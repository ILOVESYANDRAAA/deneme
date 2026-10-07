import type { InputField } from "../../packages/api/sugarcad";
import { CommandRegistry } from "../core/commands";
import { SugarDocument, type FeaturePatch } from "../core/document";
import { Emitter } from "../core/events";
import {
  BOOLEAN_LABELS,
  PrimitiveRegistry,
  clampParam,
  defaultParams,
  featureSolid,
  type Feature,
  type ParamValues,
} from "../core/features";
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

  private normalizeParams(type: string, params: ParamValues): ParamValues {
    const def = this.primitives.get(type);
    if (!def) return params;
    const out: ParamValues = {};
    for (const [name, spec] of Object.entries(def.params)) out[name] = clampParam(spec, Number(params[name]));
    return out;
  }

  deleteSelection(): void {
    const sel = [...this.document.getSelection()];
    if (sel.length === 0) return;
    // Önce boolean sonuçları silinsin ki işlenenler serbest kalsın.
    const order = sel.sort((a, b) => Number(!!this.document.get(b)?.operands) - Number(!!this.document.get(a)?.operands));
    for (const id of order) this.document.remove(id);
    this.document.setSelection([]);
  }

  duplicateSelection(): void {
    const created: string[] = [];
    for (const id of this.document.getSelection()) {
      const f = this.document.get(id);
      if (!f || f.type === "boolean") continue;
      const copy = this.document.add({
        type: f.type,
        params: f.params,
        ...(f.solid ? { solid: f.solid } : {}),
        position: [f.position[0] + 10, f.position[1] + 10, f.position[2]],
        rotation: f.rotation,
        name: `${f.name} kopya`,
      });
      created.push(copy.id);
    }
    if (created.length) this.document.setSelection(created);
    else this.showMessage("Çoğaltmak için bir şekil seçin (boolean sonuçları henüz çoğaltılamıyor)", "warning");
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
        .filter((f) => f.type !== "boolean" && !this.primitives.get(f.type))
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

function registerPrimitiveCommands(app: SugarApp): void {
  for (const def of app.primitives.list()) {
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
