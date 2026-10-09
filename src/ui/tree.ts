import type { SugarApp } from "../app/controller";
import { featureRefs, type Feature } from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import { h, icon } from "./dom";
import { ICONS, iconForType } from "./icons";
import type { Sketcher } from "./sketcher";
import { VIEW_LABELS, type Viewport, type ViewName } from "./viewport";

type Folder = "origin" | "bodies" | "sketches" | "views";

const NAMED_VIEWS: ViewName[] = ["iso", "front", "top", "right"];

/**
 * Tarayıcı (Fusion 360'taki Browser): Orijin düzlemleri, Gövdeler ve boştaki Eskizler.
 * Her özelliğin altında girdileri (işlenenler, eskiz, hedef gövde) gösterilir.
 */
export class FeatureTree {
  readonly element: HTMLElement;
  private list: HTMLUListElement;
  private queued = false;
  private open: Record<Folder, boolean> = { origin: false, bodies: true, sketches: true, views: false };

  constructor(
    private readonly app: SugarApp,
    private readonly sketcher: Sketcher,
    private readonly viewport?: Viewport,
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

    const folder = (key: Folder, label: string, svg: string, count?: number, eye?: HTMLElement | null) => {
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
          eye ?? null,
        ),
      );
      return open;
    };

    /** Klasör satırındaki toplu göz anahtarı. */
    const folderEye = (label: string, visible: boolean, toggle: () => void) =>
      h(
        "button",
        {
          class: "eye folder-eye",
          title: visible ? `${label} gizle` : `${label} göster`,
          attrs: { "aria-label": `${label} ${visible ? "gizle" : "göster"}`, "aria-pressed": String(visible) },
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            toggle();
          },
        },
        icon(visible ? ICONS.eye : ICONS.eyeOff),
      );
    const groupEye = (label: string, items: Feature[]) =>
      items.length
        ? folderEye(label, items.some((f) => !f.hidden), () => {
            const hide = items.some((f) => !f.hidden);
            this.app.document.batch(() => {
              for (const f of items) this.app.document.update(f.id, { hidden: hide ? true : undefined });
            });
          })
        : null;

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
    const viewport = this.viewport;
    rows.push(
      h(
        "li",
        { class: "tree-info", style: "padding-left:22px", title: "Belge birimi (salt okunur)", attrs: { role: "treeitem" } },
        h("span", { class: "name" }, "Belge Ayarları"),
        h("span", { class: "count" }, "Birimler: mm"),
      ),
    );
    if (viewport && folder("views", "Adlandırılmış Görünümler", ICONS.folder)) {
      for (const v of NAMED_VIEWS) {
        rows.push(
          h(
            "li",
            {
              class: "tree-view",
              style: "padding-left:38px",
              dataset: { view: v },
              title: "Tıkla: kamerayı bu görünüme götür",
              attrs: { role: "treeitem" },
              onclick: () => viewport.setView(v),
            },
            h("span", { class: "name" }, v === "iso" ? "Ev" : VIEW_LABELS[v]),
          ),
        );
      }
    }
    const originEye = viewport
      ? folderEye("Orijin", viewport.isOriginVisible, () => {
          viewport.setOriginVisible(!viewport.isOriginVisible);
          this.render();
        })
      : null;
    if (folder("origin", "Orijin", ICONS.origin, undefined, originEye)) {
      for (const plane of Object.keys(PLANES) as PlaneName[]) {
        rows.push(
          h(
            "li",
            {
              class: `tree-plane plane-${plane}`,
              style: "padding-left:38px",
              title: "Tıkla: bu düzlemde eskiz başlat",
              attrs: { role: "treeitem" },
              onclick: () => void this.sketcher.startNew(plane),
            },
            icon(ICONS.plane),
            h("span", { class: "name" }, PLANES[plane].label),
          ),
        );
      }
    }
    if (folder("bodies", "Gövdeler", ICONS.folder, bodies.length, groupEye("Gövdeler", bodies))) {
      if (bodies.length) bodies.forEach((f) => add(f, 0));
      else rows.push(h("li", { class: "empty" }, "Henüz gövde yok."));
    }
    if (folder("sketches", "Eskizler", ICONS.folder, sketches.length, groupEye("Eskizler", sketches))) {
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
