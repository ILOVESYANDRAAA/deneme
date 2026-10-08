import type { SugarApp } from "../app/controller";
import { frameFromPoints } from "../core/sketch";
import type { Vec3 } from "../core/solid";
import { formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import type { Sketcher } from "./sketcher";
import type { PointerHandler, Viewport } from "./viewport";

const fmtPoint = (p: Vec3) => `(${p.map((n) => formatNumber(Number(n.toFixed(3)))).join(", ")})`;

/**
 * 3 Noktalı Düzlem: gövde köşelerine (ya da yüzeyine) üç kez tıklanır; geçen düzlemde eskiz açılır.
 * İlk nokta eskiz başlangıcı, ilk iki nokta u ekseni olur.
 */
export class ThreePointPlaneTool implements PointerHandler {
  private box: HTMLElement | null = null;
  private points: Vec3[] = [];
  private hover: Vec3 | null = null;
  private body = h("div", { class: "inspect-body" });

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly sketcher: Sketcher,
    private readonly onChanged: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  open(): void {
    this.close();
    this.points = [];
    this.box = hudBox("3 Noktalı Düzlem", ICONS.plane, () => this.close(), this.body);
    this.viewport.element.append(this.box);
    this.viewport.setInteraction(this);
    this.render();
    this.onChanged();
  }

  close(): void {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.points = [];
    this.hover = null;
    this.viewport.setOverlay([], []);
    if (this.viewport.currentInteraction === this) this.viewport.setInteraction(null);
    this.onChanged();
  }

  /** Dünya noktası ekler (fare tıklaması ve testler). Üçüncüde düzlem kurulur ve eskiz açılır. */
  addPoint(p: Vec3): void {
    this.points.push(p);
    if (this.points.length < 3) return this.render();
    const frame = frameFromPoints(this.points[0], this.points[1], this.points[2]);
    if (!frame) {
      this.app.showMessage("Üç nokta aynı doğru üzerinde: düzlem oluşmaz. Farklı noktalar seçin", "warning");
      this.points.pop();
      return this.render();
    }
    const sketch = this.app.createSketch(frame);
    this.close();
    this.sketcher.edit(sketch.id);
  }

  pointerMove(e: PointerEvent): void {
    this.hover = this.viewport.pickPoint(e.clientX, e.clientY)?.point ?? null;
    this.draw();
  }

  pointerLeave(): void {
    this.hover = null;
    this.draw();
  }

  click(e: PointerEvent): void {
    const hit = this.viewport.pickPoint(e.clientX, e.clientY);
    if (hit) this.addPoint(hit.point);
  }

  doubleClick(): void {}

  private draw(): void {
    const pts = [...this.points];
    if (this.hover && pts.length < 3) pts.push(this.hover);
    const segs: [Vec3, Vec3][] = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
    this.viewport.setOverlay(segs, pts);
  }

  private render(): void {
    this.draw();
    this.body.replaceChildren(
      ...this.points.map((p, i) => h("div", { class: "meta" }, `${i + 1}. nokta ${fmtPoint(p)}`)),
      h("div", { class: "meta" }, this.points.length < 3 ? `${this.points.length + 1}. noktaya tıklayın (köşelere yapışır)` : ""),
    );
  }
}
