import { errorText, type SugarApp } from "../app/controller";
import { BOOLEAN_LABELS, type Feature, type ParamSpec } from "../core/features";
import type { BooleanOp, Vec3 } from "../core/solid";
import { formatNumber, h } from "./dom";

/**
 * Sağ paneldeki özellik düzenleyici. Değer, alan odağı kaybedince ya da Enter'a
 * basılınca uygulanır; her uygulama tek bir geri alma adımıdır.
 */
export class PropertiesPanel {
  readonly element: HTMLElement;
  private body: HTMLElement;
  /** Şu an gösterilen özellik ve türü; değişmediyse panel yeniden kurulmaz, sadece değerler tazelenir. */
  private shown: { id: string; type: string; op?: string } | null = null;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  constructor(private readonly app: SugarApp) {
    this.body = h("div");
    this.element = h("section", {}, h("div", { class: "panel-title" }, "Özellikler"), this.body);
    app.document.onDidChangeSelection.on(() => this.render());
    app.document.onDidChange.on(() => this.render());
    app.onDidChangeMeshes.on(() => this.render());
    this.render();
  }

  private render(): void {
    const doc = this.app.document;
    const sel = doc.getSelection();
    if (sel.length === 1) {
      const f = doc.get(sel[0])!;
      if (this.shown?.id === f.id && this.shown.type === f.type && this.shown.op === f.op) {
        this.refreshValues(f);
        return;
      }
      this.renderFeature(f);
      return;
    }
    this.shown = null;
    this.inputs.clear();
    if (sel.length === 0) {
      this.body.replaceChildren(
        h(
          "div",
          { class: "empty" },
          "Düzenlemek için bir şekil seçin.",
          h("br"),
          "Boolean işlemleri için ",
          h("kbd", {}, "Ctrl"),
          " ile iki şekil seçin.",
        ),
      );
      return;
    }
    const ops: BooleanOp[] = ["union", "subtract", "intersect"];
    const names = sel.map((id) => doc.get(id)?.name).join(", ");
    this.body.replaceChildren(
      h(
        "div",
        { class: "form" },
        h("div", {}, `${sel.length} şekil seçili`),
        h("div", { class: "meta" }, names),
        sel.length === 2
          ? h(
              "div",
              { class: "btn-row" },
              ...ops.map((op) =>
                h("button", { class: "btn", onclick: () => this.app.commands.run(`boolean.${op}`) }, BOOLEAN_LABELS[op]),
              ),
            )
          : h("div", { class: "meta" }, "Boolean işlemi için tam iki şekil seçin."),
        sel.length === 2 ? h("div", { class: "meta" }, `Çıkarma: "${doc.get(sel[0])?.name}" − "${doc.get(sel[1])?.name}"`) : null,
        h("div", { class: "btn-row" }, h("button", { class: "btn danger", onclick: () => this.app.commands.run("edit.delete") }, "Sil")),
      ),
    );
  }

  private renderFeature(f: Feature): void {
    this.shown = { id: f.id, type: f.type, op: f.op };
    this.inputs.clear();
    const app = this.app;
    const def = app.primitives.get(f.type);
    const form = h("div", { class: "form" });

    const nameInput = h("input", { type: "text", value: f.name, attrs: { "aria-label": "Ad" } });
    nameInput.addEventListener("change", () => {
      const name = nameInput.value.trim();
      if (name && name !== this.current()?.name) this.apply(f.id, { name });
    });
    this.inputs.set("name", nameInput);
    form.append(this.field("Ad", nameInput));

    const typeLabel =
      f.type === "boolean" ? `Boolean · ${BOOLEAN_LABELS[f.op!]}` : (def?.label ?? f.type) + (def?.pluginId ? ` (eklenti: ${def.pluginId})` : "");
    form.append(h("div", { class: "meta" }, typeLabel));

    const error = app.errors.get(f.id);
    if (error) form.append(h("div", { class: "error-box" }, error));

    if (f.type === "boolean") {
      const select = h(
        "select",
        { attrs: { "aria-label": "İşlem" } },
        ...(Object.keys(BOOLEAN_LABELS) as BooleanOp[]).map((op) =>
          h("option", { value: op, selected: op === f.op }, BOOLEAN_LABELS[op]),
        ),
      );
      select.addEventListener("change", () => this.apply(f.id, { op: select.value as BooleanOp }));
      this.inputs.set("op", select);
      form.append(this.field("İşlem", select));
      const [a, b] = (f.operands ?? []).map((id) => app.document.get(id)?.name ?? id);
      form.append(h("div", { class: "meta" }, `İşlenenler: ${a} ve ${b}`));
    } else if (def) {
      form.append(h("h3", {}, "Parametreler"));
      for (const [name, spec] of Object.entries(def.params)) {
        const input = this.numberInput(spec, f.params[name] ?? spec.default, `${spec.label}`);
        input.dataset.param = name;
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value === this.current()?.params[name]) return;
          this.apply(f.id, { params: { [name]: value } });
        });
        this.inputs.set(`param.${name}`, input);
        form.append(this.field(spec.label, input));
      }
    } else {
      form.append(h("div", { class: "meta" }, `"${f.type}" eklentisi yüklü değil; parametreler düzenlenemez.`));
    }

    form.append(h("h3", {}, "Konum"), this.vec3("position", f.position, 1));
    form.append(h("h3", {}, "Dönüş (derece)"), this.vec3("rotation", f.rotation, 15));

    const mesh = app.meshes.get(f.id);
    const stats = h("div", { class: "meta", dataset: { stats: "" } }, mesh ? this.statsText(f.id) : "");
    form.append(stats);
    form.append(h("div", { class: "btn-row" }, h("button", { class: "btn danger", onclick: () => app.commands.run("edit.delete") }, "Sil")));
    this.body.replaceChildren(form);
  }

  private statsText(id: string): string {
    const mesh = this.app.meshes.get(id);
    return mesh ? `Hacim: ${formatNumber(Number(mesh.volume.toFixed(2)))} mm³ · ${mesh.triangles.toLocaleString("tr")} üçgen` : "";
  }

  private current(): Feature | undefined {
    return this.shown ? this.app.document.get(this.shown.id) : undefined;
  }

  /** Odaktaki alan hariç değerleri belgeyle eşitler (yazarken imleç kaçmasın). */
  private refreshValues(f: Feature, force = false): void {
    const active = force ? null : document.activeElement;
    const set = (key: string, value: string) => {
      const input = this.inputs.get(key);
      if (input && input !== active && input.value !== value) input.value = value;
    };
    set("name", f.name);
    if (f.op) set("op", f.op);
    for (const [name, value] of Object.entries(f.params)) set(`param.${name}`, formatNumber(value));
    f.position.forEach((v, i) => set(`position.${i}`, formatNumber(v)));
    f.rotation.forEach((v, i) => set(`rotation.${i}`, formatNumber(v)));
    const stats = this.body.querySelector<HTMLElement>("[data-stats]");
    if (stats) stats.textContent = this.statsText(f.id);
    const err = this.app.errors.get(f.id);
    const box = this.body.querySelector(".error-box");
    if (!!err !== !!box || (box && box.textContent !== err)) this.renderFeature(f);
  }

  private apply(id: string, patch: Parameters<SugarApp["updateFeature"]>[1]): void {
    this.app.updateFeature(id, patch).then(
      () => {
        // Kırpılan değer (ör. diş sayısı 3 → 6) odaktaki alana da yansısın.
        const f = this.current();
        if (f?.id === id) this.refreshValues(f, true);
      },
      (e) => {
      this.app.showMessage(errorText(e), "error");
        const f = this.app.document.get(id);
        if (f) this.renderFeature(f);
      },
    );
  }

  private field(label: string, input: HTMLElement): HTMLElement {
    const id = `prop-${label.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    input.id = id;
    return h("div", { class: "field" }, h("label", { htmlFor: id, title: label }, label), input);
  }

  private numberInput(spec: Partial<ParamSpec>, value: number, label: string): HTMLInputElement {
    // min/max yazılmaz (adım min'den sayılır, 2 gibi değerler geçersizleşir); sınırlar uygulanırken kırpılır.
    const input = h("input", { type: "number", value: formatNumber(value), attrs: { "aria-label": label } });
    input.step = String(spec.step ?? "any");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.dispatchEvent(new Event("change"));
    });
    return input;
  }

  private vec3(key: "position" | "rotation", value: Vec3, step: number): HTMLElement {
    const axes = ["X", "Y", "Z"];
    return h(
      "div",
      { class: "vec3" },
      ...value.map((v, i) => {
        const input = this.numberInput({ step }, v, `${key === "position" ? "Konum" : "Dönüş"} ${axes[i]}`);
        input.addEventListener("change", () => {
          const f = this.current();
          const n = Number(input.value);
          if (!f || !Number.isFinite(n) || n === f[key][i]) return;
          const next = [...f[key]] as Vec3;
          next[i] = n;
          this.apply(f.id, { [key]: next });
        });
        this.inputs.set(`${key}.${i}`, input);
        return h("label", {}, axes[i], input);
      }),
    );
  }
}
