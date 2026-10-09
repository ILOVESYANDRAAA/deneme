import * as THREE from "three";
import type { SugarApp } from "../app/controller";
import type { Disposable } from "../core/events";
import { DIRECTION_LABELS, FEATURE_PARAMS, OPERATION_LABELS, sketchDataOf, type BodyOperation, type ExtrudeDirection, type Feature } from "../core/features";
import { frameOf, pointInPolygon, profileRegions, toWorld, type PlaneRef } from "../core/sketch";
import { sketchDataProfiles } from "../core/sketchmodel";
import type { Vec2 } from "../core/solid";
import { compact, formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import { Viewport } from "./viewport";

/**
 * Ekstrüzyon diyaloğu (Fusion'daki gibi): komut çalışınca özellik hemen eklenir ve model canlı güncellenir;
 * yön, mesafe ve işlem değiştikçe tuvaldeki sonuç değişir. Tamam tek bir geri alma adımı bırakır,
 * İptal / Esc hiçbir iz bırakmadan geri alır.
 */
export class ExtrudeTool {
  private box: HTMLElement | null = null;
  private featureId: string | null = null;
  private sketchId: string | null = null;
  private body = h("div", { class: "inspect-body" });
  /** Girişten gelen güncellemeler sırayla uygulansın. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Diyalogdaki Mesafe kutusu (tuvaldeki ok sürüklenirken güncellenir). */
  private distanceInput: HTMLInputElement | null = null;
  /** Tuvalde sürüklenebilir mesafe oku (diyalog açıkken). */
  private handle: ExtrudeHandle | null = null;

  constructor(
    private readonly app: SugarApp,
    private readonly host: HTMLElement,
    private readonly onChanged: () => void,
    /** Okun çizileceği görünüm; verilmezse `host`un ait olduğu görünüm kullanılır (yoksa ok çizilmez). */
    private readonly viewport: Viewport | null = Viewport.of(host) ?? null,
  ) {
    // Geri al / yinele / dosya yükleme oturumu bitirirse diyalog artık geçersizdir; özellik kaybolduysa da kapanır.
    app.document.onDidEndSession.on(() => this.close(true));
    app.document.onDidChange.on(() => {
      if (this.box && this.featureId && !app.document.get(this.featureId)) this.close(true);
    });
  }

  get isActive(): boolean {
    return this.box !== null;
  }

  /** Açık diyalogun özellik kimliği (testler için). */
  get feature(): string | null {
    return this.featureId;
  }

  open(): void {
    // Zaten açıksa (ikinci E, şerit düğmesi) mevcut diyaloga dokunma.
    if (this.box) return;
    const doc = this.app.document;
    doc.beginSession();
    let feature: ReturnType<SugarApp["addSketchFeature"]> = null;
    try {
      feature = this.app.addSketchFeature("extrude");
    } finally {
      if (!feature) doc.cancelSession();
    }
    if (!feature) return;
    this.featureId = feature.id;
    this.sketchId = feature.sketch ?? null;
    this.box = hudBox("Ekstrüzyon", ICONS.extrude, () => this.cancel(), this.body);
    this.box.classList.add("feature-dialog");
    this.host.append(this.box);
    // Fusion'daki gibi diyalog açıkken Özellikler paneli gizlenir (aynı alanı düzenler).
    document.body.dataset.featureDialog = "extrude";
    this.render();
    if (this.viewport) this.handle = new ExtrudeHandle(this.app, this.viewport, feature.id, (value, final) => this.dragDistance(value, final));
    this.onChanged();
  }

  /** Tamam / Enter: yazılan mesafe geçerliyse uygular; değilse diyalog açık kalır. */
  async confirm(): Promise<void> {
    if (!this.box) return;
    const ok = await this.commitDistance();
    if (ok) this.apply();
  }

  /** Başka bir komut belgeyi değiştirmeden önce: diyalog uygulanabiliyorsa onaylanır, değilse iptal edilir. */
  finish(): void {
    if (!this.box) return;
    const f = this.featureId && this.app.document.get(this.featureId);
    if (f && f.operation && f.operation !== "new" && !f.target) this.cancel();
    else this.apply();
  }

  /** Tuvaldeki okun ekran konumu: dayanak (ekstrüzyon ucu) ve sap üstünde tutulacak nokta (testler için). */
  handleScreen(): { base: { x: number; y: number }; grip: { x: number; y: number } } | null {
    return this.handle?.screen() ?? null;
  }

  /** Tamam: özellik kalır, tek geri alma adımı olarak. */
  apply(): void {
    if (!this.box) return;
    // Oktan gelen son değer henüz modele yazılmadıysa önce o bitsin (aynı geri alma adımına girsin).
    if (this.dragBusy || this.dragPending !== null) {
      const id = this.featureId;
      if (this.dragFrame) cancelAnimationFrame(this.dragFrame);
      this.dragFrame = 0;
      this.flushDrag();
      void this.queue.then(() => {
        if (this.featureId === id) this.apply();
      });
      return;
    }
    const f = this.featureId && this.app.document.get(this.featureId);
    if (f && f.operation && f.operation !== "new" && !f.target) {
      this.app.showMessage("Birleştirmek / kesmek için bir hedef gövde seçin", "warning");
      return;
    }
    this.app.document.endSession();
    this.close(true);
  }

  /** İptal: eklenen özellik ve yapılan bütün değişiklikler geri alınır. */
  cancel(): void {
    if (!this.box) return;
    this.app.document.cancelSession();
    const sketch = this.sketchId;
    this.close(true);
    if (sketch && this.app.document.get(sketch)) this.app.document.setSelection([sketch]);
  }

  /** Diyaloğu kapatır; açıksa yapılanları iptal eder (başka bir araç açılırken). */
  close(silent = false): void {
    if (!this.box) return;
    if (!silent) this.app.document.cancelSession();
    this.handle?.dispose();
    this.handle = null;
    if (this.dragFrame) cancelAnimationFrame(this.dragFrame);
    this.dragFrame = 0;
    this.dragPending = null;
    this.distanceInput = null;
    this.box.remove();
    this.box = null;
    delete document.body.dataset.featureDialog;
    this.featureId = null;
    this.sketchId = null;
    this.onChanged();
  }

  /** Mesafe kutusuna yazılmış gibi değer verir (testler ve kısayollar için). */
  setDistance(text: string): Promise<unknown> {
    return this.enqueue((id) => this.app.setFeatureParam(id, "distance", text));
  }

  /**
   * İşi sıraya alır. İş, kuyruğa alındığı andaki özelliğe uygulanır; diyalog bu arada kapandıysa ya da
   * yeniden açıldıysa hiçbir şey yapılmaz. Hata mesaj olarak gösterilir, kuyruk devam eder.
   */
  private enqueue(job: (id: string) => Promise<unknown>, quiet = false): Promise<boolean> {
    const id = this.featureId;
    const run = this.queue.then(async () => {
      if (!id || id !== this.featureId) return false;
      try {
        await job(id);
        return true;
      } catch (e) {
        if (!quiet) this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
        return false;
      }
    });
    this.queue = run;
    return run;
  }

  /** Mesafe kutusundaki son metni modele uygular; geçersizse hata gösterir ve false döner. */
  private async commitDistance(): Promise<boolean> {
    const input = this.body.querySelector<HTMLInputElement>('input[aria-label="Mesafe"]');
    if (!input) return true;
    return this.enqueue((id) => this.app.setFeatureParam(id, "distance", input.value));
  }

  // ---- ok sürükleme ----

  /** Sürüklemeden gelen, henüz modele yazılmamış son değer. */
  private dragPending: number | null = null;
  private dragFrame = 0;
  /** Bir sürükleme güncellemesi kuyrukta / hesaplanıyor. */
  private dragBusy = false;

  /**
   * Ok sürüklenince: Mesafe kutusu hemen güncellenir; ağır model hesabı kare başına en çok bir kez
   * ve sırayla yapılır (hesap sürerken gelen değerlerden yalnız sonuncusu uygulanır).
   */
  private dragDistance(value: number, final: boolean): void {
    if (!this.featureId) return;
    if (this.distanceInput) this.distanceInput.value = formatNumber(value);
    this.dragPending = value;
    if (final) {
      if (this.dragFrame) cancelAnimationFrame(this.dragFrame);
      this.dragFrame = 0;
      this.flushDrag();
      // Bırakınca Mesafe kutusu yine yazılabilsin (Enter = Tamam).
      this.distanceInput?.focus();
      this.distanceInput?.select();
    } else if (!this.dragFrame) {
      this.dragFrame = requestAnimationFrame(() => {
        this.dragFrame = 0;
        this.flushDrag();
      });
    }
  }

  private flushDrag(): void {
    const id = this.featureId;
    if (this.dragBusy || this.dragPending === null || !id) return;
    const text = formatNumber(this.dragPending);
    this.dragPending = null;
    this.dragBusy = true;
    void this.enqueue(() => this.app.setFeatureParam(id, "distance", text).catch(() => undefined)).finally(() => {
      this.dragBusy = false;
      // Hesap sürerken yeni değer geldiyse onu da uygula (diyalog kapanınca bekleyen değer silinir).
      if (this.dragPending !== null) this.flushDrag();
    });
  }

  private render(): void {
    const f = this.featureId ? this.app.document.get(this.featureId) : undefined;
    if (!f || !this.box) return;
    const sketch = f.sketch ? this.app.document.get(f.sketch) : undefined;
    const spec = FEATURE_PARAMS.extrude.distance;
    const operation: BodyOperation = f.operation ?? "new";

    const select = <T extends string>(label: string, labels: Record<T, string>, value: T, onChange: (v: T) => void) => {
      const el = h(
        "select",
        { attrs: { "aria-label": label } },
        ...(Object.keys(labels) as T[]).map((k) => h("option", { value: k, selected: k === value }, labels[k])),
      ) as HTMLSelectElement;
      el.addEventListener("change", () => onChange(el.value as T));
      el.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") this.cancel();
        else if (e.key === "Enter") {
          e.preventDefault();
          void this.confirm();
        }
      });
      return h("label", { class: "field" }, h("span", {}, label), el);
    };

    const distance = h("input", {
      type: "text",
      value: f.exprs?.distance ?? formatNumber(f.params.distance ?? spec.default),
      attrs: { "aria-label": "Mesafe", inputmode: "decimal", spellcheck: "false" },
    }) as HTMLInputElement;
    this.distanceInput = distance;
    distance.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void this.confirm();
      } else if (e.key === "Escape") this.cancel();
    });
    distance.addEventListener("input", () => {
      // Yazarken canlı önizleme: geçerli sayı / ifade oldukça model güncellenir.
      // Yarım yazılmış değerler ("-", "1e") sessizce yok sayılır.
      void this.enqueue((id) => this.app.setFeatureParam(id, "distance", distance.value), true);
    });

    const candidates = operation === "new" ? [] : this.app.targetCandidates(f.id);
    const targets = Object.fromEntries(candidates.map((c) => [c.id, c.name])) as Record<string, string>;

    this.body.replaceChildren(
      ...compact(
      h("div", { class: "dialog-note" }, `Profil: ${sketch?.name ?? "eskiz"}`),
      select<ExtrudeDirection>("Yön", DIRECTION_LABELS, f.direction ?? "one", (v) =>
        void this.enqueue((id) => this.app.updateFeature(id, { direction: v === "one" ? undefined : v })),
      ),
      h("label", { class: "field" }, h("span", {}, "Mesafe (mm)"), distance),
      select<BodyOperation>("İşlem", OPERATION_LABELS, operation, (v) =>
        void this.enqueue(async (id) => {
          await this.app.setOperation(id, v);
          // Birden çok aday varsa ilki seçilir; açılır kutu ile model hep aynı şeyi göstersin.
          const now = this.app.document.get(id);
          const first = this.app.targetCandidates(id)[0];
          if (v !== "new" && now && !now.target && first) await this.app.updateFeature(id, { target: first.id });
          this.render();
        }),
      ),
      operation !== "new"
        ? candidates.length
          ? select("Hedef gövde", targets, f.target ?? candidates[0].id, (v) =>
              void this.enqueue((id) => this.app.updateFeature(id, { target: v })),
            )
          : h("div", { class: "dialog-note warn" }, "Birleştirilecek / kesilecek bir gövde yok")
        : null,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => void this.confirm() }, "Tamam"),
        h("button", { class: "btn", onclick: () => this.cancel() }, "İptal"),
      ),
      ),
    );
    // Mesafe kutusu hemen yazılabilsin.
    distance.focus();
    distance.select();
  }
}

// ---- tuvaldeki mesafe oku ----

/** Okun ekrandaki ölçüleri (piksel). */
const ARROW = { shaft: 46, shaftRadius: 1.6, head: 18, headRadius: 7, ball: 4.5, pick: 9 };
const ARROW_COLOR = 0xff6a00;
const ARROW_HOVER = 0xffb52e;

/**
 * Profilin içinde, okun çıkacağı nokta: en büyük bölgenin ağırlık merkezi; merkez bölgenin
 * dışında kalıyorsa (halka, L biçimi) merkezden geçen yatay çizginin bölge içindeki en geniş aralığının ortası.
 */
export function profileAnchor(profiles: readonly Vec2[][]): Vec2 | null {
  const regions = profileRegions(profiles);
  if (!regions.length) return null;
  const moments = (p: readonly Vec2[]) => {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      const k = x0 * y1 - x1 * y0;
      a += k;
      cx += (x0 + x1) * k;
      cy += (y0 + y1) * k;
    }
    // Dönüş yönünden bağımsız: alan ve alan × merkez.
    const s = Math.sign(a) || 1;
    return { area: (a / 2) * s, mx: (cx / 6) * s, my: (cy / 6) * s };
  };
  let best: { area: number; c: Vec2; loops: readonly Vec2[][] } | null = null;
  for (const r of regions) {
    let { area, mx, my } = moments(r.outer);
    for (const hole of r.holes) {
      const m = moments(hole);
      area -= m.area;
      mx -= m.mx;
      my -= m.my;
    }
    if (area > 1e-12 && (!best || area > best.area)) best = { area, c: [mx / area, my / area], loops: [r.outer, ...r.holes] };
  }
  if (!best) return regions[0].outer[0] ?? null;
  const loops = best.loops;
  const inside = (p: Vec2) => loops.filter((l) => pointInPolygon(p, l)).length % 2 === 1;
  if (inside(best.c)) return best.c;
  // Yatay tarama: çift-tek kuralıyla içteki aralıklar; en genişinin ortası.
  const y = best.c[1] + 1e-7;
  const xs: number[] = [];
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const [x0, y0] = l[i];
      const [x1, y1] = l[(i + 1) % l.length];
      if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
  }
  xs.sort((a, b) => a - b);
  let mid: Vec2 | null = null;
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i];
      mid = [(xs[i] + xs[i + 1]) / 2, y];
    }
  }
  return mid ?? loops[0][0];
}

/**
 * Sürükleme sonucu mesafe: normal ekseni boyunca alınan yol (`travel`, dünya birimi) başlangıç
 * değerine eklenir; simetrikte ok mesafenin yarısında durduğundan yol iki kat sayılır.
 * Adıma yuvarlanır; sıfır geçersiz olduğundan bir adıma çekilir (simetrikte yalnız pozitif).
 */
export function dragDistanceValue(start: number, travel: number, direction: ExtrudeDirection, step: number): number {
  const symmetric = direction === "symmetric";
  const raw = symmetric ? Math.abs(start) + 2 * travel : start + travel;
  let v = Number((Math.round(raw / step) * step).toFixed(6)) + 0;
  if (symmetric) v = Math.max(step, v);
  else if (v === 0) v = raw < 0 ? -step : step;
  return v;
}

/**
 * Ekstrüzyon diyaloğu açıkken tuvalde çizilen, sürüklenebilir mesafe oku (Fusion'daki manipülatör).
 * Profilin içinden eskiz normali yönünde, ekstrüzyonun ucunda durur; ekranda sabit boyutludur.
 * Fare olaylarını görünüm öğesinde yakalama evresinde dinler: ok tutulduğunda olay kameraya
 * ve seçime ulaşmaz, kamera denetimi sürükleme boyunca kapalıdır.
 */
class ExtrudeHandle {
  private readonly group = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly disposables: Disposable[] = [];
  /** Okun dünya konumu (ekstrüzyon ucu) ve yönü. */
  private readonly anchor = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0, 0, 1);
  private readonly quat = new THREE.Quaternion();
  private visible = false;
  private hovered = false;
  private savedCursor: string | null = null;
  /** Profil noktası önbelleği (aynı eskiz nesnesi için yeniden hesaplanmaz). */
  private anchorCache: { sketch: Feature; point: Vec2 | null } | null = null;
  /** Bırakılan, modele henüz yazılmamış değer (ve bırakıldığındaki model değeri): ok model güncellenene dek geri sıçramasın. */
  private released: { value: number; from: number } | null = null;
  private drag: {
    pointerId: number;
    /** Eksen: eskiz düzlemindeki profil noktası ve normal (dünya). */
    base: THREE.Vector3;
    normal: THREE.Vector3;
    direction: ExtrudeDirection;
    start: number;
    /** Tutulan noktanın eksen üzerindeki konumu. */
    t0: number;
    screenY0: number;
    /** Eksen bakış yönündeyse (ekranda noktaya iniyor) dikey fare hareketi kullanılır. */
    vertical: boolean;
    controlsWere: boolean;
    value: number;
  } | null = null;

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly featureId: string,
    /** Yeni mesafe (final: fare bırakıldı). */
    private readonly onDrag: (value: number, final: boolean) => void,
  ) {
    // Geometri piksel biriminde, ok +Y yönünde; her çizimde ekran ölçeğine göre yerleştirilir.
    const parts = [
      new THREE.CylinderGeometry(ARROW.shaftRadius, ARROW.shaftRadius, ARROW.shaft, 12).translate(0, ARROW.shaft / 2, 0),
      new THREE.ConeGeometry(ARROW.headRadius, ARROW.head, 24).translate(0, ARROW.shaft + ARROW.head / 2, 0),
      new THREE.SphereGeometry(ARROW.ball, 16, 12),
    ];
    const scale = new THREE.Vector3();
    for (const g of parts) {
      const material = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, depthTest: false, depthWrite: false, transparent: true });
      const mesh = new THREE.Mesh(g, material);
      mesh.renderOrder = 34;
      mesh.frustumCulled = false;
      mesh.onBeforeRender = () => {
        scale.setScalar(this.pixel());
        mesh.matrixWorld.compose(this.anchor, this.quat, scale);
      };
      this.geometries.push(g);
      this.materials.push(material);
      this.group.add(mesh);
    }
    this.group.visible = false;
    this.viewport.layer.add(this.group);

    const el = this.viewport.element;
    const listen = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      const l = fn as EventListener;
      el.addEventListener(type, l, true);
      this.disposables.push({ dispose: () => el.removeEventListener(type, l, true) });
    };
    listen("pointerdown", (e) => this.pointerDown(e));
    listen("pointermove", (e) => this.pointerMove(e));
    listen("pointerup", (e) => this.pointerUp(e, true));
    listen("pointercancel", (e) => this.pointerUp(e, false));
    listen("lostpointercapture", (e) => this.pointerUp(e, true));
    // Ok üzerinde çift tıklama görünümü sığdırmasın.
    listen("dblclick", (e) => {
      if (this.onCanvas(e) && this.hit(e.clientX, e.clientY)) e.stopPropagation();
    });
    this.disposables.push(this.app.document.onDidChange.on(() => this.update()));
    this.update();
  }

  /** Oku, olay dinleyicilerini ve imleci tamamen temizler. */
  dispose(): void {
    this.endDrag();
    this.setHover(false);
    for (const d of this.disposables.splice(0)) d.dispose();
    this.viewport.layer.remove(this.group);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.viewport.requestRender();
  }

  /** Okun ekran konumu (testler için): dayanak ve sapın üstündeki tutma noktası. */
  screen(): { base: { x: number; y: number }; grip: { x: number; y: number } } | null {
    if (!this.visible) return null;
    const [a, b] = this.screenSegment();
    return { base: a, grip: { x: a.x + (b.x - a.x) * 0.55, y: a.y + (b.y - a.y) * 0.55 } };
  }

  // ---- konum ----

  private feature(): Feature | undefined {
    return this.app.document.get(this.featureId);
  }

  /** Okun bulunduğu yerde bir pikselin dünya karşılığı. */
  private pixel(): number {
    return this.viewport.worldPerPixelAt([this.anchor.x, this.anchor.y, this.anchor.z]);
  }

  /** Ekstrüzyonun ekseni: eskiz düzlemindeki profil noktası ve eskiz normali. */
  private axis(f: Feature): { base: THREE.Vector3; normal: THREE.Vector3 } | null {
    const sketch = f.sketch ? this.app.document.get(f.sketch) : undefined;
    if (!sketch || sketch.type !== "sketch") return null;
    if (this.anchorCache?.sketch !== sketch) {
      let point: Vec2 | null = null;
      try {
        point = profileAnchor(sketchDataProfiles(sketchDataOf(sketch)));
      } catch {
        point = null;
      }
      this.anchorCache = { sketch, point };
    }
    const p = this.anchorCache.point;
    if (!p) return null;
    const plane: PlaneRef = sketch.frame ?? sketch.plane ?? "XY";
    const base = new THREE.Vector3(...toWorld(plane, sketch.params.offset ?? 0, p));
    const normal = new THREE.Vector3(...frameOf(plane).n).normalize();
    return { base, normal };
  }

  /** Mesafeye göre okun yeri: tek yönde ucunda (negatifte ters yönde), simetrikte mesafenin yarısında. */
  private place(base: THREE.Vector3, normal: THREE.Vector3, direction: ExtrudeDirection, distance: number): void {
    if (direction === "symmetric") {
      this.anchor.copy(base).addScaledVector(normal, Math.abs(distance) / 2);
      this.dir.copy(normal);
    } else {
      this.anchor.copy(base).addScaledVector(normal, distance);
      this.dir.copy(normal).multiplyScalar(distance < 0 ? -1 : 1);
    }
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
  }

  private update(): void {
    const f = this.feature();
    const axis = f && this.axis(f);
    this.visible = !!axis;
    if (f && axis) {
      const stored = f.params.distance ?? FEATURE_PARAMS.extrude.distance.default;
      // Model değeri değişti (bırakılan değer yazıldı ya da kutuya başka bir şey girildi): artık modeli izle.
      if (this.released && stored !== this.released.from) this.released = null;
      const distance = this.drag ? this.drag.value : (this.released?.value ?? stored);
      this.place(axis.base, axis.normal, f.direction ?? "one", Number.isFinite(distance) ? distance : 0);
    }
    this.group.visible = this.visible;
    this.viewport.requestRender();
  }

  /** Okun ekrandaki uçları: dayanak ve sivri uç. */
  private screenSegment(): [{ x: number; y: number }, { x: number; y: number }] {
    const tip = this.anchor.clone().addScaledVector(this.dir, (ARROW.shaft + ARROW.head) * this.pixel());
    return [this.viewport.screenOf([this.anchor.x, this.anchor.y, this.anchor.z]), this.viewport.screenOf([tip.x, tip.y, tip.z])];
  }

  private hit(x: number, y: number): boolean {
    if (!this.visible) return false;
    const [a, b] = this.screenSegment();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    // Ok bakış yönündeyse ekranda küçük bir daireye iner: biraz daha cömert tut.
    return d <= (len2 < 15 * 15 ? ARROW.headRadius + ARROW.pick : ARROW.pick);
  }

  private setHover(on: boolean): void {
    if (on === this.hovered) return;
    this.hovered = on;
    const canvas = this.viewport.canvas;
    if (on) {
      this.savedCursor = canvas.style.cursor;
      canvas.style.cursor = "grab";
    } else if (this.savedCursor !== null) {
      canvas.style.cursor = this.savedCursor;
      this.savedCursor = null;
    }
    for (const m of this.materials) m.color.set(on ? ARROW_HOVER : ARROW_COLOR);
    this.viewport.requestRender();
  }

  // ---- fare ----

  /** İmleç ışınına en yakın eksen noktasının tabandan uzaklığı (normal yönünde, dünya birimi). */
  private along(e: PointerEvent, base: THREE.Vector3, normal: THREE.Vector3): number {
    // İki doğrunun ortak dikmesi: eksen base + n·t, ışın o + d·s (n ve d birim).
    const ray = this.viewport.rayAt(e.clientX, e.clientY);
    const w0 = base.clone().sub(ray.origin);
    const b = normal.dot(ray.direction);
    const d = normal.dot(w0);
    const k = ray.direction.dot(w0);
    const denom = 1 - b * b;
    return denom > 1e-9 ? (b * k - d) / denom : -d;
  }

  private onCanvas(e: Event): boolean {
    return e.target === this.viewport.canvas && !this.viewport.isPickingPlane;
  }

  private pointerDown(e: PointerEvent): void {
    if (this.drag || e.button !== 0 || !this.onCanvas(e) || !this.hit(e.clientX, e.clientY)) return;
    const f = this.feature();
    const axis = f && this.axis(f);
    if (!f || !axis) return;
    // Olay kameraya (OrbitControls) ve seçime ulaşmasın.
    e.stopPropagation();
    e.preventDefault();
    this.setHover(true);
    const a = this.viewport.screenOf([axis.base.x, axis.base.y, axis.base.z]);
    const far = axis.base.clone().addScaledVector(axis.normal, 40 * this.pixel());
    const b = this.viewport.screenOf([far.x, far.y, far.z]);
    const stored = this.released?.value ?? f.params.distance ?? FEATURE_PARAMS.extrude.distance.default;
    const start = Number.isFinite(stored) ? stored : 0;
    this.drag = {
      pointerId: e.pointerId,
      base: axis.base,
      normal: axis.normal,
      direction: f.direction ?? "one",
      start,
      t0: this.along(e, axis.base, axis.normal),
      screenY0: e.clientY,
      // Eksenin ekrandaki izdüşümü çok kısaysa ışın izdüşümü kararsızdır.
      vertical: Math.hypot(b.x - a.x, b.y - a.y) < 8,
      controlsWere: this.viewport.setCameraControlsEnabled(false),
      value: start,
    };
    try {
      this.viewport.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Yakalama olmasa da olaylar tuvalden gelir.
    }
    this.viewport.canvas.style.cursor = "grabbing";
  }

  private pointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      this.setHover(this.onCanvas(e) && e.buttons === 0 && this.hit(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    const travel = drag.vertical
      ? (drag.screenY0 - e.clientY) * this.viewport.worldPerPixelAt([drag.base.x, drag.base.y, drag.base.z])
      : this.along(e, drag.base, drag.normal) - drag.t0;
    const value = dragDistanceValue(drag.start, travel, drag.direction, e.shiftKey ? 0.1 : 0.5);
    if (value === drag.value) return;
    drag.value = value;
    this.update();
    this.onDrag(value, false);
  }

  private pointerUp(e: PointerEvent, commit: boolean): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    this.endDrag();
    const value = commit ? drag.value : drag.start;
    // Değer hiç değişmediyse modele dokunulmaz.
    if (drag.value !== drag.start) {
      const f = this.feature();
      if (f) this.released = { value, from: f.params.distance ?? FEATURE_PARAMS.extrude.distance.default };
      this.onDrag(value, true);
    }
    this.update();
    this.setHover(this.onCanvas(e) && this.hit(e.clientX, e.clientY));
  }

  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.viewport.setCameraControlsEnabled(drag.controlsWere);
    const canvas = this.viewport.canvas;
    try {
      if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    } catch {
      // Yakalama zaten bırakılmış.
    }
    canvas.style.cursor = this.hovered ? "grab" : (this.savedCursor ?? canvas.style.cursor);
  }
}
