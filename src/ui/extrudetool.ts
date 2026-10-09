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
  ) {
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
    // Zaten açıksa (ikinci E, şerit düğmesi) mevcut diyaloga dokunma.
    if (this.box) return;
    const doc = this.app.document;
    doc.beginSession();
    let feature: ReturnType<SugarApp["addSketchFeature"]> = null;
    try {
      feature = this.app.addSketchFeature("extrude");
    } finally {
      if (!feature) doc.cancelSession();
    }
    if (!feature) return;
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

  /** Tamam / Enter: yazılan mesafe geçerliyse uygular; değilse diyalog açık kalır. */
  async confirm(): Promise<void> {
    if (!this.box) return;
    const ok = await this.commitDistance();
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

  /** Mesafe kutusuna yazılmış gibi değer verir (testler ve kısayollar için). */
  setDistance(text: string): Promise<unknown> {
    return this.enqueue((id) => this.app.setFeatureParam(id, "distance", text));
  }

  /**
   * İşi sıraya alır. İş, kuyruğa alındığı andaki özelliğe uygulanır; diyalog bu arada kapandıysa ya da
   * yeniden açıldıysa hiçbir şey yapılmaz. Hata mesaj olarak gösterilir, kuyruk devam eder.
   */
  private enqueue(job: (id: string) => Promise<unknown>, quiet = false): Promise<boolean> {
    const id = this.featureId;
    const run = this.queue.then(async () => {
      if (!id || id !== this.featureId) return false;
      try {
        await job(id);
        return true;
      } catch (e) {
        if (!quiet) this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
        return false;
      }
    });
    this.queue = run;
    return run;
  }

  /** Mesafe kutusundaki son metni modele uygular; geçersizse hata gösterir ve false döner. */
  private async commitDistance(): Promise<boolean> {
    const input = this.body.querySelector<HTMLInputElement>('input[aria-label="Mesafe"]');
    if (!input) return true;
    return this.enqueue((id) => this.app.setFeatureParam(id, "distance", input.value));
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
      el.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") this.cancel();
        else if (e.key === "Enter") {
          e.preventDefault();
          void this.confirm();
        }
      });
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
        void this.confirm();
      } else if (e.key === "Escape") this.cancel();
    });
    distance.addEventListener("input", () => {
      // Yazarken canlı önizleme: geçerli sayı / ifade oldukça model güncellenir.
      // Yarım yazılmış değerler ("-", "1e") sessizce yok sayılır.
      void this.enqueue((id) => this.app.setFeatureParam(id, "distance", distance.value), true);
    });

    const candidates = operation === "new" ? [] : this.app.targetCandidates(f.id);
    const targets = Object.fromEntries(candidates.map((c) => [c.id, c.name])) as Record<string, string>;

    this.body.replaceChildren(
      ...compact(
      h("div", { class: "dialog-note" }, `Profil: ${sketch?.name ?? "eskiz"}`),
      select<ExtrudeDirection>("Yön", DIRECTION_LABELS, f.direction ?? "one", (v) =>
        void this.enqueue((id) => this.app.updateFeature(id, { direction: v === "one" ? undefined : v })),
      ),
      h("label", { class: "field" }, h("span", {}, "Mesafe (mm)"), distance),
      select<BodyOperation>("İşlem", OPERATION_LABELS, operation, (v) =>
        void this.enqueue(async (id) => {
          await this.app.setOperation(id, v);
          // Birden çok aday varsa ilki seçilir; açılır kutu ile model hep aynı şeyi göstersin.
          const now = this.app.document.get(id);
          const first = this.app.targetCandidates(id)[0];
          if (v !== "new" && now && !now.target && first) await this.app.updateFeature(id, { target: first.id });
          this.render();
        }),
      ),
      operation !== "new"
        ? candidates.length
          ? select("Hedef gövde", targets, f.target ?? candidates[0].id, (v) =>
              void this.enqueue((id) => this.app.updateFeature(id, { target: v })),
            )
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
    // Mesafe kutusu hemen yazılabilsin.
    distance.focus();
    distance.select();
  }
}
