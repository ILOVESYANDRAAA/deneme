import type { SugarApp } from "../app/controller";
import { errorText } from "../app/controller";
import { formatNumber, h } from "./dom";

/**
 * Parametreler paneli: adlandırılmış değerler. Özellik parametreleri (ƒ düğmesiyle) ve eskiz ölçüleri bu adlara
 * başvuran ifadeler olabilir (örn. "genislik / 2"); parametre değişince hepsi tek geri alma adımında yenilenir.
 */
export class ParametersPanel {
  readonly element: HTMLElement;
  private list = h("div", { class: "param-list" });

  constructor(private readonly app: SugarApp) {
    this.element = h("div", { class: "params-panel form" }, this.list);
    this.render();
    app.document.onDidChange.on(() => this.render());
  }

  private fail(e: unknown): void {
    this.app.showMessage(errorText(e), "error");
  }

  private render(): void {
    const doc = this.app.document;
    const { values, errors } = doc.resolvedParameters();
    const rows = doc.parameters().map((p) => {
      const name = h("input", { type: "text", value: p.name, attrs: { "aria-label": `Parametre adı ${p.name}`, spellcheck: "false" } }) as HTMLInputElement;
      const expr = h("input", { type: "text", value: p.expr, attrs: { "aria-label": `${p.name} ifadesi`, spellcheck: "false", inputmode: "decimal" } }) as HTMLInputElement;
      for (const input of [name, expr]) input.addEventListener("keydown", (e) => e.stopPropagation());
      name.addEventListener("change", () => {
        try {
          doc.renameParameter(p.name, name.value.trim());
        } catch (e) {
          this.fail(e);
          name.value = p.name;
        }
      });
      expr.addEventListener("change", () => {
        this.app.setParameter(p.name, expr.value).catch((e) => {
          this.fail(e);
          expr.value = p.expr;
        });
      });
      const err = errors[p.name];
      return h(
        "div",
        { class: `param-row${err ? " bad" : ""}`, dataset: { param: p.name } },
        name,
        expr,
        h("span", { class: "param-value", title: err ?? "" }, err ? "!" : formatNumber(Number(values[p.name].toFixed(4)))),
        h(
          "button",
          { class: "fpanel-btn", title: "Parametreyi sil", attrs: { "aria-label": `${p.name} parametresini sil` }, onclick: () => {
            try {
              doc.removeParameter(p.name);
            } catch (e) {
              this.fail(e);
            }
          } },
          "✕",
        ),
      );
    });

    const newName = h("input", { type: "text", placeholder: "ad (örn. genislik)", attrs: { "aria-label": "Yeni parametre adı", spellcheck: "false" } }) as HTMLInputElement;
    const newExpr = h("input", { type: "text", placeholder: "değer ya da ifade", attrs: { "aria-label": "Yeni parametre değeri", spellcheck: "false", inputmode: "decimal" } }) as HTMLInputElement;
    for (const input of [newName, newExpr]) input.addEventListener("keydown", (e) => e.stopPropagation());
    const add = () => {
      this.app
        .setParameter(newName.value.trim(), newExpr.value)
        .then(() => {
          newName.value = "";
          newExpr.value = "";
        })
        .catch((e) => this.fail(e));
    };
    newExpr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    this.list.replaceChildren(
      ...(rows.length
        ? [h("div", { class: "param-head" }, h("span", {}, "Ad"), h("span", {}, "Değer / ifade"), h("span", {}, "="), h("span", {}))]
        : [h("div", { class: "meta" }, "Henüz parametre yok. Bir ad ve değer girin; ölçülerde ve özellik parametrelerinde (ƒ düğmesi) ifadeyle kullanın.")]),
      ...rows,
      h("div", { class: "param-row add" }, newName, newExpr, h("button", { class: "btn primary", onclick: add }, "Ekle")),
      h("div", { class: "meta" }, "İşlevler: sin cos tan sqrt abs min max pow round ... · sabitler: pi, e · açılar derece"),
    );
  }
}
