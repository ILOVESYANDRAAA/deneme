import type { SugarApp } from "../app/controller";
import { featureRefs, type Feature } from "../core/features";
import { h, icon } from "./dom";
import { ICONS, iconForType } from "./icons";

/** Sol paneldeki özellik ağacı: her özelliğin altında girdileri (işlenenler, eskiz) gösterilir. */
export class FeatureTree {
  readonly element: HTMLElement;
  private list: HTMLUListElement;
  private queued = false;

  constructor(private readonly app: SugarApp) {
    this.list = h("ul", { class: "tree", attrs: { role: "tree", "aria-label": "Özellik ağacı" } });
    this.element = h("section", {}, h("div", { class: "panel-title" }, "Özellik Ağacı"), this.list);
    const refresh = () => this.schedule();
    app.document.onDidChange.on(refresh);
    app.document.onDidChangeSelection.on(refresh);
    app.onDidChangeMeshes.on(refresh);
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
    const roots = doc.roots();
    const byId = doc.byId();
    const selected = new Set(doc.getSelection());
    const rows: HTMLElement[] = [];

    const add = (f: Feature, depth: number) => {
      const error = this.app.errors.get(f.id);
      const row = h(
        "li",
        {
          class: `tree-row${depth > 0 ? " consumed" : ""}`,
          style: `padding-left:${10 + depth * 16}px`,
          dataset: { id: f.id },
          title: error ?? f.name,
          attrs: { role: "treeitem", "aria-selected": String(selected.has(f.id)) },
          onclick: (e: MouseEvent) => this.onClick(f.id, e),
        },
        icon(iconForType(f.type, f.op)),
        h("span", { class: "name" }, f.name),
        error ? h("span", { class: "err", title: error }, icon(ICONS.error)) : null,
      );
      rows.push(row);
      for (const id of featureRefs(f)) {
        const child = byId.get(id);
        if (child) add(child, depth + 1);
      }
    };
    roots.forEach((f) => add(f, 0));

    if (rows.length === 0) {
      this.list.replaceChildren(h("li", { class: "empty" }, "Henüz şekil yok."));
    } else {
      this.list.replaceChildren(...rows);
    }
  }

  private onClick(id: string, e: MouseEvent): void {
    const doc = this.app.document;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const sel = doc.getSelection();
      doc.setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
    } else {
      doc.setSelection([id]);
    }
  }
}
