import type { SugarApp } from "../app/controller";
import { Emitter } from "../core/events";
import type { Feature } from "../core/features";
import {
  PLANES,
  circleFrom3,
  dist,
  filletCorner,
  hitCorner,
  hitEntity,
  mirrorEntity,
  niceStep,
  perp,
  polygonPoints,
  roundPoint,
  sketchSegments,
  sketchSnapPoints,
  snapToGrid,
  type PlaneName,
  type SketchEntity,
  type SnapKind,
} from "../core/sketch";
import type { Vec2 } from "../core/solid";
import type { PointerHandler, Viewport } from "./viewport";

export type SketchTool =
  | "line"
  | "rect"
  | "rectCenter"
  | "rect3"
  | "circle"
  | "circle2"
  | "circle3"
  | "arc3"
  | "arcCenter"
  | "polygon"
  | "slot"
  | "ellipse"
  | "spline"
  | "fillet";

interface ToolInfo {
  label: string;
  /** Kısayol tuşu (eskiz modunda). */
  key?: string;
  /** Tamamlamak için gereken tıklama sayısı; "multi": Enter / çift tık / ilk noktaya tıklayınca biter. */
  clicks: number | "multi";
  /** Aşama başına (tıklanmış nokta sayısına göre) ipucu. */
  hints: string[];
}

export const TOOLS: Record<SketchTool, ToolInfo> = {
  line: {
    label: "Çizgi",
    key: "L",
    clicks: "multi",
    hints: ["Başlangıç noktasına tıklayın", "Sonraki noktaya tıklayın · ilk noktaya tıklayınca kapanır · çift tık / Enter bitirir"],
  },
  rect: { label: "Dikdörtgen", key: "R", clicks: 2, hints: ["İlk köşeye tıklayın", "Karşı köşeye tıklayın"] },
  rectCenter: { label: "Merkez Dikdörtgen", clicks: 2, hints: ["Merkeze tıklayın", "Bir köşeye tıklayın"] },
  rect3: { label: "3 Noktalı Dikdörtgen", clicks: 3, hints: ["İlk köşeye tıklayın", "Kenarın sonuna tıklayın", "Yüksekliği belirleyin"] },
  circle: { label: "Daire", key: "C", clicks: 2, hints: ["Merkeze tıklayın", "Çapı belirleyin"] },
  circle2: { label: "2 Noktalı Daire", clicks: 2, hints: ["Çapın bir ucuna tıklayın", "Öbür ucuna tıklayın"] },
  circle3: { label: "3 Noktalı Daire", clicks: 3, hints: ["Çember üzerinde ilk nokta", "İkinci nokta", "Üçüncü nokta"] },
  arc3: { label: "3 Noktalı Yay", key: "A", clicks: 3, hints: ["Yayın başlangıcına tıklayın", "Bitişine tıklayın", "Yayın geçtiği noktayı seçin"] },
  arcCenter: { label: "Merkez Noktalı Yay", clicks: 3, hints: ["Merkeze tıklayın", "Başlangıç noktasına tıklayın", "Bitiş açısını seçin (saat yönünün tersine)"] },
  polygon: { label: "Çokgen", key: "P", clicks: 2, hints: ["Merkeze tıklayın", "Bir köşeye tıklayın (kenar sayısı Eskiz Paletinde)"] },
  slot: { label: "Kanal", key: "T", clicks: 3, hints: ["İlk merkeze tıklayın", "İkinci merkeze tıklayın", "Genişliği belirleyin"] },
  ellipse: { label: "Elips", clicks: 3, hints: ["Merkeze tıklayın", "Büyük eksenin ucuna tıklayın", "Küçük ekseni belirleyin"] },
  spline: {
    label: "Eğri",
    clicks: "multi",
    hints: ["İlk noktaya tıklayın", "Eğrinin geçeceği noktalara tıklayın · ilk noktaya tıklayınca kapanır · Enter bitirir"],
  },
  fillet: { label: "Köşe Yuvarlatma", clicks: 1, hints: ["Yuvarlatılacak köşeye tıklayın (yarıçap Eskiz Paletinde)"] },
};

/** Araç çubuğu ve komut kaydı için kısa erişim. */
export const TOOL_LABELS = Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label])) as Record<SketchTool, string>;

export type FieldKey = "length" | "angle" | "width" | "height" | "diameter" | "radius" | "radius2" | "sweep";

export const FIELD_LABELS: Record<FieldKey, string> = {
  length: "Uzunluk",
  angle: "Açı",
  width: "Genişlik",
  height: "Yükseklik",
  diameter: "Çap",
  radius: "Yarıçap",
  radius2: "Yarıçap 2",
  sweep: "Yay açısı",
};

export interface SketchField {
  key: FieldKey;
  label: string;
  value: number;
  unit: "mm" | "°";
  locked: boolean;
}

export interface SketchOptions {
  grid: boolean;
  snapGrid: boolean;
  snapPoints: boolean;
  construction: boolean;
  showProfiles: boolean;
  polygonSides: number;
  filletRadius: number;
}

/** Yakalama mesafesi (piksel). */
const SNAP_PX = 10;
const DEG = 180 / Math.PI;
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const along = (p: Vec2, d: Vec2, s: number): Vec2 => [p[0] + d[0] * s, p[1] + d[1] * s];
const sign = (n: number) => (n < 0 ? -1 : 1);
const normDeg = (a: number) => ((a % 360) + 360) % 360;

/**
 * Eskiz modu: seçilen düzlemde çizim araçları, öğe seçimi ve çizerken ölçü yazma.
 * Her tamamlanan şekil belgeye tek bir geri alınabilir adım olarak yazılır.
 */
export class Sketcher implements PointerHandler {
  activeId: string | null = null;
  tool: SketchTool | null = null;
  /** Yapım aşamasındaki şeklin tıklanmış noktaları. */
  private pending: Vec2[] = [];
  /** Yakalanmış imleç konumu (eskiz koordinatlarında, yazılan ölçüler uygulanmadan). */
  cursor: Vec2 | null = null;
  /** İmleç neye yapıştı (köşe, merkez...); ızgaraya ya da hiçbir şeye değilse null. */
  snapKind: SnapKind | null = null;
  gridStep = 1;
  /** Seçili öğelerin indeksleri (araç yokken tıklayarak seçilir). */
  readonly selected = new Set<number>();
  hovered = -1;
  /** Klavyeden yazılıp kilitlenen ölçüler. */
  private locked: Partial<Record<FieldKey, number>> = {};
  readonly options: SketchOptions = {
    grid: true,
    snapGrid: true,
    snapPoints: true,
    construction: false,
    showProfiles: true,
    polygonSides: 6,
    filletRadius: 2,
  };
  /** Etkin eskizin düzlemi ve ofseti ("XY:0"); değişince görünüm yeniden kurulur. */
  private where = "";
  /** Kendi yaptığımız değişikliklerde seçimi korumak için. */
  private keepSelection = false;

  readonly onDidChange = new Emitter<void>();

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
  ) {
    app.document.onDidChange.on(() => {
      if (!this.activeId) return;
      const f = this.sketch();
      // Eskiz geri alma ile silindiyse moddan çık.
      if (!f || !f.plane) return this.exit();
      if (!this.keepSelection) this.selected.clear();
      this.hovered = -1;
      // Düzlem ya da ofset değiştiyse kamera ve ızgara yeni düzleme geçsin.
      const where = `${f.plane}:${f.params.offset ?? 0}`;
      if (where !== this.where) {
        this.where = where;
        this.pending = [];
        this.viewport.enterSketch(f.id, f.plane, f.params.offset ?? 0);
      }
      this.updatePreview();
      this.onDidChange.fire();
    });
  }

  get isActive(): boolean {
    return this.activeId !== null;
  }

  sketch(): Feature | undefined {
    return this.activeId ? this.app.document.get(this.activeId) : undefined;
  }

  private entities(): SketchEntity[] {
    return this.sketch()?.entities ?? [];
  }

  get plane(): PlaneName {
    return this.sketch()?.plane ?? "XY";
  }

  private get offset(): number {
    return this.sketch()?.params.offset ?? 0;
  }

  /** Çizim yarıda mı (en az bir nokta tıklanmış)? */
  get isDrawing(): boolean {
    return this.pending.length > 0;
  }

  /** Düzlem seçtirip yeni eskiz açar (ya da verilen düzlemde). */
  async startNew(plane?: PlaneName, offset = 0): Promise<void> {
    if (this.isActive) this.finish();
    const chosen = plane ?? (await this.viewport.pickPlane());
    if (!chosen) return;
    const f = this.app.createSketch(chosen, offset);
    this.edit(f.id);
  }

  /** Var olan bir eskizi düzenlemeye açar (kullanılmış olsa bile: değişiklik katıya yansır). */
  edit(id: string): void {
    const f = this.app.document.get(id);
    if (!f || f.type !== "sketch" || !f.plane) throw new Error("Düzenlemek için bir eskiz seçin");
    this.viewport.cancelPlanePick();
    this.activeId = id;
    this.pending = [];
    this.locked = {};
    this.selected.clear();
    this.tool = this.tool ?? "line";
    this.where = `${f.plane}:${f.params.offset ?? 0}`;
    this.viewport.enterSketch(id, f.plane, f.params.offset ?? 0);
    this.viewport.setInteraction(this);
    this.syncViewOptions();
    this.app.document.setSelection([id]);
    this.onDidChange.fire();
  }

  setTool(tool: SketchTool | null): void {
    if (!this.isActive) throw new Error("Önce bir eskiz açın (Eskiz düğmesi)");
    this.tool = tool;
    this.pending = [];
    this.locked = {};
    if (tool) this.selected.clear();
    this.updatePreview();
    this.onDidChange.fire();
  }

  setOption<K extends keyof SketchOptions>(key: K, value: SketchOptions[K]): void {
    this.options[key] = value;
    this.syncViewOptions();
    this.updatePreview();
    this.onDidChange.fire();
  }

  private syncViewOptions(): void {
    this.viewport.setSketchOptions({ grid: this.options.grid, profiles: this.options.showProfiles });
    this.viewport.setSketchHighlight([...this.selected], this.hovered);
  }

  /** Eskizi kapatır. Yarım kalan çizgi en az iki noktalıysa açık çizgi olarak kaydedilir. */
  finish(): void {
    if (!this.isActive) return;
    if (this.tool === "line" || this.tool === "spline") this.commitMulti(false);
    const id = this.activeId!;
    this.exit();
    // Sonucun 3D'si görünsün (Ekstrüzyon/Döndürme bir sonraki adım).
    this.viewport.setView("iso");
    if (this.app.document.get(id)) this.app.document.setSelection([id]);
  }

  private exit(): void {
    this.activeId = null;
    this.pending = [];
    this.locked = {};
    this.cursor = null;
    this.selected.clear();
    this.hovered = -1;
    this.viewport.setInteraction(null);
    this.viewport.exitSketch();
    this.onDidChange.fire();
  }

  /** Esc: önce yarım şekli, sonra seçimi, sonra aracı bırakır; hiçbiri yoksa eskizden çıkar. */
  escape(): void {
    if (this.pending.length) {
      this.pending = [];
      this.locked = {};
    } else if (this.selected.size) this.selected.clear();
    else if (this.tool) this.tool = null;
    else return this.finish();
    this.updatePreview();
    this.onDidChange.fire();
  }

  /** Enter: açık çizgiyi / eğriyi bitirir ya da yazılan ölçülerle noktayı onaylar. */
  enter(): void {
    if ((this.tool === "line" || this.tool === "spline") && this.pending.length >= 2 && !Object.keys(this.locked).length) {
      this.commitMulti(false);
      return;
    }
    this.commitTyped();
  }

  /** Backspace: son tıklanan noktayı geri alır. */
  backspace(): void {
    if (!this.pending.length) return;
    this.pending.pop();
    this.locked = {};
    this.updatePreview();
    this.onDidChange.fire();
  }

  reportError(e: unknown): void {
    this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
  }

  // ---- seçili öğeler ----

  deleteSelected(): void {
    const f = this.sketch();
    if (!f || !this.selected.size) return;
    const entities = this.entities().filter((_, i) => !this.selected.has(i));
    this.selected.clear();
    this.app.document.update(f.id, { entities });
  }

  /** Seçili öğeleri yapı çizgisine çevirir (ya da geri); seçim yoksa yeni çizimler için modu değiştirir. */
  toggleConstruction(): void {
    const f = this.sketch();
    if (!f) return;
    if (!this.selected.size) {
      this.setOption("construction", !this.options.construction);
      return;
    }
    const all = [...this.selected].every((i) => this.entities()[i]?.construction);
    const entities = this.entities().map((e, i) => {
      if (!this.selected.has(i)) return e;
      const { construction: _c, ...rest } = e;
      return (all ? rest : { ...rest, construction: true }) as SketchEntity;
    });
    this.updateKeepingSelection(f.id, entities);
  }

  /** Seçili öğelerin aynalanmış kopyalarını ekler (V: dikey eksen, U: yatay eksen). */
  mirrorSelected(axis: "U" | "V"): void {
    const f = this.sketch();
    if (!f) return;
    if (!this.selected.size) throw new Error("Aynalamak için önce öğe seçin (araç yokken tıklayın, Ctrl ile çoklu seçim)");
    const entities = this.entities();
    const copies = [...this.selected].sort((a, b) => a - b).map((i) => mirrorEntity(entities[i], axis));
    this.app.document.update(f.id, { entities: [...entities, ...copies] });
  }

  selectAll(): void {
    this.entities().forEach((_, i) => this.selected.add(i));
    this.syncViewOptions();
    this.onDidChange.fire();
  }

  private updateKeepingSelection(id: string, entities: SketchEntity[]): void {
    this.keepSelection = true;
    try {
      this.app.document.update(id, { entities });
    } finally {
      this.keepSelection = false;
    }
  }

  // ---- fare ----

  pointerMove(e: PointerEvent): void {
    this.cursor = this.snap(e.clientX, e.clientY);
    if (!this.tool) {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      const hovered = raw ? hitEntity(this.entities(), raw, SNAP_PX * this.viewport.worldPerPixel()) : -1;
      if (hovered !== this.hovered) {
        this.hovered = hovered;
        this.syncViewOptions();
      }
    }
    this.updatePreview();
    this.onDidChange.fire();
  }

  pointerLeave(): void {
    this.cursor = null;
    this.hovered = -1;
    this.syncViewOptions();
    this.updatePreview();
  }

  click(e: PointerEvent): void {
    if (!this.tool) {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      const hit = raw ? hitEntity(this.entities(), raw, SNAP_PX * this.viewport.worldPerPixel()) : -1;
      this.selectEntity(hit, e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    const p = this.snap(e.clientX, e.clientY);
    if (!p) return;
    this.cursor = p;
    this.addPoint(this.constrain(p));
  }

  doubleClick(): void {
    if (this.tool === "line" || this.tool === "spline") this.commitMulti(false);
  }

  /** Öğe seçimi (indeks −1: boşluğa tıklama). */
  selectEntity(index: number, toggle = false): void {
    if (!toggle) this.selected.clear();
    if (index >= 0) {
      if (toggle && this.selected.has(index)) this.selected.delete(index);
      else this.selected.add(index);
    }
    this.syncViewOptions();
    this.onDidChange.fire();
  }

  /** Eskiz koordinatında bir tıklama (fare ve testler bunu kullanır). */
  addPoint(p: Vec2): void {
    const tool = this.tool;
    if (!tool) return;
    const info = TOOLS[tool];
    if (tool === "fillet") {
      this.filletAt(p);
      return;
    }
    if (info.clicks === "multi") {
      const last = this.pending.at(-1);
      if (last && same(last, p)) return; // çift tıklamanın ikinci tıkı
      if (this.pending.length >= 3 && same(this.pending[0], p)) {
        this.commitMulti(true);
        return;
      }
      this.pending.push(p);
      this.locked = {};
      this.updatePreview();
      this.onDidChange.fire();
      return;
    }
    if (this.pending.some((q) => same(q, p))) return; // aynı noktaya ikinci tık
    const points = [...this.pending, p];
    if (points.length < info.clicks) {
      this.pending = points;
      this.locked = {};
      this.updatePreview();
      this.onDidChange.fire();
      return;
    }
    const entity = buildEntity(tool, points, this.options);
    // Geçersiz (sıfır boyutlu, doğrusal) şekilde son tık yok sayılır.
    if (entity) this.commit(entity);
  }

  private filletAt(p: Vec2): void {
    const f = this.sketch();
    if (!f) return;
    const hit = hitCorner(this.entities(), p, SNAP_PX * 1.5 * this.viewport.worldPerPixel());
    if (!hit) {
      this.app.showMessage("Yuvarlatmak için çizgi ya da dikdörtgen köşesine tıklayın", "warning");
      return;
    }
    const entities = [...this.entities()];
    entities[hit.entity] = filletCorner(entities[hit.entity], hit.vertex, this.options.filletRadius);
    this.app.document.update(f.id, { entities });
  }

  private commitMulti(closed: boolean): void {
    if (this.pending.length < 2) return;
    const points = this.pending;
    this.commit(
      this.tool === "spline" ? { kind: "spline", points, closed } : { kind: "polyline", points, closed },
    );
  }

  private commit(entity: SketchEntity): void {
    const f = this.sketch();
    if (!f) return;
    this.pending = [];
    this.locked = {};
    const e = this.options.construction ? { ...entity, construction: true } : entity;
    this.app.document.update(f.id, { entities: [...(f.entities ?? []), e] });
  }

  // ---- yazılan ölçüler ----

  /** O anki aşamada klavyeden girilebilecek ölçüler. */
  private fieldKeys(): FieldKey[] {
    const s = this.pending.length;
    if (s === 0) return [];
    switch (this.tool) {
      case "line":
      case "spline":
        return ["length", "angle"];
      case "rect":
      case "rectCenter":
        return ["width", "height"];
      case "rect3":
        return s === 1 ? ["length", "angle"] : ["height"];
      case "circle":
      case "circle2":
        return ["diameter"];
      case "polygon":
        return ["radius", "angle"];
      case "arcCenter":
        return s === 1 ? ["radius", "angle"] : ["sweep"];
      case "slot":
        return s === 1 ? ["length", "angle"] : ["width"];
      case "ellipse":
        return s === 1 ? ["radius", "angle"] : ["radius2"];
      default:
        return [];
    }
  }

  /** Ölçü kutucukları: kilitliyse yazılan değer, değilse imlecin ölçüsü. */
  fields(): SketchField[] {
    const keys = this.fieldKeys();
    if (!keys.length) return [];
    const point = this.cursor ? this.constrain(this.cursor) : null;
    return keys.map((key) => ({
      key,
      label: FIELD_LABELS[key],
      unit: key === "angle" || key === "sweep" ? "°" : "mm",
      locked: this.locked[key] !== undefined,
      value: this.locked[key] ?? (point ? this.measure(key, point) : 0),
    }));
  }

  /** Bir ölçüyü kilitler (undefined: kilidi açar). */
  lockField(key: FieldKey, value: number | undefined): void {
    if (value === undefined || !Number.isFinite(value)) delete this.locked[key];
    else this.locked[key] = value;
    this.updatePreview();
    this.onDidChange.fire();
  }

  /** Yazılan ölçülerle (eksikler imleçten) noktayı ekler. */
  commitTyped(): void {
    if (!this.tool || !this.pending.length) return;
    const base = this.cursor ?? this.pending.at(-1)!;
    this.addPoint(this.constrain(base));
  }

  /** Kilitli ölçüleri imleç noktasına uygular. */
  private constrain(c: Vec2): Vec2 {
    const p = this.pending;
    const L = this.locked;
    const s = p.length;
    if (!s) return c;
    const base = p[s - 1];
    const polar = (key: "length" | "radius", from: Vec2): Vec2 => {
      const length = L[key] ?? dist(from, c);
      const ang = L.angle !== undefined ? L.angle / DEG : Math.atan2(c[1] - from[1], c[0] - from[0]);
      return roundPoint([from[0] + length * Math.cos(ang), from[1] + length * Math.sin(ang)]);
    };
    // Ölçü yazılmadıysa imleç olduğu gibi kullanılır (ızgara / köşe yakalaması korunur).
    const any = Object.keys(L).length > 0;
    if (!any) return c;
    switch (this.tool) {
      case "line":
      case "spline":
        return polar("length", base);
      case "rect":
      case "rectCenter": {
        const k = this.tool === "rectCenter" ? 0.5 : 1;
        const dx = c[0] - base[0];
        const dy = c[1] - base[1];
        const w = L.width !== undefined ? L.width * k : Math.abs(dx);
        const hh = L.height !== undefined ? L.height * k : Math.abs(dy);
        return roundPoint([base[0] + sign(dx) * w, base[1] + sign(dy) * hh]);
      }
      case "circle":
        return this.radial(base, c, L.diameter !== undefined ? L.diameter / 2 : undefined);
      case "circle2":
        return this.radial(base, c, L.diameter);
      case "polygon":
        return polar("radius", base);
      case "rect3":
        if (s === 1) return polar("length", base);
        return this.offsetFromLine(p[0], p[1], p[1], c, L.height);
      case "slot":
        if (s === 1) return polar("length", base);
        return this.offsetFromLine(p[0], p[1], p[0], c, L.width !== undefined ? L.width / 2 : undefined);
      case "ellipse":
        if (s === 1) return polar("radius", base);
        return this.offsetFromLine(p[0], p[1], p[0], c, L.radius2);
      case "arcCenter": {
        if (s === 1) return polar("radius", base);
        const [center, start] = p;
        const r = dist(center, start);
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const a = L.sweep !== undefined ? a0 + L.sweep / DEG : Math.atan2(c[1] - center[1], c[0] - center[0]);
        return roundPoint([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
      }
      default:
        return c;
    }
  }

  /** `base`'den imleç yönünde, verilen (ya da imlecin) uzaklıktaki nokta. */
  private radial(base: Vec2, c: Vec2, length: number | undefined): Vec2 {
    if (length === undefined) return c;
    const ang = Math.atan2(c[1] - base[1], c[0] - base[0]);
    return roundPoint([base[0] + length * Math.cos(ang), base[1] + length * Math.sin(ang)]);
  }

  /** a→b doğrusuna dik yönde, imlecin tarafında `amount` kadar uzaktaki nokta (`from`'dan ölçülür). */
  private offsetFromLine(a: Vec2, b: Vec2, from: Vec2, c: Vec2, amount: number | undefined): Vec2 {
    const n = perp(sub(b, a));
    const d = dot(sub(c, from), n);
    const h = amount !== undefined ? Math.abs(amount) * sign(d) : d;
    return roundPoint(along(from, n, h));
  }

  /** Noktanın verilen ölçü cinsinden değeri (kutucuklarda gösterilir). */
  private measure(key: FieldKey, pt: Vec2): number {
    const p = this.pending;
    const base = p[p.length - 1];
    const r = (n: number) => Number(n.toFixed(2)) + 0;
    switch (key) {
      case "length":
      case "radius":
        return r(dist(base, pt));
      case "angle":
        return r(normDeg(Math.atan2(pt[1] - base[1], pt[0] - base[0]) * DEG));
      case "width":
        return r(Math.abs(pt[0] - base[0]) * (this.tool === "rectCenter" ? 2 : 1));
      case "height":
        if (this.tool === "rect3") return r(Math.abs(dot(sub(pt, p[1]), perp(sub(p[1], p[0])))));
        return r(Math.abs(pt[1] - base[1]) * (this.tool === "rectCenter" ? 2 : 1));
      case "diameter":
        return r(dist(base, pt) * (this.tool === "circle" ? 2 : 1));
      case "radius2":
        return r(Math.abs(dot(sub(pt, p[0]), perp(sub(p[1], p[0])))));
      case "sweep": {
        const [center, start] = p;
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        return r(normDeg((Math.atan2(pt[1] - center[1], pt[0] - center[0]) - a0) * DEG));
      }
      default:
        return 0;
    }
  }

  // ---- yakalama ----

  private snap(clientX: number, clientY: number): Vec2 | null {
    const raw = this.viewport.planePoint(clientX, clientY, this.plane, this.offset);
    if (!raw) return null;
    const wpp = this.viewport.worldPerPixel();
    this.gridStep = niceStep(wpp * 12);
    this.snapKind = null;
    if (this.options.snapPoints) {
      const candidates = [
        ...sketchSnapPoints(this.entities()),
        ...this.pending.map((p) => ({ p, kind: "köşe" as SnapKind })),
      ];
      let best: { p: Vec2; kind: SnapKind } | null = null;
      let bestDist = SNAP_PX * wpp;
      for (const c of candidates) {
        // Köşeler orta noktalardan önceliklidir.
        const d = dist(c.p, raw) * (c.kind === "orta nokta" ? 1.4 : 1);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      if (best) {
        this.snapKind = best.kind;
        return [best.p[0], best.p[1]];
      }
    }
    return this.options.snapGrid ? snapToGrid(raw, this.gridStep) : roundPoint(raw);
  }

  /** Eski API: imleç bir noktaya yapıştı mı? */
  get snappedToPoint(): boolean {
    return this.snapKind !== null;
  }

  // ---- önizleme ----

  private updatePreview(): void {
    if (!this.isActive) return;
    this.syncViewOptions();
    const segs: [Vec2, Vec2][] = [];
    const c = this.cursor ? this.constrain(this.cursor) : null;
    const p = this.pending;
    const tool = this.tool;
    if (tool && tool !== "fillet" && p.length && c) {
      const info = TOOLS[tool];
      const points = [...p, c];
      if (info.clicks === "multi") {
        segs.push(...sketchSegments([tool === "spline" ? { kind: "spline", points, closed: false } : { kind: "polyline", points, closed: false }]));
      } else if (points.length === info.clicks) {
        const e = buildEntity(tool, points, this.options);
        if (e) segs.push(...sketchSegments([e]));
        // Daire ve çokgende yarıçap çizgisi, yayda merkez çizgileri yardımcı olur.
        if (tool === "circle" || tool === "polygon") segs.push([p[0], c]);
      } else {
        // Henüz eksik: tıklanan noktaları imleçle birleştir.
        for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
        if (tool === "arcCenter" && p.length === 1) {
          const r = dist(p[0], c);
          if (r > 0) segs.push(...sketchSegments([{ kind: "circle", c: p[0], r }]));
        }
      }
    }
    this.viewport.setPreview(segs, this.plane, this.offset, c ?? undefined);
  }

  /** Durum çubuğu için açıklama. */
  statusText(): string {
    if (!this.isActive) return "";
    const plane = PLANES[this.plane].label;
    let text: string;
    if (this.tool) {
      const info = TOOLS[this.tool];
      const hint = info.hints[Math.min(this.pending.length, info.hints.length - 1)];
      const typing = this.fieldKeys().length ? " · ölçü yazmak için rakam girin" : "";
      text = `${info.label}: ${hint}${typing}`;
    } else if (this.selected.size) {
      text = `${this.selected.size} öğe seçili · Delete sil · X yapı çizgisi`;
    } else {
      text = "Seçim: öğelere tıklayın (Ctrl ile çoklu) · bir araç seçin (L, R, C, A, P, T)";
    }
    return `Eskiz · ${plane} — ${text}`;
  }
}

/** Tıklanan noktalardan öğe kurar; geçersiz (sıfır boyutlu, doğrusal) ise null. */
export function buildEntity(tool: SketchTool, pts: Vec2[], options: Pick<SketchOptions, "polygonSides">): SketchEntity | null {
  const tiny = 1e-9;
  switch (tool) {
    case "rect": {
      const [a, b] = pts;
      return Math.abs(a[0] - b[0]) > tiny && Math.abs(a[1] - b[1]) > tiny ? { kind: "rect", a, b } : null;
    }
    case "rectCenter": {
      const [c, b] = pts;
      const a = roundPoint([2 * c[0] - b[0], 2 * c[1] - b[1]]);
      return Math.abs(a[0] - b[0]) > tiny && Math.abs(a[1] - b[1]) > tiny ? { kind: "rect", a, b } : null;
    }
    case "rect3": {
      const [p0, p1, p2] = pts;
      if (dist(p0, p1) < tiny) return null;
      const n = perp(sub(p1, p0));
      const h = dot(sub(p2, p1), n);
      if (Math.abs(h) < tiny) return null;
      return { kind: "polyline", points: [p0, p1, roundPoint(along(p1, n, h)), roundPoint(along(p0, n, h))], closed: true };
    }
    case "circle": {
      const r = dist(pts[0], pts[1]);
      return r > tiny ? { kind: "circle", c: pts[0], r: Number(r.toFixed(6)) } : null;
    }
    case "circle2": {
      const r = dist(pts[0], pts[1]) / 2;
      const c = roundPoint([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]);
      return r > tiny ? { kind: "circle", c, r: Number(r.toFixed(6)) } : null;
    }
    case "circle3": {
      const g = circleFrom3(pts[0], pts[1], pts[2]);
      return g ? { kind: "circle", c: roundPoint(g.c), r: Number(g.r.toFixed(6)) } : null;
    }
    case "arc3": {
      const [start, end, through] = pts;
      return circleFrom3(start, through, end) ? { kind: "arc", p0: start, p1: through, p2: end } : null;
    }
    case "arcCenter": {
      const [c, start, end] = pts;
      const r = dist(c, start);
      if (r < tiny) return null;
      const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
      const a1 = Math.atan2(end[1] - c[1], end[0] - c[0]);
      const sweep = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep < 1e-6) return null;
      const mid = a0 + sweep / 2;
      return {
        kind: "arc",
        p0: start,
        p1: roundPoint([c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid)]),
        p2: roundPoint([c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)]),
      };
    }
    case "polygon":
      return dist(pts[0], pts[1]) > tiny ? { kind: "polyline", points: polygonPoints(pts[0], pts[1], options.polygonSides), closed: true } : null;
    case "slot": {
      const [a, b, w] = pts;
      const r = Math.abs(dot(sub(w, a), perp(sub(b, a))));
      return r > tiny && dist(a, b) > tiny ? { kind: "slot", a, b, r: Number(r.toFixed(6)) } : null;
    }
    case "ellipse": {
      const [c, major, q] = pts;
      const rx = dist(c, major);
      const ry = Math.abs(dot(sub(q, c), perp(sub(major, c))));
      if (rx < tiny || ry < tiny) return null;
      return { kind: "ellipse", c, rx: Number(rx.toFixed(6)), ry: Number(ry.toFixed(6)), rot: Number(Math.atan2(major[1] - c[1], major[0] - c[0]).toFixed(9)) };
    }
    default:
      return null;
  }
}
