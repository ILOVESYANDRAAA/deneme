import { Emitter } from "./events";
import { resolveParameters, validateParameterName, referencedNames, type ParamDef } from "./expr";
import { featureRefs, isSolidFeature, sketchDataOf, type Feature } from "./features";
import type { BooleanOp } from "./solid";

export const FILE_VERSION = 2;
/** Açılabilen en eski dosya sürümü (v1: eskizler bütün-şekil öğeleriyle). */
const MIN_FILE_VERSION = 1;
const MAX_HISTORY = 200;

export interface SugarFile {
  app: "sugarCAD";
  version: number;
  features: Feature[];
  /** Adlandırılmış parametreler (eski dosyalarda yoktur). */
  parameters?: ParamDef[];
}

/** Geri alma adımı: özellikler ve parametreler birlikte saklanır. */
interface Snapshot {
  features: Feature[];
  params: ParamDef[];
}

export type FeatureInit = Omit<Feature, "id" | "position" | "rotation" | "name"> &
  Partial<Pick<Feature, "position" | "rotation" | "name">>;

export type FeaturePatch = Partial<Omit<Feature, "id" | "type">>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Parametrik özellik ağacı. Her değişiklik geri alınabilir bir adımdır.
 * Arayüz ve eklentiler belgeyi sadece bu sınıfın metotlarıyla değiştirir.
 */
export class SugarDocument {
  private features: Feature[] = [];
  private params: ParamDef[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** `batch` içindeyken: tek geri alma adımı ve tek değişiklik bildirimi. */
  private batching: { checkpointed: boolean; changed: boolean } | null = null;
  /** `beginSession` ile açılan önizleme oturumu: içindeki değişiklikler tek geri alma adımıdır (bildirimler yine anında gider). */
  private session: { checkpointed: boolean } | null = null;
  private nextId = 1;
  private selection: string[] = [];

  /** Özellikler değiştiğinde (ekleme, silme, düzenleme, geri alma, yükleme). */
  readonly onDidChange = new Emitter<void>();
  readonly onDidChangeSelection = new Emitter<string[]>();

  dirty = false;

  // ---- okuma ----

  all(): readonly Feature[] {
    return this.features;
  }

  get(id: string): Feature | undefined {
    return this.features.find((f) => f.id === id);
  }

  byId(): Map<string, Feature> {
    return new Map(this.features.map((f) => [f.id, f]));
  }

  /** Başka bir özelliğin girdisi olan (boolean işleneni, ekstrüzyonun eskizi...) özellik kimlikleri. */
  consumedIds(): Set<string> {
    const out = new Set<string>();
    for (const f of this.features) featureRefs(f).forEach((id) => out.add(id));
    return out;
  }

  /** Sahnede doğrudan çizilen, kimse tarafından tüketilmeyen özellikler. */
  roots(): Feature[] {
    const consumed = this.consumedIds();
    return this.features.filter((f) => !consumed.has(f.id));
  }

  /** Bu özelliği girdi olarak kullanan özellik. */
  parentOf(id: string): Feature | undefined {
    return this.features.find((f) => featureRefs(f).includes(id));
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ---- seçim ----

  getSelection(): readonly string[] {
    return this.selection;
  }

  setSelection(ids: string[]): void {
    const valid = ids.filter((id) => this.get(id));
    if (valid.length === this.selection.length && valid.every((id, i) => id === this.selection[i])) {
      return;
    }
    this.selection = valid;
    this.onDidChangeSelection.fire(this.selection);
  }

  // ---- değiştirme ----

  private checkpoint(): void {
    if (this.session) {
      if (this.session.checkpointed) return;
      this.session.checkpointed = true;
    }
    if (this.batching) {
      if (this.batching.checkpointed) return;
      this.batching.checkpointed = true;
    }
    this.undoStack.push({ features: clone(this.features), params: clone(this.params) });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.dirty = true;
    if (this.batching) {
      this.batching.changed = true;
      return;
    }
    this.setSelection(this.selection);
    this.onDidChange.fire();
  }

  /**
   * Diyalogla canlı önizleme için: `endSession`'a kadar yapılan bütün değişiklikler tek geri alma adımı olur.
   * `cancelSession` hepsini geri alır. Bildirimler her değişiklikte hemen gider (model anında güncellenir).
   */
  beginSession(): void {
    this.session = { checkpointed: false };
  }

  endSession(): void {
    this.session = null;
  }

  cancelSession(): void {
    const session = this.session;
    this.session = null;
    if (!session?.checkpointed) return;
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.features = prev.features;
    this.params = prev.params;
    this.changed();
  }

  /** `fn` içindeki tüm değişiklikler tek geri alma adımı olur ve tek bildirim gönderir. Hata olursa değişiklikler geri alınır. */
  batch<T>(fn: () => T): T {
    if (this.batching) return fn();
    const state = { checkpointed: false, changed: false };
    this.batching = state;
    try {
      return fn();
    } catch (e) {
      if (state.checkpointed) {
        const prev = this.undoStack.pop()!;
        this.features = prev.features;
        this.params = prev.params;
      }
      state.changed = state.checkpointed;
      throw e;
    } finally {
      this.batching = null;
      if (state.changed) this.changed();
    }
  }

  // ---- parametreler ----

  parameters(): readonly ParamDef[] {
    return this.params;
  }

  /** Parametrelerin çözülmüş değerleri ve hataları. */
  resolvedParameters(): { values: Record<string, number>; errors: Record<string, string> } {
    return resolveParameters(this.params);
  }

  /** Parametre ekle / güncelle önerisini doğrular; geçerliyse yeni liste ve çözülmüş değerleri döndürür, değilse hata fırlatır. */
  private candidate(name: string, expr: string): { next: ParamDef[]; values: Record<string, number> } {
    const bad = validateParameterName(name);
    if (bad) throw new Error(bad);
    const text = expr.trim();
    if (!text) throw new Error("Parametre değeri boş olamaz");
    const exists = this.params.some((p) => p.name === name);
    const next = exists ? this.params.map((p) => (p.name === name ? { name, expr: text } : p)) : [...this.params, { name, expr: text }];
    const { values, errors } = resolveParameters(next);
    if (errors[name]) throw new Error(errors[name]);
    const broken = Object.entries(errors).find(([n]) => n !== name);
    if (broken) throw new Error(`"${broken[0]}" parametresi bozulur: ${broken[1]}`);
    return { next, values };
  }

  /** Önerilen parametreyle oluşacak değerler (belgeyi değiştirmeden). */
  previewParameter(name: string, expr: string): Record<string, number> {
    return this.candidate(name, expr).values;
  }

  /** Ekler ya da günceller (`expr`: sayı ya da ifade). Geçersizse (ad, bilinmeyen başvuru, döngü) hata fırlatır. */
  setParameter(name: string, expr: string): void {
    const { next } = this.candidate(name, expr);
    this.checkpoint();
    this.params = next;
    this.changed();
  }

  /** Bu parametreye başvuran parametre, özellik ifadesi ve ölçü kısıtları (adlarıyla). */
  parameterUsers(name: string): string[] {
    const users: string[] = [];
    const uses = (text?: string) => !!text && referencedNames(text).includes(name);
    for (const p of this.params) if (p.name !== name && uses(p.expr)) users.push(`parametre ${p.name}`);
    for (const f of this.features) {
      if (Object.values(f.exprs ?? {}).some(uses) || f.sketchData?.constraints.some((k) => uses(k.expr))) users.push(f.name);
    }
    return users;
  }

  removeParameter(name: string): void {
    if (!this.params.some((p) => p.name === name)) return;
    const users = this.parameterUsers(name);
    if (users.length) throw new Error(`"${name}" kullanımda: ${users.slice(0, 4).join(", ")}${users.length > 4 ? "…" : ""}`);
    this.checkpoint();
    this.params = this.params.filter((p) => p.name !== name);
    this.changed();
  }

  renameParameter(from: string, to: string): void {
    if (from === to) return;
    const bad = validateParameterName(to);
    if (bad) throw new Error(bad);
    if (this.params.some((p) => p.name === to)) throw new Error(`"${to}" adında bir parametre zaten var`);
    const users = this.parameterUsers(from);
    if (users.length) throw new Error(`"${from}" kullanımda (${users.slice(0, 3).join(", ")}); önce başvuruları kaldırın`);
    this.checkpoint();
    this.params = this.params.map((p) => (p.name === from ? { ...p, name: to } : p));
    this.changed();
  }

  private uniqueName(base: string): string {
    const names = new Set(this.features.map((f) => f.name));
    for (let i = 1; ; i++) {
      const name = `${base} ${i}`;
      if (!names.has(name)) return name;
    }
  }

  add(init: FeatureInit, baseName = init.type): Feature {
    const feature: Feature = {
      ...clone(init),
      id: `f${this.nextId++}`,
      name: init.name ?? this.uniqueName(baseName),
      position: init.position ? [...init.position] : [0, 0, 0],
      rotation: init.rotation ? [...init.rotation] : [0, 0, 0],
    };
    this.validateRefs(feature);
    this.checkpoint();
    this.features.push(feature);
    this.changed();
    return feature;
  }

  /** `id` özelliği (doğrudan ya da dolaylı) `other`'ı girdi olarak kullanıyor mu? */
  dependsOn(id: string, other: string, seen = new Set<string>()): boolean {
    if (id === other) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const f = this.get(id);
    return !!f && featureRefs(f).some((ref) => this.dependsOn(ref, other, seen));
  }

  /** Girdiler var mı, boşta mı, doğru türde mi ve döngü oluşturmuyor mu? */
  private validateRefs(feature: Feature): void {
    const refs = featureRefs(feature);
    for (const id of refs) {
      const input = this.get(id);
      if (!input) throw new Error(`Girdi bulunamadı: ${id}`);
      if (id === feature.id) throw new Error(`${input.name} kendisini girdi olarak kullanamaz`);
      const parent = this.parentOf(id);
      if (parent && parent.id !== feature.id) throw new Error(`${input.name} zaten başka bir işlemde kullanılıyor`);
      if (this.dependsOn(id, feature.id)) throw new Error(`${input.name} bu özelliğe bağlı; döngü oluşur`);
      if (id === feature.sketch || id === feature.path || feature.sections?.includes(id)) {
        if (input.type !== "sketch") throw new Error(`${input.name} bir eskiz değil`);
      } else if (!isSolidFeature(input)) {
        throw new Error(`${input.name} bir eskiz; önce Ekstrüzyon ya da Döndürme uygulayın`);
      }
    }
    if (new Set(refs).size !== refs.length) throw new Error("İki farklı şekil seçin");
  }

  /** İşlenenler kendi dönüşümlerini korur; sonuç özelliği sıfır dönüşümle başlar. */
  addBoolean(op: BooleanOp, a: string, b: string, name: string): Feature {
    return this.add({ type: "boolean", op, operands: [a, b], params: {} }, name);
  }

  update(id: string, patch: FeaturePatch): void {
    const feature = this.get(id);
    if (!feature) throw new Error(`Özellik bulunamadı: ${id}`);
    const next = { ...feature, ...clone(patch) };
    // `target: undefined` gibi alanlar silinsin (JSON'da da görünmesin).
    for (const key of Object.keys(next) as (keyof Feature)[]) if (next[key] === undefined) delete next[key];
    if (featureRefs(next).join() !== featureRefs(feature).join()) this.validateRefs(next);
    this.checkpoint();
    for (const key of Object.keys(feature) as (keyof Feature)[]) if (!(key in next)) delete feature[key];
    Object.assign(feature, next);
    this.changed();
  }

  /**
   * Özelliği siler. Bir boolean'ın işleneni ise önce o boolean silinmelidir.
   * Boolean silinirse işlenenleri tekrar serbest kalır.
   */
  remove(id: string): void {
    const feature = this.get(id);
    if (!feature) return;
    const parent = this.parentOf(id);
    if (parent) throw new Error(`${feature.name}, "${parent.name}" içinde kullanılıyor; önce onu silin`);
    this.checkpoint();
    this.features = this.features.filter((f) => f.id !== id);
    this.changed();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push({ features: this.features, params: this.params });
    this.features = prev.features;
    this.params = prev.params;
    this.changed();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({ features: this.features, params: this.params });
    this.features = next.features;
    this.params = next.params;
    this.changed();
    return true;
  }

  // ---- dosya ----

  toJSON(): SugarFile {
    return { app: "sugarCAD", version: FILE_VERSION, features: clone(this.features), ...(this.params.length ? { parameters: clone(this.params) } : {}) };
  }

  serialize(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  load(file: SugarFile): void {
    if (file?.app !== "sugarCAD") throw new Error("Bu bir sugarCAD dosyası değil");
    if (!(file.version >= MIN_FILE_VERSION && file.version <= FILE_VERSION)) {
      throw new Error(`Desteklenmeyen dosya sürümü: ${file.version}`);
    }
    if (!Array.isArray(file.features)) throw new Error("Dosyada özellik listesi yok");
    this.features = clone(file.features).map(migrateFeature);
    this.params = Array.isArray(file.parameters) ? clone(file.parameters).filter((p) => p && typeof p.name === "string" && typeof p.expr === "string") : [];
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.nextId =
      1 +
      this.features.reduce((max, f) => {
        const n = Number(/^f(\d+)$/.exec(f.id)?.[1] ?? 0);
        return Math.max(max, n);
      }, 0);
    this.dirty = false;
    this.onDidChangeSelection.fire(this.selection);
    this.onDidChange.fire();
  }

  static parse(text: string): SugarFile {
    return JSON.parse(text) as SugarFile;
  }

  clear(): void {
    this.load({ app: "sugarCAD", version: FILE_VERSION, features: [] });
  }
}

/** Eski eskiz öğelerini yeni nokta / eğri / kısıt modeline çevirir. */
function migrateFeature(f: Feature): Feature {
  if (f.type !== "sketch" || f.sketchData) return f;
  const { entities: _legacy, ...rest } = f;
  return { ...rest, sketchData: sketchDataOf(f) };
}
