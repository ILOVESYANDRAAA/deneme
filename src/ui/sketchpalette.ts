import { describeSketch } from "../core/sketch";
import { h, icon } from "./dom";
import { ICONS } from "./icons";
import type { SketchOptions, Sketcher } from "./sketcher";

type BoolOption = { [K in keyof SketchOptions]: SketchOptions[K] extends boolean ? K : never }[keyof SketchOptions];

const CHECKS: [BoolOption, string, string?][] = [
  ["grid", "Izgara"],
  ["snapGrid", "Izgaraya yapış"],
  ["snapPoints", "Köşe / merkeze yapış"],
  ["showProfiles", "Profilleri göster"],
  ["construction", "Yapı çizgisi modu", "X"],
];

/** Fusion 360'taki Eskiz Paleti: eskiz seçenekleri, araç ayarları ve seçili öğe işlemleri. */
export class SketchPalette {
  readonly element: HTMLElement;
  private checks = new Map<BoolOption, HTMLInputElement>();
  private sides: HTMLInputElement;
  private radius: HTMLInputElement;
  private selection = h("div", { class: "palette-selection" });
  private summary = h("div", { class: "meta" });

  constructor(private readonly sketcher: Sketcher) {
    const options = h("div", { class: "palette-options" });
    for (const [key, label, kbd] of CHECKS) {
      const input = h("input", { type: "checkbox", checked: sketcher.options[key] });
      input.addEventListener("change", () => sketcher.setOption(key, input.checked));
      this.checks.set(key, input);
      options.append(h("label", { class: "check" }, input, h("span", {}, label), kbd ? h("kbd", {}, kbd) : null));
    }
    this.sides = this.number(sketcher.options.polygonSides, 1, (v) => sketcher.setOption("polygonSides", Math.min(64, Math.max(3, Math.round(v)))));
    this.radius = this.number(sketcher.options.filletRadius, 0.5, (v) => sketcher.setOption("filletRadius", Math.max(0, v)));
    this.element = h(
      "div",
      { class: "sketch-palette form" },
      h("h3", {}, "Seçenekler"),
      options,
      h("h3", {}, "Araç ayarları"),
      h("div", { class: "field" }, h("label", { htmlFor: "pal-sides" }, "Çokgen kenar sayısı"), this.sides),
      h("div", { class: "field" }, h("label", { htmlFor: "pal-radius" }, "Yuvarlatma yarıçapı"), this.radius),
      h("h3", {}, "Seçim"),
      this.selection,
      this.summary,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => sketcher.finish() }, icon(ICONS.check), "Eskizi Bitir"),
      ),
    );
    this.sides.id = "pal-sides";
    this.radius.id = "pal-radius";
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
    this.summary.textContent = describeSketch(sk.sketch()?.entities ?? []);
  }
}
