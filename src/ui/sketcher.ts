import type { SugarApp } from "../app/controller";
import { Emitter } from "../core/events";
import { sketchDataOf, type Feature } from "../core/features";
import { PLANES, dist, niceStep, perp, roundPoint, snapToGrid, type PlaneName } from "../core/sketch";
import { planConstraint, planDimension, type DimensionChoice } from "../core/constrain";
import {
  CONSTRAINT_LABELS,
  SketchEdit,
  buildArc3,
  buildCircle3,
  buildPolygon,
  buildPolyline,
  buildRect,
  buildSlot,
  curveSegments,
  filletCorner,
  hitCurve,
  hitPoint,
  pointMap,
  snapCandidates,
  type GeometricConstraintType,
  type SketchData,
  type SnapKind,
} from "../core/sketchmodel";
import { extendCurve, offsetCurves, patternCircular, patternRect, rotateAbout, trimCurve, translateBy } from "../core/sketchops";
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
  | "point"
  | "fillet"
  | "trim"
  | "extend"
  | "offset"
  | "dimension";

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
  dimension: { label: "Ölçü", key: "D", clicks: 1, hints: ["Ölçülecek çizgi, daire, yay ya da nokta seçin (iki nokta / nokta + çizgi / iki çizgi de olur)"] },
  point: { label: "Nokta", clicks: 1, hints: ["Noktayı yerleştirmek için tıklayın"] },
  fillet: { label: "Köşe Yuvarlatma", clicks: 1, hints: ["Yuvarlatılacak köşeye tıklayın (yarıçap Eskiz Paletinde)"] },
  trim: { label: "Kırp", key: "K", clicks: 1, hints: ["Kesişimler arasında silinecek parçaya tıklayın (kesişimi olmayan eğri tamamen silinir)"] },
  extend: { label: "Uzat", key: "U", clicks: 1, hints: ["Uzatılacak çizginin ucuna yakın bir yere tıklayın (en yakın kesişime kadar uzar)"] },
  offset: {
    label: "Ofset",
    key: "O",
    clicks: 1,
    hints: [
      "Ötelenecek eğriye tıklayın (bağlı eğriler birlikte ötelenir)",
      "Yönü belirlemek için bir yere tıklayın · mesafe Eskiz Paletinde (0 ise imlecin uzaklığı) · Esc iptal",
    ],
  },
};

/** Tek tıklamayla bir eğriye uygulanan düzenleme araçları. */
const CURVE_TOOLS = new Set<SketchTool>(["trim", "extend", "offset"]);

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
  showConstraints: boolean;
  polygonSides: number;
  filletRadius: number;
  /** Ofset mesafesi (mm); 0 ise tıklanan noktanın eğriye uzaklığı kullanılır. */
  offsetDistance: number;
}

/** Ölçü kutusunda düzenlenen (henüz kaydedilmemiş ya da var olan) ölçü. */
export interface DimensionDraft {
  items: string[];
  /** Seçilebilecek ölçü türleri (ilki öneridir); açılan ölçü düzenlemesinde tek öğedir. */
  choices: DimensionChoice[];
  index: number;
  /** Var olan bir ölçü düzenleniyorsa kimliği. */
  editing?: string;
}

const SIGNED = new Set(["hdistance", "vdistance", "angle"]);

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
  /** Yapım aşamasındaki noktaların yakalandığı mevcut nokta kimlikleri (aynı sırayla). */
  private pendingIds: (string | null)[] = [];
  /** Seçili öğeler: eğri ("c…"), nokta ("p…") ve kısıt ("k…") kimlikleri (araç yokken tıklayarak seçilir). */
  readonly selected = new Set<string>();
  hovered: string | null = null;
  /** İmlecin yakalandığı mevcut nokta (varsa); yeni çizim ona bağlanır. */
  private snapId: string | null = null;
  /** Ölçü aracının topladığı öğeler ve açık ölçü kutusu. */
  private dimPick: string[] = [];
  draft: DimensionDraft | null = null;
  /** Sürükleyerek düzenleme (araç yokken bir noktayı ya da eğriyi tutup çekmek). */
  private drag: {
    start: SketchData;
    ids: string[];
    origin: Vec2;
    origins: Map<string, Vec2>;
    active: boolean;
    cx: number;
    cy: number;
  } | null = null;
  /** Son çözümün durumu: serbestlik derecesi ve çelişen / gereksiz kısıtlar. */
  solveInfo: { dof: number; conflicting: string[]; redundant: string[]; solved: boolean } = { dof: 0, conflicting: [], redundant: [], solved: false };
  /** Klavyeden yazılıp kilitlenen ölçüler. */
  private locked: Partial<Record<FieldKey, number>> = {};
  readonly options: SketchOptions = {
    grid: true,
    snapGrid: true,
    snapPoints: true,
    construction: false,
    showProfiles: true,
    showConstraints: true,
    polygonSides: 6,
    filletRadius: 2,
    offsetDistance: 0,
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
      this.hovered = null;
      this.refreshSolveInfo();
      // Düzlem ya da ofset değiştiyse kamera ve ızgara yeni düzleme geçsin.
      const where = `${f.plane}:${f.params.offset ?? 0}`;
      if (where !== this.where) {
        this.where = where;
        this.resetPending();
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

  /** Etkin eskizin geometrisi (sürüklerken canlı veri, yoksa belgedeki). */
  data(): SketchData {
    const f = this.sketch();
    return this.live ?? (f ? sketchDataOf(f) : { points: [], curves: [], constraints: [], next: 1 });
  }

  /** Sürükleme sırasında belgeye yazılmamış, çözülmüş geçici veri. */
  private live: SketchData | null = null;

  private refreshSolveInfo(): void {
    const solver = this.app.solver;
    const f = this.sketch();
    if (!solver || !f) {
      this.solveInfo = { dof: 0, conflicting: [], redundant: [], solved: false };
      return;
    }
    const r = solver.solve(sketchDataOf(f));
    this.solveInfo = { dof: r.dof, conflicting: r.conflicting, redundant: r.redundant, solved: true };
  }

  get plane(): PlaneName {
    return this.sketch()?.plane ?? "XY";
  }

  private get offset(): number {
    return this.sketch()?.params.offset ?? 0;
  }

  private resetPending(): void {
    this.pending = [];
    this.pendingIds = [];
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
    this.resetPending();
    this.locked = {};
    this.selected.clear();
    this.tool = this.tool ?? "line";
    this.where = `${f.plane}:${f.params.offset ?? 0}`;
    this.viewport.enterSketch(id, f.plane, f.params.offset ?? 0);
    this.viewport.setInteraction(this);
    this.refreshSolveInfo();
    this.syncViewOptions();
    this.app.document.setSelection([id]);
    this.onDidChange.fire();
  }

  setTool(tool: SketchTool | null): void {
    if (!this.isActive) throw new Error("Önce bir eskiz açın (Eskiz düğmesi)");
    this.tool = tool;
    this.resetPending();
    this.locked = {};
    this.dimPick = [];
    this.draft = null;
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
    this.resetPending();
    this.locked = {};
    this.cursor = null;
    this.selected.clear();
    this.hovered = null;
    this.live = null;
    this.viewport.setInteraction(null);
    this.viewport.exitSketch();
    this.onDidChange.fire();
  }

  /** Esc: önce yarım şekli, sonra seçimi, sonra aracı bırakır; hiçbiri yoksa eskizden çıkar. */
  escape(): void {
    if (this.draft || this.dimPick.length) {
      this.cancelDimension();
      return;
    }
    if (this.pending.length) {
      this.resetPending();
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
    this.pendingIds.pop();
    this.locked = {};
    this.updatePreview();
    this.onDidChange.fire();
  }

  reportError(e: unknown): void {
    this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
  }

  // ---- seçili öğeler ----

  /** Verilen düzenlemeyi (kısıtlar çözülerek) belgeye yazar. Çelişki varsa çözülmemiş hâli yazar ve uyarır. */
  apply(ed: SketchEdit, keepSelection = false): void {
    const f = this.sketch();
    if (!f) return;
    let data = ed.result();
    const solver = this.app.solver;
    if (solver && data.constraints.length) {
      const r = solver.solve(data);
      if (r.ok) data = r.data;
      else if (r.conflicting.length) {
        this.app.showMessage("Kısıtlar birbiriyle çelişiyor; çelişen kısıtlar kırmızı gösterilir (silerek düzeltin)", "warning");
      } else this.app.showMessage("Kısıtlar çözülemedi; şekil değişmeden bırakıldı", "warning");
    }
    this.live = null;
    this.keepSelection = keepSelection;
    try {
      this.app.document.update(f.id, { sketchData: data });
    } finally {
      this.keepSelection = false;
    }
  }

  private edit_(): SketchEdit {
    return new SketchEdit(this.data());
  }

  deleteSelected(): void {
    if (!this.selected.size) return;
    const ed = this.edit_();
    const d = ed.d;
    const curves = new Set([...this.selected].filter((id) => id.startsWith("c")));
    // Seçili bir nokta, ona bağlı bütün eğrilerle birlikte silinir.
    for (const id of this.selected) {
      if (!id.startsWith("p")) continue;
      for (const c of d.curves) if (curvePointIds(c).includes(id)) curves.add(c.id);
    }
    ed.deleteConstraints([...this.selected].filter((id) => id.startsWith("k")));
    if (curves.size) ed.deleteCurves(curves);
    this.selected.clear();
    this.apply(ed);
  }

  /** Seçili eğrileri yapı çizgisine çevirir (ya da geri); seçim yoksa yeni çizimler için modu değiştirir. */
  toggleConstruction(): void {
    const ids = [...this.selected].filter((id) => id.startsWith("c"));
    if (!ids.length) {
      this.setOption("construction", !this.options.construction);
      return;
    }
    const ed = this.edit_();
    const all = ids.every((id) => ed.d.curves.find((c) => c.id === id)?.construction);
    for (const c of ed.d.curves) {
      if (!ids.includes(c.id)) continue;
      if (all) delete c.construction;
      else c.construction = true;
    }
    this.apply(ed, true);
  }

  /** Seçili eğrilerin aynalanmış kopyalarını ekler (V: dikey eksen, U: yatay eksen). */
  mirrorSelected(axis: "U" | "V"): void {
    const ids = [...this.selected].filter((id) => id.startsWith("c"));
    if (!ids.length) throw new Error("Aynalamak için önce öğe seçin (araç yokken tıklayın, Ctrl ile çoklu seçim)");
    const ed = this.edit_();
    ed.copyCurves(ids, ([a, b]) => roundPoint(axis === "V" ? [-a, b] : [a, -b]), true);
    this.apply(ed);
  }

  selectAll(): void {
    this.data().curves.forEach((c) => this.selected.add(c.id));
    this.syncViewOptions();
    this.onDidChange.fire();
  }

  // ---- fare ----

  pointerDown(e: PointerEvent): void {
    if (this.tool || e.button !== 0) return;
    const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
    const id = raw ? this.hit(raw) : null;
    if (!raw || !id || id.startsWith("k")) return;
    const d = this.data();
    const pm = pointMap(d);
    const curve = d.curves.find((c) => c.id === id);
    const ids = curve ? [...new Set(curvePointIds(curve))] : [id];
    this.drag = { start: structuredClone(d), ids, origin: raw, origins: new Map(ids.map((i) => [i, pm.get(i)!])), active: false, cx: e.clientX, cy: e.clientY };
  }

  pointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.active) return;
    const f = this.sketch();
    const data = this.live;
    this.live = null;
    this.viewport.setLiveSketch(null);
    if (!f || !data) return;
    this.keepSelection = true;
    try {
      this.app.document.update(f.id, { sketchData: data });
    } finally {
      this.keepSelection = false;
    }
  }

  /** Tutulan öğeyi imleçle birlikte sürükler; kısıtlar çözücüyle korunur. */
  private dragTo(e: PointerEvent): void {
    const drag = this.drag!;
    if (!drag.active && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;
    drag.active = true;
    const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
    if (!raw) return;
    this.gridStep = niceStep(this.viewport.worldPerPixel() * 12);
    const grabbed = drag.ids.length === 1 && this.options.snapGrid ? snapToGrid(raw, this.gridStep) : raw;
    const delta: Vec2 = [grabbed[0] - drag.origin[0], grabbed[1] - drag.origin[1]];
    const targets = drag.ids.map((point) => {
      const o = drag.origins.get(point)!;
      return { point, to: roundPoint([o[0] + delta[0], o[1] + delta[1]]) };
    });
    const solver = this.app.solver;
    if (solver) {
      const r = solver.solve(drag.start, { drag: targets });
      this.solveInfo = { dof: r.dof, conflicting: r.conflicting, redundant: r.redundant, solved: true };
      if (r.ok) this.live = r.data;
    } else {
      const moved = structuredClone(drag.start);
      for (const t of targets) {
        const p = moved.points.find((q) => q.id === t.point);
        if (p) [p.x, p.y] = t.to;
      }
      this.live = moved;
    }
    if (this.live) this.viewport.setLiveSketch(this.live);
    this.cursor = roundPoint(raw);
    this.onDidChange.fire();
  }

  pointerMove(e: PointerEvent): void {
    if (this.drag && e.buttons & 1) {
      this.dragTo(e);
      return;
    }
    this.cursor = this.snap(e.clientX, e.clientY);
    if (!this.tool || CURVE_TOOLS.has(this.tool)) {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      const source = this.tool === "offset" && this.pending.length ? this.pendingIds[0] : null;
      const hovered = source ?? (raw ? (this.tool ? this.hitCurveOnly(raw) : this.hit(raw)) : null);
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
    this.hovered = null;
    this.syncViewOptions();
    this.updatePreview();
  }

  /** Eskiz koordinatındaki öğe: önce nokta, sonra eğri. */
  private hit(raw: Vec2): string | null {
    const tol = SNAP_PX * this.viewport.worldPerPixel();
    const d = this.data();
    return hitPoint(d, raw, tol) ?? hitCurve(d, raw, tol);
  }

  private hitCurveOnly(raw: Vec2): string | null {
    return hitCurve(this.data(), raw, SNAP_PX * this.viewport.worldPerPixel());
  }

  click(e: PointerEvent): void {
    if (this.tool && CURVE_TOOLS.has(this.tool)) {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      if (raw) this.editCurveAt(this.tool, raw);
      return;
    }
    if (!this.tool) {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      this.selectItem(raw ? this.hit(raw) : null, e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    if (this.tool === "dimension") {
      const raw = this.viewport.planePoint(e.clientX, e.clientY, this.plane, this.offset);
      this.pickForDimension(raw ? this.hit(raw) : null);
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

  /** Öğe seçimi (null: boşluğa tıklama). */
  selectItem(id: string | null, toggle = false): void {
    if (!toggle) this.selected.clear();
    if (id) {
      if (toggle && this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    }
    this.syncViewOptions();
    this.onDidChange.fire();
  }

  /** Eskiz koordinatında bir tıklama (fare ve testler bunu kullanır). `id`: yakalanan mevcut nokta. */
  addPoint(p: Vec2, id: string | null = this.snapId): void {
    const tool = this.tool;
    if (!tool) return;
    const info = TOOLS[tool];
    if (tool === "fillet") {
      this.filletAt(p, id);
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
      this.pendingIds.push(id);
      this.locked = {};
      this.updatePreview();
      this.onDidChange.fire();
      return;
    }
    if (this.pending.some((q) => same(q, p))) return; // aynı noktaya ikinci tık
    const points = [...this.pending, p];
    const ids = [...this.pendingIds, id];
    if (points.length < info.clicks) {
      this.pending = points;
      this.pendingIds = ids;
      this.locked = {};
      this.updatePreview();
      this.onDidChange.fire();
      return;
    }
    // Geçersiz (sıfır boyutlu, doğrusal) şekilde son tık yok sayılır.
    const ed = this.edit_();
    if (!buildTool(ed, tool, points, ids, this.options, this.options.construction)) return;
    this.resetPending();
    this.locked = {};
    this.apply(ed);
  }

  /** Kırp / Uzat / Ofset: eskiz koordinatındaki `raw` noktasının altındaki eğriye uygulanır. */
  editCurveAt(tool: SketchTool, raw: Vec2): void {
    if (tool === "offset" && this.pending.length && this.pendingIds[0]) {
      // İkinci tıklama: yön ve (mesafe 0 ise) uzaklık imlece göre belirlenir.
      const ed = this.edit_();
      try {
        offsetCurves(ed, this.pendingIds[0], this.options.offsetDistance, raw);
      } catch (e) {
        this.reportError(e);
        return;
      }
      this.resetPending();
      this.hovered = null;
      this.apply(ed);
      return;
    }
    const id = this.hitCurveOnly(raw);
    if (!id) return;
    if (tool === "offset") {
      this.pending = [raw];
      this.pendingIds = [id];
      this.hovered = id;
      this.updatePreview();
      this.onDidChange.fire();
      return;
    }
    const ed = this.edit_();
    try {
      if (tool === "trim") trimCurve(ed, id, raw);
      else if (tool === "extend") extendCurve(ed, id, raw);
      else return;
    } catch (e) {
      this.reportError(e);
      return;
    }
    this.hovered = null;
    this.apply(ed);
  }

  private selectedCurves(what: string): string[] {
    const ids = [...this.selected].filter((id) => id.startsWith("c"));
    if (!ids.length) throw new Error(`${what} için önce öğe seçin (araç yokken tıklayın, Ctrl ile çoklu seçim)`);
    return ids;
  }

  /** Seçili eğrileri (dx, dy) kadar taşır ya da kopyasını oraya koyar. */
  moveSelected(dx: number, dy: number, copy: boolean): void {
    const ids = this.selectedCurves(copy ? "Kopyalamak" : "Taşımak");
    if (!dx && !dy) throw new Error("Taşıma miktarı sıfır");
    const ed = this.edit_();
    const map = translateBy(dx, dy);
    if (copy) ed.copyCurves(ids, map);
    else ed.transformCurves(ids, map);
    this.apply(ed, !copy);
  }

  /** Seçili eğrileri (cx, cy) çevresinde `angle` derece (saat yönünün tersine) döndürür ya da kopyalar. */
  rotateSelected(cx: number, cy: number, angle: number, copy: boolean): void {
    const ids = this.selectedCurves("Döndürmek");
    if (!angle) throw new Error("Döndürme açısı sıfır");
    const ed = this.edit_();
    const map = rotateAbout([cx, cy], angle);
    if (copy) ed.copyCurves(ids, map);
    else ed.transformCurves(ids, map);
    this.apply(ed, !copy);
  }

  patternRectSelected(nx: number, ny: number, dx: number, dy: number): void {
    const ids = this.selectedCurves("Desen için");
    const ed = this.edit_();
    patternRect(ed, ids, nx, ny, dx, dy);
    this.apply(ed);
  }

  patternCircularSelected(count: number, angle: number, cx: number, cy: number): void {
    const ids = this.selectedCurves("Desen için");
    const ed = this.edit_();
    patternCircular(ed, ids, count, angle, [cx, cy]);
    this.apply(ed);
  }

  private filletAt(p: Vec2, id: string | null): void {
    const pointId = id ?? hitPoint(this.data(), p, SNAP_PX * 1.5 * this.viewport.worldPerPixel());
    if (!pointId) {
      this.app.showMessage("Yuvarlatmak için iki çizginin birleştiği köşeye tıklayın", "warning");
      return;
    }
    const ed = this.edit_();
    try {
      filletCorner(ed, pointId, this.options.filletRadius);
    } catch (e) {
      this.reportError(e);
      return;
    }
    this.apply(ed);
  }

  private commitMulti(closed: boolean): void {
    if (this.pending.length < 2) return;
    const ed = this.edit_();
    const opts = { construction: this.options.construction, snapped: this.pendingIds };
    if (this.tool === "spline") {
      const ids = this.pending.map((q, i) => ed.pointAt(q, this.pendingIds[i]));
      ed.spline(ids, closed, this.options.construction);
    } else {
      buildPolyline(ed, this.pending, closed, opts);
    }
    this.resetPending();
    this.locked = {};
    this.apply(ed);
  }

  // ---- kısıtlar ve ölçüler ----

  /** Kısıt/ölçü eklemeyi dener: çözücü çelişki bulursa hiçbir şeyi değiştirmez. */
  private tryApply(ed: SketchEdit): boolean {
    const f = this.sketch();
    if (!f) return false;
    let data = ed.result();
    const solver = this.app.solver;
    if (solver) {
      const r = solver.solve(data);
      if (r.conflicting.length) {
        this.app.showMessage("Bu kısıt / ölçü mevcut kısıtlarla çelişiyor; eklenmedi", "error");
        return false;
      }
      if (!r.ok) {
        this.app.showMessage("Çözücü bu kısıtla bir çözüm bulamadı; eklenmedi", "error");
        return false;
      }
      data = r.data;
    }
    this.live = null;
    this.app.document.update(f.id, { sketchData: data });
    return true;
  }

  /** Seçili öğelere geometrik kısıt uygular (Yatay, Dik, Teğet, Sabit...). Uygunsuz seçimde hata fırlatır. */
  applyConstraint(type: GeometricConstraintType): void {
    if (!this.isActive) throw new Error("Önce bir eskiz açın");
    const ed = this.edit_();
    const ids = [...this.selected].filter((id) => !id.startsWith("k"));
    const plan = planConstraint(ed.d, type, ids);
    if (!plan.add.length && !plan.remove.length) {
      this.app.showMessage(`${CONSTRAINT_LABELS[type]}: bu kısıt zaten var`, "info");
      return;
    }
    ed.deleteConstraints(plan.remove);
    for (const c of plan.add) ed.constrain(c.type, c.refs, c.at ? { at: c.at } : {});
    if (this.tryApply(ed)) {
      this.selected.clear();
      this.syncViewOptions();
      this.onDidChange.fire();
    }
  }

  /** Ölçü aracı: tıklanan öğeleri toplar, uygun olunca ölçü kutusunu açar. */
  private pickForDimension(id: string | null): void {
    if (!id || id.startsWith("k")) return;
    const items = [...(this.draft && !this.draft.editing ? this.draft.items : this.dimPick), id];
    try {
      this.draft = { items, choices: planDimension(this.data(), items), index: 0 };
      this.dimPick = [];
    } catch (e) {
      if (this.draft && !this.draft.editing) {
        this.reportError(e); // açık kutu varsa onu bozmadan uyar
      } else if (items.length >= 2) {
        this.dimPick = [id];
        this.reportError(e);
      } else this.dimPick = items; // ilk nokta: ikincisini bekle
    }
    this.onDidChange.fire();
  }

  /** Var olan bir ölçünün değerini kutuda düzenlemeye açar. */
  beginEditDimension(id: string): void {
    const k = this.data().constraints.find((c) => c.id === id);
    if (!k || k.value === undefined) throw new Error("Bu bir ölçü değil");
    this.draft = { items: k.refs, choices: [{ type: k.type as DimensionChoice["type"], refs: k.refs, value: k.value }], index: 0, editing: id };
    this.onDidChange.fire();
  }

  setDimensionChoice(index: number): void {
    if (this.draft && this.draft.choices[index]) {
      this.draft = { ...this.draft, index };
      this.onDidChange.fire();
    }
  }

  cancelDimension(): void {
    this.draft = null;
    this.dimPick = [];
    this.onDidChange.fire();
  }

  /**
   * Yazılan ölçüyü geçerli hâle getirir: boyutlar pozitif olmalı; yatay / dikey mesafe mevcut yönü
   * korur (açık eksi işaret yazılırsa ters yön kurulur). Geçersizse null.
   */
  private normalizeDimension(type: string, current: number, value: number): number | null {
    if (!Number.isFinite(value)) return null;
    if (!SIGNED.has(type)) return value > 0 ? value : null;
    if (type === "angle") return value;
    return Math.abs(value) * (value < 0 ? -1 : Math.sign(current) || 1);
  }

  /** Açık ölçü kutusundaki değeri kaydeder. Çelişirse kutu açık kalır ve false döner. */
  commitDimension(value: number): boolean {
    const dr = this.draft;
    if (!dr) return false;
    const choice = dr.choices[dr.index];
    const signed = this.normalizeDimension(choice.type, choice.value, value);
    if (signed === null) {
      this.app.showMessage("Geçerli bir değer girin (0'dan büyük)", "warning");
      return false;
    }
    const ed = this.edit_();
    if (dr.editing) {
      const k = ed.d.constraints.find((c) => c.id === dr.editing);
      if (!k) return false;
      k.value = signed;
    } else {
      ed.constrain(choice.type, choice.refs, { value: signed });
    }
    if (!this.tryApply(ed)) return false;
    this.draft = null;
    this.dimPick = [];
    this.onDidChange.fire();
    return true;
  }

  /** Var olan bir ölçünün değerini (kutu açmadan) değiştirir; çelişirse reddeder. */
  setDimensionValue(id: string, value: number): boolean {
    const ed = this.edit_();
    const k = ed.d.constraints.find((c) => c.id === id);
    if (!k || k.value === undefined) return false;
    const signed = this.normalizeDimension(k.type, k.value, value);
    if (signed === null) {
      this.app.showMessage("Geçerli bir değer girin (0'dan büyük)", "warning");
      return false;
    }
    k.value = signed;
    return this.tryApply(ed);
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
    this.snapId = null;
    if (this.options.snapPoints) {
      const candidates: { p: Vec2; kind: SnapKind; pointId?: string }[] = [
        ...snapCandidates(this.data()),
        ...this.pending.map((p, i) => ({ p, kind: "köşe" as SnapKind, pointId: this.pendingIds[i] ?? undefined })),
      ];
      let best: (typeof candidates)[number] | null = null;
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
        // Orta nokta yeni bir nokta üretir (ona bağlanılmaz); diğerleri mevcut noktayı paylaşır.
        this.snapId = best.kind === "orta nokta" ? null : (best.pointId ?? null);
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
    if (tool && tool !== "fillet" && !CURVE_TOOLS.has(tool) && p.length && c) {
      const info = TOOLS[tool];
      const points = [...p, c];
      // Gerçek şekli boş bir eskize kurup parçalarını çizeriz: önizleme ile sonuç hep aynı olur.
      const scratch = new SketchEdit();
      if (info.clicks === "multi") {
        const ids = points.map((q) => scratch.point(q));
        if (tool === "spline") scratch.spline(ids, false);
        else scratch.polyline(ids, false);
        segs.push(...previewSegments(scratch));
      } else if (points.length === info.clicks) {
        if (buildTool(scratch, tool, points, [], this.options)) segs.push(...previewSegments(scratch));
        // Daire ve çokgende yarıçap çizgisi, yayda merkez çizgileri yardımcı olur.
        if (tool === "circle" || tool === "polygon") segs.push([p[0], c]);
      } else {
        // Henüz eksik: tıklanan noktaları imleçle birleştir.
        for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
        if (tool === "arcCenter" && p.length === 1) {
          const r = dist(p[0], c);
          if (r > 0) {
            const circle = new SketchEdit();
            circle.circle(circle.point(p[0]), r);
            segs.push(...previewSegments(circle));
          }
        }
      }
    }
    if (tool === "offset" && p.length && c && this.pendingIds[0]) {
      try {
        const scratch = this.edit_();
        const added = new Set(offsetCurves(scratch, this.pendingIds[0], this.options.offsetDistance, c));
        for (const cu of scratch.d.curves) if (added.has(cu.id)) segs.push(...curveSegments(scratch.d, cu, scratch.pm));
      } catch {
        // Önizleme sessizce atlanır; hata ikinci tıklamada gösterilir.
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

function previewSegments(ed: SketchEdit): [Vec2, Vec2][] {
  const pm = ed.pm;
  return ed.d.curves.flatMap((c) => curveSegments(ed.d, c, pm));
}

function curvePointIds(c: SketchData["curves"][number]): string[] {
  switch (c.kind) {
    case "line":
      return [c.p1, c.p2];
    case "circle":
    case "ellipse":
      return [c.c];
    case "arc":
      return [c.c, c.s, c.e];
    case "spline":
      return c.pts;
    case "point":
      return [c.p];
  }
}

/**
 * Tıklanan noktalardan şekli `ed`'e kurar (yeni eğriler + otomatik kısıtlar). Geçersiz
 * (sıfır boyutlu, doğrusal) ise hiçbir şey eklemeden false döner. `ids`: tıklamaların yakalandığı
 * mevcut nokta kimlikleri; onlar yeniden kullanılır ki yeni şekil mevcut olana bağlansın.
 */
export function buildTool(
  ed: SketchEdit,
  tool: SketchTool,
  pts: Vec2[],
  ids: (string | null | undefined)[],
  options: Pick<SketchOptions, "polygonSides">,
  construction?: boolean,
): boolean {
  const tiny = 1e-9;
  const o = (snapped: (string | null | undefined)[]) => ({ construction, snapped });
  switch (tool) {
    case "rect": {
      const [a, b] = pts;
      if (Math.abs(a[0] - b[0]) <= tiny || Math.abs(a[1] - b[1]) <= tiny) return false;
      buildRect(ed, [a, [b[0], a[1]], b, [a[0], b[1]]], o([ids[0], null, ids[1], null]));
      return true;
    }
    case "rectCenter": {
      const [c, b] = pts;
      const a = roundPoint([2 * c[0] - b[0], 2 * c[1] - b[1]]);
      if (Math.abs(a[0] - b[0]) <= tiny || Math.abs(a[1] - b[1]) <= tiny) return false;
      buildRect(ed, [a, [b[0], a[1]], b, [a[0], b[1]]], o([null, null, ids[1], null]));
      return true;
    }
    case "rect3": {
      const [p0, p1, p2] = pts;
      if (dist(p0, p1) < tiny) return false;
      const n = perp(sub(p1, p0));
      const h = dot(sub(p2, p1), n);
      if (Math.abs(h) < tiny) return false;
      buildRect(ed, [p0, p1, roundPoint(along(p1, n, h)), roundPoint(along(p0, n, h))], o([ids[0], ids[1], null, null]));
      return true;
    }
    case "circle": {
      const r = dist(pts[0], pts[1]);
      if (r <= tiny) return false;
      ed.circle(ed.pointAt(pts[0], ids[0]), r, construction);
      return true;
    }
    case "circle2": {
      const r = dist(pts[0], pts[1]) / 2;
      if (r <= tiny) return false;
      ed.circle(ed.point(roundPoint([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2])), r, construction);
      return true;
    }
    case "circle3":
      return buildCircle3(ed, pts[0], pts[1], pts[2], o([])) !== null;
    case "arc3": {
      const [start, end, through] = pts;
      return buildArc3(ed, start, end, through, o([ids[0], ids[1]])) !== null;
    }
    case "arcCenter": {
      const [c, start, end] = pts;
      const r = dist(c, start);
      if (r < tiny) return false;
      const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
      const a1 = Math.atan2(end[1] - c[1], end[0] - c[0]);
      const sweep = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep < 1e-6) return false;
      const e = roundPoint([c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)]);
      const cp = ed.pointAt(c, ids[0]);
      const sp = ed.pointAt(start, ids[1]);
      // Bitiş tıklaması yayın ucuna yapıştıysa o nokta kullanılır, değilse uç yeni bir nokta olur.
      const endClick = ids[2] ? ed.pm.get(ids[2]) : undefined;
      const ep = endClick && dist(endClick, e) < 1e-6 ? ids[2]! : ed.point(e);
      ed.arc(cp, sp, ep, construction);
      return true;
    }
    case "polygon":
      if (dist(pts[0], pts[1]) <= tiny) return false;
      buildPolygon(ed, pts[0], pts[1], options.polygonSides, o([ids[0], ids[1]]));
      return true;
    case "slot": {
      const [a, b, w] = pts;
      const r = Math.abs(dot(sub(w, a), perp(sub(b, a))));
      if (r <= tiny || dist(a, b) <= tiny) return false;
      buildSlot(ed, a, b, Number(r.toFixed(6)), o([ids[0], ids[1]]));
      return true;
    }
    case "ellipse": {
      const [c, major, q] = pts;
      const rx = dist(c, major);
      const ry = Math.abs(dot(sub(q, c), perp(sub(major, c))));
      if (rx < tiny || ry < tiny) return false;
      ed.ellipse(ed.pointAt(c, ids[0]), rx, ry, Math.atan2(major[1] - c[1], major[0] - c[0]), construction);
      return true;
    }
    case "point":
      ed.standalone(ed.pointAt(pts[0], ids[0]));
      return true;
    default:
      return false;
  }
}
