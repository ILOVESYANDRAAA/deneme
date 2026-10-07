import type { InputField } from "../../packages/api/sugarcad";
import { CommandRegistry } from "../core/commands";
import { SugarDocument, type FeaturePatch } from "../core/document";
import { Emitter } from "../core/events";
import {
  BOOLEAN_LABELS,
  FEATURE_PARAMS,
  PrimitiveRegistry,
  SKETCH_FEATURE_LABELS,
  clampParam,
  defaultParams,
  featureRefs,
  featureSolid,
  isSolidFeature,
  type Feature,
  type ParamSpec,
  type ParamValues,
} from "../core/features";
import { PLANES, type PlaneName } from "../core/sketch";
import type { BooleanOp, Solid, Vec3 } from "../core/solid";
import type { MeshData } from "../geometry/evaluate";
import { meshesToStl } from "../geometry/stl";
import { PluginHost, type HostOptions, type HostServices, type PluginWorker } from "../plugins/host";
import type { PluginSource } from "../plugins/manifest";
import type { Platform } from "../platform/adapter";

export type MessageKind = "info" | "warning" | "error";

/** Denetleyicinin arayüzden beklediği iki etkileşim. */
export interface UiBridge {
  showMessage(text: string, kind: MessageKind): void;
  showInput(options: { title: string; fields: InputField[] }): Promise<Record<string, number | string> | null>;
}

/** Geometri işçisinin soyutlaması (testlerde eşzamanlı bir sahtesi kullanılır). */
export interface GeometryEngine {
  submit(items: { id: string; solid: Solid }[]): void;
  onUpdate(listener: (u: { changed: Map<string, { mesh?: MeshData; error?: string }>; removed: string[]; ms: number }) => void): void;
}

export interface MeshesChanged {
  changed: string[];
  removed: string[];
  ms: number;
}

/**
 * Uygulamanın DOM'dan bağımsız beyni: belge, komutlar, şekil türleri, eklentiler
 * ve geometri hesabı burada birleşir. Arayüz bileşenleri sadece bunu dinler.
 */
export class SugarApp implements HostServices {
  readonly document = new SugarDocument();
  readonly commands = new CommandRegistry();
  readonly primitives = new PrimitiveRegistry();
  readonly host: PluginHost;

  /** Kök özelliklerin hesaplanmış ağları. */
  readonly meshes = new Map<string, MeshData>();
  /** Özellik kimliği → tarif ya da geometri hatası. */
  readonly errors = new Map<string, string>();
  readonly onDidChangeMeshes = new Emitter<MeshesChanged>();
  readonly onDidChangeTitle = new Emitter<string>();

  filePath: string | null = null;

  constructor(
    readonly platform: Platform,
    private readonly ui: UiBridge,
    private readonly geometry: GeometryEngine,
    createPluginWorker: () => PluginWorker,
    hostOptions?: HostOptions,
  ) {
    this.host = new PluginHost(this, createPluginWorker, hostOptions);
    this.document.onDidChange.on(() => {
      this.recompute();
      this.onDidChangeTitle.fire(this.title());
    });
    this.geometry.onUpdate((u) => {
      for (const [id, result] of u.changed) {
        if (result.mesh) {
          this.meshes.set(id, result.mesh);
          this.errors.delete(id);
        } else {
          this.meshes.delete(id);
          this.errors.set(id, result.error ?? "Bilinmeyen geometri hatası");
        }
      }
      for (const id of u.removed) this.meshes.delete(id);
      this.onDidChangeMeshes.fire({ changed: [...u.changed.keys()], removed: u.removed, ms: u.ms });
    });
    this.commands.onDidFail.on(({ error }) => this.showMessage(errorText(error), "error"));
    registerBuiltinCommands(this);
  }

  // ---- HostServices / UiBridge ----

  showMessage(text: string, kind: MessageKind = "info"): void {
    this.ui.showMessage(text, kind);
  }

  showInput(options: { title: string; fields: InputField[] }): Promise<Record<string, number | string> | null> {
    return this.ui.showInput(options);
  }

  // ---- geometri ----

  /** Belgedeki kök özelliklerin tariflerini çıkarır ve geometri işçisine gönderir. */
  recompute(): void {
    const byId = this.document.byId();
    const items: { id: string; solid: Solid }[] = [];
    const roots = this.document.roots();
    const rootIds = new Set(roots.map((f) => f.id));
    for (const id of [...this.errors.keys()]) if (!byId.has(id) || !rootIds.has(id)) this.errors.delete(id);
    for (const feature of roots) {
      if (!isSolidFeature(feature)) continue;
      try {
        items.push({ id: feature.id, solid: featureSolid(feature, byId, this.primitives) });
      } catch (e) {
        this.errors.set(feature.id, errorText(e));
      }
    }
    this.geometry.submit(items);
  }

  // ---- düzenleme ----

  async addPrimitive(
    type: string,
    params: ParamValues = {},
    options: { name?: string; position?: Vec3; rotation?: Vec3 } = {},
  ): Promise<Feature> {
    const def = this.primitives.get(type);
    if (!def) throw new Error(`Bilinmeyen şekil türü: ${type}`);
    const values = this.normalizeParams(type, { ...defaultParams(def), ...params });
    const solid = def.build ? undefined : await this.host.buildPrimitive(type, values);
    const feature = this.document.add(
      { type, params: values, ...(solid ? { solid } : {}), ...options },
      def.label,
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  addBoolean(op: BooleanOp, a: string, b: string): Feature {
    const feature = this.document.addBoolean(op, a, b, BOOLEAN_LABELS[op]);
    this.document.setSelection([feature.id]);
    return feature;
  }

  booleanFromSelection(op: BooleanOp): void {
    const sel = this.document.getSelection();
    if (sel.length !== 2) {
      this.showMessage(`${BOOLEAN_LABELS[op]} için iki şekil seçin (Ctrl ile tıklayarak). İlk seçilen ana şekildir.`, "warning");
      return;
    }
    this.addBoolean(op, sel[0], sel[1]);
  }

  // ---- eskiz tabanlı modelleme ----

  /** Seçilen başlangıç düzleminde boş bir eskiz açar. */
  createSketch(plane: PlaneName): Feature {
    if (!(plane in PLANES)) throw new Error(`Bilinmeyen düzlem: ${plane}`);
    const feature = this.document.add(
      { type: "sketch", plane, entities: [], params: { offset: 0 } },
      SKETCH_FEATURE_LABELS.sketch,
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Seçili (ya da tek kullanılmamış) eskizden ekstrüzyon / döndürme oluşturur. */
  addSketchFeature(type: "extrude" | "revolve", sketchId?: string): Feature | null {
    const id = sketchId ?? this.pickSketch();
    if (!id) {
      this.showMessage(
        `${SKETCH_FEATURE_LABELS[type]} için önce bir eskiz seçin (ya da Eskiz ile yeni bir tane çizin)`,
        "warning",
      );
      return null;
    }
    const feature = this.document.add(
      {
        type,
        sketch: id,
        params: Object.fromEntries(Object.entries(FEATURE_PARAMS[type]).map(([k, spec]) => [k, spec.default])),
        ...(type === "revolve" ? { axis: "V" as const } : {}),
      },
      SKETCH_FEATURE_LABELS[type],
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  private pickSketch(): string | undefined {
    const free = (f: Feature | undefined) => f?.type === "sketch" && !this.document.parentOf(f.id);
    const sel = this.document.getSelection();
    if (sel.length === 1 && free(this.document.get(sel[0]))) return sel[0];
    const all = this.document.all().filter(free);
    return all.length === 1 ? all[0].id : undefined;
  }

  /** Parametre değişirse eklenti şeklinin tarifi yeniden üretilir; hepsi tek bir geri alma adımıdır. */
  async updateFeature(id: string, patch: FeaturePatch): Promise<void> {
    const feature = this.document.get(id);
    if (!feature) throw new Error(`Özellik bulunamadı: ${id}`);
    const next: FeaturePatch = { ...patch };
    if (patch.params) {
      next.params = this.normalizeParams(feature.type, { ...feature.params, ...patch.params });
      const def = this.primitives.get(feature.type);
      if (def && !def.build) next.solid = await this.host.buildPrimitive(feature.type, next.params);
    }
    this.document.update(id, next);
  }

  /** Özellik türünün düzenlenebilir parametreleri (yerleşik özellik ya da şekil türü). */
  paramSpecs(type: string): Record<string, ParamSpec> | undefined {
    return FEATURE_PARAMS[type] ?? this.primitives.get(type)?.params;
  }

  private normalizeParams(type: string, params: ParamValues): ParamValues {
    const specs = this.paramSpecs(type);
    if (!specs) return params;
    const out: ParamValues = {};
    for (const [name, spec] of Object.entries(specs)) out[name] = clampParam(spec, Number(params[name]));
    return out;
  }

  deleteSelection(): void {
    const remaining = new Set(this.document.getSelection());
    // Önce girdileri kullanan özellikler (boolean, ekstrüzyon) silinsin ki girdileri serbest kalsın.
    while (remaining.size) {
      const next = [...remaining].find((id) => !remaining.has(this.document.parentOf(id)?.id ?? ""));
      if (!next) break;
      remaining.delete(next);
      this.document.remove(next);
    }
    this.document.setSelection([]);
  }

  duplicateSelection(): void {
    const created: string[] = [];
    for (const id of this.document.getSelection()) {
      const f = this.document.get(id);
      if (!f || featureRefs(f).length) continue;
      const copy = this.document.add({
        type: f.type,
        params: f.params,
        ...(f.solid ? { solid: f.solid } : {}),
        ...(f.plane ? { plane: f.plane, entities: f.entities ?? [] } : {}),
        position: [f.position[0] + 10, f.position[1] + 10, f.position[2]],
        rotation: f.rotation,
        name: `${f.name} kopya`,
      });
      created.push(copy.id);
    }
    if (created.length) this.document.setSelection(created);
    else this.showMessage("Çoğaltmak için bir eskiz ya da şekil seçin (başka özelliğe bağlı olanlar henüz çoğaltılamıyor)", "warning");
  }

  // ---- dosya ----

  title(): string {
    const name = this.filePath ? this.filePath.split(/[\\/]/).pop() : "Adsız";
    return `${this.document.dirty ? "● " : ""}${name} — sugarCAD`;
  }

  private setFile(path: string | null): void {
    this.filePath = path;
    this.onDidChangeTitle.fire(this.title());
  }

  newFile(): void {
    this.document.clear();
    this.setFile(null);
  }

  async openFile(): Promise<void> {
    const file = await this.platform.openTextFile();
    if (!file) return;
    this.openText(file.text, file.path);
  }

  openText(text: string, path: string | null): void {
    this.document.load(SugarDocument.parse(text));
    this.setFile(path);
    const missing = new Set(
      this.document
        .all()
        .filter((f) => !BUILTIN_TYPES.has(f.type) && !this.primitives.get(f.type))
        .map((f) => f.type),
    );
    if (missing.size) {
      this.showMessage(
        `Bu çizim yüklü olmayan eklenti şekilleri içeriyor: ${[...missing].join(", ")}. Kayıtlı geometri gösteriliyor, düzenlemek için eklentiyi kurun.`,
        "warning",
      );
    }
  }

  async save(saveAs = false): Promise<void> {
    const path = await this.platform.saveTextFile(this.document.serialize(), saveAs ? undefined : (this.filePath ?? undefined));
    if (!path) return;
    this.document.dirty = false;
    this.setFile(path);
    this.showMessage(`Kaydedildi: ${path}`, "info");
  }

  async exportStl(): Promise<void> {
    const meshes = this.document.roots().flatMap((f) => this.meshes.get(f.id) ?? []);
    if (meshes.length === 0) {
      this.showMessage("Dışa aktarılacak şekil yok", "warning");
      return;
    }
    const base = (this.filePath?.split(/[\\/]/).pop() ?? "cizim").replace(/\.sugar$/, "");
    const path = await this.platform.saveBinaryFile(meshesToStl(meshes), `${base}.stl`);
    if (path) this.showMessage(`STL dışa aktarıldı: ${path}`, "info");
  }

  // ---- eklentiler ----

  /** Yerleşik ve kullanıcı eklentilerini yükler, şekilleri için "Ekle" komutları üretir. */
  async loadPlugins(builtin: PluginSource[]): Promise<void> {
    let user: PluginSource[] = [];
    try {
      user = await this.platform.listUserPlugins();
    } catch (e) {
      this.showMessage(`Kullanıcı eklentileri okunamadı: ${errorText(e)}`, "error");
    }
    const errors = this.host.load([...builtin, ...user]);
    errors.forEach((e) => this.showMessage(e, "error"));
    registerPrimitiveCommands(this);
    // Eklenti şekilleri artık yüklü: önceden açılmış dosyalardaki hatalar düzelsin.
    this.recompute();
    await this.host.activateStartup();
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const BUILTIN_TYPES = new Set(["boolean", "sketch", "extrude", "revolve"]);

/** Eklentilerin katkıladığı şekiller için "Ekle" komutları. Yerleşik kutu/silindir/küre arayüzde gösterilmez. */
function registerPrimitiveCommands(app: SugarApp): void {
  for (const def of app.primitives.list()) {
    if (!def.pluginId) continue;
    const id = `shape.add.${def.type}`;
    if (app.commands.has(id)) continue;
    app.commands.register(
      { id, title: `${def.label} Ekle`, category: "Şekil", pluginId: def.pluginId },
      () => app.addPrimitive(def.type),
    );
  }
}

function registerBuiltinCommands(app: SugarApp): void {
  const c = app.commands;
  const doc = app.document;
  c.register({ id: "file.new", title: "Yeni Çizim", category: "Dosya", keybinding: "Ctrl+N" }, () => app.newFile());
  c.register({ id: "file.open", title: "Aç…", category: "Dosya", keybinding: "Ctrl+O" }, () => app.openFile());
  c.register({ id: "file.save", title: "Kaydet", category: "Dosya", keybinding: "Ctrl+S" }, () => app.save());
  c.register({ id: "file.saveAs", title: "Farklı Kaydet…", category: "Dosya", keybinding: "Ctrl+Shift+S" }, () =>
    app.save(true),
  );
  c.register({ id: "file.exportStl", title: "STL Olarak Dışa Aktar…", category: "Dosya", keybinding: "Ctrl+E" }, () =>
    app.exportStl(),
  );

  c.register({ id: "edit.undo", title: "Geri Al", category: "Düzen", keybinding: "Ctrl+Z" }, () => doc.undo());
  c.register({ id: "edit.redo", title: "Yinele", category: "Düzen", keybinding: "Ctrl+Y" }, () => doc.redo());
  c.register({ id: "edit.delete", title: "Seçileni Sil", category: "Düzen", keybinding: "Delete" }, () =>
    app.deleteSelection(),
  );
  c.register({ id: "edit.duplicate", title: "Çoğalt", category: "Düzen", keybinding: "Ctrl+D" }, () =>
    app.duplicateSelection(),
  );
  c.register({ id: "edit.selectAll", title: "Tümünü Seç", category: "Düzen", keybinding: "Ctrl+A" }, () =>
    doc.setSelection(doc.roots().map((f) => f.id)),
  );

  c.register({ id: "feature.extrude", title: "Ekstrüzyon", category: "Katı", keybinding: "E" }, () =>
    app.addSketchFeature("extrude"),
  );
  c.register({ id: "feature.revolve", title: "Döndürme", category: "Katı", keybinding: "Shift+R" }, () =>
    app.addSketchFeature("revolve"),
  );

  const ops: [BooleanOp, string][] = [
    ["union", "Ctrl+Shift+U"],
    ["subtract", "Ctrl+Shift+D"],
    ["intersect", "Ctrl+Shift+I"],
  ];
  for (const [op, keybinding] of ops) {
    c.register({ id: `boolean.${op}`, title: BOOLEAN_LABELS[op], category: "Katı", keybinding }, () =>
      app.booleanFromSelection(op),
    );
  }
  registerPrimitiveCommands(app);
}
