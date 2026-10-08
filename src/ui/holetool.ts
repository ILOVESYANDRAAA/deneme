import * as THREE from "three";
import type { SugarApp } from "../app/controller";
import { FEATURE_PARAMS, HOLE_LABELS, placeMatrix, visibleParams, type HolePoint, type HoleType } from "../core/features";
import type { Vec3 } from "../core/solid";
import { formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import type { PointerHandler, Viewport } from "./viewport";

const COLOR = 0xff5a1f;
const PREVIEW = 0xffd23f;

/**
 * Delik: gövde yüzeyine tıklayarak konum(lar) seçilir; tür, çap, derinlik girilir; Uygula ile
 * "Delik" özelliği eklenir. Konumlar kutuda sayısal olarak da düzenlenir.
 */
export class HoleTool implements PointerHandler {
  private box: HTMLElement | null = null;
  private sourceId: string | null = null;
  private points: HolePoint[] = [];
  private hover: HolePoint | null = null;
  private type: HoleType = "simple";
  private values: Record<string, number> = {};
  private objects: THREE.Object3D[] = [];
  private body = h("div", { class: "inspect-body" });

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly onChanged: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  get placed(): readonly HolePoint[] {
    return this.points;
  }

  open(): void {
    this.close();
    const sel = this.app.document.getSelection();
    const picked = sel.length === 1 ? this.app.document.get(sel[0]) : undefined;
    // Seçili boştaki bir gövde varsa delikler ona açılır; yoksa ilk tıklanan gövde kaynak olur.
    if (picked && picked.type !== "sketch" && !this.app.document.parentOf(picked.id)) this.sourceId = picked.id;
    else this.sourceId = null;
    this.points = [];
    this.type = "simple";
    this.values = Object.fromEntries(Object.entries(FEATURE_PARAMS.hole).map(([k, spec]) => [k, spec.default]));
    this.box = hudBox("Delik", ICONS.hole, () => this.close(), this.body);
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
    this.sourceId = null;
    this.clearObjects();
    if (this.viewport.currentInteraction === this) this.viewport.setInteraction(null);
    this.viewport.requestRender();
    this.onChanged();
  }

  /** Testler için: dünya koordinatında konum ekler. */
  addPoint(at: Vec3, normal: Vec3): void {
    this.points.push({ at, normal });
    this.render();
  }

  apply(): void {
    if (!this.sourceId || !this.points.length) {
      this.app.showMessage("Önce gövde yüzeyine tıklayarak en az bir delik konumu seçin", "warning");
      return;
    }
    try {
      this.app.addHoleFeature(this.sourceId, this.points, { type: this.type, params: this.values });
    } catch (e) {
      this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
      return;
    }
    this.close();
  }

  // ---- fare ----

  pointerMove(e: PointerEvent): void {
    const hit = this.viewport.pickSurface(e.clientX, e.clientY, this.sourceId ?? undefined);
    this.hover = hit ? { at: hit.point, normal: hit.normal } : null;
    this.drawMarkers();
  }

  pointerLeave(): void {
    this.hover = null;
    this.drawMarkers();
  }

  click(e: PointerEvent): void {
    const hit = this.viewport.pickSurface(e.clientX, e.clientY, this.sourceId ?? undefined);
    if (!hit) return;
    const body = this.app.document.get(hit.featureId);
    if (!this.sourceId) {
      if (!body || this.app.document.parentOf(body.id)) return;
      this.sourceId = hit.featureId;
    }
    this.points.push({ at: hit.point, normal: hit.normal });
    this.render();
  }

  doubleClick(): void {}

  // ---- çizim ----

  private clearObjects(): void {
    for (const o of this.objects) {
      this.viewport.layer.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
    }
    this.objects = [];
  }

  /** Konumların çevresine delik çapında halka, merkezine nokta çizer. */
  private drawMarkers(): void {
    this.clearObjects();
    const radius = Math.max(this.values.diameter, this.type === "counterbore" ? this.values.cbDiameter : 0, this.type === "countersink" ? this.values.csDiameter : 0) / 2;
    const ring = (p: HolePoint, color: number) => {
      const m = new THREE.Matrix4().fromArray(placeMatrix(p.at, p.normal));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        // Yüzeyin biraz üstünde çizilir (z-çakışması olmasın).
        pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0.02).applyMatrix4(m));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false }));
      const dot = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p.at)]),
        new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false, depthTest: false }),
      );
      for (const o of [line, dot]) {
        o.renderOrder = 32;
        this.viewport.layer.add(o);
        this.objects.push(o);
      }
    };
    this.points.forEach((p) => ring(p, COLOR));
    if (this.hover) ring(this.hover, PREVIEW);
    this.viewport.requestRender();
  }

  // ---- kutu ----

  private numberInput(key: string, label: string, onChange: () => void): HTMLElement {
    const spec = FEATURE_PARAMS.hole[key];
    const input = h("input", { type: "number", value: formatNumber(this.values[key]), attrs: { "aria-label": label, step: String(spec.step ?? 1), min: String(spec.min ?? 0) } }) as HTMLInputElement;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.values[key] = Number(input.value);
        this.apply();
      } else if (e.key === "Escape") this.close();
    });
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) this.values[key] = v;
      onChange();
    });
    return h("label", { class: "field" }, h("span", {}, label), input);
  }

  private render(): void {
    const shown = visibleParams({ type: "hole", holeType: this.type }) ?? [];
    const select = h(
      "select",
      { attrs: { "aria-label": "Delik türü" } },
      ...(Object.keys(HOLE_LABELS) as HoleType[]).map((t) => h("option", { value: t, selected: t === this.type }, HOLE_LABELS[t])),
    ) as HTMLSelectElement;
    select.addEventListener("change", () => {
      this.type = select.value as HoleType;
      this.render();
    });
    const positions = this.points.map((p, i) =>
      h(
        "div",
        { class: "hole-row", dataset: { hole: String(i) } },
        h("span", { class: "meta" }, `${i + 1}.`),
        ...(["X", "Y", "Z"] as const).map((axis, k) => {
          const input = h("input", { type: "number", value: formatNumber(p.at[k]), attrs: { "aria-label": `Delik ${i + 1} ${axis}`, step: "0.5" } }) as HTMLInputElement;
          input.addEventListener("keydown", (e) => e.stopPropagation());
          input.addEventListener("change", () => {
            const v = Number(input.value);
            if (Number.isFinite(v)) {
              p.at[k] = v;
              this.drawMarkers();
            }
          });
          return input;
        }),
        h("button", { class: "fpanel-btn", title: "Bu konumu kaldır", attrs: { "aria-label": `Delik ${i + 1} kaldır` }, onclick: () => { this.points.splice(i, 1); this.render(); } }, "✕"),
      ),
    );
    this.body.replaceChildren(
      h(
        "div",
        { class: "meta" },
        this.points.length
          ? `${this.points.length} konum seçili — yüzeye tıklayarak ekleyin, değerleri girip Uygula'ya basın`
          : this.sourceId
            ? "Deliğin açılacağı yüzeye tıklayın (birden çok konum seçebilirsiniz)"
            : "Gövde yüzeyine tıklayın: delik tıkladığınız yüzeyden içeri açılır",
      ),
      h("label", { class: "field" }, h("span", {}, "Tür"), select),
      ...shown.map((key) => this.numberInput(key, FEATURE_PARAMS.hole[key].label, () => this.drawMarkers())),
      ...(positions.length ? [h("div", { class: "hole-list" }, ...positions)] : []),
      h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => this.close() }, "İptal"), h("button", { class: "btn primary", disabled: this.points.length === 0, onclick: () => this.apply() }, "Uygula")),
    );
    this.drawMarkers();
  }
}
