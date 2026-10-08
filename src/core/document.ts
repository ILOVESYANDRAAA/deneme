import { Emitter } from "./events";
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
  private undoStack: Feature[][] = [];
  private redoStack: Feature[][] = [];
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
    this.undoStack.push(clone(this.features));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.dirty = true;
    this.setSelection(this.selection);
    this.onDidChange.fire();
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
    this.redoStack.push(this.features);
    this.features = prev;
    this.changed();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.features);
    this.features = next;
    this.changed();
    return true;
  }

  // ---- dosya ----

  toJSON(): SugarFile {
    return { app: "sugarCAD", version: FILE_VERSION, features: clone(this.features) };
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
