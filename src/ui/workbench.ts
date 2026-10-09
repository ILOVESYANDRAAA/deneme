import type { InputField } from "../../packages/api/sugarcad";
import type { MessageKind, SugarApp, UiBridge } from "../app/controller";
import { BOOLEAN_LABELS, BREP_LABELS, BREP_FEATURES, type BodyFeatureType, type BrepFeatureType } from "../core/features";
import { PLANES, angledFrame, type PlaneName } from "../core/sketch";
import { CONSTRAINT_LABELS, type GeometricConstraintType } from "../core/sketchmodel";
import type { BooleanOp } from "../core/solid";
import { BrepTool } from "./brep";
import { FaceSketchTool } from "./facesketch";
import { ExtrudeTool } from "./extrudetool";
import { RevolveTool } from "./revolvetool";
import { HoleTool } from "./holetool";
import { Notifications, showInputDialog } from "./dialogs";
import { ParametersPanel } from "./parameters";
import { MassPropertiesTool } from "./massdialog";
import { ThreePointPlaneTool } from "./pointsplane";
import { compact, h, icon, isTextInput } from "./dom";
import { ExtensionsPanel } from "./extensions";
import { ICONS, iconForType } from "./icons";
import { MeasureTool, SectionTool } from "./inspect";
import { MarkingMenu } from "./markingmenu";
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
/** Uzun komut adlarının şerit düğmesi altındaki kısa karşılıkları (erişilebilir ad tam kalır). */
const SHORT_LABELS: Record<string, string> = {
  "Dikdörtgensel Desen": "Desen",
  "Köşe Yuvarlatma": "Yuvarlat",
  "Taşı / Kopyala": "Taşı",
  "Gövdeyi Böl": "Böl",
  "Kütle Özellikleri": "Kütle",
  "Kesit Analizi": "Kesit",
  "Eskizi Bitir": "Bitir",
};

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
  move: ICONS.move,
  split: ICONS.split,
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
  readonly brep: BrepTool;
  readonly hole: HoleTool;
  readonly extrude: ExtrudeTool;
  readonly revolve: RevolveTool;
  readonly faceSketch: FaceSketchTool;
  readonly planePoints: ThreePointPlaneTool;
  readonly mass: MassPropertiesTool;
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
    this.brep = new BrepTool(app, this.viewport, () => this.renderAll());
    this.hole = new HoleTool(app, this.viewport, () => this.renderAll());
    this.extrude = new ExtrudeTool(app, this.viewport.element, () => this.renderAll());
    this.revolve = new RevolveTool(app, this.viewport.element, () => this.renderAll());
    app.commitFeatureDialog = () => {
      this.extrude.finish();
      this.revolve.finish();
    };
    app.openExtrudeDialog = () => {
      if (this.sketcher.isActive) this.sketcher.finish();
      this.measure.close();
      this.brep.close();
      this.hole.close();
      this.faceSketch.close();
      this.planePoints.close();
      this.revolve.finish();
      this.extrude.open();
    };
    app.openRevolveDialog = () => {
      if (this.sketcher.isActive) this.sketcher.finish();
      this.measure.close();
      this.brep.close();
      this.hole.close();
      this.faceSketch.close();
      this.planePoints.close();
      this.extrude.finish();
      this.revolve.open();
    };
    this.faceSketch = new FaceSketchTool(app, this.viewport, this.sketcher, () => this.renderAll());
    this.mass = new MassPropertiesTool(app, this.viewport, () => this.renderAll());
    this.planePoints = new ThreePointPlaneTool(app, this.viewport, this.sketcher, () => this.renderAll());

    this.panels = new PanelHost();
    this.panels.add({
      id: "browser",
      title: "Tarayıcı",
      content: new FeatureTree(app, this.sketcher, this.viewport).element,
      defaults: { dock: "left", width: 250 },
    });
    this.panels.add({
      id: "extensions",
      title: "Eklentiler",
      content: new ExtensionsPanel(app).element,
      defaults: { dock: "left", width: 300, visible: false },
    });
    this.panels.add({
      id: "parameters",
      title: "Parametreler",
      content: new ParametersPanel(app).element,
      defaults: { dock: "left", width: 320, visible: false },
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
      content: new SketchPalette(this.sketcher, () => this.lookAtSketchPlane()).element,
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
    this.registerBrepCommands();
    new MarkingMenu(app, this);
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
        if (this.sketcher.activeId && !lastSketch) {
          this.measure.close();
          this.brep.close();
          this.hole.close();
          this.extrude.close();
          this.revolve.close();
          this.faceSketch.close();
          this.planePoints.close();
        }
        lastSketch = this.sketcher.activeId;
        lastTool = this.sketcher.tool;
        this.panels.setContext("sketchPalette", this.sketcher.isActive);
        document.body.toggleAttribute("data-sketching", this.sketcher.isActive);
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
    c.register({ id: "view.parameters", title: "Parametreleri Göster / Gizle", category: "Görünüm" }, () =>
      this.panels.toggle("parameters"),
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

  private registerBrepCommands(): void {
    for (const type of BREP_FEATURES) {
      this.app.commands.register({ id: `feature.${type}`, title: BREP_LABELS[type], category: "Katı" }, async () => {
        if (this.sketcher.isActive) throw new Error(`${BREP_LABELS[type]} için önce eskizi bitirin`);
        this.measure.close();
        this.hole.close();
        this.extrude.close();
        this.revolve.close();
        await this.brep.open(type);
      });
    }
    const closeTools = () => {
      this.measure.close();
      this.brep.close();
      this.hole.close();
      this.extrude.close();
      this.revolve.close();
      this.faceSketch.close();
      this.planePoints.close();
    };
    this.app.commands.register({ id: "sketch.newAngled", title: "Açılı Düzlemde Eskiz", category: "Eskiz" }, async () => {
      if (this.sketcher.isActive) throw new Error("Önce mevcut eskizi bitirin");
      const planes = (Object.keys(PLANES) as PlaneName[]).map((p) => ({ value: p, label: PLANES[p].label }));
      const v = await this.app.showInput({
        title: "Açılı Düzlemde Eskiz",
        fields: [
          { name: "base", label: "Taban düzlem", options: planes, value: "XY" },
          { name: "axis", label: "Dönme ekseni (taban düzlemde)", options: [{ value: "U", label: "Yatay eksen (u)" }, { value: "V", label: "Dikey eksen (v)" }], value: "U" },
          { name: "angle", label: "Açı (°)", type: "number", value: 45, min: -180, max: 180, step: 5 },
          { name: "offset", label: "Ofset (mm, düzlem normali yönünde)", type: "number", value: 0, step: 1 },
        ],
      });
      if (!v) return;
      const sketch = this.app.createSketch(angledFrame(String(v.base) as PlaneName, v.axis === "V" ? "V" : "U", Number(v.angle)), Number(v.offset));
      this.sketcher.edit(sketch.id);
    });
    this.app.commands.register({ id: "sketch.importDxf", title: "DXF İçe Aktar (eskize)…", category: "Eskiz" }, async () => {
      const id = this.sketcher.activeId;
      if (!id) throw new Error("DXF içe aktarmak için önce bir eskiz açın");
      await this.app.importDxfFile(id);
    });
    this.app.commands.register({ id: "sketch.exportDxf", title: "DXF Dışa Aktar (eskiz)…", category: "Eskiz" }, async () => {
      const doc = this.app.document;
      const id = this.sketcher.activeId ?? doc.getSelection().find((i) => doc.get(i)?.type === "sketch");
      if (!id) throw new Error("DXF dışa aktarmak için bir eskiz açın ya da seçin");
      await this.app.exportDxfFile(id);
    });
    this.app.commands.register({ id: "sketch.new3pt", title: "3 Noktalı Düzlemde Eskiz", category: "Eskiz" }, () => {
      if (this.sketcher.isActive) throw new Error("Önce mevcut eskizi bitirin");
      closeTools();
      this.planePoints.open();
    });
    this.app.commands.register({ id: "sketch.onFace", title: "Yüzeye Eskiz", category: "Eskiz" }, () => {
      if (this.sketcher.isActive) throw new Error("Önce mevcut eskizi bitirin");
      this.measure.close();
      this.brep.close();
      this.hole.close();
      this.extrude.close();
      this.revolve.close();
      this.faceSketch.open();
    });
    this.app.commands.register({ id: "feature.hole", title: "Delik", category: "Katı", keybinding: "H" }, () => {
      if (this.sketcher.isActive) throw new Error("Delik için önce eskizi bitirin");
      this.measure.close();
      this.brep.close();
      this.faceSketch.close();
      this.extrude.close();
      this.revolve.close();
      this.hole.open();
    });
  }

  private registerInspectCommands(): void {
    const c = this.app.commands;
    c.register({ id: "inspect.measure", title: "Ölç", category: "İncele", keybinding: "I" }, () => {
      if (this.sketcher.isActive) throw new Error("Ölçmek için önce eskizi bitirin");
      this.brep.close();
      this.hole.close();
      this.extrude.close();
      this.revolve.close();
      this.mass.close();
      this.measure.open();
      this.renderRibbon();
    });
    c.register({ id: "inspect.mass", title: "Kütle Özellikleri", category: "İncele" }, () => {
      if (this.sketcher.isActive) throw new Error("Kütle özellikleri için önce eskizi bitirin");
      if (this.mass.isActive) this.mass.close();
      else {
        this.measure.close();
        this.mass.open();
      }
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
      btn("Parametreler", ICONS.parameters, "view.parameters", { pressed: this.panels.isVisible("parameters") }),
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
      this.item("file.importStep", ICONS.open),
      this.item("file.exportStep", ICONS.export),
      this.item("file.exportStl", ICONS.export),
      this.item("sketch.exportDxf", ICONS.export),
      this.item("sketch.importDxf", ICONS.open, { disabled: !this.sketcher.isActive }),
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
      short: SHORT_LABELS[label] ?? label.replace(/^Kısıt: /, ""),
      icon: svg,
      command,
      title: info?.keybinding ? `${label} (${info.keybinding})` : label,
      run: () => void this.app.commands.run(command),
      ...extra,
    };
  }

  /** Şerit solundaki çalışma alanı menüsü; şimdilik yalnızca Tasarım etkin, diğerleri ileride. */
  private workspaceMenu(): { label: string; menu: MenuItem[] } {
    return {
      label: "TASARIM",
      menu: [
        { label: "Tasarım", checked: true },
        { separator: true, label: "" },
        { label: "Yüzey", disabled: true },
        { label: "Sac Metal", disabled: true },
        { label: "Üretim", disabled: true },
        { label: "Çizim", disabled: true },
      ],
    };
  }

  private renderRibbon(): void {
    const workspace = this.workspaceMenu();
    if (this.sketcher.isActive) {
      this.ribbon.render([{ label: "KATI", active: false, run: () => this.sketcher.finish() }, { label: "ESKİZ", active: true }], this.sketchGroups(), workspace);
      return;
    }
    this.ribbon.render([{ label: "KATI", active: true }], this.solidGroups(), workspace);
  }

  private solidGroups(): RibbonGroup[] {
    const app = this.app;
    const sel = app.document.getSelection();
    const oneBody = sel.length === 1 && app.document.get(sel[0])?.type !== "sketch";
    const ops = Object.keys(BOOLEAN_LABELS) as BooleanOp[];
    const bodyItem = (type: BodyFeatureType) => this.item(`feature.${type}`, BODY_FEATURE_ICONS[type], { disabled: !oneBody });
    const shapes = app.primitives.list().filter((p) => app.commands.has(`shape.add.${p.type}`));
    const builtinShapes = shapes.filter((p) => !p.pluginId).map((p) => this.item(`shape.add.${p.type}`, iconForType(p.type)));
    const plugins = shapes.filter((p) => p.pluginId).map((p) => this.item(`shape.add.${p.type}`, iconForType(p.type)));
    return [
      {
        id: "create",
        label: "OLUŞTUR",
        buttons: [
          this.button("sketch.new", ICONS.sketch, { label: "Eskiz", title: "Eskiz Oluştur (S)" }),
          this.button("sketch.onFace", ICONS.sketchOnFace, { label: "Yüzeye Eskiz", pressed: this.faceSketch.isActive, title: "Yüzeye Eskiz — gövdenin düz bir yüzeyine tıklayarak o yüzeyde eskiz açar" }),
          this.button("feature.extrude", ICONS.extrude, { title: "Ekstrüzyon (E) — eskizi 3D'ye çeker" }),
          this.button("feature.revolve", ICONS.revolve, { title: "Döndürme (Shift+R) — eskizi eksen etrafında döndürür" }),
          this.button("feature.rib", ICONS.rib, { title: "Kaburga — açık bir yolu (çizgi / yay) kalınlaştırıp yükseltir; gövdeye birleştirilir" }),
          this.button("feature.loft", ICONS.loft, { disabled: sel.length < 2, title: "Loft — Ctrl ile iki ya da daha çok kapalı eskizi sırayla seçin; aralarında geçiş yapar" }),
          this.button("feature.sweep", ICONS.sweep, { disabled: sel.length !== 2, title: "Süpürme — iki eskiz seçin: kapalı bir profil ve açık bir yol" }),
          this.button("feature.linearPattern", ICONS.linearPattern, { disabled: !oneBody, title: "Dikdörtgensel Desen — seçili gövdeyi çoğaltır" }),
          this.button("feature.mirror", ICONS.mirror, { disabled: !oneBody, title: "Ayna — seçili gövdeyi aynalar" }),
        ],
        menu: [
          this.item("sketch.new", ICONS.sketch, { label: "Eskiz Oluştur" }),
          this.item("sketch.onFace", ICONS.sketchOnFace),
          this.item("sketch.newOffset", ICONS.sketchOffset),
          { separator: true, label: "" },
          this.item("feature.extrude", ICONS.extrude),
          this.item("feature.revolve", ICONS.revolve),
          this.item("feature.rib", ICONS.rib),
          this.item("feature.loft", ICONS.loft, { disabled: sel.length < 2 }),
          this.item("feature.sweep", ICONS.sweep, { disabled: sel.length !== 2 }),
          { separator: true, label: "" },
          { label: "Temel Şekiller", icon: ICONS.box, submenu: builtinShapes },
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
          this.button("feature.fillet", ICONS.fillet, { disabled: !oneBody, pressed: this.brep.mode === "edges" && this.brep.isActive, title: "Yuvarlatma — seçili gövdenin kenarlarını yuvarlatır" }),
          this.button("feature.hole", ICONS.hole, { disabled: sel.length > 1, pressed: this.hole.isActive, title: "Delik (H) — yüzeye tıklayarak basit / havşalı / konik havşalı delik açar" }),
          this.button("feature.chamfer", ICONS.chamfer, { disabled: !oneBody, title: "Pah — seçili gövdenin kenarlarını pahlar" }),
          this.button("feature.draft", ICONS.draft, { disabled: !oneBody, title: "Açılı Yüzey — seçili yüzlere kalıp açısı verir" }),
          this.button("feature.shell", ICONS.shell, { disabled: !oneBody, title: "Kabuk — seçilen yüzü açıp gövdenin içini oyar" }),
          this.button("feature.scale", ICONS.scale, { disabled: !oneBody, title: "Ölçek — seçili gövdeyi büyütür / küçültür" }),
          this.button("feature.move", ICONS.move, { disabled: !oneBody, title: "Taşı / Kopyala — seçili gövdeyi kaydırır, döndürür ya da kopyasını bırakır" }),
          this.button("feature.split", ICONS.split, { disabled: !oneBody, title: "Gövdeyi Böl — gövdeyi bir düzlemle keser, düzlemin istenen yanını tutar" }),
        ],
        menu: [
          { label: "Birleştir", icon: ICONS.union, submenu: ops.map((op) => this.item(`boolean.${op}`, ICONS[op], { disabled: sel.length !== 2 })) },
          this.item("feature.hole", ICONS.hole),
          ...(BREP_FEATURES as readonly BrepFeatureType[]).map((t) => this.item(`feature.${t}`, t === "fillet" ? ICONS.fillet : t === "chamfer" ? ICONS.chamfer : t === "draft" ? ICONS.draft : ICONS.shell, { disabled: !oneBody })),
          bodyItem("scale"),
          bodyItem("move"),
          bodyItem("split"),
          { separator: true, label: "" },
          this.item("edit.toggleVisibility", ICONS.eye, { disabled: !sel.length }),
          this.item("edit.duplicate", undefined, { disabled: !sel.length }),
          this.item("edit.delete", ICONS.trash, { disabled: !sel.length }),
        ],
      },
      {
        id: "construct",
        label: "YAPI",
        buttons: [
          this.button("sketch.newOffset", ICONS.sketchOffset, { label: "Ofset Düzlem", title: "Ofset Düzlemde Eskiz — düzlemi kaydırarak eskiz açar" }),
          this.button("sketch.newAngled", ICONS.plane, { label: "Açılı Düzlem", title: "Açılı Düzlemde Eskiz — bir düzlemi eksen etrafında döndürerek eskiz açar" }),
          this.button("sketch.new3pt", ICONS.plane, { label: "3 Nokta", pressed: this.planePoints.isActive, title: "3 Noktalı Düzlem — gövde köşelerine tıklayarak düzlem kurar ve eskiz açar" }),
        ],
        menu: [
          this.item("sketch.newOffset", ICONS.sketchOffset),
          this.item("sketch.newAngled", ICONS.plane),
          this.item("sketch.new3pt", ICONS.plane),
          { separator: true, label: "" },
          ...(Object.keys(PLANES) as PlaneName[]).map((p) => this.item(`sketch.new.${p}`, ICONS.plane)),
        ],
      },
      {
        id: "inspect",
        label: "İNCELE",
        buttons: [
          this.button("inspect.measure", ICONS.measure, { pressed: this.measure.isActive, title: "Ölç (I) — iki nokta arası mesafe" }),
          this.button("inspect.mass", ICONS.mass, { pressed: this.mass.isActive, title: "Kütle Özellikleri — hacim, yüzey alanı, ağırlık merkezi, kütle ve eylemsizlik" }),
          this.button("inspect.section", ICONS.section, { pressed: this.section.isActive, title: "Kesit Analizi — modeli bir düzlemle keser" }),
        ],
        menu: [this.item("inspect.measure", ICONS.measure), this.item("inspect.mass", ICONS.mass, { checked: this.mass.isActive }), this.item("inspect.section", ICONS.section, { checked: this.section.isActive })],
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
    /** Açılır menü düğmesi: ikon + küçük ▾. */
    const menuBtn = (label: string, svg: string, items: () => MenuItem[]) => {
      const b = h(
        "button",
        { class: "nbtn nbtn-menu", title: label, attrs: { "aria-label": label, "aria-haspopup": "menu", "aria-expanded": "false" } },
        icon(svg),
        h("span", { class: "nbtn-caret" }, icon(ICONS.chevronDown)),
      );
      b.addEventListener("click", () => openMenu(b, items(), { above: true }));
      return b;
    };
    const sep = () => h("span", { class: "nsep" });
    const gridItem = (label: string): MenuItem => ({ label, icon: ICONS.grid, checked: vp.isGridVisible, run: () => vp.setGridVisible(!vp.isGridVisible) });
    const displayItems = (): MenuItem[] => [
      ...(Object.keys(STYLE_LABELS) as VisualStyle[]).map((s) => ({
        label: STYLE_LABELS[s],
        checked: vp.visualStyle === s,
        run: () => vp.setVisualStyle(s),
      })),
      { separator: true, label: "" },
      { label: "Perspektif", checked: vp.projection === "perspective", run: () => vp.setProjection("perspective") },
      { label: "Ortografik", checked: vp.projection === "orthographic", run: () => vp.setProjection("orthographic") },
      { separator: true, label: "" },
      gridItem("Zemin Izgarası"),
    ];
    this.navbar.replaceChildren(
      btn("Ana görünüm", ICONS.home, () => vp.setView("iso")),
      sep(),
      h(
        "div",
        { class: "ngroup", attrs: { role: "group", "aria-label": "Yakınlaştırma" } },
        btn("Yakınlaştır", ICONS.zoomIn, () => vp.zoomBy(0.8)),
        btn("Uzaklaştır", ICONS.zoomOut, () => vp.zoomBy(1.25)),
      ),
      sep(),
      btn("Görünüme sığdır (F)", ICONS.fit, () => vp.fit()),
      sep(),
      menuBtn("Görüntü Ayarları", ICONS.display, displayItems),
      menuBtn("Izgara ve Yakalama", ICONS.grid, () => [gridItem("Izgarayı Göster")]),
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

  /** Eskiz Paleti > Düzleme Bak: görünümü etkin eskizin düzlemine döndürür. */
  private lookAtSketchPlane(): void {
    const f = this.sketcher.sketch();
    if (f?.plane) this.viewport.enterSketch(f.id, f.frame ?? f.plane, f.params.offset ?? 0);
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
      if (this.mass.isActive) return this.mass.close();
      if (this.planePoints.isActive) return this.planePoints.close();
      if (this.faceSketch.isActive) return this.faceSketch.close();
      if (this.extrude.isActive) return this.extrude.cancel();
      if (this.revolve.isActive) return this.revolve.cancel();
      if (this.hole.isActive) return this.hole.close();
      if (this.brep.isActive) return this.brep.close();
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
