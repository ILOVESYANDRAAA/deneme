import type { InputField } from "../../packages/api/sugarcad";
import type { MessageKind, SugarApp, UiBridge } from "../app/controller";
import { BOOLEAN_LABELS } from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import type { BooleanOp } from "../core/solid";
import { Notifications, showInputDialog } from "./dialogs";
import { compact, h, icon, isTextInput } from "./dom";
import { ExtensionsPanel } from "./extensions";
import { ICONS, iconForType } from "./icons";
import { CommandPalette } from "./palette";
import { PropertiesPanel } from "./properties";
import { Sketcher, TOOL_LABELS, type SketchTool } from "./sketcher";
import { FeatureTree } from "./tree";
import { UpdateChecker } from "./updates";
import { Viewport, type ViewName } from "./viewport";

/** Arayüzün bildirim ve form tarafı; uygulama kurulmadan önce de hazır olmalı. */
export class WorkbenchUi implements UiBridge {
  private notifications = new Notifications();

  showMessage(text: string, kind: MessageKind): void {
    this.notifications.show(text, kind);
  }

  /** Düğmeli, kendiliğinden kapanmayan bildirim. Dönen öğenin metni güncellenebilir. */
  notify(text: string, kind: MessageKind, actions: { label: string; run: () => void }[]): HTMLElement {
    return this.notifications.show(text, kind, actions);
  }

  showInput(options: { title: string; fields: InputField[] }) {
    return showInputDialog(options);
  }
}

/** VS Code düzeni: etkinlik çubuğu | yan panel | 3D görünüm | özellikler, altta durum çubuğu. */
export class Workbench {
  readonly viewport: Viewport;
  readonly sketcher: Sketcher;
  private palette: CommandPalette;
  private sidebar = h("aside", { class: "sidebar" });
  private toolbar = h("div", { class: "toolbar", attrs: { role: "toolbar", "aria-label": "Araçlar" } });
  private status = h("footer", { class: "statusbar" });
  private views: Record<"tree" | "extensions", HTMLElement>;
  private activityButtons: Record<"tree" | "extensions", HTMLButtonElement>;
  private lastComputeMs = 0;
  private version = "";
  readonly updates: UpdateChecker;

  constructor(
    root: HTMLElement,
    private readonly app: SugarApp,
    ui: WorkbenchUi,
  ) {
    this.updates = new UpdateChecker(app, ui);
    this.palette = new CommandPalette(app.commands);
    this.viewport = new Viewport(app);
    this.sketcher = new Sketcher(app, this.viewport);
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

    const props = new PropertiesPanel(app, this.sketcher);
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
    this.registerSketchCommands();
    this.showView("tree");
    this.renderToolbar();
    this.renderStatus();

    app.commands.onDidChange.on(() => this.renderToolbar());
    app.document.onDidChange.on(() => {
      this.renderToolbar();
      this.renderStatus();
    });
    app.document.onDidChangeSelection.on(() => this.renderToolbar());
    this.sketcher.onDidChange.on(() => {
      this.renderToolbar();
      this.renderStatus();
    });
    app.onDidChangeMeshes.on((e) => {
      this.lastComputeMs = e.ms;
      this.renderStatus();
    });
    app.onDidChangeTitle.on((t) => app.platform.setTitle(t));
    void app.platform.appVersion().then((v) => {
      this.version = v;
      this.renderStatus();
    });
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
    c.register({ id: "help.checkUpdates", title: "Güncellemeleri Denetle", category: "Yardım" }, () => {
      if (this.app.platform.name !== "tauri") throw new Error("Güncelleme denetimi masaüstü uygulamasında çalışır");
      return this.updates.check(true);
    });
  }

  private registerSketchCommands(): void {
    const c = this.app.commands;
    const sk = this.sketcher;
    c.register({ id: "sketch.new", title: "Yeni Eskiz…", category: "Eskiz", keybinding: "S" }, () => sk.startNew());
    for (const plane of Object.keys(PLANES) as PlaneName[]) {
      c.register({ id: `sketch.new.${plane}`, title: `Yeni Eskiz: ${PLANES[plane].label}`, category: "Eskiz" }, () =>
        sk.startNew(plane),
      );
    }
    c.register({ id: "sketch.edit", title: "Seçili Eskizi Düzenle", category: "Eskiz" }, () => {
      const doc = this.app.document;
      const sel = doc.getSelection().map((id) => doc.get(id));
      // Ekstrüzyon / döndürme seçiliyse onun eskizini aç.
      const target = sel.length === 1 ? (sel[0]?.type === "sketch" ? sel[0].id : sel[0]?.sketch) : undefined;
      if (!target) throw new Error("Düzenlemek için ağaçtan bir eskiz (ya da ekstrüzyon) seçin");
      sk.edit(target);
    });
    c.register({ id: "sketch.finish", title: "Eskizi Bitir", category: "Eskiz", keybinding: "Ctrl+Enter" }, () =>
      sk.finish(),
    );
    const tools: [SketchTool, string][] = [
      ["line", "L"],
      ["rect", "R"],
      ["circle", "C"],
    ];
    for (const [tool, key] of tools) {
      c.register({ id: `sketch.tool.${tool}`, title: TOOL_LABELS[tool], category: "Eskiz", keybinding: key }, () =>
        sk.setTool(tool),
      );
    }
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
    const undoRedo = [
      tool("", ICONS.undo, "edit.undo", { disabled: !app.document.canUndo, title: "Geri Al (Ctrl+Z)" }),
      tool("", ICONS.redo, "edit.redo", { disabled: !app.document.canRedo, title: "Yinele (Ctrl+Y)" }),
    ];

    if (this.sketcher.isActive) {
      const sketch = this.sketcher.sketch();
      const tools = (Object.keys(TOOL_LABELS) as SketchTool[]).map((t) => {
        const btn = tool(TOOL_LABELS[t], ICONS[t], `sketch.tool.${t}`);
        btn.setAttribute("aria-pressed", String(this.sketcher.tool === t));
        return btn;
      });
      const finish = tool("Eskizi Bitir", ICONS.check, "sketch.finish");
      finish.classList.add("primary");
      this.toolbar.replaceChildren(
        ...tools,
        sep(),
        ...undoRedo,
        sep(),
        finish,
        h("span", { class: "toolbar-title" }, `${sketch?.name ?? ""} · ${PLANES[this.sketcher.plane].label}`),
      );
      return;
    }

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
      ...compact(
        tool("", ICONS.open, "file.open", { title: "Aç (Ctrl+O)" }),
        tool("", ICONS.save, "file.save", { title: "Kaydet (Ctrl+S)" }),
        sep(),
        tool("Eskiz", ICONS.sketch, "sketch.new"),
        tool("Ekstrüzyon", ICONS.extrude, "feature.extrude"),
        tool("Döndürme", ICONS.revolve, "feature.revolve"),
        shapes.length ? sep() : null,
        ...shapes,
        sep(),
        ...ops,
        sep(),
        ...undoRedo,
        tool("", ICONS.fit, "view.fit", { title: "Görünüme Sığdır (F)" }),
      ),
    );
  }

  private renderStatus(): void {
    const doc = this.app.document;
    const roots = doc.roots();
    const triangles = roots.reduce((n, f) => n + (this.app.meshes.get(f.id)?.triangles ?? 0), 0);
    const errors = roots.filter((f) => this.app.errors.has(f.id)).length;
    const sk = this.sketcher;
    if (sk.isActive) {
      const c = sk.cursor;
      this.status.replaceChildren(
        ...compact(
          h("span", { class: "sketch-status" }, sk.statusText()),
          h("span", { class: "grow" }),
          c ? h("span", { class: "coords" }, `u ${c[0].toFixed(2)}  v ${c[1].toFixed(2)}${sk.snappedToPoint ? " · köşe" : ""}`) : null,
          h("span", {}, `Izgara: ${sk.gridStep} mm`),
          h("span", {}, h("kbd", {}, "Esc"), " iptal"),
        ),
      );
      return;
    }
    this.status.replaceChildren(
      ...compact(
      h("span", {}, this.app.platform.name === "tauri" ? "Masaüstü" : "Tarayıcı"),
      h("span", {}, `${doc.all().length} özellik`),
      h("span", {}, `${triangles.toLocaleString("tr")} üçgen`),
      errors ? h("span", { style: "color:var(--danger)" }, `${errors} hata`) : null,
      h("span", { class: "grow" }),
      this.lastComputeMs ? h("span", {}, `Hesap: ${this.lastComputeMs.toFixed(1)} ms`) : null,
      this.version ? h("span", { title: "sugarCAD sürümü" }, `v${this.version}`) : null,
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
    const typing = isTextInput(document.activeElement);
    if (!typing && e.key === "Escape" && this.viewport.isPickingPlane) {
      this.viewport.cancelPlanePick();
      return;
    }
    if (!typing && this.sketcher.isActive && !(e.ctrlKey || e.metaKey || e.altKey)) {
      const keys: Record<string, () => void> = {
        Escape: () => this.sketcher.escape(),
        Enter: () => this.sketcher.enter(),
        Backspace: () => this.sketcher.backspace(),
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
        return;
      }
    }
    const id = this.app.commands.findByKeybinding(e);
    if (!id) return;
    // Çizim aracı tuşları (L, R, C) sadece eskiz modunda anlamlı.
    if (!this.sketcher.isActive && id.startsWith("sketch.tool.")) return;
    // Eskiz modunda sadece eskiz, görünüm, geri al ve kaydet kısayolları çalışır (Delete eskizi silmesin).
    if (this.sketcher.isActive && !/^(sketch\.|view\.|edit\.(undo|redo)$|file\.save)/.test(id)) return;
    // Yazı yazılırken sadece Ctrl'li genel komutlar çalışır (Ctrl+Z/A gibi metin kısayolları hariç).
    if (isTextInput(document.activeElement)) {
      const textShortcuts = new Set(["edit.undo", "edit.redo", "edit.selectAll", "edit.delete", "edit.duplicate"]);
      if (!(e.ctrlKey || e.metaKey) || textShortcuts.has(id)) return;
    }
    e.preventDefault();
    void this.app.commands.run(id);
  }
}
