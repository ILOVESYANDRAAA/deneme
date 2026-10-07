import type { SugarApp } from "../app/controller";
import { Emitter } from "../core/events";
import type { Feature } from "../core/features";
import {
  PLANES,
  niceStep,
  sketchSegments,
  sketchSnapPoints,
  snapToGrid,
  type PlaneName,
  type SketchEntity,
} from "../core/sketch";
import type { Vec2 } from "../core/solid";
import type { PointerHandler, Viewport } from "./viewport";

export type SketchTool = "line" | "rect" | "circle";

export const TOOL_LABELS: Record<SketchTool, string> = {
  line: "Çizgi",
  rect: "Dikdörtgen",
  circle: "Daire",
};

export const TOOL_HINTS: Record<SketchTool, string> = {
  line: "Tıklayarak nokta ekleyin · ilk noktaya tıklayınca şekil kapanır · çift tık / Enter açık bırakır",
  rect: "İlk köşeye, sonra karşı köşeye tıklayın",
  circle: "Merkeze, sonra yarıçap noktasına tıklayın",
};

/** Yakalama mesafesi (piksel). */
const SNAP_PX = 10;

/**
 * Eskiz modu: seçilen düzlemde çizgi, dikdörtgen ve daire çizer.
 * Her tamamlanan şekil belgeye tek bir geri alınabilir adım olarak yazılır.
 */
export class Sketcher implements PointerHandler {
  activeId: string | null = null;
  tool: SketchTool | null = null;
  /** Yapım aşamasındaki şeklin tıklanmış noktaları. */
  private pending: Vec2[] = [];
  /** Yakalanmış imleç konumu (eskiz koordinatlarında). */
  cursor: Vec2 | null = null;
  /** İmleç bir köşeye yapıştı mı (ızgara yerine)? */
  snappedToPoint = false;
  gridStep = 1;
  /** Etkin eskizin düzlemi ve ofseti ("XY:0"); değişince görünüm yeniden kurulur. */
  private where = "";

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
      // Düzlem ya da ofset değiştiyse kamera ve ızgara yeni düzleme geçsin.
      const where = `${f.plane}:${f.params.offset ?? 0}`;
      if (where !== this.where) {
        this.where = where;
        this.pending = [];
        this.viewport.enterSketch(f.id, f.plane, f.params.offset ?? 0);
      }
      this.updatePreview();
    });
  }

  get isActive(): boolean {
    return this.activeId !== null;
  }

  sketch(): Feature | undefined {
    return this.activeId ? this.app.document.get(this.activeId) : undefined;
  }

  get plane(): PlaneName {
    return this.sketch()?.plane ?? "XY";
  }

  private get offset(): number {
    return this.sketch()?.params.offset ?? 0;
  }

  /** Düzlem seçtirip yeni eskiz açar (ya da verilen düzlemde). */
  async startNew(plane?: PlaneName): Promise<void> {
    if (this.isActive) this.finish();
    const chosen = plane ?? (await this.viewport.pickPlane());
    if (!chosen) return;
    const f = this.app.createSketch(chosen);
    this.edit(f.id);
  }

  /** Var olan bir eskizi düzenlemeye açar (kullanılmış olsa bile: değişiklik katıya yansır). */
  edit(id: string): void {
    const f = this.app.document.get(id);
    if (!f || f.type !== "sketch" || !f.plane) throw new Error("Düzenlemek için bir eskiz seçin");
    this.viewport.cancelPlanePick();
    this.activeId = id;
    this.pending = [];
    this.tool = this.tool ?? "line";
    this.where = `${f.plane}:${f.params.offset ?? 0}`;
    this.viewport.enterSketch(id, f.plane, f.params.offset ?? 0);
    this.viewport.setInteraction(this);
    this.app.document.setSelection([id]);
    this.onDidChange.fire();
  }

  setTool(tool: SketchTool): void {
    if (!this.isActive) throw new Error("Önce bir eskiz açın (Eskiz düğmesi)");
    this.tool = tool;
    this.pending = [];
    this.updatePreview();
    this.onDidChange.fire();
  }

  /** Eskizi kapatır. Yarım kalan çizgi en az iki noktalıysa açık çizgi olarak kaydedilir. */
  finish(): void {
    if (!this.isActive) return;
    if (this.tool === "line" && this.pending.length >= 2) this.commitPolyline(false);
    const id = this.activeId!;
    this.exit();
    // Sonucun 3D'si görünsün (Ekstrüzyon/Döndürme bir sonraki adım).
    this.viewport.setView("iso");
    if (this.app.document.get(id)) this.app.document.setSelection([id]);
  }

  private exit(): void {
    this.activeId = null;
    this.pending = [];
    this.cursor = null;
    this.viewport.setInteraction(null);
    this.viewport.exitSketch();
    this.onDidChange.fire();
  }

  /** Esc: önce yarım şekli, sonra aracı bırakır; araç yoksa eskizden çıkar. */
  escape(): void {
    if (this.pending.length) this.pending = [];
    else if (this.tool) this.tool = null;
    else return this.finish();
    this.updatePreview();
    this.onDidChange.fire();
  }

  /** Enter: açık çizgiyi bitirir. */
  enter(): void {
    if (this.tool === "line" && this.pending.length >= 2) this.commitPolyline(false);
  }

  /** Backspace: son tıklanan noktayı geri alır. */
  backspace(): void {
    if (!this.pending.length) return;
    this.pending.pop();
    this.updatePreview();
  }

  // ---- fare ----

  pointerMove(e: PointerEvent): void {
    this.cursor = this.snap(e.clientX, e.clientY);
    this.updatePreview();
    this.onDidChange.fire();
  }

  pointerLeave(): void {
    this.cursor = null;
    this.updatePreview();
  }

  click(e: PointerEvent): void {
    const p = this.snap(e.clientX, e.clientY);
    if (!p || !this.tool) return;
    this.cursor = p;
    this.addPoint(p);
  }

  doubleClick(): void {
    this.enter();
  }

  /** Eskiz koordinatında bir tıklama (fare ve testler bunu kullanır). */
  addPoint(p: Vec2): void {
    const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    switch (this.tool) {
      case "line": {
        const last = this.pending.at(-1);
        if (last && same(last, p)) return; // çift tıklamanın ikinci tıkı
        if (this.pending.length >= 3 && same(this.pending[0], p)) {
          this.commitPolyline(true);
          return;
        }
        this.pending.push(p);
        break;
      }
      case "rect":
        if (this.pending.length === 0) this.pending.push(p);
        else if (!same(this.pending[0], p) && this.pending[0][0] !== p[0] && this.pending[0][1] !== p[1]) {
          this.commit({ kind: "rect", a: this.pending[0], b: p });
        }
        break;
      case "circle":
        if (this.pending.length === 0) this.pending.push(p);
        else {
          const r = Math.hypot(p[0] - this.pending[0][0], p[1] - this.pending[0][1]);
          if (r > 1e-9) this.commit({ kind: "circle", c: this.pending[0], r: Number(r.toFixed(6)) });
        }
        break;
      default:
        return;
    }
    this.updatePreview();
  }

  private commitPolyline(closed: boolean): void {
    const points = this.pending;
    this.commit({ kind: "polyline", points, closed });
  }

  private commit(entity: SketchEntity): void {
    const f = this.sketch();
    if (!f) return;
    this.pending = [];
    this.app.document.update(f.id, { entities: [...(f.entities ?? []), entity] });
  }

  // ---- yakalama ----

  private snap(clientX: number, clientY: number): Vec2 | null {
    const raw = this.viewport.planePoint(clientX, clientY, this.plane, this.offset);
    if (!raw) return null;
    const wpp = this.viewport.worldPerPixel();
    this.gridStep = niceStep(wpp * 12);
    const candidates = [...sketchSnapPoints(this.sketch()?.entities ?? []), ...this.pending];
    let best: Vec2 | null = null;
    let bestDist = SNAP_PX * wpp;
    for (const c of candidates) {
      const d = Math.hypot(c[0] - raw[0], c[1] - raw[1]);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    this.snappedToPoint = best !== null;
    return best ? [best[0], best[1]] : snapToGrid(raw, this.gridStep);
  }

  // ---- önizleme ----

  private updatePreview(): void {
    if (!this.isActive) return;
    const segs: [Vec2, Vec2][] = [];
    const c = this.cursor;
    const p = this.pending;
    if (this.tool === "line" && p.length) {
      segs.push(...sketchSegments([{ kind: "polyline", points: c ? [...p, c] : p, closed: false }]));
    }
    if (this.tool === "rect" && p.length && c) segs.push(...sketchSegments([{ kind: "rect", a: p[0], b: c }]));
    if (this.tool === "circle" && p.length && c) {
      const r = Math.hypot(c[0] - p[0][0], c[1] - p[0][1]);
      if (r > 0) segs.push(...sketchSegments([{ kind: "circle", c: p[0], r }]), [p[0], c]);
    }
    this.viewport.setPreview(segs, this.plane, this.offset, c ?? undefined);
  }

  /** Durum çubuğu için açıklama. */
  statusText(): string {
    if (!this.isActive) return "";
    const plane = PLANES[this.plane].label;
    const tool = this.tool ? `${TOOL_LABELS[this.tool]}: ${TOOL_HINTS[this.tool]}` : "Bir araç seçin (L, R, C)";
    return `Eskiz · ${plane} — ${tool}`;
  }
}
