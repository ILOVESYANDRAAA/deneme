import { Emitter } from "./events";
import type { Feature } from "./features";
import type { BooleanOp } from "./solid";

export const FILE_VERSION = 1;
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

  /** Bir boolean özelliğinin işleneni olan (başka özellik tarafından tüketilen) özellik kimlikleri. */
  consumedIds(): Set<string> {
    const out = new Set<string>();
    for (const f of this.features) f.operands?.forEach((id) => out.add(id));
    return out;
  }

  /** Sahnede doğrudan çizilen, kimse tarafından tüketilmeyen özellikler. */
  roots(): Feature[] {
    const consumed = this.consumedIds();
    return this.features.filter((f) => !consumed.has(f.id));
  }

  /** Bu özelliği işlenen olarak kullanan boolean özelliği. */
  parentOf(id: string): Feature | undefined {
    return this.features.find((f) => f.operands?.includes(id));
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
    if (feature.operands) {
      for (const id of feature.operands) {
        if (!this.get(id)) throw new Error(`İşlenen bulunamadı: ${id}`);
        if (this.parentOf(id)) throw new Error(`${this.get(id)!.name} zaten başka bir işlemde kullanılıyor`);
      }
      if (feature.operands[0] === feature.operands[1]) throw new Error("İki farklı şekil seçin");
    }
    this.checkpoint();
    this.features.push(feature);
    this.changed();
    return feature;
  }

  /** İşlenenler kendi dönüşümlerini korur; sonuç özelliği sıfır dönüşümle başlar. */
  addBoolean(op: BooleanOp, a: string, b: string, name: string): Feature {
    return this.add({ type: "boolean", op, operands: [a, b], params: {} }, name);
  }

  update(id: string, patch: FeaturePatch): void {
    const feature = this.get(id);
    if (!feature) throw new Error(`Özellik bulunamadı: ${id}`);
    this.checkpoint();
    Object.assign(feature, clone(patch));
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
    if (file.version !== FILE_VERSION) throw new Error(`Desteklenmeyen dosya sürümü: ${file.version}`);
    if (!Array.isArray(file.features)) throw new Error("Dosyada özellik listesi yok");
    this.features = clone(file.features);
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
