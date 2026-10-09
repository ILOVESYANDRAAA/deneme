import type { SugarApp } from "../app/controller";
import { h, icon } from "./dom";
import { iconForType } from "./icons";
import type { Sketcher } from "./sketcher";

/**
 * Alttaki zaman çizelgesi: özellikler oluşturulma sırasıyla. Tıklayınca seçer,
 * eskize çift tıklayınca düzenlemeye açar (Fusion 360'taki tasarım geçmişi gibi).
 */
export class Timeline {
  readonly element: HTMLElement;
  private track = h("div", { class: "timeline-track", attrs: { role: "listbox", "aria-label": "Zaman çizelgesi" } });
  private queued = false;
  private readonly controls: HTMLElement;
  private readonly buttons: Record<"first" | "prev" | "next" | "last", HTMLButtonElement>;

  constructor(
    private readonly app: SugarApp,
    private readonly sketcher: Sketcher,
  ) {
    const mk = (key: "first" | "prev" | "next" | "last", label: string, svg: string) =>
      h("button", { class: "timeline-btn", attrs: { type: "button", "aria-label": label }, title: label, onclick: () => this.step(key) }, icon(svg));
    const svg = (body: string) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${body}</svg>`;
    this.buttons = {
      first: mk("first", "Başa git", svg('<rect x="2.5" y="3" width="2" height="10"/><path d="M13 3v10L5.5 8z"/>')),
      prev: mk("prev", "Bir geri", svg('<path d="M11.5 3v10L4 8z"/>')),
      next: mk("next", "Bir ileri", svg('<path d="M4.5 3v10L12 8z"/>')),
      last: mk("last", "Sona git", svg('<path d="M3 3v10l7.5-5z"/><rect x="11.5" y="3" width="2" height="10"/>')),
    };
    this.controls = h(
      "div",
      { class: "timeline-controls", attrs: { role: "group", "aria-label": "Zaman çizelgesi denetimleri" } },
      this.buttons.first,
      this.buttons.prev,
      this.buttons.next,
      this.buttons.last,
    );
    this.element = h("div", { class: "timeline" }, this.controls, h("span", { class: "timeline-title" }, "Geçmiş"), this.track);
    const refresh = () => this.schedule();
    app.document.onDidChange.on(refresh);
    app.document.onDidChangeSelection.on(refresh);
    app.onDidChangeMeshes.on(refresh);
    sketcher.onDidChange.on(refresh);
    this.render();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.render();
    });
  }

  /** İşaretin bulunduğu kare: seçili son özellik, seçim yoksa son kare. */
  private markerIndex(): number {
    const features = this.app.document.all();
    const sel = new Set(this.app.document.getSelection());
    for (let i = features.length - 1; i >= 0; i--) if (sel.has(features[i].id)) return i;
    return features.length - 1;
  }

  /** Yalnızca seçimi taşır; model hesabı ve baskılama değişmez. */
  private step(key: "first" | "prev" | "next" | "last"): void {
    const features = this.app.document.all();
    if (!features.length) return;
    const cur = this.markerIndex();
    const last = features.length - 1;
    const target = key === "first" ? 0 : key === "last" ? last : Math.min(last, Math.max(0, cur + (key === "next" ? 1 : -1)));
    this.app.document.setSelection([features[target].id]);
  }

  private render(): void {
    const doc = this.app.document;
    const selected = new Set(doc.getSelection());
    const features = doc.all();
    const marker = this.markerIndex();
    this.buttons.first.disabled = this.buttons.prev.disabled = !features.length || marker <= 0;
    this.buttons.next.disabled = this.buttons.last.disabled = !features.length || marker >= features.length - 1;
    if (!features.length) {
      this.track.replaceChildren(h("span", { class: "timeline-empty" }, "Özellikler burada sırayla görünür"));
      return;
    }
    this.track.replaceChildren(
      ...features.map((f, i) => {
        const error = this.app.errors.get(f.id);
        const chip = h(
          "button",
          {
            class: `timeline-item${error ? " error" : ""}${this.sketcher.activeId === f.id ? " editing" : ""}${i === marker ? " marker" : ""}`,
            title: `${f.name} · ${f.type}${error ? ` — ${error}` : ""}`,
            dataset: { id: f.id },
            attrs: { role: "option", "aria-selected": String(selected.has(f.id)), "aria-label": f.name },
            onclick: (e: MouseEvent) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                const sel = doc.getSelection();
                doc.setSelection(sel.includes(f.id) ? sel.filter((s) => s !== f.id) : [...sel, f.id]);
              } else doc.setSelection([f.id]);
            },
            ondblclick: () => {
              if (f.type === "sketch") this.sketcher.edit(f.id);
              else if (f.sketch) this.sketcher.edit(f.sketch);
            },
          },
          icon(iconForType(f.type, f.op)),
        );
        return chip;
      }),
    );
    this.track.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
