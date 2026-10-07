/**
 * sugarCAD eklenti API'si.
 *
 * Eklentiniz ayrı bir iş parçacığında (Web Worker) çalışır ve `activate`
 * fonksiyonuna bu nesneyi alır. Belgeye dokunan tüm çağrılar Promise döndürür.
 *
 *   exports.activate = function (sugarcad) {
 *     sugarcad.commands.register("benim-eklentim.merhaba", () =>
 *       sugarcad.ui.showMessage("Merhaba!"));
 *   };
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type BooleanOp = "union" | "subtract" | "intersect";

/** Geometri tarifi. Elle yazabilir ya da `sugarcad.solids` yardımcılarını kullanabilirsiniz. */
export type Solid =
  | { kind: "box"; size: Vec3 }
  | { kind: "cylinder"; radius: number; height: number; segments?: number }
  | { kind: "sphere"; radius: number; segments?: number }
  | { kind: "extrude"; polygons: Vec2[][]; height: number }
  | { kind: "boolean"; op: BooleanOp; children: Solid[] }
  | { kind: "transform"; translate?: Vec3; rotate?: Vec3; child: Solid };

export type ParamValues = Record<string, number>;

export interface FeatureInfo {
  id: string;
  type: string;
  name: string;
  params: ParamValues;
  position: Vec3;
  rotation: Vec3;
  op?: BooleanOp;
  operands?: [string, string];
}

export interface FeaturePatch {
  name?: string;
  params?: ParamValues;
  position?: Vec3;
  rotation?: Vec3;
}

export interface InputField {
  name: string;
  label: string;
  type?: "number" | "text";
  value?: number | string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SugarCadApi {
  readonly version: string;
  /** Bu eklentinin manifestindeki `name`. */
  readonly pluginId: string;

  commands: {
    /** Manifestte `contributes.commands` altında tanımlı bir komutun işleyicisini bağlar. */
    register(id: string, handler: (...args: unknown[]) => unknown): void;
    /** Herhangi bir komutu çalıştırır (yerleşik ya da başka eklentinin). */
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };

  primitives: {
    /** Manifestte `contributes.primitives` altında tanımlı bir şeklin üreticisini bağlar. */
    register(type: string, build: (params: ParamValues) => Solid): void;
  };

  document: {
    getFeatures(): Promise<FeatureInfo[]>;
    getSelection(): Promise<string[]>;
    /** Yerleşik ("box", "cylinder", "sphere") ya da eklenti şekli ekler. */
    addPrimitive(
      type: string,
      params?: ParamValues,
      options?: { name?: string; position?: Vec3; rotation?: Vec3 },
    ): Promise<FeatureInfo>;
    boolean(op: BooleanOp, a: string, b: string): Promise<FeatureInfo>;
    updateFeature(id: string, patch: FeaturePatch): Promise<void>;
    removeFeature(id: string): Promise<void>;
  };

  ui: {
    showMessage(text: string, kind?: "info" | "warning" | "error"): Promise<void>;
    /** Kullanıcıya form gösterir; iptal edilirse `null` döner. */
    showInput(options: { title: string; fields: InputField[] }): Promise<Record<string, number | string> | null>;
  };

  /** Tarif oluşturma yardımcıları (eşzamanlı, sadece nesne üretir). */
  solids: {
    box(size: Vec3): Solid;
    cylinder(radius: number, height: number, segments?: number): Solid;
    sphere(radius: number, segments?: number): Solid;
    extrude(polygons: Vec2[] | Vec2[][], height: number): Solid;
    union(...solids: Solid[]): Solid;
    subtract(...solids: Solid[]): Solid;
    intersect(...solids: Solid[]): Solid;
    translate(solid: Solid, offset: Vec3): Solid;
    rotate(solid: Solid, degrees: Vec3): Solid;
  };
}

export interface PluginModule {
  activate(sugarcad: SugarCadApi): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
