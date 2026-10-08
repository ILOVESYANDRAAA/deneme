import type { InputField } from "../../packages/api/sugarcad";
import type { MessageKind, SugarApp, UiBridge } from "../app/controller";
import { BOOLEAN_LABELS, type BodyFeatureType } from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import { CONSTRAINT_LABELS, type GeometricConstraintType } from "../core/sketchmodel";
import type { BooleanOp } from "../core/solid";
import { Notifications, showInputDialog } from "./dialogs";
import { compact, h, icon, isTextInput } from "./dom";
import { ExtensionsPanel } from "./extensions";
import { ICONS, iconForType } from "./icons";
import { MeasureTool, SectionTool } from "./inspect";
import { closeMenus, isMenuOpen, openMenu, type MenuItem } from "./menu";
import { CommandPalette } from "./palette";
import { PanelHost } from "./panels";
import { PropertiesPanel } from "./properties";
import { Ribbon, type RibbonButton, type RibbonGroup } from "./ribbon";
import { SketchHud } from "./sketchhud";
import { SketchNotes } from "./sketchnotes";
import { SketchPalette } from "./sketchpalette";
import { Sketcher, TOOLS, type SketchTool } from "./sketcher";
import { Timeline } from "./timeline";
import { FeatureTree } from "./tree";
import { UpdateChecker } from "./updates";
import { ViewCube } from "./viewcube";
import { STYLE_LABELS, VIEW_LABELS, Viewport, type Theme, type ViewName, type VisualStyle } from "./viewport";

const THEME_KEY = "sugarcad.theme";

function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

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

const SKETCH_TOOL_ICONS: Record<SketchTool, string> = {
  line: ICONS.line,
  rect: ICONS.rect,
  rectCenter: ICONS.rectCenter,
  rect3: ICONS.rect3,
  circle: ICONS.circle,
  circle2: ICONS.circle2,
  circle3: ICONS.circle3,
  arc3: ICONS.arc3,
  arcCenter: ICONS.arcCenter,
  polygon: ICONS.polygon,
  slot: ICONS.slot,
  ellipse: ICONS.ellipse,
  spline: ICONS.spline,
  point: ICONS.point,
  fillet: ICONS.fillet,
  trim: ICONS.trim,
  extend: ICONS.extend,
  offset: ICONS.offset,
  dimension: ICONS.dimension,
};

const CONSTRAINT_ICONS: Record<GeometricConstraintType, string> = {
  coincident: ICONS.cCoincident,
  horizontal: ICONS.cHorizontal,
  vertical: ICONS.cVertical,
  parallel: ICONS.cParallel,
  perpendicular: ICONS.cPerpendicular,
  tangent: ICONS.cTangent,
  equal: ICONS.cEqual,
  fix: ICONS.cFix,
  midpoint: ICONS.cMidpoint,
  concentric: ICONS.cConcentric,
  onCurve: ICONS.cOnCurve,
  symmetric: ICONS.cSymmetric,
};

const CONSTRAINT_TYPES = Object.keys(CONSTRAINT_ICONS) as GeometricConstraintType[];

const BODY_FEATURE_ICONS: Record<BodyFeatureType, string> = {
  mirror: ICONS.mirror,
  linearPattern: ICONS.linearPattern,
  circularPattern: ICONS.circularPattern,
  scale: ICONS.scale,
};

/**
 * Fusion 360 düzeni: üstte uygulama çubuğu ve araç şeridi, ortada tam ekran 3D görünüm;
 * Tarayıcı, Özellikler ve Eskiz Paleti görünümün üstünde taşınabilir paneller. Sağ üstte
 * ViewCube, altta gezinme çubuğu ve zaman çizelgesi.
 */
export class Workbench {
  readonly viewport: Viewport;
  readonly sketcher: Sketcher;
  readonly panels: PanelHost;
  readonly measure: MeasureTool;
  readonly section: SectionTool;
  private palette: CommandPalette;
  private hud: SketchHud;
  readonly notes: SketchNotes;
  private ribbon = new Ribbon();
  private appbar = h("header", { class: "appbar" });
  private navbar = h("nav", { class: "navbar", attrs: { "aria-label": "Gezinme" } });
  private status = h("footer", { class: "statusbar" });
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
    this.hud = new SketchHud(this.sketcher, this.viewport);
    this.notes = new SketchNotes(this.sketcher, this.viewport, app);
    this.measure = new MeasureTool(this.viewport, () => this.renderAll());
    this.section = new SectionTool(this.viewport, () => this.renderAll());

    this.panels = new PanelHost();
    this.panels.add({
      id: "browser",
      title: "Tarayıcı",
      content: new FeatureTree(app, this.sketcher).element,
      defaults: { dock: "left", width: 250 },
    });
    this.panels.add({
      id: "extensions",
      title: "Eklentiler",
      content: new ExtensionsPanel(app).element,
      defaults: { dock: "left", width: 300, visible: false },
    });
    this.panels.add({
      id: "properties",
      title: "Özellikler",
      content: new PropertiesPanel(app, this.sketcher).element,
      defaults: { dock: "right", width: 290 },
    });
    this.panels.add({
      id: "sketchPalette",
      title: "Eskiz Paleti",
      content: new SketchPalette(this.sketcher).element,
      defaults: { dock: "right", width: 270 },
    });
    this.panels.setContext("sketchPalette", false);

    const stage = h(
      "main",
      { class: "stage" },
      this.viewport.element,
      this.panels.element,
      new ViewCube(this.viewport).element,
      this.navbar,
    );
    root.replaceChildren(
      h(
        "div",
        { class: "workbench" },
        this.appbar,
        this.ribbon.element,
        stage,
        new Timeline(app, this.sketcher).element,
        this.status,
      ),
    );

    this.setTheme(savedTheme());
    this.registerViewCommands();
    this.registerSketchCommands();
    this.registerInspectCommands();
    this.renderAll();

    app.commands.onDidChange.on(() => this.renderRibbon());
    app.document.onDidChange.on(() => {
      this.renderRibbon();
      this.renderAppbar();
      this.renderStatus();
    });
    app.document.onDidChangeSelection.on(() => this.renderRibbon());
    let lastSketch = this.sketcher.activeId;
    let lastTool = this.sketcher.tool;
    this.sketcher.onDidChange.on(() => {
      // İmleç hareketlerinde şerit yeniden kurulmasın; sadece mod ya da araç değişince.
      if (this.sketcher.activeId !== lastSketch || this.sketcher.tool !== lastTool) {
        if (this.sketcher.activeId && !lastSketch) this.measure.close();
        lastSketch = this.sketcher.activeId;
        lastTool = this.sketcher.tool;
        this.panels.setContext("sketchPalette", this.sketcher.isActive);
        this.renderRibbon();
      }
      this.renderStatus();
    });
    this.panels.onDidChange.on(() => this.renderAppbar());
    this.viewport.onDidChangeDisplay.on(() => this.renderNavbar());
    app.onDidChangeMeshes.on((e) => {
      this.lastComputeMs = e.ms;
      this.renderStatus();
    });
    app.onDidChangeTitle.on((t) => {
      app.platform.setTitle(t);
      this.renderAppbar();
    });
    void app.platform.appVersion().then((v) => {
      this.version = v;
      this.renderStatus();
    });
    app.platform.setTitle(app.title());

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  setTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
    this.viewport.setTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // depolama kapalıysa tema sadece bu oturumda geçerli
    }
  }

  private renderAll(): void {
    this.renderAppbar();
    this.renderRibbon();
    this.renderNavbar();
    this.renderStatus();
  }

  // ---- komutlar ----

  private registerViewCommands(): void {
    const c = this.app.commands;
    c.register({ id: "view.palette", title: "Komut Paleti", category: "Görünüm", keybinding: "Ctrl+Shift+P" }, () =>
      this.palette.open(),
    );
    c.register({ id: "view.fit", title: "Görünüme Sığdır", category: "Görünüm", keybinding: "F" }, () => this.viewport.fit());
    const keys: Partial<Record<ViewName, string>> = { iso: "0", top: "7", front: "1", right: "3" };
    for (const name of Object.keys(VIEW_LABELS) as ViewName[]) {
      c.register({ id: `view.${name}`, title: `${VIEW_LABELS[name]} Görünüm`, category: "Görünüm", keybinding: keys[name] }, () =>
        this.viewport.setView(name),
      );
    }
    for (const style of Object.keys(STYLE_LABELS) as VisualStyle[]) {
      c.register({ id: `view.style.${style}`, title: `Görsel Stil: ${STYLE_LABELS[style]}`, category: "Görünüm" }, () =>
        this.viewport.setVisualStyle(style),
      );
    }
    c.register({ id: "view.grid", title: "Izgarayı Göster / Gizle", category: "Görünüm", keybinding: "G" }, () =>
      this.viewport.setGridVisible(!this.viewport.isGridVisible),
    );
    c.register({ id: "view.tree", title: "Tarayıcıyı Göster / Gizle", category: "Görünüm", keybinding: "Ctrl+Shift+E" }, () =>
      this.panels.toggle("browser"),
    );
    c.register({ id: "view.properties", title: "Özellikleri Göster / Gizle", category: "Görünüm" }, () =>
      this.panels.toggle("properties"),
    );
    c.register({ id: "view.extensions", title: "Eklentileri Göster / Gizle", category: "Görünüm", keybinding: "Ctrl+Shift+X" }, () =>
      this.panels.toggle("extensions"),
    );
    c.register({ id: "view.resetLayout", title: "Panel Düzenini Sıfırla", category: "Görünüm" }, () => this.panels.reset());
    c.register({ id: "view.theme", title: "Açık / Koyu Tema", category: "Görünüm" }, () =>
      this.setTheme(this.viewport.currentTheme === "dark" ? "light" : "dark"),
    );
    c.register({ id: "help.checkUpdates", title: "Güncellemeleri Denetle", category: "Yardım" }, () => {
      if (this.app.platform.name !== "tauri") throw new Error("Güncelleme denetimi masaüstü uygulamasında çalışır");
      return this.updates.check(true);
    });
  }

  private registerSketchCommands(): void {
    const c = this.app.commands;
    const sk = this.sketcher;
    c.register({ id: "sketch.new", title: "Yeni Eskiz…", category: "Eskiz", keybinding: "S" }, () => {
      this.measure.close();
      return sk.startNew();
    });
    for (const plane of Object.keys(PLANES) as PlaneName[]) {
      c.register({ id: `sketch.new.${plane}`, title: `Yeni Eskiz: ${PLANES[plane].label}`, category: "Eskiz" }, () =>
        sk.startNew(plane),
      );
    }
    c.register({ id: "sketch.newOffset", title: "Ofset Düzlemde Eskiz…", category: "Eskiz" }, async () => {
      const plane = await this.viewport.pickPlane();
      if (!plane) return;
      const values = await this.app.showInput({
        title: `Ofset düzlem: ${PLANES[plane].label}`,
        fields: [{ name: "offset", label: "Ofset (mm)", type: "number", value: 10, step: 1 }],
      });
      if (!values) return;
      await sk.startNew(plane, Number(values.offset));
    });
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
    for (const tool of Object.keys(TOOLS) as SketchTool[]) {
      c.register({ id: `sketch.tool.${tool}`, title: TOOLS[tool].label, category: "Eskiz", keybinding: TOOLS[tool].key }, () =>
        sk.setTool(tool),
      );
    }
    c.register({ id: "sketch.select", title: "Seç", category: "Eskiz" }, () => sk.setTool(null));
    for (const type of CONSTRAINT_TYPES) {
      c.register({ id: `sketch.constraint.${type}`, title: `Kısıt: ${CONSTRAINT_LABELS[type]}`, category: "Eskiz" }, () =>
        sk.applyConstraint(type),
      );
    }
    c.register({ id: "sketch.construction", title: "Yapı Çizgisi", category: "Eskiz", keybinding: "X" }, () =>
      sk.toggleConstruction(),
    );
    c.register({ id: "sketch.mirrorV", title: "Dikey Eksende Aynala", category: "Eskiz" }, () => sk.mirrorSelected("V"));
    c.register({ id: "sketch.mirrorU", title: "Yatay Eksende Aynala", category: "Eskiz" }, () => sk.mirrorSelected("U"));
    const ask = async (title: string, fields: InputField[]) => {
      if (!sk.selected.size) throw new Error("Önce eskizde öğe seçin (araç yokken tıklayın, Ctrl ile çoklu seçim)");
      return this.app.showInput({ title, fields });
    };
    const num = (name: string, label: string, value: number, extra: Partial<InputField> = {}): InputField => ({
      name,
      label,
      type: "number",
      value,
      step: 1,
      ...extra,
    });
    for (const copy of [false, true]) {
      c.register({ id: copy ? "sketch.copy" : "sketch.move", title: copy ? "Kopyala (Ötele)" : "Taşı", category: "Eskiz" }, async () => {
        const v = await ask(copy ? "Kopyala" : "Taşı", [num("dx", "X kaydırma (mm)", 10), num("dy", "Y kaydırma (mm)", 0)]);
        if (v) sk.moveSelected(Number(v.dx), Number(v.dy), copy);
      });
    }
    c.register({ id: "sketch.rotate", title: "Döndür", category: "Eskiz" }, async () => {
      const v = await ask("Döndür", [
        num("angle", "Açı (°, saat yönünün tersine)", 90, { min: -360, max: 360 }),
        num("cx", "Merkez X (mm)", 0),
        num("cy", "Merkez Y (mm)", 0),
        num("copy", "Kopya bırak (1: evet, 0: hayır)", 0, { min: 0, max: 1 }),
      ]);
      if (v) sk.rotateSelected(Number(v.cx), Number(v.cy), Number(v.angle), Number(v.copy) === 1);
    });
    c.register({ id: "sketch.patternRect", title: "Dikdörtgensel Desen", category: "Eskiz" }, async () => {
      const v = await ask("Dikdörtgensel Desen", [
        num("nx", "X yönünde adet", 3, { min: 1, max: 100 }),
        num("ny", "Y yönünde adet", 2, { min: 1, max: 100 }),
        num("dx", "X aralığı (mm)", 10),
        num("dy", "Y aralığı (mm)", 10),
      ]);
      if (v) sk.patternRectSelected(Math.round(Number(v.nx)), Math.round(Number(v.ny)), Number(v.dx), Number(v.dy));
    });
    c.register({ id: "sketch.patternCircular", title: "Dairesel Desen", category: "Eskiz" }, async () => {
      const v = await ask("Dairesel Desen", [
        num("count", "Adet (orijinal dahil)", 6, { min: 2, max: 200 }),
        num("angle", "Toplam açı (°)", 360, { min: 1, max: 360 }),
        num("cx", "Merkez X (mm)", 0),
        num("cy", "Merkez Y (mm)", 0),
      ]);
      if (v) sk.patternCircularSelected(Math.round(Number(v.count)), Number(v.angle), Number(v.cx), Number(v.cy));
    });
    c.register({ id: "sketch.deleteSelection", title: "Seçili Öğeleri Sil", category: "Eskiz" }, () => sk.deleteSelected());
  }

  private registerInspectCommands(): void {
    const c = this.app.commands;
    c.register({ id: "inspect.measure", title: "Ölç", category: "İncele", keybinding: "I" }, () => {
      if (this.sketcher.isActive) throw new Error("Ölçmek için önce eskizi bitirin");
      this.measure.open();
      this.renderRibbon();
    });
    c.register({ id: "inspect.section", title: "Kesit Analizi", category: "İncele" }, () => {
      this.section.toggle();
      this.renderAll();
    });
  }

  // ---- uygulama çubuğu ----

  private renderAppbar(): void {
    const app = this.app;
    const btn = (label: string, svg: string, command: string, opts: { disabled?: boolean; pressed?: boolean } = {}) => {
      const info = app.commands.get(command);
      const b = h(
        "button",
        {
          class: "abtn",
          disabled: opts.disabled ?? false,
          title: info?.keybinding ? `${label} (${info.keybinding})` : label,
          attrs: { "aria-label": label },
          onclick: () => app.commands.run(command),
        },
        icon(svg),
      );
      if (opts.pressed !== undefined) b.setAttribute("aria-pressed", String(opts.pressed));
      return b;
    };
    const fileMenu = h(
      "button",
      { class: "abtn file", attrs: { "aria-haspopup": "menu", "aria-label": "Dosya menüsü" }, onclick: () => openMenu(fileMenu, this.fileMenu()) },
      icon(ICONS.menu),
      h("span", {}, "Dosya"),
      icon(ICONS.chevronDown),
    );
    const sep = () => h("span", { class: "asep" });
    this.appbar.replaceChildren(
      h("span", { class: "brand" }, h("img", { src: "/icon.svg", alt: "" }), "sugarCAD"),
      fileMenu,
      sep(),
      btn("Yeni", ICONS.newFile, "file.new"),
      btn("Aç", ICONS.open, "file.open"),
      btn("Kaydet", ICONS.save, "file.save"),
      sep(),
      btn("Geri Al", ICONS.undo, "edit.undo", { disabled: !app.document.canUndo }),
      btn("Yinele", ICONS.redo, "edit.redo", { disabled: !app.document.canRedo }),
      h("span", { class: "doc-title" }, app.title().replace(/ — sugarCAD$/, "")),
      btn("Tarayıcı", ICONS.tree, "view.tree", { pressed: this.panels.isVisible("browser") }),
      btn("Özellikler", ICONS.properties, "view.properties", { pressed: this.panels.isVisible("properties") }),
      btn("Eklentiler", ICONS.extensions, "view.extensions", { pressed: this.panels.isVisible("extensions") }),
      sep(),
      btn("Komut Paleti", ICONS.palette, "view.palette"),
    );
  }

  private item(command: string, svg?: string, extra: Partial<MenuItem> = {}): MenuItem {
    const info = this.app.commands.get(command);
    return {
      label: info?.title ?? command,
      icon: svg,
      keybinding: info?.keybinding,
      run: () => void this.app.commands.run(command),
      disabled: !info,
      ...extra,
    };
  }

  private fileMenu(): MenuItem[] {
    return [
      this.item("file.new", ICONS.newFile),
      this.item("file.open", ICONS.open),
      this.item("file.save", ICONS.save),
      this.item("file.saveAs"),
      { separator: true, label: "" },
      this.item("file.exportStl", ICONS.export),
      { separator: true, label: "" },
      this.item("view.theme", undefined, { checked: this.viewport.currentTheme === "dark", label: "Koyu tema" }),
      this.item("view.resetLayout"),
      this.item("help.checkUpdates"),
    ];
  }

  // ---- şerit ----

  private button(command: string, svg: string, extra: Partial<RibbonButton> = {}): RibbonButton {
    const info = this.app.commands.get(command);
    const label = extra.label ?? info?.title ?? command;
    return {
      label,
      icon: svg,
      command,
      title: info?.keybinding ? `${label} (${info.keybinding})` : label,
      run: () => void this.app.commands.run(command),
      ...extra,
    };
  }

  private renderRibbon(): void {
    if (this.sketcher.isActive) {
      this.ribbon.render([{ label: "KATI", active: false, run: () => this.sketcher.finish() }, { label: "ESKİZ", active: true }], this.sketchGroups());
      return;
    }
    this.ribbon.render([{ label: "KATI", active: true }], this.solidGroups());
  }

  private solidGroups(): RibbonGroup[] {
    const app = this.app;
    const sel = app.document.getSelection();
    const oneBody = sel.length === 1 && app.document.get(sel[0])?.type !== "sketch";
    const ops = Object.keys(BOOLEAN_LABELS) as BooleanOp[];
    const bodyItem = (type: BodyFeatureType) => this.item(`feature.${type}`, BODY_FEATURE_ICONS[type], { disabled: !oneBody });
    const plugins = app.primitives
      .list()
      .filter((p) => app.commands.has(`shape.add.${p.type}`))
      .map((p) => this.item(`shape.add.${p.type}`, iconForType(p.type)));
    return [
      {
        id: "create",
        label: "OLUŞTUR",
        buttons: [
          this.button("sketch.new", ICONS.sketch, { label: "Eskiz", title: "Eskiz Oluştur (S)" }),
          this.button("feature.extrude", ICONS.extrude, { title: "Ekstrüzyon (E) — eskizi 3D'ye çeker" }),
          this.button("feature.revolve", ICONS.revolve, { title: "Döndürme (Shift+R) — eskizi eksen etrafında döndürür" }),
          this.button("feature.linearPattern", ICONS.linearPattern, { disabled: !oneBody, title: "Dikdörtgensel Desen — seçili gövdeyi çoğaltır" }),
          this.button("feature.mirror", ICONS.mirror, { disabled: !oneBody, title: "Ayna — seçili gövdeyi aynalar" }),
        ],
        menu: [
          this.item("sketch.new", ICONS.sketch, { label: "Eskiz Oluştur" }),
          this.item("sketch.newOffset", ICONS.sketchOffset),
          { separator: true, label: "" },
          this.item("feature.extrude", ICONS.extrude),
          this.item("feature.revolve", ICONS.revolve),
          { separator: true, label: "" },
          { label: "Desen", icon: ICONS.linearPattern, submenu: [bodyItem("linearPattern"), bodyItem("circularPattern")] },
          bodyItem("mirror"),
          ...(plugins.length ? [{ separator: true, label: "" }, { label: "Eklenti şekilleri", icon: ICONS.plugin, submenu: plugins }] : []),
        ],
      },
      {
        id: "modify",
        label: "DEĞİŞTİR",
        buttons: [
          ...ops.map((op) =>
            this.button(`boolean.${op}`, ICONS[op], { disabled: sel.length !== 2, title: `${BOOLEAN_LABELS[op]} — Ctrl ile iki gövde seçin` }),
          ),
          this.button("feature.scale", ICONS.scale, { disabled: !oneBody, title: "Ölçek — seçili gövdeyi büyütür / küçültür" }),
        ],
        menu: [
          { label: "Birleştir", icon: ICONS.union, submenu: ops.map((op) => this.item(`boolean.${op}`, ICONS[op], { disabled: sel.length !== 2 })) },
          bodyItem("scale"),
          { separator: true, label: "" },
          this.item("edit.toggleVisibility", ICONS.eye, { disabled: !sel.length }),
          this.item("edit.duplicate", undefined, { disabled: !sel.length }),
          this.item("edit.delete", ICONS.trash, { disabled: !sel.length }),
        ],
      },
      {
        id: "construct",
        label: "YAPI",
        buttons: [this.button("sketch.newOffset", ICONS.sketchOffset, { label: "Ofset Düzlem", title: "Ofset Düzlemde Eskiz — düzlemi kaydırarak eskiz açar" })],
        menu: [
          this.item("sketch.newOffset", ICONS.sketchOffset),
          { separator: true, label: "" },
          ...(Object.keys(PLANES) as PlaneName[]).map((p) => this.item(`sketch.new.${p}`, ICONS.plane)),
        ],
      },
      {
        id: "inspect",
        label: "İNCELE",
        buttons: [
          this.button("inspect.measure", ICONS.measure, { pressed: this.measure.isActive, title: "Ölç (I) — iki nokta arası mesafe" }),
          this.button("inspect.section", ICONS.section, { pressed: this.section.isActive, title: "Kesit Analizi — modeli bir düzlemle keser" }),
        ],
        menu: [this.item("inspect.measure", ICONS.measure), this.item("inspect.section", ICONS.section, { checked: this.section.isActive })],
      },
    ];
  }

  private sketchGroups(): RibbonGroup[] {
    const sk = this.sketcher;
    const tool = (t: SketchTool) => this.button(`sketch.tool.${t}`, SKETCH_TOOL_ICONS[t], { pressed: sk.tool === t });
    const toolItem = (t: SketchTool, label?: string) =>
      this.item(`sketch.tool.${t}`, SKETCH_TOOL_ICONS[t], { checked: undefined, ...(label ? { label } : {}) });
    const hasSel = sk.selected.size > 0;
    const constraint = (t: GeometricConstraintType) =>
      this.button(`sketch.constraint.${t}`, CONSTRAINT_ICONS[t], { title: `${CONSTRAINT_LABELS[t]} — önce öğeleri seçin, sonra tıklayın` });
    return [
      {
        id: "sketch-create",
        label: "OLUŞTUR",
        buttons: (["line", "rect", "circle", "arc3", "polygon", "slot", "spline"] as SketchTool[]).map(tool),
        menu: [
          toolItem("line"),
          {
            label: "Dikdörtgen",
            icon: ICONS.rect,
            submenu: [toolItem("rect", "2 Noktalı Dikdörtgen"), toolItem("rect3"), toolItem("rectCenter")],
          },
          {
            label: "Daire",
            icon: ICONS.circle,
            submenu: [toolItem("circle", "Merkez-Çap Daire"), toolItem("circle2"), toolItem("circle3")],
          },
          { label: "Yay", icon: ICONS.arc3, submenu: [toolItem("arc3"), toolItem("arcCenter")] },
          toolItem("polygon"),
          toolItem("slot"),
          toolItem("ellipse"),
          toolItem("spline"),
          toolItem("point"),
          { separator: true, label: "" },
          this.item("sketch.mirrorV", ICONS.sketchMirror, { disabled: !hasSel }),
          this.item("sketch.mirrorU", ICONS.sketchMirror, { disabled: !hasSel }),
        ],
      },
      {
        id: "sketch-modify",
        label: "DEĞİŞTİR",
        buttons: [
          this.button("sketch.select", ICONS.select, { pressed: sk.tool === null, title: "Seç (Esc) — öğelere tıklayarak seçin" }),
          tool("fillet"),
          tool("trim"),
          tool("extend"),
          tool("offset"),
          this.button("sketch.move", ICONS.sketchMove, { disabled: !hasSel, title: "Taşı / Kopyala — seçili öğeleri" }),
          this.button("sketch.rotate", ICONS.sketchRotate, { disabled: !hasSel, title: "Döndür / Kopyala — seçili öğeleri" }),
          this.button("sketch.construction", ICONS.construction, {
            pressed: sk.options.construction,
            title: "Yapı Çizgisi (X) — seçili öğeleri ya da yeni çizimleri yardımcı çizgi yapar",
          }),
          this.button("sketch.mirrorV", ICONS.sketchMirror, { disabled: !hasSel, title: "Dikey Eksende Aynala — seçili öğeleri" }),
          this.button("sketch.deleteSelection", ICONS.trash, { disabled: !hasSel, label: "Sil", title: "Seçili öğeleri sil (Delete)" }),
        ],
        menu: [
          this.item("sketch.select", ICONS.select, { keybinding: "Esc" }),
          toolItem("fillet"),
          toolItem("trim"),
          toolItem("extend"),
          toolItem("offset"),
          { separator: true, label: "" },
          this.item("sketch.move", ICONS.sketchMove, { disabled: !hasSel }),
          this.item("sketch.copy", ICONS.sketchMove, { disabled: !hasSel }),
          this.item("sketch.rotate", ICONS.sketchRotate, { disabled: !hasSel }),
          this.item("sketch.patternRect", ICONS.sketchPatternRect, { disabled: !hasSel }),
          this.item("sketch.patternCircular", ICONS.sketchPatternCircular, { disabled: !hasSel }),
          { separator: true, label: "" },
          this.item("sketch.construction", ICONS.construction),
          this.item("sketch.mirrorV", ICONS.sketchMirror, { disabled: !hasSel }),
          this.item("sketch.mirrorU", ICONS.sketchMirror, { disabled: !hasSel }),
          { separator: true, label: "" },
          this.item("sketch.deleteSelection", ICONS.trash, { disabled: !hasSel, keybinding: "Delete" }),
        ],
      },
      {
        id: "sketch-constraints",
        label: "KISITLAR",
        buttons: [
          tool("dimension"),
          ...(["coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "equal", "fix"] as GeometricConstraintType[]).map(constraint),
        ],
        menu: [
          toolItem("dimension"),
          { separator: true, label: "" },
          ...CONSTRAINT_TYPES.map((t) =>
            this.item(`sketch.constraint.${t}`, CONSTRAINT_ICONS[t], { label: CONSTRAINT_LABELS[t] }),
          ),
        ],
      },
      {
        id: "sketch-finish",
        label: "BİTİR",
        primary: true,
        buttons: [this.button("sketch.finish", ICONS.check, { label: "Eskizi Bitir" })],
        menu: [],
      },
    ];
  }

  // ---- gezinme çubuğu ----

  private renderNavbar(): void {
    const vp = this.viewport;
    const btn = (label: string, svg: string, run: (b: HTMLButtonElement) => void, pressed?: boolean) => {
      const b = h("button", { class: "nbtn", title: label, attrs: { "aria-label": label } }, icon(svg));
      b.addEventListener("click", () => run(b));
      if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
      return b;
    };
    const styleIcons: Record<VisualStyle, string> = { shaded: ICONS.styleShaded, shadedEdges: ICONS.styleEdges, wireframe: ICONS.styleWire };
    const sep = () => h("span", { class: "nsep" });
    this.navbar.replaceChildren(
      btn("Ana görünüm", ICONS.home, () => vp.setView("iso")),
      btn("Görünüme sığdır (F)", ICONS.fit, () => vp.fit()),
      sep(),
      btn(`Görsel stil: ${STYLE_LABELS[vp.visualStyle]}`, styleIcons[vp.visualStyle], (b) =>
        openMenu(
          b,
          (Object.keys(STYLE_LABELS) as VisualStyle[]).map((s) => ({
            label: STYLE_LABELS[s],
            checked: vp.visualStyle === s,
            run: () => vp.setVisualStyle(s),
          })),
          { above: true },
        ),
      ),
      btn("Izgara (G)", ICONS.grid, () => vp.setGridVisible(!vp.isGridVisible), vp.isGridVisible),
      sep(),
      btn("Ölç (I)", ICONS.measure, () => void this.app.commands.run("inspect.measure"), this.measure.isActive),
      btn("Kesit Analizi", ICONS.section, () => void this.app.commands.run("inspect.section"), this.section.isActive),
    );
  }

  // ---- durum çubuğu ----

  /** Eskizin kısıt durumu: tam tanımlı, kalan serbestlik derecesi ya da çelişki. */
  private dofChip(): HTMLElement | null {
    const sk = this.sketcher;
    const info = sk.solveInfo;
    if (!info.solved || !sk.data().curves.some((c) => c.kind !== "point")) return null;
    if (info.conflicting.length) {
      return h("span", { class: "dof conflict", title: "Birbiriyle çelişen kısıtlar kırmızı gösterilir; birini silin" }, "Çelişen kısıt");
    }
    if (info.dof === 0) return h("span", { class: "dof full", title: "Her şey ölçü ve kısıtlarla belirli" }, "Tam tanımlı");
    return h("span", { class: "dof", title: "Henüz ölçü / kısıt verilmemiş hareket serbestliği" }, `${info.dof} serbestlik`);
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
          this.dofChip(),
          c ? h("span", { class: "coords" }, `u ${c[0].toFixed(2)}  v ${c[1].toFixed(2)}${sk.snapKind ? ` · ${sk.snapKind}` : ""}`) : null,
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

  // ---- klavye ----

  private onKeyDown(e: KeyboardEvent): void {
    if (this.palette.isOpen || document.querySelector(".dialog") || isMenuOpen()) return;
    if (e.key === "F1") {
      e.preventDefault();
      this.palette.open();
      return;
    }
    const typing = isTextInput(document.activeElement);
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (!typing && e.key === "Escape") {
      if (this.viewport.isPickingPlane) return this.viewport.cancelPlanePick();
      if (this.measure.isActive) return this.measure.close();
      if (this.section.isActive && !this.sketcher.isActive) {
        this.section.close();
        return;
      }
    }
    if (!typing && this.sketcher.isActive && !mod) {
      const keys: Record<string, () => void> = {
        Escape: () => this.sketcher.escape(),
        Enter: () => this.sketcher.enter(),
        Backspace: () => this.sketcher.backspace(),
        Delete: () => this.sketcher.deleteSelected(),
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
        return;
      }
      // Çizerken rakam yazmak ölçü kutucuğunu açar (görünüm kısayolları 0/1/3/7 yerine).
      if (/^[0-9.,-]$/.test(e.key) && this.sketcher.isDrawing && this.hud.beginTyping(e.key)) {
        e.preventDefault();
        return;
      }
    }
    if (!typing && this.sketcher.isActive && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.sketcher.selectAll();
      return;
    }
    const id = this.app.commands.findByKeybinding(e);
    if (!id) return;
    // Çizim aracı tuşları sadece eskiz modunda anlamlı.
    if (!this.sketcher.isActive && /^sketch\.(tool\.|construction)/.test(id)) return;
    // Eskiz modunda sadece eskiz, görünüm, geri al ve kaydet kısayolları çalışır (Delete eskizi silmesin).
    if (this.sketcher.isActive && !/^(sketch\.|view\.|edit\.(undo|redo)$|file\.save)/.test(id)) return;
    // Yazı yazılırken sadece Ctrl'li genel komutlar çalışır (Ctrl+Z/A gibi metin kısayolları hariç).
    if (isTextInput(document.activeElement)) {
      const textShortcuts = new Set(["edit.undo", "edit.redo", "edit.selectAll", "edit.delete", "edit.duplicate"]);
      if (!(e.ctrlKey || e.metaKey) || textShortcuts.has(id)) return;
    }
    e.preventDefault();
    closeMenus();
    void this.app.commands.run(id);
  }
}
