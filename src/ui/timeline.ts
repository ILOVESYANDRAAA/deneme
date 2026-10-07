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

  constructor(
    private readonly app: SugarApp,
    private readonly sketcher: Sketcher,
  ) {
    this.element = h("div", { class: "timeline" }, h("span", { class: "timeline-title" }, "Geçmiş"), this.track);
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

  private render(): void {
    const doc = this.app.document;
    const selected = new Set(doc.getSelection());
    const features = doc.all();
    if (!features.length) {
      this.track.replaceChildren(h("span", { class: "timeline-empty" }, "Özellikler burada sırayla görünür"));
      return;
    }
    this.track.replaceChildren(
      ...features.map((f) => {
        const error = this.app.errors.get(f.id);
        const chip = h(
          "button",
          {
            class: `timeline-item${error ? " error" : ""}${this.sketcher.activeId === f.id ? " editing" : ""}`,
            title: error ? `${f.name}: ${error}` : f.name,
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
