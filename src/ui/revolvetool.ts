import type { SugarApp } from "../app/controller";
import { AXIS_LABELS, FEATURE_PARAMS, OPERATION_LABELS, sketchDataOf, type BodyOperation, type RevolveAxis } from "../core/features";
import { compact, formatNumber, h } from "./dom";
import { dialogSelect, FeatureJobQueue } from "./featuredialog";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";

/**
 * Döndürme diyaloğu (Fusion'daki gibi): komut çalışınca özellik hemen eklenir ve model canlı güncellenir;
 * eksen, açı ve işlem değiştikçe tuvaldeki sonuç değişir. Tamam tek bir geri alma adımı bırakır,
 * İptal / Esc hiçbir iz bırakmadan geri alır.
 */
export class RevolveTool {
  private box: HTMLElement | null = null;
  private featureId: string | null = null;
  private sketchId: string | null = null;
  private body = h("div", { class: "inspect-body" });
  private readonly jobs: FeatureJobQueue;

  constructor(
    private readonly app: SugarApp,
    private readonly host: HTMLElement,
    private readonly onChanged: () => void,
  ) {
    this.jobs = new FeatureJobQueue(app, () => this.featureId);
    // Geri al / yinele / dosya yükleme oturumu bitirirse diyalog artık geçersizdir; özellik kaybolduysa da kapanır.
    app.document.onDidEndSession.on(() => this.close(true));
    app.document.onDidChange.on(() => {
      if (this.box && this.featureId && !app.document.get(this.featureId)) this.close(true);
    });
  }

  get isActive(): boolean {
    return this.box !== null;
  }

  /** Açık diyalogun özellik kimliği (testler için). */
  get feature(): string | null {
    return this.featureId;
  }

  open(): void {
    // Zaten açıksa (ikinci Shift+R, şerit düğmesi) mevcut diyaloga dokunma.
    if (this.box) return;
    const doc = this.app.document;
    doc.beginSession();
    let feature: ReturnType<SugarApp["addSketchFeature"]> = null;
    try {
      feature = this.app.addSketchFeature("revolve");
    } finally {
      if (!feature) doc.cancelSession();
    }
    if (!feature) return;
    this.featureId = feature.id;
    this.sketchId = feature.sketch ?? null;
    this.box = hudBox("Döndürme", ICONS.revolve, () => this.cancel(), this.body);
    this.box.classList.add("feature-dialog");
    this.host.append(this.box);
    // Fusion'daki gibi diyalog açıkken Özellikler paneli gizlenir (aynı alanı düzenler).
    document.body.dataset.featureDialog = "revolve";
    this.render();
    this.onChanged();
  }

  /** Tamam / Enter: yazılan açı geçerliyse uygular; değilse diyalog açık kalır. */
  async confirm(): Promise<void> {
    if (!this.box) return;
    const ok = await this.commitAngle();
    if (ok) this.apply();
  }

  /** Başka bir komut belgeyi değiştirmeden önce: diyalog uygulanabiliyorsa onaylanır, değilse iptal edilir. */
  finish(): void {
    if (!this.box) return;
    const f = this.featureId && this.app.document.get(this.featureId);
    if (f && f.operation && f.operation !== "new" && !f.target) this.cancel();
    else this.apply();
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

  /** Açı kutusuna yazılmış gibi değer verir (testler ve kısayollar için). */
  setAngle(text: string): Promise<unknown> {
    return this.jobs.run((id) => this.app.setFeatureParam(id, "angle", text));
  }

  /** Açı kutusundaki son metni modele uygular; geçersizse hata gösterir ve false döner. */
  private async commitAngle(): Promise<boolean> {
    const input = this.body.querySelector<HTMLInputElement>('input[aria-label="Açı (°)"]');
    if (!input) return true;
    return this.jobs.run((id) => this.app.setFeatureParam(id, "angle", input.value));
  }

  /** Eksen seçenekleri: eskizin iki ekseni ve eskizdeki her çizgi (yapı çizgileri dahil); Özellikler paneliyle aynı. */
  private axisOptions(sketchId: string | undefined): Record<string, string> {
    const options: Record<string, string> = { V: AXIS_LABELS.V, U: AXIS_LABELS.U };
    const sketch = sketchId ? this.app.document.get(sketchId) : undefined;
    const data = sketch ? sketchDataOf(sketch) : undefined;
    let n = 0;
    for (const c of data?.curves ?? []) {
      if (c.kind !== "line") continue;
      n++;
      options[`line:${c.id}`] = `Çizgi ${n}${c.construction ? " (yapı)" : ""}`;
    }
    return options;
  }

  private render(): void {
    const f = this.featureId ? this.app.document.get(this.featureId) : undefined;
    if (!f || !this.box) return;
    const sketch = f.sketch ? this.app.document.get(f.sketch) : undefined;
    const spec = FEATURE_PARAMS.revolve.angle;
    const operation: BodyOperation = f.operation ?? "new";
    const keys = { cancel: () => this.cancel(), confirm: () => void this.confirm() };

    const angle = h("input", {
      type: "text",
      value: f.exprs?.angle ?? formatNumber(f.params.angle ?? spec.default),
      attrs: { "aria-label": "Açı (°)", inputmode: "decimal", spellcheck: "false" },
    }) as HTMLInputElement;
    angle.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        keys.confirm();
      } else if (e.key === "Escape") keys.cancel();
    });
    angle.addEventListener("input", () => {
      // Yazarken canlı önizleme; yarım yazılmış değerler sessizce yok sayılır.
      void this.jobs.run((id) => this.app.setFeatureParam(id, "angle", angle.value), true);
    });

    const candidates = operation === "new" ? [] : this.app.targetCandidates(f.id);
    const targets = Object.fromEntries(candidates.map((c) => [c.id, c.name])) as Record<string, string>;
    const axes = this.axisOptions(f.sketch);
    const axis = f.axis ?? "V";

    this.body.replaceChildren(
      ...compact(
        h("div", { class: "dialog-note" }, `Profil: ${sketch?.name ?? "eskiz"}`),
        dialogSelect<string>(
          "Eksen",
          axes,
          axis in axes ? axis : "V",
          (v) => void this.jobs.run((id) => this.app.updateFeature(id, { axis: v as RevolveAxis })),
          keys,
        ),
        h("label", { class: "field" }, h("span", {}, spec.label), angle),
        dialogSelect<BodyOperation>(
          "İşlem",
          OPERATION_LABELS,
          operation,
          (v) =>
            void this.jobs.run(async (id) => {
              await this.app.setOperation(id, v);
              // Birden çok aday varsa ilki seçilir; açılır kutu ile model hep aynı şeyi göstersin.
              const now = this.app.document.get(id);
              const first = this.app.targetCandidates(id)[0];
              if (v !== "new" && now && !now.target && first) await this.app.updateFeature(id, { target: first.id });
              this.render();
            }),
          keys,
        ),
        operation !== "new"
          ? candidates.length
            ? dialogSelect("Hedef gövde", targets, f.target ?? candidates[0].id, (v) =>
                void this.jobs.run((id) => this.app.updateFeature(id, { target: v })), keys)
            : h("div", { class: "dialog-note warn" }, "Birleştirilecek / kesilecek bir gövde yok")
          : null,
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary", onclick: () => void this.confirm() }, "Tamam"),
          h("button", { class: "btn", onclick: () => this.cancel() }, "İptal"),
        ),
      ),
    );
    // Açı kutusu hemen yazılabilsin.
    angle.focus();
    angle.select();
  }
}
