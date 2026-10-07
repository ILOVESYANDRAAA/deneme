import type { SugarApp } from "../app/controller";
import { featureRefs, type Feature } from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import { h, icon } from "./dom";
import { ICONS, iconForType } from "./icons";
import type { Sketcher } from "./sketcher";

type Folder = "origin" | "bodies" | "sketches";

/**
 * Tarayıcı (Fusion 360'taki Browser): Orijin düzlemleri, Gövdeler ve boştaki Eskizler.
 * Her özelliğin altında girdileri (işlenenler, eskiz, hedef gövde) gösterilir.
 */
export class FeatureTree {
  readonly element: HTMLElement;
  private list: HTMLUListElement;
  private queued = false;
  private open: Record<Folder, boolean> = { origin: false, bodies: true, sketches: true };

  constructor(
    private readonly app: SugarApp,
    private readonly sketcher: Sketcher,
  ) {
    this.list = h("ul", { class: "tree", attrs: { role: "tree", "aria-label": "Özellik ağacı" } });
    this.element = h("div", { class: "browser" }, this.list);
    const refresh = () => this.schedule();
    app.document.onDidChange.on(refresh);
    app.document.onDidChangeSelection.on(refresh);
    app.onDidChangeMeshes.on(refresh);
    app.onDidChangeTitle.on(refresh);
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
    const bodies = roots.filter((f) => f.type !== "sketch");
    const sketches = roots.filter((f) => f.type === "sketch");

    const folder = (key: Folder, label: string, svg: string, count?: number) => {
      const open = this.open[key];
      rows.push(
        h(
          "li",
          {
            class: "tree-folder",
            dataset: { folder: key },
            attrs: { role: "treeitem", "aria-expanded": String(open) },
            onclick: () => {
              this.open[key] = !open;
              this.render();
            },
          },
          h("span", { class: "twisty" }, icon(open ? ICONS.chevronDown : ICONS.chevronRight)),
          icon(svg),
          h("span", { class: "name" }, label),
          count !== undefined ? h("span", { class: "count" }, String(count)) : null,
        ),
      );
      return open;
    };

    const add = (f: Feature, depth: number) => {
      const error = this.app.errors.get(f.id);
      const eye = depth === 0
        ? h(
            "button",
            {
              class: "eye",
              title: f.hidden ? "Göster (V)" : "Gizle (V)",
              attrs: { "aria-label": `${f.name} ${f.hidden ? "göster" : "gizle"}`, "aria-pressed": String(!f.hidden) },
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.app.toggleVisibility([f.id]);
              },
            },
            icon(f.hidden ? ICONS.eyeOff : ICONS.eye),
          )
        : null;
      const row = h(
        "li",
        {
          class: `tree-row${depth > 0 ? " consumed" : ""}${f.hidden ? " hidden-feature" : ""}`,
          style: `padding-left:${22 + depth * 16}px`,
          dataset: { id: f.id },
          title: error ?? f.name,
          attrs: { role: "treeitem", "aria-selected": String(selected.has(f.id)) },
          onclick: (e: MouseEvent) => this.onClick(f.id, e),
          ondblclick: () => {
            if (f.type === "sketch") this.sketcher.edit(f.id);
          },
        },
        icon(iconForType(f.type, f.op)),
        h("span", { class: "name" }, f.name),
        error ? h("span", { class: "err", title: error }, icon(ICONS.error)) : null,
        eye,
      );
      rows.push(row);
      for (const id of featureRefs(f)) {
        const child = byId.get(id);
        if (child) add(child, depth + 1);
      }
    };

    const docName = this.app.filePath?.split(/[\\/]/).pop()?.replace(/\.sugar$/, "") ?? "Adsız";
    rows.push(h("li", { class: "tree-doc", attrs: { role: "treeitem" } }, icon(ICONS.box), h("span", { class: "name" }, docName)));
    if (folder("origin", "Orijin", ICONS.origin)) {
      for (const plane of Object.keys(PLANES) as PlaneName[]) {
        rows.push(
          h(
            "li",
            {
              class: `tree-plane plane-${plane}`,
              style: "padding-left:38px",
              title: `${PLANES[plane].label} düzleminde yeni eskiz`,
              attrs: { role: "treeitem" },
              onclick: () => void this.sketcher.startNew(plane),
            },
            icon(ICONS.plane),
            h("span", { class: "name" }, PLANES[plane].label),
          ),
        );
      }
    }
    if (folder("bodies", "Gövdeler", ICONS.folder, bodies.length)) {
      if (bodies.length) bodies.forEach((f) => add(f, 0));
      else rows.push(h("li", { class: "empty" }, "Henüz gövde yok."));
    }
    if (folder("sketches", "Eskizler", ICONS.folder, sketches.length)) {
      if (sketches.length) sketches.forEach((f) => add(f, 0));
      else rows.push(h("li", { class: "empty" }, "Boşta eskiz yok."));
    }
    this.list.replaceChildren(...rows);
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
