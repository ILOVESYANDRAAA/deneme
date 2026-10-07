import { PLANES, type PlaneName } from "../core/sketch";
import type { Vec3 } from "../core/solid";
import { formatNumber, h, icon } from "./dom";
import { ICONS } from "./icons";
import type { PointerHandler, Viewport } from "./viewport";

const fmt = (n: number) => formatNumber(Number(n.toFixed(3)));
const fmtPoint = (p: Vec3) => `(${p.map(fmt).join(", ")})`;

/** Görünümün üst ortasında duran küçük araç kutusu. */
function hudBox(title: string, svg: string, onClose: () => void, ...children: HTMLElement[]): HTMLElement {
  return h(
    "div",
    { class: "inspect-hud", attrs: { role: "dialog", "aria-label": title } },
    h(
      "div",
      { class: "inspect-head" },
      icon(svg),
      h("strong", {}, title),
      h("button", { class: "fpanel-btn", title: "Kapat (Esc)", attrs: { "aria-label": `${title} kapat` }, onclick: onClose }, icon(ICONS.close)),
    ),
    ...children,
  );
}

/**
 * Ölç: gövde yüzeyinde iki nokta seçince aradaki mesafeyi ve eksen farklarını gösterir.
 * İmleç üçgen köşelerine yapışır.
 */
export class MeasureTool implements PointerHandler {
  private points: Vec3[] = [];
  private hover: Vec3 | null = null;
  private box: HTMLElement | null = null;
  private body = h("div", { class: "inspect-body" });

  constructor(
    private readonly viewport: Viewport,
    private readonly onClosed: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  open(): void {
    if (this.box) return;
    this.points = [];
    this.box = hudBox("Ölç", ICONS.measure, () => this.close(), this.body);
    this.viewport.element.append(this.box);
    this.viewport.setInteraction(this);
    this.render();
  }

  close(): void {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.points = [];
    this.hover = null;
    this.viewport.setOverlay([], []);
    if (this.viewport.currentInteraction === this) this.viewport.setInteraction(null);
    this.onClosed();
  }

  /** Testler ve klavye için: dünya noktası ekler. */
  addPoint(p: Vec3): void {
    if (this.points.length >= 2) this.points = [];
    this.points.push(p);
    this.render();
  }

  get result(): { distance: number; delta: Vec3 } | null {
    if (this.points.length < 2) return null;
    const [a, b] = this.points;
    const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { distance: Math.hypot(...delta), delta };
  }

  pointerMove(e: PointerEvent): void {
    this.hover = this.viewport.pickPoint(e.clientX, e.clientY)?.point ?? null;
    this.drawOverlay();
  }

  pointerLeave(): void {
    this.hover = null;
    this.drawOverlay();
  }

  click(e: PointerEvent): void {
    const hit = this.viewport.pickPoint(e.clientX, e.clientY);
    if (hit) this.addPoint(hit.point);
  }

  doubleClick(): void {}

  private drawOverlay(): void {
    const pts = [...this.points];
    if (this.hover && this.points.length < 2) pts.push(this.hover);
    const segs: [Vec3, Vec3][] = pts.length >= 2 ? [[pts[0], pts[1]]] : [];
    this.viewport.setOverlay(segs, pts);
  }

  private render(): void {
    this.drawOverlay();
    const r = this.result;
    const [a, b] = this.points;
    this.body.replaceChildren(
      ...(a ? [h("div", { class: "meta" }, `1. nokta ${fmtPoint(a)}`)] : [h("div", { class: "meta" }, "Gövde üzerinde ilk noktaya tıklayın (köşelere yapışır)")]),
      ...(b ? [h("div", { class: "meta" }, `2. nokta ${fmtPoint(b)}`)] : a ? [h("div", { class: "meta" }, "İkinci noktaya tıklayın")] : []),
      ...(r
        ? [
            h("div", { class: "measure-result", dataset: { distance: String(r.distance) } }, `Mesafe: ${fmt(r.distance)} mm`),
            h("div", { class: "meta" }, `ΔX ${fmt(r.delta[0])} · ΔY ${fmt(r.delta[1])} · ΔZ ${fmt(r.delta[2])}`),
          ]
        : []),
    );
  }
}

/** Kesit Analizi: seçilen düzlemle modeli keser; kesilen yüzler kırmızı görünür. */
export class SectionTool {
  private box: HTMLElement | null = null;

  constructor(
    private readonly viewport: Viewport,
    private readonly onClosed: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  open(): void {
    if (this.box) return;
    const state = { plane: "XZ" as PlaneName, offset: 0, flip: false };
    const range = () => this.viewport.extentAlong(state.plane);
    const [lo, hi] = range();
    state.offset = Number(((lo + hi) / 2).toFixed(3));
    const slider = h("input", { type: "range", attrs: { "aria-label": "Kesit konumu" } });
    const number = h("input", { type: "number", attrs: { "aria-label": "Kesit ofseti" } });
    number.step = "any";
    const setRange = () => {
      const [a, b] = range();
      const pad = Math.max(1, (b - a) * 0.05);
      slider.min = String(a - pad);
      slider.max = String(b + pad);
      slider.step = String(Math.max(0.01, (b - a) / 400));
    };
    const apply = () => {
      slider.value = String(state.offset);
      number.value = fmt(state.offset);
      this.viewport.setSection({ ...state });
    };
    slider.addEventListener("input", () => {
      state.offset = Number(slider.value);
      apply();
    });
    number.addEventListener("change", () => {
      const v = Number(number.value);
      if (Number.isFinite(v)) state.offset = v;
      apply();
    });
    const plane = h(
      "select",
      { attrs: { "aria-label": "Kesit düzlemi" } },
      ...(Object.keys(PLANES) as PlaneName[]).map((p) => h("option", { value: p, selected: p === state.plane }, PLANES[p].label)),
    );
    plane.addEventListener("change", () => {
      state.plane = plane.value as PlaneName;
      setRange();
      const [a, b] = range();
      state.offset = Number(((a + b) / 2).toFixed(3));
      apply();
    });
    const flip = h("input", { type: "checkbox" });
    flip.addEventListener("change", () => {
      state.flip = flip.checked;
      apply();
    });
    this.box = hudBox(
      "Kesit Analizi",
      ICONS.section,
      () => this.close(),
      h(
        "div",
        { class: "inspect-body form" },
        h("div", { class: "field" }, h("label", {}, "Düzlem"), plane),
        h("div", { class: "field" }, h("label", {}, "Ofset"), number),
        slider,
        h("label", { class: "check" }, flip, h("span", {}, "Öbür tarafı göster")),
      ),
    );
    this.viewport.element.append(this.box);
    setRange();
    apply();
  }

  close(): void {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.viewport.setSection(null);
    this.onClosed();
  }

  toggle(): void {
    if (this.box) this.close();
    else this.open();
  }
}
