import type { SugarApp } from "../app/controller";
import { h } from "./dom";

/**
 * Özellik diyaloglarının (Ekstrüzyon, Döndürme) ortak küçük parçaları: sıralı iş kuyruğu ve
 * Esc / Enter'ı diyaloğa bağlayan açılır kutu.
 */
export class FeatureJobQueue {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: SugarApp,
    /** Diyaloğun şu an düzenlediği özellik (yoksa diyalog kapalı). */
    private readonly current: () => string | null,
  ) {}

  /**
   * İşi sıraya alır. İş, kuyruğa alındığı andaki özelliğe uygulanır; diyalog bu arada kapandıysa ya da
   * yeniden açıldıysa hiçbir şey yapılmaz. Hata mesaj olarak gösterilir, kuyruk devam eder.
   */
  run(job: (id: string) => Promise<unknown>, quiet = false): Promise<boolean> {
    const id = this.current();
    const run = this.queue.then(async () => {
      if (!id || id !== this.current()) return false;
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
}

/** Etiketli açılır kutu; Esc iptal, Enter onay (genel kısayollara sızmaz). */
export function dialogSelect<T extends string>(
  label: string,
  labels: Record<T, string>,
  value: T,
  onChange: (v: T) => void,
  keys: { cancel: () => void; confirm: () => void },
): HTMLElement {
  const el = h(
    "select",
    { attrs: { "aria-label": label } },
    ...(Object.keys(labels) as T[]).map((k) => h("option", { value: k, selected: k === value }, labels[k])),
  ) as HTMLSelectElement;
  el.addEventListener("change", () => onChange(el.value as T));
  el.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") keys.cancel();
    else if (e.key === "Enter") {
      e.preventDefault();
      keys.confirm();
    }
  });
  return h("label", { class: "field" }, h("span", {}, label), el);
}
