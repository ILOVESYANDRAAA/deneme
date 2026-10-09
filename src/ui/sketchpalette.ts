import { DIMENSION_UNITS } from "../core/constrain";
import { CONSTRAINT_GLYPHS, CONSTRAINT_LABELS, CURVE_LABELS, describeSketchData, isDimension, type GeometricConstraintType } from "../core/sketchmodel";
import { h, icon } from "./dom";
import { ICONS } from "./icons";
import type { SketchOptions, Sketcher } from "./sketcher";

type BoolOption = { [K in keyof SketchOptions]: SketchOptions[K] extends boolean ? K : never }[keyof SketchOptions];

const CHECKS: [BoolOption, string, string?][] = [
  ["grid", "Izgara"],
  ["snapGrid", "Izgaraya yapış"],
  ["snapPoints", "Köşe / merkeze yapış"],
  ["showProfiles", "Profilleri göster"],
  ["showConstraints", "Kısıt simgelerini göster"],
  ["construction", "Yapı çizgisi modu", "X"],
];

/** Fusion 360'taki Eskiz Paleti: eskiz seçenekleri, araç ayarları ve seçili öğe işlemleri. */
export class SketchPalette {
  readonly element: HTMLElement;
  private checks = new Map<BoolOption, HTMLInputElement>();
  private sides: HTMLInputElement;
  private radius: HTMLInputElement;
  private offset: HTMLInputElement;
  private selection = h("div", { class: "palette-selection" });
  private summary = h("div", { class: "meta" });
  private dimensions = h("div", { class: "palette-list", attrs: { "aria-label": "Ölçüler" } });
  private constraints = h("div", { class: "palette-list", attrs: { "aria-label": "Kısıtlar" } });
  private listKey = "";

  constructor(private readonly sketcher: Sketcher, private readonly lookAtPlane: () => void = () => {}) {
    const options = h("div", { class: "palette-options" });
    for (const [key, label, kbd] of CHECKS) {
      const input = h("input", { type: "checkbox", checked: sketcher.options[key] });
      input.addEventListener("change", () => sketcher.setOption(key, input.checked));
      this.checks.set(key, input);
      options.append(h("label", { class: "check" }, input, h("span", {}, label), kbd ? h("kbd", {}, kbd) : null));
    }
    this.sides = this.number(sketcher.options.polygonSides, 1, (v) => sketcher.setOption("polygonSides", Math.min(64, Math.max(3, Math.round(v)))));
    this.radius = this.number(sketcher.options.filletRadius, 0.5, (v) => sketcher.setOption("filletRadius", Math.max(0, v)));
    this.offset = this.number(sketcher.options.offsetDistance, 0.5, (v) => sketcher.setOption("offsetDistance", Math.max(0, v)));
    this.element = h(
      "div",
      { class: "sketch-palette form" },
      h("h3", {}, "Seçenekler"),
      options,
      h("h3", {}, "Araç ayarları"),
      h("div", { class: "field" }, h("label", { htmlFor: "pal-sides" }, "Çokgen kenar sayısı"), this.sides),
      h("div", { class: "field" }, h("label", { htmlFor: "pal-radius" }, "Yuvarlatma yarıçapı"), this.radius),
      h("div", { class: "field" }, h("label", { htmlFor: "pal-offset" }, "Ofset mesafesi (0: imleçle)"), this.offset),
      h("h3", {}, "Seçim"),
      this.selection,
      this.summary,
      h("h3", {}, "Ölçüler"),
      this.dimensions,
      h("h3", {}, "Kısıtlar"),
      this.constraints,
      h(
        "div",
        { class: "palette-footer" },
        h("button", { class: "btn", title: "Görünümü eskiz düzlemine çevir", onclick: () => this.lookAtPlane() }, "Düzleme Bak"),
        h("button", { class: "btn finish", onclick: () => sketcher.finish() }, icon(ICONS.check), "Eskizi Bitir"),
      ),
    );
    this.sides.id = "pal-sides";
    this.radius.id = "pal-radius";
    this.offset.id = "pal-offset";
    sketcher.onDidChange.on(() => this.render());
    this.render();
  }

  private number(value: number, step: number, apply: (v: number) => void): HTMLInputElement {
    const input = h("input", { type: "number", value: String(value) });
    input.step = String(step);
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) apply(v);
    });
    return input;
  }

  private render(): void {
    const sk = this.sketcher;
    if (!sk.isActive) return;
    for (const [key, input] of this.checks) input.checked = sk.options[key];
    if (document.activeElement !== this.sides) this.sides.value = String(sk.options.polygonSides);
    if (document.activeElement !== this.radius) this.radius.value = String(sk.options.filletRadius);
    if (document.activeElement !== this.offset) this.offset.value = String(sk.options.offsetDistance);
    const n = sk.selected.size;
    const run = (fn: () => void) => () => {
      try {
        fn();
      } catch (e) {
        sk.reportError(e);
      }
    };
    const key = `${n}`;
    if (this.selection.dataset.key !== key) {
      this.selection.dataset.key = key;
      this.selection.replaceChildren(
        n
          ? h(
              "div",
              { class: "btn-row" },
              h("span", { class: "meta" }, `${n} öğe seçili`),
              h("button", { class: "btn", title: "Yapı çizgisi yap / geri al (X)", onclick: run(() => sk.toggleConstruction()) }, "Yapı çizgisi"),
              h("button", { class: "btn", title: "Dikey eksende aynala", onclick: run(() => sk.mirrorSelected("V")) }, "Aynala ↔"),
              h("button", { class: "btn", title: "Yatay eksende aynala", onclick: run(() => sk.mirrorSelected("U")) }, "Aynala ↕"),
              h("button", { class: "btn danger", title: "Sil (Delete)", onclick: run(() => sk.deleteSelected()) }, "Sil"),
            )
          : h("div", { class: "meta" }, "Araç yokken (Esc) öğelere tıklayarak seçin; Ctrl ile çoklu seçim."),
      );
    }
    this.summary.textContent = describeSketchData(sk.data());
    this.renderLists();
  }

  /** Kısıt ve ölçü listeleri; odakta bir değer girişi varken yeniden kurulmaz. */
  private renderLists(): void {
    const sk = this.sketcher;
    const d = sk.data();
    const key = [
      d.constraints.map((k) => `${k.id}:${k.value ?? ""}`).join("|"),
      [...sk.selected].join(","),
      sk.solveInfo.conflicting.join(","),
    ].join("#");
    if (key === this.listKey || this.dimensions.contains(document.activeElement)) return;
    this.listKey = key;
    const nameOf = (id: string) => {
      const c = d.curves.find((x) => x.id === id);
      return c ? `${CURVE_LABELS[c.kind]} ${id.slice(1)}` : `Nokta ${id.slice(1)}`;
    };
    const conflicting = new Set(sk.solveInfo.conflicting);
    const remove = (id: string) =>
      h("button", { class: "btn small danger", title: "Sil", attrs: { "aria-label": "Sil" }, onclick: () => {
        sk.selected.clear();
        sk.selected.add(id);
        sk.deleteSelected();
      } }, "✕");
    const dims = d.constraints.filter(isDimension);
    this.dimensions.replaceChildren(
      ...(dims.length
        ? dims.map((k) => {
            // Metin kutusu: sayı ya da parametre ifadesi ("genislik / 2") yazılabilir.
            const shown = () => k.expr ?? String(Number((k.value ?? 0).toFixed(4)));
            const input = h("input", { type: "text", value: shown(), title: k.expr ? `= ${k.value}` : "", attrs: { inputmode: "decimal", spellcheck: "false", "aria-label": `${CONSTRAINT_LABELS[k.type]} ${nameOf(k.refs[0])}` } });
            input.addEventListener("keydown", (e) => e.stopPropagation());
            input.addEventListener("change", () => {
              if (!sk.setDimensionText(k.id, input.value)) input.value = shown();
            });
            return h(
              "div",
              { class: `palette-row${sk.selected.has(k.id) ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`, dataset: { constraint: k.id } },
              h("span", { class: "grow", title: k.refs.map(nameOf).join(" – ") }, `${CONSTRAINT_LABELS[k.type]} · ${nameOf(k.refs[0])}`),
              input,
              h("span", { class: "unit" }, DIMENSION_UNITS[k.type as keyof typeof DIMENSION_UNITS]),
              remove(k.id),
            );
          })
        : [h("div", { class: "meta" }, "Ölçü yok. Ölçü aracı (D) ile ekleyin.")]),
    );
    const geo = d.constraints.filter((k) => !isDimension(k));
    this.constraints.replaceChildren(
      ...(geo.length
        ? geo.map((k) =>
            h(
              "div",
              {
                class: `palette-row${sk.selected.has(k.id) ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`,
                dataset: { constraint: k.id },
                onclick: (e: MouseEvent) => sk.selectItem(k.id, e.ctrlKey || e.metaKey || e.shiftKey),
              },
              h("span", { class: "glyph" }, CONSTRAINT_GLYPHS[k.type as GeometricConstraintType] ?? "?"),
              h("span", { class: "grow", title: k.refs.map(nameOf).join(" – ") }, `${CONSTRAINT_LABELS[k.type]} · ${k.refs.map(nameOf).join(", ")}`),
              remove(k.id),
            ),
          )
        : [h("div", { class: "meta" }, "Kısıt yok.")]),
    );
  }
}
