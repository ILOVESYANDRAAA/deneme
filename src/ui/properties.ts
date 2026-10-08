import { errorText, type SugarApp } from "../app/controller";
import {
  AXIS_LABELS,
  BOOLEAN_LABELS,
  DIRECTION_LABELS,
  BREP_LABELS,
  FEATURE_LABELS,
  HOLE_LABELS,
  PULL_DIRECTIONS,
  pullKey,
  visibleParams,
  type HoleType,
  OPERATION_LABELS,
  WORLD_AXIS_LABELS,
  sketchDataOf,
  type BodyOperation,
  type ExtrudeDirection,
  type Feature,
  type ParamSpec,
  type RevolveAxis,
  type WorldAxis,
} from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import { describeSketchData } from "../core/sketchmodel";
import type { BooleanOp, Vec3 } from "../core/solid";
import { formatNumber, h } from "./dom";
import type { Sketcher } from "./sketcher";

/**
 * Sağ paneldeki özellik düzenleyici. Değer, alan odağı kaybedince ya da Enter'a
 * basılınca uygulanır; her uygulama tek bir geri alma adımıdır.
 */
export class PropertiesPanel {
  readonly element: HTMLElement;
  private body: HTMLElement;
  /** Şu an gösterilen özellik ve türü; değişmediyse panel yeniden kurulmaz, sadece değerler tazelenir. */
  private shown: { id: string; type: string; key: string } | null = null;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  constructor(
    private readonly app: SugarApp,
    private readonly sketcher: Sketcher,
  ) {
    this.body = h("div");
    this.element = h("div", { class: "properties" }, this.body);
    app.document.onDidChangeSelection.on(() => this.render());
    app.document.onDidChange.on(() => this.render());
    app.onDidChangeMeshes.on(() => this.render());
    // Eskiz moduna girip çıkınca "Eskizi Düzenle / Bitir" düğmeleri değişsin (imleç hareketlerinde değil).
    let lastActive = sketcher.activeId;
    sketcher.onDidChange.on(() => {
      if (sketcher.activeId === lastActive) return;
      lastActive = sketcher.activeId;
      this.shown = null;
      this.render();
    });
    this.render();
  }

  private render(): void {
    const doc = this.app.document;
    const sel = doc.getSelection();
    if (sel.length === 1) {
      const f = doc.get(sel[0])!;
      if (this.shown?.id === f.id && this.shown.type === f.type && this.shown.key === this.shapeKey(f)) {
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

  /** Formun yapısını değiştiren alanlar (değişince form yeniden kurulur). */
  private shapeKey(f: Feature): string {
    const candidates = f.operation && f.operation !== "new" ? this.app.targetCandidates(f.id).map((c) => `${c.id}:${c.name}`).join() : "";
    return [f.op, f.operation, f.target, candidates, f.holeType, JSON.stringify(f.holes)].join("|");
  }

  private renderFeature(f: Feature): void {
    this.shown = { id: f.id, type: f.type, key: this.shapeKey(f) };
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

    const sketchLabel = FEATURE_LABELS[f.type as keyof typeof FEATURE_LABELS] ?? BREP_LABELS[f.type as keyof typeof BREP_LABELS];
    const typeLabel =
      f.type === "boolean"
        ? `Boolean · ${BOOLEAN_LABELS[f.op!]}`
        : (sketchLabel ?? def?.label ?? f.type) + (def?.pluginId ? ` (eklenti: ${def.pluginId})` : "");
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
    } else if (app.paramSpecs(f.type)) {
      if (f.type === "sketch") this.sketchFields(form, f);
      if (f.type === "extrude" || f.type === "revolve") {
        const sketch = f.sketch ? app.document.get(f.sketch) : undefined;
        form.append(h("div", { class: "meta" }, `Eskiz: ${sketch?.name ?? "—"}`));
        this.operationFields(form, f);
      }
      if (f.type === "extrude") {
        form.append(
          this.selectField("direction", "Yön", DIRECTION_LABELS, f.direction ?? "one", (v) =>
            this.apply(f.id, { direction: v === "one" ? undefined : (v as ExtrudeDirection) }),
          ),
        );
      }
      if (f.type === "revolve") this.axisField(form, f);
      if (f.source) {
        form.append(h("div", { class: "meta" }, `Kaynak gövde: ${app.document.get(f.source)?.name ?? "—"}`));
      }
      if (f.edges?.length) form.append(h("div", { class: "meta" }, `${f.edges.length} kenar seçili`));
      if (f.faces?.length) form.append(h("div", { class: "meta" }, `${f.faces.length} yüz açık`));
      if (f.type === "hole") this.holeFields(form, f);
      if (f.type === "draft") {
        const dirs = Object.fromEntries(Object.entries(PULL_DIRECTIONS).map(([k, v]) => [k, v.label]));
        form.append(this.selectField("pull", "Çekme yönü", dirs, pullKey(f.pull), (v) => this.apply(f.id, { pull: PULL_DIRECTIONS[v].dir })));
      }
      if (f.type === "mirror") {
        const planes = Object.fromEntries((Object.keys(PLANES) as PlaneName[]).map((p) => [p, PLANES[p].label]));
        form.append(this.selectField("plane", "Ayna düzlemi", planes, f.plane ?? "YZ", (v) => this.apply(f.id, { plane: v as PlaneName })));
      }
      if (f.type === "circularPattern") {
        form.append(
          this.selectField("worldAxis", "Eksen", WORLD_AXIS_LABELS, f.worldAxis ?? "Z", (v) => this.apply(f.id, { worldAxis: v as WorldAxis })),
        );
      }
      if (Object.keys(app.paramSpecs(f.type)!).length) form.append(h("h3", {}, "Parametreler"));
      const shown = visibleParams(f);
      for (const [name, spec] of Object.entries(app.paramSpecs(f.type)!)) {
        if (shown && !shown.includes(name)) continue;
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

    if (f.type === "sketch") {
      const editing = this.sketcher.activeId === f.id;
      form.append(
        h(
          "div",
          { class: "btn-row" },
          editing
            ? h("button", { class: "btn primary", onclick: () => app.commands.run("sketch.finish") }, "Eskizi Bitir")
            : h("button", { class: "btn", onclick: () => this.sketcher.edit(f.id) }, "Eskizi Düzenle"),
          !app.document.parentOf(f.id) && !editing
            ? h("button", { class: "btn primary", onclick: () => app.commands.run("feature.extrude") }, "Ekstrüzyon")
            : null,
          !app.document.parentOf(f.id) && !editing
            ? h("button", { class: "btn", onclick: () => app.commands.run("feature.revolve") }, "Döndürme")
            : null,
        ),
      );
    } else {
      form.append(h("h3", {}, "Konum"), this.vec3("position", f.position, 1));
      form.append(h("h3", {}, "Dönüş (derece)"), this.vec3("rotation", f.rotation, 15));
    }

    const mesh = app.meshes.get(f.id);
    const stats = h("div", { class: "meta", dataset: { stats: "" } }, mesh ? this.statsText(f.id) : "");
    form.append(stats);
    form.append(h("div", { class: "btn-row" }, h("button", { class: "btn danger", onclick: () => app.commands.run("edit.delete") }, "Sil")));
    this.body.replaceChildren(form);
  }

  private sketchFields(form: HTMLElement, f: Feature): void {
    const select = h(
      "select",
      { attrs: { "aria-label": "Düzlem" } },
      ...(Object.keys(PLANES) as PlaneName[]).map((p) => h("option", { value: p, selected: p === f.plane }, PLANES[p].label)),
    );
    select.addEventListener("change", () => this.apply(f.id, { plane: select.value as PlaneName }));
    this.inputs.set("plane", select);
    form.append(this.field("Düzlem", select));
    form.append(h("div", { class: "meta", dataset: { sketchdesc: "" } }, describeSketchData(sketchDataOf(f))));
  }

  /** Yeni gövde / Birleştir / Kes / Kesiştir ve hedef gövde. */
  /** Delik: tür seçimi ve her deliğin merkez koordinatları. */
  private holeFields(form: HTMLElement, f: Feature): void {
    form.append(
      this.selectField("holeType", "Delik türü", HOLE_LABELS, f.holeType ?? "simple", (v) =>
        this.apply(f.id, { holeType: v === "simple" ? undefined : (v as HoleType) }),
      ),
    );
    (f.holes ?? []).forEach((hole, i) => {
      const row = h("div", { class: "field stack" }, h("label", {}, `Delik ${i + 1} (X, Y, Z)`));
      const xyz = h("div", { class: "vec3" });
      (["X", "Y", "Z"] as const).forEach((axis, k) => {
        const input = h("input", { type: "number", value: formatNumber(hole.at[k]), attrs: { "aria-label": `Delik ${i + 1} ${axis}`, step: "0.5" } }) as HTMLInputElement;
        input.addEventListener("change", () => {
          const v = Number(input.value);
          const current = this.current();
          if (!Number.isFinite(v) || !current?.holes) return;
          const holes = current.holes.map((x, j) => (j === i ? { ...x, at: x.at.map((n, m) => (m === k ? v : n)) as Vec3 } : x));
          this.apply(f.id, { holes });
        });
        xyz.append(input);
      });
      row.append(xyz);
      form.append(row);
    });
  }

  private operationFields(form: HTMLElement, f: Feature): void {
    const op = f.operation ?? "new";
    form.append(
      this.selectField("operation", "İşlem", OPERATION_LABELS, op, (v) => {
        this.app.setOperation(f.id, v as BodyOperation).catch((e) => this.app.showMessage(errorText(e), "error"));
      }),
    );
    if (op === "new") return;
    const candidates = this.app.targetCandidates(f.id);
    if (!candidates.length) {
      form.append(h("div", { class: "meta" }, "Hedef olabilecek gövde yok: önce başka bir gövde oluşturun."));
      return;
    }
    const options: Record<string, string> = { "": "— seçin —" };
    for (const c of candidates) options[c.id] = c.name;
    form.append(this.selectField("target", "Hedef gövde", options, f.target ?? "", (v) => this.apply(f.id, { target: v || undefined })));
  }

  private selectField(key: string, label: string, options: Record<string, string>, value: string, onChange: (v: string) => void): HTMLElement {
    const select = h(
      "select",
      { attrs: { "aria-label": label } },
      ...Object.entries(options).map(([v, text]) => h("option", { value: v, selected: v === value }, text)),
    );
    select.addEventListener("change", () => onChange(select.value));
    this.inputs.set(key, select);
    return this.field(label, select);
  }

  private axisField(form: HTMLElement, f: Feature): void {
    const select = h(
      "select",
      { attrs: { "aria-label": "Eksen" } },
      ...(Object.keys(AXIS_LABELS) as RevolveAxis[]).map((a) =>
        h("option", { value: a, selected: a === (f.axis ?? "V") }, AXIS_LABELS[a]),
      ),
    );
    select.addEventListener("change", () => this.apply(f.id, { axis: select.value as RevolveAxis }));
    this.inputs.set("axis", select);
    form.append(this.field("Eksen", select));
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
    if (f.plane) set("plane", f.plane);
    if (f.type === "revolve") set("axis", f.axis ?? "V");
    if (f.type === "extrude") set("direction", f.direction ?? "one");
    if (f.type === "mirror") set("plane", f.plane ?? "YZ");
    if (f.type === "circularPattern") set("worldAxis", f.worldAxis ?? "Z");
    const desc = this.body.querySelector<HTMLElement>("[data-sketchdesc]");
    if (desc) desc.textContent = describeSketchData(sketchDataOf(f));
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
