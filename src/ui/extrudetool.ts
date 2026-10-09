import type { SugarApp } from "../app/controller";
import { DIRECTION_LABELS, FEATURE_PARAMS, OPERATION_LABELS, type BodyOperation, type ExtrudeDirection } from "../core/features";
import { compact, formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";

/**
 * Ekstrüzyon diyaloğu (Fusion'daki gibi): komut çalışınca özellik hemen eklenir ve model canlı güncellenir;
 * yön, mesafe ve işlem değiştikçe tuvaldeki sonuç değişir. Tamam tek bir geri alma adımı bırakır,
 * İptal / Esc hiçbir iz bırakmadan geri alır.
 */
export class ExtrudeTool {
  private box: HTMLElement | null = null;
  private featureId: string | null = null;
  private sketchId: string | null = null;
  private body = h("div", { class: "inspect-body" });
  /** Girişten gelen güncellemeler sırayla uygulansın. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: SugarApp,
    private readonly host: HTMLElement,
    private readonly onChanged: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  /** Açık diyalogun özellik kimliği (testler için). */
  get feature(): string | null {
    return this.featureId;
  }

  open(): void {
    this.close(true);
    const doc = this.app.document;
    doc.beginSession();
    const feature = this.app.addSketchFeature("extrude");
    if (!feature) {
      doc.endSession();
      return;
    }
    this.featureId = feature.id;
    this.sketchId = feature.sketch ?? null;
    this.box = hudBox("Ekstrüzyon", ICONS.extrude, () => this.cancel(), this.body);
    this.box.classList.add("feature-dialog");
    this.host.append(this.box);
    // Fusion'daki gibi diyalog açıkken Özellikler paneli gizlenir (aynı alanı düzenler).
    document.body.dataset.featureDialog = "extrude";
    this.render();
    this.onChanged();
  }

  /** Tamam: özellik kalır, tek geri alma adımı olarak. */
  apply(): void {
    if (!this.box) return;
    const f = this.featureId && this.app.document.get(this.featureId);
    if (f && f.operation && f.operation !== "new" && !f.target) {
      this.app.showMessage("Birleştirmek / kesmek için bir hedef gövde seçin", "warning");
      return;
    }
    this.app.document.endSession();
    this.close(true);
  }

  /** İptal: eklenen özellik ve yapılan bütün değişiklikler geri alınır. */
  cancel(): void {
    if (!this.box) return;
    this.app.document.cancelSession();
    const sketch = this.sketchId;
    this.close(true);
    if (sketch && this.app.document.get(sketch)) this.app.document.setSelection([sketch]);
  }

  /** Diyaloğu kapatır; açıksa yapılanları iptal eder (başka bir araç açılırken). */
  close(silent = false): void {
    if (!this.box) return;
    if (!silent) this.app.document.cancelSession();
    this.box.remove();
    this.box = null;
    delete document.body.dataset.featureDialog;
    this.featureId = null;
    this.sketchId = null;
    this.onChanged();
  }

  /** Mesafe kutusuna yazılmış gibi değer verir (testler ve kısayollar için). */
  setDistance(text: string): Promise<unknown> {
    return this.enqueue(() => this.app.setFeatureParam(this.featureId!, "distance", text));
  }

  private enqueue(job: () => Promise<unknown>): Promise<unknown> {
    this.queue = this.queue.then(job).catch((e) => this.app.showMessage(e instanceof Error ? e.message : String(e), "error"));
    return this.queue;
  }

  private render(): void {
    const f = this.featureId ? this.app.document.get(this.featureId) : undefined;
    if (!f || !this.box) return;
    const sketch = f.sketch ? this.app.document.get(f.sketch) : undefined;
    const spec = FEATURE_PARAMS.extrude.distance;
    const operation: BodyOperation = f.operation ?? "new";

    const select = <T extends string>(label: string, labels: Record<T, string>, value: T, onChange: (v: T) => void) => {
      const el = h(
        "select",
        { attrs: { "aria-label": label } },
        ...(Object.keys(labels) as T[]).map((k) => h("option", { value: k, selected: k === value }, labels[k])),
      ) as HTMLSelectElement;
      el.addEventListener("change", () => onChange(el.value as T));
      el.addEventListener("keydown", (e) => e.stopPropagation());
      return h("label", { class: "field" }, h("span", {}, label), el);
    };

    const distance = h("input", {
      type: "text",
      value: f.exprs?.distance ?? formatNumber(f.params.distance ?? spec.default),
      attrs: { "aria-label": "Mesafe", inputmode: "decimal", spellcheck: "false" },
    }) as HTMLInputElement;
    distance.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void this.enqueue(() => this.app.setFeatureParam(this.featureId!, "distance", distance.value)).then(() => this.apply());
      } else if (e.key === "Escape") this.cancel();
    });
    distance.addEventListener("input", () => {
      // Yazarken canlı önizleme: geçerli sayı / ifade oldukça model güncellenir.
      void this.enqueue(() => this.app.setFeatureParam(this.featureId!, "distance", distance.value).catch(() => undefined));
    });

    const candidates = operation === "new" ? [] : this.app.targetCandidates(f.id);
    const targets = Object.fromEntries(candidates.map((c) => [c.id, c.name])) as Record<string, string>;

    this.body.replaceChildren(
      ...compact(
      h("div", { class: "dialog-note" }, `Profil: ${sketch?.name ?? "eskiz"}`),
      select<ExtrudeDirection>("Yön", DIRECTION_LABELS, f.direction ?? "one", (v) =>
        void this.enqueue(() => this.app.updateFeature(f.id, { direction: v === "one" ? undefined : v })),
      ),
      h("label", { class: "field" }, h("span", {}, "Mesafe (mm)"), distance),
      select<BodyOperation>("İşlem", OPERATION_LABELS, operation, (v) =>
        void this.enqueue(async () => {
          await this.app.setOperation(f.id, v);
          this.render();
        }),
      ),
      operation !== "new"
        ? candidates.length
          ? select("Hedef gövde", targets, f.target ?? candidates[0].id, (v) =>
              void this.enqueue(() => this.app.updateFeature(f.id, { target: v })),
            )
          : h("div", { class: "dialog-note warn" }, "Birleştirilecek / kesilecek bir gövde yok")
        : null,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => this.apply() }, "Tamam"),
        h("button", { class: "btn", onclick: () => this.cancel() }, "İptal"),
      ),
      ),
    );
    // Mesafe kutusu hemen yazılabilsin.
    distance.focus();
    distance.select();
  }
}
