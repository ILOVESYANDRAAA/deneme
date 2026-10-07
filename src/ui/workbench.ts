import type { InputField } from "../../packages/api/sugarcad";
import type { MessageKind, SugarApp, UiBridge } from "../app/controller";
import { BOOLEAN_LABELS } from "../core/features";
import type { BooleanOp } from "../core/solid";
import { Notifications, showInputDialog } from "./dialogs";
import { compact, h, icon, isTextInput } from "./dom";
import { ExtensionsPanel } from "./extensions";
import { ICONS, iconForType } from "./icons";
import { CommandPalette } from "./palette";
import { PropertiesPanel } from "./properties";
import { FeatureTree } from "./tree";
import { Viewport, type ViewName } from "./viewport";

/** Arayüzün bildirim ve form tarafı; uygulama kurulmadan önce de hazır olmalı. */
export class WorkbenchUi implements UiBridge {
  private notifications = new Notifications();

  showMessage(text: string, kind: MessageKind): void {
    this.notifications.show(text, kind);
  }

  showInput(options: { title: string; fields: InputField[] }) {
    return showInputDialog(options);
  }
}

/** VS Code düzeni: etkinlik çubuğu | yan panel | 3D görünüm | özellikler, altta durum çubuğu. */
export class Workbench {
  readonly viewport: Viewport;
  private palette: CommandPalette;
  private sidebar = h("aside", { class: "sidebar" });
  private toolbar = h("div", { class: "toolbar", attrs: { role: "toolbar", "aria-label": "Araçlar" } });
  private status = h("footer", { class: "statusbar" });
  private views: Record<"tree" | "extensions", HTMLElement>;
  private activityButtons: Record<"tree" | "extensions", HTMLButtonElement>;
  private lastComputeMs = 0;

  constructor(
    root: HTMLElement,
    private readonly app: SugarApp,
  ) {
    this.palette = new CommandPalette(app.commands);
    this.viewport = new Viewport(app);
    this.views = {
      tree: new FeatureTree(app).element,
      extensions: new ExtensionsPanel(app).element,
    };

    this.activityButtons = {
      tree: h("button", { title: "Özellik Ağacı", onclick: () => this.showView("tree") }),
      extensions: h("button", { title: "Eklentiler", onclick: () => this.showView("extensions") }),
    };
    this.activityButtons.tree.append(icon(ICONS.tree));
    this.activityButtons.extensions.append(icon(ICONS.extensions));
    const paletteButton = h("button", { title: "Komut Paleti (Ctrl+Shift+P)", onclick: () => this.palette.open() });
    paletteButton.append(icon(ICONS.palette));

    const activity = h(
      "nav",
      { class: "activitybar", attrs: { "aria-label": "Görünümler" } },
      this.activityButtons.tree,
      this.activityButtons.extensions,
      h("div", { class: "spacer" }),
      paletteButton,
    );

    const props = new PropertiesPanel(app);
    root.replaceChildren(
      h(
        "div",
        { class: "workbench" },
        activity,
        this.sidebar,
        h("main", { class: "main" }, this.toolbar, this.viewport.element),
        h("aside", { class: "props" }, props.element),
        this.status,
      ),
    );

    this.registerViewCommands();
    this.showView("tree");
    this.renderToolbar();
    this.renderStatus();

    app.commands.onDidChange.on(() => this.renderToolbar());
    app.document.onDidChange.on(() => {
      this.renderToolbar();
      this.renderStatus();
    });
    app.document.onDidChangeSelection.on(() => this.renderToolbar());
    app.onDidChangeMeshes.on((e) => {
      this.lastComputeMs = e.ms;
      this.renderStatus();
    });
    app.onDidChangeTitle.on((t) => app.platform.setTitle(t));
    app.platform.setTitle(app.title());

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  private showView(name: "tree" | "extensions"): void {
    this.sidebar.replaceChildren(this.views[name]);
    for (const [key, btn] of Object.entries(this.activityButtons)) btn.setAttribute("aria-pressed", String(key === name));
  }

  private registerViewCommands(): void {
    const c = this.app.commands;
    c.register({ id: "view.palette", title: "Komut Paleti", category: "Görünüm", keybinding: "Ctrl+Shift+P" }, () =>
      this.palette.open(),
    );
    c.register({ id: "view.fit", title: "Görünüme Sığdır", category: "Görünüm", keybinding: "F" }, () => this.viewport.fit());
    const views: [ViewName, string, string][] = [
      ["iso", "İzometrik Görünüm", "0"],
      ["top", "Üst Görünüm", "7"],
      ["front", "Ön Görünüm", "1"],
      ["right", "Sağ Görünüm", "3"],
    ];
    for (const [name, title, key] of views) {
      c.register({ id: `view.${name}`, title, category: "Görünüm", keybinding: key }, () => this.viewport.setView(name));
    }
    c.register({ id: "view.tree", title: "Özellik Ağacını Göster", category: "Görünüm", keybinding: "Ctrl+Shift+E" }, () =>
      this.showView("tree"),
    );
    c.register({ id: "view.extensions", title: "Eklentileri Göster", category: "Görünüm", keybinding: "Ctrl+Shift+X" }, () =>
      this.showView("extensions"),
    );
  }

  private renderToolbar(): void {
    const app = this.app;
    const tool = (
      label: string,
      svg: string,
      command: string,
      opts: { disabled?: boolean; title?: string; kind?: "shape" | "op" } = {},
    ) => {
      const info = app.commands.get(command);
      const btn = h(
        "button",
        {
          class: opts.kind ? `tool ${opts.kind}` : "tool",
          disabled: opts.disabled ?? false,
          title: opts.title ?? (info?.keybinding ? `${info.title} (${info.keybinding})` : (info?.title ?? label)),
          onclick: () => app.commands.run(command),
          dataset: { command },
        },
        icon(svg),
        label ? h("span", { class: "label" }, label) : null,
      );
      if (label) btn.setAttribute("aria-label", label);
      return btn;
    };
    const sep = () => h("span", { class: "sep" });
    const selCount = app.document.getSelection().length;

    const shapes = app.primitives
      .list()
      .filter((p) => app.commands.has(`shape.add.${p.type}`))
      .map((p) => tool(p.label, iconForType(p.type), `shape.add.${p.type}`, { kind: "shape" }));
    const ops = (Object.keys(BOOLEAN_LABELS) as BooleanOp[]).map((op) =>
      tool(BOOLEAN_LABELS[op], ICONS[op], `boolean.${op}`, {
        disabled: selCount !== 2,
        kind: "op",
        title: `${BOOLEAN_LABELS[op]} — Ctrl ile iki şekil seçin`,
      }),
    );
    this.toolbar.replaceChildren(
      tool("", ICONS.open, "file.open", { title: "Aç (Ctrl+O)" }),
      tool("", ICONS.save, "file.save", { title: "Kaydet (Ctrl+S)" }),
      sep(),
      ...shapes,
      sep(),
      ...ops,
      sep(),
      tool("", ICONS.undo, "edit.undo", { disabled: !app.document.canUndo, title: "Geri Al (Ctrl+Z)" }),
      tool("", ICONS.redo, "edit.redo", { disabled: !app.document.canRedo, title: "Yinele (Ctrl+Y)" }),
      tool("", ICONS.fit, "view.fit", { title: "Görünüme Sığdır (F)" }),
    );
  }

  private renderStatus(): void {
    const doc = this.app.document;
    const roots = doc.roots();
    const triangles = roots.reduce((n, f) => n + (this.app.meshes.get(f.id)?.triangles ?? 0), 0);
    const errors = roots.filter((f) => this.app.errors.has(f.id)).length;
    this.status.replaceChildren(
      ...compact(
      h("span", {}, this.app.platform.name === "tauri" ? "Masaüstü" : "Tarayıcı"),
      h("span", {}, `${doc.all().length} özellik`),
      h("span", {}, `${triangles.toLocaleString("tr")} üçgen`),
      errors ? h("span", { style: "color:var(--danger)" }, `${errors} hata`) : null,
      h("span", { class: "grow" }),
      this.lastComputeMs ? h("span", {}, `Hesap: ${this.lastComputeMs.toFixed(1)} ms`) : null,
      h("span", {}, h("kbd", {}, "Ctrl+Shift+P"), " komutlar"),
      ),
    );
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.palette.isOpen || document.querySelector(".dialog")) return;
    if (e.key === "F1") {
      e.preventDefault();
      this.palette.open();
      return;
    }
    const id = this.app.commands.findByKeybinding(e);
    if (!id) return;
    // Yazı yazılırken sadece Ctrl'li genel komutlar çalışır (Ctrl+Z/A gibi metin kısayolları hariç).
    if (isTextInput(document.activeElement)) {
      const textShortcuts = new Set(["edit.undo", "edit.redo", "edit.selectAll", "edit.delete", "edit.duplicate"]);
      if (!(e.ctrlKey || e.metaKey) || textShortcuts.has(id)) return;
    }
    e.preventDefault();
    void this.app.commands.run(id);
  }
}
