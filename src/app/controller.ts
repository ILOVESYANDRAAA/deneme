import type { InputField } from "../../packages/api/sugarcad";
import { CommandRegistry } from "../core/commands";
import { SugarDocument, type FeaturePatch } from "../core/document";
import { Emitter } from "../core/events";
import {
  BODY_FEATURES,
  BOOLEAN_LABELS,
  BREP_LABELS,
  type BrepFeatureType,
  type HolePoint,
  type HoleType,
  FEATURE_LABELS,
  FEATURE_PARAMS,
  PrimitiveRegistry,
  type BodyFeatureType,
  clampParam,
  defaultParams,
  featureRefs,
  featureSolid,
  sketchDataOf,
  stepAssets,
  isSolidFeature,
  type Feature,
  type ParamSpec,
  type ParamValues,
} from "../core/features";
import { PLANES, type PlaneRef } from "../core/sketch";
import type { SketchSolver } from "../core/solver";
import { importDxf, sketchToDxf, type DxfImportResult } from "../core/dxf";
import { SketchEdit, emptySketch, sketchDataChain, sketchDataLoops } from "../core/sketchmodel";
import type { BooleanOp, EdgeRef, FaceRef, Solid, Vec3 } from "../core/solid";
import type { BrepInfo } from "../geometry/brep";
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
  submit(items: { id: string; solid: Solid }[], assets?: Record<string, string>): void;
  /** Gövdeleri STEP dosyası olarak yazar (OpenCascade). */
  exportStep(items: { id: string; name: string; solid: Solid }[], assets?: Record<string, string>): Promise<Uint8Array>;
  /** Bir tarifin kenar / yüz betimi (OpenCascade); seçim arayüzü için. */
  describe(solid: Solid): Promise<BrepInfo>;
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
  /** Eskiz kısıt çözücüsü; başlatılana kadar (ya da hiç yoksa) kısıtlar çözülmez, çizim yine çalışır. */
  solver: SketchSolver | null = null;

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
    this.geometry.submit(items, stepAssets(this.document.all()));
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

  /** Seçilen başlangıç düzleminde ya da serbest bir düzlemde (örn. gövde yüzeyi) boş bir eskiz açar. */
  createSketch(plane: PlaneRef, offset = 0): Feature {
    const params = { offset: Number.isFinite(offset) ? offset : 0 };
    let placement: Pick<Feature, "plane" | "frame">;
    if (typeof plane === "string") {
      if (!(plane in PLANES)) throw new Error(`Bilinmeyen düzlem: ${plane}`);
      placement = { plane };
    } else {
      const ok = [plane.origin, plane.u, plane.v, plane.n].every((v) => v.length === 3 && v.every(Number.isFinite));
      if (!ok) throw new Error("Geçersiz eskiz düzlemi");
      // `plane` eskiz özelliğinin işaretidir; çerçeve varsa onun yerine geçer.
      placement = { plane: "XY", frame: structuredClone(plane) };
    }
    const feature = this.document.add({ type: "sketch", ...placement, sketchData: emptySketch(), params }, FEATURE_LABELS.sketch);
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Seçili (ya da tek kullanılmamış) eskizden ekstrüzyon / döndürme oluşturur. */
  addSketchFeature(type: "extrude" | "revolve" | "rib", sketchId?: string): Feature | null {
    const id = sketchId ?? this.pickSketch();
    if (!id) {
      this.showMessage(
        `${FEATURE_LABELS[type]} için önce bir eskiz seçin (ya da Eskiz ile yeni bir tane çizin)`,
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
      FEATURE_LABELS[type],
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Seçili gövdeden ayna / desen / ölçek özelliği oluşturur. */
  addBodyFeature(type: BodyFeatureType, sourceId?: string): Feature | null {
    const sel = this.document.getSelection();
    const id = sourceId ?? (sel.length === 1 ? sel[0] : undefined);
    const source = id ? this.document.get(id) : undefined;
    if (!source || !isSolidFeature(source) || this.document.parentOf(source.id)) {
      this.showMessage(`${FEATURE_LABELS[type]} için önce bir gövde seçin`, "warning");
      return null;
    }
    const feature = this.document.add(
      {
        type,
        source: source.id,
        params: Object.fromEntries(Object.entries(FEATURE_PARAMS[type]).map(([k, spec]) => [k, spec.default])),
        ...(type === "mirror" ? { plane: "YZ" as const } : {}),
        ...(type === "circularPattern" ? { worldAxis: "Z" as const } : {}),
      },
      FEATURE_LABELS[type],
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Seçili eskizler (seçim sırasıyla); en az `min` tane yoksa uyarır. */
  private selectedSketches(what: string, min: number): Feature[] | null {
    const sketches = this.document.getSelection().map((id) => this.document.get(id)).filter((f): f is Feature => f?.type === "sketch");
    if (sketches.length < min || sketches.length !== this.document.getSelection().length) {
      this.showMessage(`${what}: Ctrl ile ${min === 2 ? "en az iki" : "gerekli"} eskizi seçin (ağaçtan ya da zaman çizelgesinden)`, "warning");
      return null;
    }
    if (sketches.some((sk) => this.document.parentOf(sk.id))) {
      this.showMessage(`${what}: seçilen eskizlerden biri zaten başka bir özellikte kullanılıyor`, "warning");
      return null;
    }
    return sketches;
  }

  /** Seçili eskizleri (seçim sırasıyla) loft ile birleştirir. */
  addLoftFeature(sketchIds?: string[]): Feature | null {
    if (sketchIds) this.document.setSelection(sketchIds);
    const sketches = this.selectedSketches("Loft", 2);
    if (!sketches) return null;
    const feature = this.document.add(
      { type: "loft", sections: sketches.map((sk) => sk.id), params: Object.fromEntries(Object.entries(FEATURE_PARAMS.loft).map(([k, spec]) => [k, spec.default])) },
      FEATURE_LABELS.loft,
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** İki eskizden süpürme: kapalı şekil içeren profil, açık zincir içeren yol sayılır (seçim sırası önemsiz). */
  addSweepFeature(sketchIds?: string[]): Feature | null {
    if (sketchIds) this.document.setSelection(sketchIds);
    const sketches = this.selectedSketches("Süpürme", 2);
    if (!sketches) return null;
    if (sketches.length !== 2) {
      this.showMessage("Süpürme: tam iki eskiz seçin (profil ve yol)", "warning");
      return null;
    }
    const kinds = sketches.map((sk) => {
      const d = sketchDataOf(sk);
      return { sk, closed: sketchDataLoops(d).length > 0, open: sketchDataChain(d) !== null };
    });
    const profile = kinds.find((k) => k.closed && !k.open);
    const path = kinds.find((k) => k.open && !k.closed);
    if (!profile || !path || profile === path) {
      this.showMessage("Süpürme: bir eskiz kapalı şekil (profil), diğeri açık bir çizgi / yay zinciri (yol) içermeli", "warning");
      return null;
    }
    const feature = this.document.add({ type: "sweep", sketch: profile.sk.id, path: path.sk.id, params: {} }, FEATURE_LABELS.sweep);
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Yuvarlatma / pah / kabuk için kaynak olabilecek gövde: seçili tek, boşta (başka özelliğe tüketilmemiş) katı. */
  brepSource(type: BrepFeatureType): Feature | null {
    const sel = this.document.getSelection();
    const source = sel.length === 1 ? this.document.get(sel[0]) : undefined;
    if (!source || !isSolidFeature(source) || this.document.parentOf(source.id)) {
      this.showMessage(`${BREP_LABELS[type]} için önce bir gövde seçin`, "warning");
      return null;
    }
    return source;
  }

  /** Gövdenin (kaynak özelliğin) kenar / yüz betimi. */
  async describeBody(sourceId: string): Promise<BrepInfo> {
    const f = this.document.get(sourceId);
    if (!f) throw new Error("Gövde bulunamadı");
    return this.geometry.describe(featureSolid(f, this.document.byId(), this.primitives));
  }

  /** Gövdeye delik(ler) açar: her konum yüzey noktası + dışa bakan normaldir. Boştaki bir katı gövde gerekir. */
  addHoleFeature(sourceId: string, holes: HolePoint[], options: { type?: HoleType; params?: ParamValues } = {}): Feature {
    const source = this.document.get(sourceId);
    if (!source || !isSolidFeature(source) || this.document.parentOf(source.id)) {
      throw new Error("Delik için boştaki bir katı gövde gerekir");
    }
    if (!holes.length) throw new Error("Delik konumu seçilmemiş");
    const defaults = Object.fromEntries(Object.entries(FEATURE_PARAMS.hole).map(([k, spec]) => [k, spec.default]));
    const params = this.normalizeParams("hole", { ...defaults, ...options.params });
    const feature = this.document.add(
      { type: "hole", source: sourceId, params, holes: holes.map((h) => ({ at: [...h.at], normal: [...h.normal] })), ...(options.type && options.type !== "simple" ? { holeType: options.type } : {}) },
      FEATURE_LABELS.hole,
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Seçilen kenarları yuvarlatır / pah kırar, ya da seçilen yüzleri açarak gövdeyi oyar. */
  addBrepFeature(type: BrepFeatureType, sourceId: string, refs: { edges?: EdgeRef[]; faces?: FaceRef[] }, value?: number, extra: { pull?: Vec3 } = {}): Feature {
    const source = this.document.get(sourceId);
    if (!source || !isSolidFeature(source)) throw new Error(`${BREP_LABELS[type]} için gövde bulunamadı`);
    const onFaces = type === "shell" || type === "draft";
    if (onFaces ? !refs.faces?.length : !refs.edges?.length) {
      throw new Error(type === "shell" ? "Açılacak en az bir yüz seçin" : onFaces ? "En az bir yüz seçin" : "En az bir kenar seçin");
    }
    const params = Object.fromEntries(Object.entries(FEATURE_PARAMS[type]).map(([k, spec]) => [k, spec.default]));
    const key = Object.keys(params)[0];
    if (value !== undefined) params[key] = clampParam(FEATURE_PARAMS[type][key], value);
    const feature = this.document.add(
      {
        type,
        source: sourceId,
        params,
        ...(onFaces ? { faces: refs.faces } : { edges: refs.edges }),
        ...(type === "draft" && extra.pull ? { pull: extra.pull } : {}),
      },
      BREP_LABELS[type],
    );
    this.document.setSelection([feature.id]);
    return feature;
  }

  /** Birleştir / Kes / Kesiştir için hedef olabilecek gövdeler: boştaki, bu özelliğe bağlı olmayan katılar. */
  targetCandidates(featureId: string): Feature[] {
    const f = this.document.get(featureId);
    return this.document
      .roots()
      .filter((r) => r.id !== featureId && isSolidFeature(r) && !this.document.dependsOn(r.id, featureId))
      .concat(f?.target ? [this.document.get(f.target)!].filter(Boolean) : []);
  }

  /** İşlem türünü değiştirir; tek aday gövde varsa onu hedef seçer. */
  async setOperation(featureId: string, operation: NonNullable<Feature["operation"]>): Promise<void> {
    const f = this.document.get(featureId);
    if (!f) return;
    if (operation === "new") return this.updateFeature(featureId, { operation, target: undefined });
    const candidates = this.targetCandidates(featureId);
    const target = f.target ?? (candidates.length === 1 ? candidates[0].id : undefined);
    await this.updateFeature(featureId, { operation, target });
  }

  /** Seçili özellikleri 3D görünümde gizler / gösterir. */
  toggleVisibility(ids = this.document.getSelection()): void {
    const features = ids.map((id) => this.document.get(id)).filter((f): f is Feature => !!f);
    if (!features.length) return;
    const hide = !features.every((f) => f.hidden);
    for (const f of features) this.document.update(f.id, { hidden: hide ? true : undefined });
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
        ...(f.plane ? { plane: f.plane, ...(f.frame ? { frame: f.frame } : {}), sketchData: sketchDataOf(f) } : {}),
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

  /** DXF metnini `sketchId` eskizine ekler (çözücüyle bağlantıları yeniden çözülür). */
  importDxfInto(sketchId: string, text: string): DxfImportResult {
    const sketch = this.document.get(sketchId);
    if (!sketch || sketch.type !== "sketch") throw new Error("DXF içe aktarmak için bir eskiz gerekir");
    const ed = new SketchEdit(sketchDataOf(sketch));
    const result = importDxf(text, ed);
    if (!result.added) throw new Error("DXF dosyasında içe aktarılabilir çizim öğesi (çizgi, daire, yay, çoklu çizgi...) bulunamadı");
    this.document.update(sketchId, { sketchData: ed.result() });
    return result;
  }

  async importDxfFile(sketchId: string): Promise<void> {
    const file = await this.platform.openTextFile({ name: "DXF", extensions: ["dxf"] });
    if (!file) return;
    const r = this.importDxfInto(sketchId, file.text);
    const skipped = Object.entries(r.skipped).map(([k, n]) => `${k} ×${n}`).join(", ");
    this.showMessage(`${r.added} öğe içe aktarıldı${skipped ? ` (atlanan: ${skipped})` : ""}`, skipped ? "warning" : "info");
  }

  async exportDxfFile(sketchId: string): Promise<void> {
    const sketch = this.document.get(sketchId);
    if (!sketch || sketch.type !== "sketch") throw new Error("DXF dışa aktarmak için bir eskiz seçin");
    const text = sketchToDxf(sketchDataOf(sketch));
    const path = await this.platform.saveBinaryFile(new TextEncoder().encode(text), `${sketch.name}.dxf`);
    if (path) this.showMessage(`${sketch.name} DXF olarak kaydedildi`, "info");
  }

  /** STEP metnini yeni bir "STEP Gövdesi" özelliği olarak ekler. */
  importStepText(name: string, text: string): Feature {
    if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error("Bu dosya bir STEP dosyasına benzemiyor (ISO-10303-21 başlığı yok)");
    const feature = this.document.add({ type: "stepBody", stepData: text, params: {} }, name.replace(/\.(step|stp)$/i, "") || FEATURE_LABELS.stepBody);
    this.document.setSelection([feature.id]);
    return feature;
  }

  async importStepFile(): Promise<void> {
    const file = await this.platform.openTextFile({ name: "STEP", extensions: ["step", "stp"] });
    if (!file) return;
    const base = file.path.split(/[\\/]/).pop() ?? file.path;
    this.importStepText(base, file.text);
  }

  /** Görünür kök gövdelerin tariflerini STEP dosyasına yazar (varsa seçili gövdeler yalnız onlar). */
  async exportStepFile(): Promise<void> {
    const byId = this.document.byId();
    const roots = this.document.roots().filter((f) => isSolidFeature(f) && !f.hidden);
    const selected = roots.filter((f) => this.document.getSelection().includes(f.id));
    const chosen = selected.length ? selected : roots;
    const items: { id: string; name: string; solid: Solid }[] = [];
    for (const f of chosen) {
      try {
        items.push({ id: f.id, name: f.name, solid: featureSolid(f, byId, this.primitives) });
      } catch {
        // hatalı özellik atlanır (hatası zaten ağaçta gösterilir)
      }
    }
    if (!items.length) {
      this.showMessage("Dışa aktarılacak gövde yok", "warning");
      return;
    }
    this.showMessage("STEP dosyası hazırlanıyor…", "info");
    const data = await this.geometry.exportStep(items, stepAssets(this.document.all()));
    const base = (this.filePath ?? "model").split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "") || "model";
    const path = await this.platform.saveBinaryFile(data, `${base}.step`);
    if (path) this.showMessage(`${items.length} gövde STEP olarak kaydedildi`, "info");
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

const BUILTIN_TYPES = new Set(["boolean", ...Object.keys(FEATURE_LABELS)]);

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
  c.register({ id: "file.exportStep", title: "STEP Olarak Dışa Aktar…", category: "Dosya" }, () => app.exportStepFile());
  c.register({ id: "file.importStep", title: "STEP İçe Aktar…", category: "Dosya" }, () => app.importStepFile());
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
  c.register({ id: "feature.rib", title: "Kaburga", category: "Katı" }, async () => {
    const f = app.addSketchFeature("rib");
    // Tek aday gövde varsa kaburga ona birleştirilir.
    if (f && app.targetCandidates(f.id).length === 1) await app.setOperation(f.id, "join");
  });
  c.register({ id: "feature.loft", title: "Loft", category: "Katı" }, () => app.addLoftFeature());
  c.register({ id: "feature.sweep", title: "Süpürme", category: "Katı" }, () => app.addSweepFeature());
  c.register({ id: "feature.revolve", title: "Döndürme", category: "Katı", keybinding: "Shift+R" }, () =>
    app.addSketchFeature("revolve"),
  );
  for (const type of BODY_FEATURES) {
    c.register({ id: `feature.${type}`, title: FEATURE_LABELS[type], category: "Katı" }, () => app.addBodyFeature(type));
  }
  c.register({ id: "edit.toggleVisibility", title: "Göster / Gizle", category: "Düzen", keybinding: "V" }, () =>
    app.toggleVisibility(),
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
