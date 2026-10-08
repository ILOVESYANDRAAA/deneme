import type { SugarApp } from "../app/controller";
import { MATERIALS, massGrams, massProperties, type MassProperties } from "../core/massprops";
import type { Vec3 } from "../core/solid";
import { formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import type { Viewport } from "./viewport";

const fmt = (n: number, digits = 3) => formatNumber(Number(n.toFixed(digits)));
const fmtPoint = (p: Vec3) => `(${p.map((n) => fmt(n)).join(", ")})`;
const MATERIAL_KEY = "sugarcad.material";

function savedMaterial(): string {
  try {
    const v = localStorage.getItem(MATERIAL_KEY);
    return v && v in MATERIALS ? v : "steel";
  } catch {
    return "steel";
  }
}

/** Seçili gövdelerin (seçim yoksa hepsinin) hacim, alan, ağırlık merkezi, kütle ve eylemsizlik değerleri. */
export class MassPropertiesTool {
  private box: HTMLElement | null = null;
  private body = h("div", { class: "inspect-body mass" });
  private material = savedMaterial();
  private custom = 1;

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly onClosed: () => void,
  ) {
    const refresh = () => this.box && this.render();
    app.onDidChangeMeshes.on(refresh);
    app.document.onDidChangeSelection.on(refresh);
  }

  get isActive(): boolean {
    return this.box !== null;
  }

  open(): void {
    if (this.box) return;
    this.box = hudBox("Kütle Özellikleri", ICONS.mass, () => this.close(), this.body);
    this.viewport.element.append(this.box);
    this.render();
    this.onClosed();
  }

  close(): void {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.viewport.setOverlay([], []);
    this.onClosed();
  }

  /** Hesaplanacak gövdeler: seçili kök gövdeler, yoksa görünür tüm kök gövdeler. */
  private targets(): { names: string[]; props: MassProperties | null } {
    const doc = this.app.document;
    const roots = doc.roots().filter((f) => f.type !== "sketch" && this.app.meshes.has(f.id));
    const selected = roots.filter((f) => doc.getSelection().includes(f.id));
    const chosen = selected.length ? selected : roots.filter((f) => !f.hidden);
    if (!chosen.length) return { names: [], props: null };
    let pos: number[] = [];
    let idx: number[] = [];
    for (const f of chosen) {
      const m = this.app.meshes.get(f.id)!;
      const offset = pos.length / 3;
      pos = pos.concat(Array.from(m.positions));
      idx = idx.concat(Array.from(m.indices, (i) => i + offset));
    }
    return { names: chosen.map((f) => f.name), props: massProperties(new Float32Array(pos), new Uint32Array(idx)) };
  }

  private density(): number {
    return this.material === "custom" ? this.custom : MATERIALS[this.material].density;
  }

  private render(): void {
    const { names, props } = this.targets();
    if (!props) {
      this.body.replaceChildren(h("div", { class: "meta" }, "Önce bir gövde oluşturun ya da seçin"));
      this.viewport.setOverlay([], []);
      return;
    }
    const select = h(
      "select",
      { attrs: { "aria-label": "Malzeme" } },
      ...Object.entries(MATERIALS).map(([k, m]) => h("option", { value: k, selected: k === this.material }, `${m.label} (${m.density} g/cm³)`)),
      h("option", { value: "custom", selected: this.material === "custom" }, "Özel yoğunluk"),
    ) as HTMLSelectElement;
    select.addEventListener("change", () => {
      this.material = select.value;
      try {
        localStorage.setItem(MATERIAL_KEY, this.material);
      } catch {
        // depolama kapalıysa seçim sadece bu oturumda geçerli
      }
      this.render();
    });
    const customInput = h("input", { type: "number", value: String(this.custom), attrs: { "aria-label": "Yoğunluk (g/cm³)", step: "0.1", min: "0" } }) as HTMLInputElement;
    customInput.addEventListener("keydown", (e) => e.stopPropagation());
    customInput.addEventListener("change", () => {
      const v = Number(customInput.value);
      if (v > 0) this.custom = v;
      this.render();
    });
    const grams = massGrams(props.volume, this.density());
    const mass = grams >= 10000 ? `${fmt(grams / 1000)} kg` : `${fmt(grams)} g`;
    const k = this.density() / 1000; // g/mm³
    const inertia = props.inertia.map((row) => row.map((v) => v * k));
    const row = (label: string, value: string, key?: string) =>
      h("div", { class: "mass-row", dataset: key ? { mass: key } : {} }, h("span", {}, label), h("strong", {}, value));
    this.body.replaceChildren(
      h("div", { class: "meta" }, names.length > 3 ? `${names.length} gövde` : names.join(", ")),
      h("label", { class: "field" }, h("span", {}, "Malzeme"), select),
      ...(this.material === "custom" ? [h("label", { class: "field" }, h("span", {}, "Yoğunluk (g/cm³)"), customInput)] : []),
      row("Hacim", `${fmt(props.volume, 2)} mm³`, "volume"),
      row("Yüzey alanı", `${fmt(props.area, 2)} mm²`, "area"),
      row("Kütle", mass, "mass"),
      row("Ağırlık merkezi", `${fmtPoint(props.centroid)} mm`, "centroid"),
      row("Sınırlayıcı kutu", `${fmt(props.bbox.max[0] - props.bbox.min[0], 2)} × ${fmt(props.bbox.max[1] - props.bbox.min[1], 2)} × ${fmt(props.bbox.max[2] - props.bbox.min[2], 2)} mm`),
      h("div", { class: "meta" }, "Eylemsizlik momentleri (ağırlık merkezinde, g·mm²)"),
      row("Ixx · Iyy · Izz", `${fmt(inertia[0][0], 1)} · ${fmt(inertia[1][1], 1)} · ${fmt(inertia[2][2], 1)}`, "inertia"),
    );
    this.viewport.setOverlay([], [props.centroid]);
  }
}
