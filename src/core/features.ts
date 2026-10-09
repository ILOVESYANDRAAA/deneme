import { PLANES, planeMatrix, type PlaneFrame, type PlaneName, type SketchEntity } from "./sketch";
import { fromLegacyEntities, pointMap, sketchDataChain, sketchDataLoops, sketchDataProfiles, thickenChain, type SketchData } from "./sketchmodel";
import { textHash, type BooleanOp, type EdgeRef, type FaceRef, type Loop, type Section, type Solid, type Vec2, type Vec3 } from "./solid";

/** Bir parametrenin özellik panelinde nasıl gösterileceği. */
export interface ParamSpec {
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}

export type ParamValues = Record<string, number>;

/** Özellik ağacındaki tek bir düğüm. Tamamı JSON'a çevrilebilir. */
export interface Feature {
  id: string;
  /** "box" | "cylinder" | "sphere" | "boolean" | eklenti türü ("gear.spur" gibi) */
  type: string;
  name: string;
  params: ParamValues;
  /** Parametre ifadeleri: `params` içindeki bir değerin ifadeden geldiğini belirtir (örn. { distance: "genislik / 2" }). */
  exprs?: Record<string, string>;
  position: Vec3;
  /** Derece cinsinden X, Y, Z dönüşü. */
  rotation: Vec3;
  /** Sadece boolean özellikleri için. */
  op?: BooleanOp;
  operands?: [string, string];
  /** Eskiz: düzlem ve geometri (noktalar, eğriler, kısıtlar). */
  plane?: PlaneName;
  /** Eskiz bir gövde yüzeyinde (ya da serbest düzlemde) ise düzlem çerçevesi; varsa `plane`ın yerine geçer. */
  frame?: PlaneFrame;
  sketchData?: SketchData;
  /** Eski (v1) dosyalardaki eskiz öğeleri; açılırken `sketchData`'ya çevrilir. */
  entities?: SketchEntity[];
  /** Ekstrüzyon / döndürme / süpürme: kullanılan (profil) eskizin kimliği. */
  sketch?: string;
  /** Loft: sırayla bağlanan kesit eskizlerinin kimlikleri. */
  sections?: string[];
  /** Süpürme: yolu tanımlayan açık eskizin kimliği. */
  path?: string;
  /** Döndürme ekseni: eskizin dikey (V) ya da yatay (U) ekseni. */
  axis?: RevolveAxis;
  /** Ekstrüzyon / döndürme sonucu yeni gövde mi, yoksa `target` gövdeyle birleşim / kesme / kesişim mi? */
  operation?: BodyOperation;
  /** Birleştir / Kes / Kesiştir işlemlerinin uygulandığı gövde (tüketilir). */
  target?: string;
  /** Ekstrüzyon yönü: tek taraf ya da düzlemin iki yanına simetrik. */
  direction?: ExtrudeDirection;
  /** Ayna / desen / ölçek: kopyalanan ya da değiştirilen gövde (tüketilir). */
  source?: string;
  /** Dairesel desenin döndüğü dünya ekseni. Ayna düzlemi `plane` alanındadır. */
  worldAxis?: WorldAxis;
  /** Yuvarlatma / pah: seçilen kenarlar. Kabuk: açılan (kaldırılan) yüzler. Kaynak gövdenin B-rep imzaları. */
  edges?: EdgeRef[];
  faces?: FaceRef[];
  /** Delik: türü ve konumları (yüzey noktası + dışa bakan yüzey normali). Kaynak gövdeden çıkarılır. */
  holeType?: HoleType;
  holes?: HolePoint[];
  /** Açılı yüzey: çekme yönü (varsayılan +Z). */
  pull?: Vec3;
  /** İçe aktarılan STEP gövdesi: dosyanın metni. */
  stepData?: string;
  /** Sadece 3D görünümde gizlenir; hesaplama ve dışa aktarma etkilenmez. */
  hidden?: boolean;
  /** Eklenti özellikleri için son üretilen tarif (eklenti yüklü olmasa da dosya açılabilsin diye saklanır). */
  solid?: Solid;
}

export interface PrimitiveDef {
  type: string;
  label: string;
  params: Record<string, ParamSpec>;
  /** Yerleşik şekiller eşzamanlı üretilir; eklenti şekilleri eklenti sunucusunda üretilir. */
  build?: (params: ParamValues) => Solid;
  pluginId?: string;
  /** Arayüzde "Ekle" komutu / menü öğesi sunulmaz (kutu, silindir, küre: eskiz tabanlı akış tercih edilir). */
  hidden?: boolean;
}

export type HoleType = "simple" | "counterbore" | "countersink";
export interface HolePoint {
  /** Deliğin gövde yüzeyindeki merkezi (dünya koordinatı). */
  at: Vec3;
  /** Yüzeyin dışa bakan birim normali; delik bunun tersine (malzemeye doğru) açılır. */
  normal: Vec3;
}

export const HOLE_LABELS: Record<HoleType, string> = {
  simple: "Basit",
  counterbore: "Havşa (silindirik)",
  countersink: "Konik havşa",
};

/** Döndürme ekseni: eskizin dikey (V) / yatay (U) ekseni ya da eskizdeki bir çizgi (`line:<eğri kimliği>`). */
export type RevolveAxis = "U" | "V" | `line:${string}`;
export type WorldAxis = "X" | "Y" | "Z";
export type BodyOperation = "new" | "join" | "cut" | "intersect";
export type ExtrudeDirection = "one" | "symmetric";

export const AXIS_LABELS: Record<"U" | "V", string> = {
  V: "Dikey eksen (V)",
  U: "Yatay eksen (U)",
};

export const WORLD_AXIS_LABELS: Record<WorldAxis, string> = { X: "X ekseni", Y: "Y ekseni", Z: "Z ekseni" };

export const OPERATION_LABELS: Record<BodyOperation, string> = {
  new: "Yeni gövde",
  join: "Birleştir",
  cut: "Kes",
  intersect: "Kesiştir",
};

export const DIRECTION_LABELS: Record<ExtrudeDirection, string> = {
  one: "Tek yön",
  symmetric: "Simetrik (iki yana)",
};

const OPERATION_TO_BOOLEAN: Record<Exclude<BodyOperation, "new">, BooleanOp> = {
  join: "union",
  cut: "subtract",
  intersect: "intersect",
};

/** Yerleşik özelliklerin türleri ve görünen adları. */
export const FEATURE_LABELS = {
  sketch: "Eskiz",
  extrude: "Ekstrüzyon",
  revolve: "Döndürme",
  mirror: "Ayna",
  linearPattern: "Dikdörtgensel Desen",
  circularPattern: "Dairesel Desen",
  scale: "Ölçek",
  hole: "Delik",
  loft: "Loft",
  sweep: "Süpürme",
  rib: "Kaburga",
  move: "Taşı / Kopyala",
  split: "Gövdeyi Böl",
  stepBody: "STEP Gövdesi",
} as const;

export type BuiltinFeatureType = keyof typeof FEATURE_LABELS;

/** Özellik panelinde gösterilecek parametreler (delik türüne göre ilgisizler gizlenir). */
export function visibleParams(f: Pick<Feature, "type" | "holeType">): string[] | null {
  if (f.type !== "hole") return null;
  const base = ["diameter", "depth"];
  if (f.holeType === "counterbore") return [...base, "cbDiameter", "cbDepth"];
  if (f.holeType === "countersink") return [...base, "csDiameter", "csAngle"];
  return base;
}

/** Kaynak gövdenin kenarlarını / yüzlerini değiştiren B-rep özellikleri (OpenCascade çekirdeği gerekir). */
export const BREP_FEATURES = ["fillet", "chamfer", "shell", "draft"] as const;
export type BrepFeatureType = (typeof BREP_FEATURES)[number];

export const BREP_LABELS: Record<BrepFeatureType, string> = {
  fillet: "Yuvarlatma",
  chamfer: "Pah",
  shell: "Kabuk",
  draft: "Açılı Yüzey",
};

/** Açılı yüzeyin çekme yönü seçenekleri. */
export const PULL_DIRECTIONS: Record<string, { label: string; dir: Vec3 }> = {
  "+Z": { label: "Yukarı (+Z)", dir: [0, 0, 1] },
  "-Z": { label: "Aşağı (−Z)", dir: [0, 0, -1] },
  "+X": { label: "+X", dir: [1, 0, 0] },
  "-X": { label: "−X", dir: [-1, 0, 0] },
  "+Y": { label: "+Y", dir: [0, 1, 0] },
  "-Y": { label: "−Y", dir: [0, -1, 0] },
};

export function pullKey(dir: Vec3 | undefined): string {
  const d = dir ?? [0, 0, 1];
  return Object.entries(PULL_DIRECTIONS).find(([, v]) => v.dir.every((n, i) => n === d[i]))?.[0] ?? "+Z";
}

export function isBrepFeature(type: string): type is BrepFeatureType {
  return (BREP_FEATURES as readonly string[]).includes(type);
}

/** Bir gövdeyi girdi alan (kopyalayan / değiştiren) özellikler. */
export const BODY_FEATURES = ["mirror", "linearPattern", "circularPattern", "scale", "move", "split"] as const;
export type BodyFeatureType = (typeof BODY_FEATURES)[number];

/** Yerleşik (şekil olmayan) özelliklerin düzenlenebilir parametreleri. */
export const FEATURE_PARAMS: Record<string, Record<string, ParamSpec>> = {
  sketch: { offset: { label: "Düzlem ofseti", default: 0, step: 1 } },
  extrude: { distance: { label: "Mesafe (− ters yön)", default: 10, step: 1 } },
  revolve: { angle: { label: "Açı (°)", default: 360, min: 0.1, max: 360, step: 15 } },
  mirror: {},
  linearPattern: {
    countX: { label: "X adedi", default: 3, min: 1, max: 100, step: 1, integer: true },
    spacingX: { label: "X aralığı", default: 30, step: 1 },
    countY: { label: "Y adedi", default: 1, min: 1, max: 100, step: 1, integer: true },
    spacingY: { label: "Y aralığı", default: 30, step: 1 },
    countZ: { label: "Z adedi", default: 1, min: 1, max: 100, step: 1, integer: true },
    spacingZ: { label: "Z aralığı", default: 30, step: 1 },
  },
  circularPattern: {
    count: { label: "Adet", default: 6, min: 1, max: 360, step: 1, integer: true },
    angle: { label: "Toplam açı (°)", default: 360, min: 0.1, max: 360, step: 15 },
  },
  scale: { factor: { label: "Ölçek oranı", default: 2, min: 0.001, max: 1000, step: 0.1 } },
  move: {
    dx: { label: "X kaydırma", default: 10, step: 1 },
    dy: { label: "Y kaydırma", default: 0, step: 1 },
    dz: { label: "Z kaydırma", default: 0, step: 1 },
    rx: { label: "X etrafında dönüş (°, dünya orijini)", default: 0, step: 15 },
    ry: { label: "Y etrafında dönüş (°, dünya orijini)", default: 0, step: 15 },
    rz: { label: "Z etrafında dönüş (°, dünya orijini)", default: 0, step: 15 },
    copy: { label: "Kopya bırak (1: evet, 0: taşı)", default: 0, min: 0, max: 1, step: 1, integer: true },
  },
  split: {
    offset: { label: "Düzlem ofseti", default: 0, step: 1 },
    keep: { label: "Tutulan taraf (1: düzlem normali yönü, 0: ters yön)", default: 1, min: 0, max: 1, step: 1, integer: true },
  },
  stepBody: {},
  rib: {
    thickness: { label: "Kalınlık", default: 2, min: 0.001, step: 0.5 },
    distance: { label: "Yükseklik (− ters yön)", default: 10, step: 1 },
  },
  loft: { ruled: { label: "Düz geçiş (1: düz, 0: yumuşak)", default: 0, min: 0, max: 1, step: 1, integer: true } },
  sweep: {},
  hole: {
    diameter: { label: "Çap", default: 8, min: 0.01, step: 0.5 },
    depth: { label: "Derinlik (0 = boydan boya)", default: 10, min: 0, step: 1 },
    cbDiameter: { label: "Havşa çapı", default: 14, min: 0.01, step: 0.5 },
    cbDepth: { label: "Havşa derinliği", default: 4, min: 0.01, step: 0.5 },
    csDiameter: { label: "Konik havşa çapı", default: 14, min: 0.01, step: 0.5 },
    csAngle: { label: "Konik havşa açısı (°)", default: 90, min: 10, max: 170, step: 5 },
  },
  fillet: { radius: { label: "Yarıçap", default: 2, min: 0.001, step: 0.5 } },
  chamfer: { distance: { label: "Mesafe", default: 2, min: 0.001, step: 0.5 } },
  shell: { thickness: { label: "Et kalınlığı", default: 2, min: 0.001, step: 0.5 } },
  draft: {
    angle: { label: "Açı (°)", default: 3, min: -45, max: 45, step: 0.5 },
    neutral: { label: "Nötr düzlem konumu (alttan)", default: 0, step: 1 },
  },
};

/** Bu özelliğin girdi olarak kullandığı (tükettiği) diğer özellikler. */
export function featureRefs(f: Feature): string[] {
  return [
    ...(f.operands ?? []),
    ...(f.sketch ? [f.sketch] : []),
    ...(f.sections ?? []),
    ...(f.path ? [f.path] : []),
    ...(f.target ? [f.target] : []),
    ...(f.source ? [f.source] : []),
  ];
}

/** Katı üretmeyen özellikler (sahneye çizgi olarak çizilir). */
export function isSolidFeature(f: Feature): boolean {
  return f.type !== "sketch";
}

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: "Birleşim",
  subtract: "Çıkarma",
  intersect: "Kesişim",
};

export const BUILTIN_PRIMITIVES: PrimitiveDef[] = [
  {
    type: "box",
    hidden: true,
    label: "Kutu",
    params: {
      width: { label: "Genişlik (X)", default: 20, min: 0.01, step: 1 },
      depth: { label: "Derinlik (Y)", default: 20, min: 0.01, step: 1 },
      height: { label: "Yükseklik (Z)", default: 20, min: 0.01, step: 1 },
    },
    build: (p) => ({ kind: "box", size: [p.width, p.depth, p.height] }),
  },
  {
    type: "cylinder",
    hidden: true,
    label: "Silindir",
    params: {
      radius: { label: "Yarıçap", default: 10, min: 0.01, step: 1 },
      height: { label: "Yükseklik", default: 20, min: 0.01, step: 1 },
      segments: { label: "Bölüm sayısı", default: 64, min: 3, max: 512, step: 1, integer: true },
    },
    build: (p) => ({ kind: "cylinder", radius: p.radius, height: p.height, segments: p.segments }),
  },
  {
    type: "sphere",
    hidden: true,
    label: "Küre",
    params: {
      radius: { label: "Yarıçap", default: 10, min: 0.01, step: 1 },
      segments: { label: "Bölüm sayısı", default: 48, min: 4, max: 256, step: 4, integer: true },
    },
    build: (p) => ({ kind: "sphere", radius: p.radius, segments: p.segments }),
  },
  {
    type: "torus",
    label: "Simit",
    params: {
      radius: { label: "Ana yarıçap (eksenden tüp merkezine)", default: 20, min: 0.01, step: 1 },
      tube: { label: "Tüp yarıçapı", default: 5, min: 0.01, step: 0.5 },
      segments: { label: "Bölüm sayısı", default: 64, min: 8, max: 256, step: 4, integer: true },
    },
    build: (p) => {
      if (!(p.tube < p.radius)) throw new Error("Simit: tüp yarıçapı ana yarıçaptan küçük olmalı");
      const ring = 32;
      const profile: Vec2[] = Array.from({ length: ring }, (_, i) => {
        const a = (2 * Math.PI * i) / ring;
        return [p.radius + p.tube * Math.cos(a), p.tube * Math.sin(a)];
      });
      return { kind: "revolve", polygons: [profile], angle: 360, segments: p.segments };
    },
  },
  {
    type: "pipe",
    label: "Boru",
    params: {
      outer: { label: "Dış yarıçap", default: 10, min: 0.01, step: 1 },
      wall: { label: "Et kalınlığı", default: 2, min: 0.01, step: 0.5 },
      height: { label: "Yükseklik", default: 30, min: 0.01, step: 1 },
      segments: { label: "Bölüm sayısı", default: 64, min: 3, max: 512, step: 4, integer: true },
    },
    build: (p) => {
      if (!(p.wall < p.outer)) throw new Error("Boru: et kalınlığı dış yarıçaptan küçük olmalı");
      const inner = p.outer - p.wall;
      return {
        kind: "revolve",
        polygons: [[[inner, 0], [p.outer, 0], [p.outer, p.height], [inner, p.height]]],
        angle: 360,
        segments: p.segments,
      };
    },
  },
  {
    type: "coil",
    label: "Helis (Yay)",
    params: {
      radius: { label: "Helis yarıçapı (eksenden tel merkezine)", default: 10, min: 0.01, step: 1 },
      wire: { label: "Tel yarıçapı", default: 1, min: 0.01, step: 0.25 },
      pitch: { label: "Adım (tur başına yükseklik)", default: 5, min: 0.02, step: 0.5 },
      turns: { label: "Tur sayısı", default: 5, min: 0.1, max: 200, step: 0.5 },
      segments: { label: "Tur başına bölüm", default: 48, min: 8, max: 256, step: 8, integer: true },
    },
    build: (p) => {
      if (!(p.wire < p.radius)) throw new Error("Helis: tel yarıçapı helis yarıçapından küçük olmalı");
      if (!(p.pitch > 2 * p.wire)) throw new Error(`Helis: adım, tel çapından (${(2 * p.wire).toFixed(2)}) büyük olmalı; yoksa sarımlar birbirine girer`);
      return { kind: "coil", radius: p.radius, wire: p.wire, pitch: p.pitch, turns: p.turns, segments: p.segments };
    },
  },
];

/** Yerleşik ve eklenti şekil türlerinin kaydı. */
export class PrimitiveRegistry {
  private defs = new Map<string, PrimitiveDef>();

  constructor(defs: PrimitiveDef[] = BUILTIN_PRIMITIVES) {
    defs.forEach((d) => this.register(d));
  }

  register(def: PrimitiveDef): void {
    if (this.defs.has(def.type)) throw new Error(`Şekil türü zaten kayıtlı: ${def.type}`);
    this.defs.set(def.type, def);
  }

  unregisterPlugin(pluginId: string): void {
    for (const [type, def] of this.defs) if (def.pluginId === pluginId) this.defs.delete(type);
  }

  get(type: string): PrimitiveDef | undefined {
    return this.defs.get(type);
  }

  list(): PrimitiveDef[] {
    return [...this.defs.values()];
  }
}

export function defaultParams(def: PrimitiveDef): ParamValues {
  const out: ParamValues = {};
  for (const [name, spec] of Object.entries(def.params)) out[name] = spec.default;
  return out;
}

/** Parametreyi tanımındaki sınırlara çeker; geçersiz değerde varsayılana döner. */
export function clampParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  let v = value;
  if (spec.integer) v = Math.round(v);
  if (spec.min !== undefined) v = Math.max(spec.min, v);
  if (spec.max !== undefined) v = Math.min(spec.max, v);
  return v;
}

function withTransform(feature: Feature, solid: Solid): Solid {
  const [px, py, pz] = feature.position;
  const [rx, ry, rz] = feature.rotation;
  const hasRot = rx !== 0 || ry !== 0 || rz !== 0;
  const hasPos = px !== 0 || py !== 0 || pz !== 0;
  if (!hasRot && !hasPos) return solid;
  return {
    kind: "transform",
    ...(hasPos ? { translate: [px, py, pz] as Vec3 } : {}),
    ...(hasRot ? { rotate: [rx, ry, rz] as Vec3 } : {}),
    child: solid,
  };
}

/**
 * Bir özelliği geometri tarifine çevirir. Boolean özellikleri işlenenlerini
 * özyinelemeli olarak içerir. Yerleşik olmayan türler kayıtlı `solid`ı kullanır.
 */
export function featureSolid(
  feature: Feature,
  byId: Map<string, Feature>,
  registry: PrimitiveRegistry,
  visiting: Set<string> = new Set(),
): Solid {
  if (visiting.has(feature.id)) throw new Error(`Döngüsel bağımlılık: ${feature.name}`);
  visiting.add(feature.id);
  try {
    let base: Solid;
    if (feature.type === "sketch") {
      throw new Error(`${feature.name}: eskiz bir katı değildir; önce Ekstrüzyon ya da Döndürme uygulayın`);
    } else if (["extrude", "revolve", "rib", "loft", "sweep"].includes(feature.type)) {
      base = feature.type === "loft" || feature.type === "sweep" ? sectionFeatureSolid(feature, byId) : sketchFeatureSolid(feature, byId);
      const op = feature.operation ?? "new";
      if (op !== "new") {
        const target = feature.target ? byId.get(feature.target) : undefined;
        if (!target) throw new Error(`${feature.name}: ${OPERATION_LABELS[op]} için hedef gövde seçin`);
        base = { kind: "boolean", op: OPERATION_TO_BOOLEAN[op], children: [featureSolid(target, byId, registry, visiting), base] };
      }
    } else if ((BODY_FEATURES as readonly string[]).includes(feature.type)) {
      const source = feature.source ? byId.get(feature.source) : undefined;
      if (!source) throw new Error(`${feature.name}: kaynak gövde bulunamadı`);
      base = bodyFeatureSolid(feature, featureSolid(source, byId, registry, visiting));
    } else if (feature.type === "stepBody") {
      if (!feature.stepData) throw new Error(`${feature.name}: STEP verisi yok`);
      base = { kind: "step", hash: stepHash(feature.stepData) };
    } else if (feature.type === "hole") {
      const source = feature.source ? byId.get(feature.source) : undefined;
      if (!source) throw new Error(`${feature.name}: kaynak gövde bulunamadı`);
      base = holeSolid(feature, featureSolid(source, byId, registry, visiting));
    } else if (isBrepFeature(feature.type)) {
      const source = feature.source ? byId.get(feature.source) : undefined;
      if (!source) throw new Error(`${feature.name}: kaynak gövde bulunamadı`);
      base = brepFeatureSolid(feature, featureSolid(source, byId, registry, visiting));
    } else if (feature.type === "boolean") {
      if (!feature.op || !feature.operands) throw new Error(`${feature.name}: eksik boolean bilgisi`);
      const children = feature.operands.map((id) => {
        const child = byId.get(id);
        if (!child) throw new Error(`${feature.name}: işlenen bulunamadı (${id})`);
        return featureSolid(child, byId, registry, visiting);
      });
      base = { kind: "boolean", op: feature.op, children };
    } else {
      const def = registry.get(feature.type);
      if (def?.build) {
        base = def.build(feature.params);
      } else if (feature.solid) {
        base = feature.solid;
      } else {
        throw new Error(`${feature.name}: "${feature.type}" türü için eklenti yüklü değil`);
      }
    }
    return withTransform(feature, base);
  } finally {
    visiting.delete(feature.id);
  }
}

/** Eskizin geometrisi (eski dosyalarda öğelerden çevrilir). */
export function sketchDataOf(f: Feature): SketchData {
  return f.sketchData ?? fromLegacyEntities(f.entities ?? []);
}

function profilesOf(feature: Feature, byId: Map<string, Feature>): { sketch: Feature; profiles: Vec2[][]; loops: Loop[] } {
  const sketch = feature.sketch ? byId.get(feature.sketch) : undefined;
  if (!sketch || sketch.type !== "sketch") throw new Error(`${feature.name}: eskiz bulunamadı`);
  const data = sketchDataOf(sketch);
  if (feature.type === "rib") {
    // Kaburga: açık yol kalınlaştırılıp kapalı profile çevrilir.
    const chain = sketchDataChain(data);
    if (!chain) throw new Error(`${feature.name}: "${sketch.name}" tek parça, açık bir yol içermeli (uç uca bağlı çizgi / yay)`);
    const thickness = feature.params.thickness ?? 0;
    if (!(thickness > 0)) throw new Error(`${feature.name}: kalınlık pozitif olmalı`);
    return { sketch, profiles: [thickenChain(chain, thickness)], loops: [] };
  }
  const profiles = sketchDataProfiles(data);
  const loops = sketchDataLoops(data);
  if (profiles.length === 0) {
    throw new Error(`${feature.name}: "${sketch.name}" içinde kapalı şekil yok (dikdörtgen, daire ya da kapatılmış çizgi çizin)`);
  }
  return { sketch, profiles, loops };
}

/** Profil eğrilerinin (kesin hâli) noktalarını dönüştürür (örn. eksen değişimi, aynalama). */
function mapLoops(loops: Loop[], f: (p: Vec2) => Vec2): Loop[] {
  return loops.map((l) =>
    "circle" in l
      ? { circle: { c: f(l.circle.c), r: l.circle.r } }
      : { from: f(l.from), segs: l.segs.map((s) => ({ to: f(s.to), ...(s.via ? { via: f(s.via) } : {}) })) },
  );
}

// Döndürme sonucunu (manifold: profil x → yarıçap, y → Z) eskizin yerel (u, v, n) eksenlerine taşır.
const REVOLVE_V_TO_LOCAL = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const REVOLVE_U_TO_LOCAL = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

const MIRROR_MATRICES: Record<PlaneName, number[]> = {
  XY: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  XZ: [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  YZ: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

const hashMemo = new Map<string, string>();

/** STEP metninin karması (büyük metin her yeniden hesaplamada tekrar taranmasın diye birkaç sonuç hatırlanır). */
export function stepHash(text: string): string {
  let h = hashMemo.get(text);
  if (!h) {
    h = textHash(text);
    if (hashMemo.size >= 8) hashMemo.delete(hashMemo.keys().next().value as string);
    hashMemo.set(text, h);
  }
  return h;
}

/** Belgedeki STEP gövdelerinin karma → metin tablosu (OpenCascade işçisine gönderilir). */
export function stepAssets(features: readonly Feature[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of features) if (f.type === "stepBody" && f.stepData) out[stepHash(f.stepData)] = f.stepData;
  return out;
}

/** Gövdeyi Böl: silinen yarı uzayı temsil eden kutunun yarı boyutu (mm). */
const SPLIT_EXTENT = 10000;
/** "Boydan boya" deliklerin uzunluğu (mm). */
const THROUGH_LENGTH = 10000;
/** Delik silindirinin yüzeyden dışarı taştığı pay: yüzeyde ince bir zar kalmasın. */
const HOLE_OVERSHOOT = 0.01;

/** Deliğin yarıçap–derinlik kesiti (x: yarıçap, y: yüzeyden aşağı negatif); eksen etrafında döndürülür. */
export function holeProfile(feature: Pick<Feature, "name" | "params" | "holeType">): Vec2[] {
  const p = feature.params;
  const r = (p.diameter ?? 0) / 2;
  if (!(r > 0)) throw new Error(`${feature.name}: delik çapı pozitif olmalı`);
  const depth = p.depth > 0 ? p.depth : THROUGH_LENGTH;
  const top = HOLE_OVERSHOOT;
  const type = feature.holeType ?? "simple";
  if (type === "counterbore") {
    const R = (p.cbDiameter ?? 0) / 2;
    if (!(R > r)) throw new Error(`${feature.name}: havşa çapı delik çapından büyük olmalı`);
    if (!(p.cbDepth > 0 && p.cbDepth < depth)) throw new Error(`${feature.name}: havşa derinliği 0 ile delik derinliği arasında olmalı`);
    return [[0, top], [R, top], [R, -p.cbDepth], [r, -p.cbDepth], [r, -depth], [0, -depth]];
  }
  if (type === "countersink") {
    const R = (p.csDiameter ?? 0) / 2;
    if (!(R > r)) throw new Error(`${feature.name}: konik havşa çapı delik çapından büyük olmalı`);
    const tan = Math.tan(((p.csAngle ?? 90) / 2) * (Math.PI / 180));
    const cone = (R - r) / tan;
    if (!(cone < depth)) throw new Error(`${feature.name}: delik derinliği konik havşadan (${cone.toFixed(2)} mm) büyük olmalı`);
    return [[0, top], [R + top * tan, top], [r, -cone], [r, -depth], [0, -depth]];
  }
  return [[0, top], [r, top], [r, -depth], [0, -depth]];
}

/** z ekseni `n` olan, `at` noktasında duran 4×4 (sütun öncelikli) yerleştirme matrisi. */
export function placeMatrix(at: Vec3, n: Vec3): number[] {
  const len = Math.hypot(...n) || 1;
  const z: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  const helper: Vec3 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const ul = cross(helper, z);
  const l = Math.hypot(...ul) || 1;
  const x: Vec3 = [ul[0] / l, ul[1] / l, ul[2] / l];
  const y = cross(z, x);
  return [...x, 0, ...y, 0, ...z, 0, ...at, 1];
}

/** Delik: kaynak gövdeden, her konumda yerleştirilmiş delik profilinin dönel gövdesi çıkarılır. */
function holeSolid(feature: Feature, child: Solid): Solid {
  if (!feature.holes?.length) throw new Error(`${feature.name}: delik konumu seçilmemiş`);
  const profile = holeProfile(feature);
  const cutter = (h: HolePoint): Solid => ({
    kind: "transform",
    matrix: placeMatrix(h.at, h.normal),
    child: { kind: "revolve", polygons: [profile], angle: 360, segments: 96, fillRule: "EvenOdd" },
  });
  return { kind: "boolean", op: "subtract", children: [child, ...feature.holes.map(cutter)] };
}

/** Yuvarlatma, pah, kabuk: kaynak gövdenin seçilen kenar / yüzlerine B-rep işlemi. */
function brepFeatureSolid(feature: Feature, child: Solid): Solid {
  const p = feature.params;
  switch (feature.type as BrepFeatureType) {
    case "fillet":
    case "chamfer": {
      if (!feature.edges?.length) throw new Error(`${feature.name}: kenar seçilmemiş`);
      const value = (feature.type === "fillet" ? p.radius : p.distance) ?? 0;
      if (!(value > 0)) throw new Error(`${feature.name}: ${feature.type === "fillet" ? "yarıçap" : "mesafe"} pozitif olmalı`);
      return feature.type === "fillet"
        ? { kind: "fillet", child, radius: value, edges: feature.edges }
        : { kind: "chamfer", child, distance: value, edges: feature.edges };
    }
    case "draft": {
      if (!feature.faces?.length) throw new Error(`${feature.name}: eğim verilecek yüz seçilmemiş`);
      if (!p.angle) throw new Error(`${feature.name}: açı sıfır olamaz`);
      return { kind: "draft", child, angle: p.angle, faces: feature.faces, pull: feature.pull ?? [0, 0, 1], neutral: p.neutral ?? 0 };
    }
    case "shell": {
      if (!feature.faces?.length) throw new Error(`${feature.name}: açılacak yüz seçilmemiş`);
      if (!(p.thickness > 0)) throw new Error(`${feature.name}: et kalınlığı pozitif olmalı`);
      return { kind: "shell", child, thickness: p.thickness, faces: feature.faces };
    }
  }
}

/** Ayna, desen ve ölçek: kaynak gövdenin dönüştürülmüş kopyaları. */
function bodyFeatureSolid(feature: Feature, child: Solid): Solid {
  const p = feature.params;
  const union = (children: Solid[]): Solid => (children.length === 1 ? children[0] : { kind: "boolean", op: "union", children });
  switch (feature.type as BodyFeatureType) {
    case "mirror":
      return union([child, { kind: "transform", matrix: MIRROR_MATRICES[feature.plane ?? "YZ"], child }]);
    case "scale": {
      const f = p.factor ?? 1;
      if (!(f > 0)) throw new Error(`${feature.name}: ölçek oranı pozitif olmalı`);
      return { kind: "transform", matrix: [f, 0, 0, 0, 0, f, 0, 0, 0, 0, f, 0, 0, 0, 0, 1], child };
    }
    case "move": {
      const rotate: Vec3 = [p.rx ?? 0, p.ry ?? 0, p.rz ?? 0];
      const translate: Vec3 = [p.dx ?? 0, p.dy ?? 0, p.dz ?? 0];
      const moved: Solid = {
        kind: "transform",
        ...(rotate.some((v) => v !== 0) ? { rotate } : {}),
        ...(translate.some((v) => v !== 0) ? { translate } : {}),
        child,
      };
      return (p.copy ?? 0) >= 1 ? union([child, moved]) : moved;
    }
    case "split": {
      const plane = feature.plane ?? "XY";
      if (!(plane in PLANES)) throw new Error(`${feature.name}: bilinmeyen düzlem ${plane}`);
      const keepPositive = (p.keep ?? 1) >= 1;
      // Düzlemin silinecek yanındaki dev bir kutu: yerel +Z yönü düzlem normalidir.
      const cutter: Solid = {
        kind: "transform",
        matrix: planeMatrix(plane, p.offset ?? 0),
        child: { kind: "transform", translate: [0, 0, keepPositive ? -SPLIT_EXTENT : 0], child: { kind: "box", size: [2 * SPLIT_EXTENT, 2 * SPLIT_EXTENT, SPLIT_EXTENT] } },
      };
      return { kind: "boolean", op: "subtract", children: [child, cutter] };
    }
    case "linearPattern": {
      const copies: Solid[] = [];
      const [nx, ny, nz] = [p.countX ?? 1, p.countY ?? 1, p.countZ ?? 1].map((n) => Math.max(1, Math.round(n)));
      if (nx * ny * nz > 1000) throw new Error(`${feature.name}: en fazla 1000 kopya`);
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          for (let k = 0; k < nz; k++) {
            const t: Vec3 = [i * (p.spacingX ?? 0), j * (p.spacingY ?? 0), k * (p.spacingZ ?? 0)];
            copies.push(i + j + k === 0 ? child : { kind: "transform", translate: t, child });
          }
      return union(copies);
    }
    case "circularPattern": {
      const n = Math.max(1, Math.round(p.count ?? 1));
      const total = p.angle ?? 360;
      // Tam turda son kopya ilkinin üstüne gelmesin; kısmi açıda iki uç da dolu.
      const step = total >= 360 ? 360 / n : n > 1 ? total / (n - 1) : 0;
      const axis = feature.worldAxis ?? "Z";
      const copies: Solid[] = [];
      for (let i = 0; i < n; i++) {
        const a = step * i;
        const rotate: Vec3 = [axis === "X" ? a : 0, axis === "Y" ? a : 0, axis === "Z" ? a : 0];
        copies.push(i === 0 ? child : { kind: "transform", rotate, child });
      }
      return union(copies);
    }
  }
}

function sketchSection(sketch: Feature | undefined, owner: Feature, what: string): { sketch: Feature; section: (loop: Loop) => Section } {
  if (!sketch || sketch.type !== "sketch") throw new Error(`${owner.name}: ${what} eskizi bulunamadı`);
  const matrix = planeMatrix(sketch.frame ?? sketch.plane ?? "XY", sketch.params.offset ?? 0);
  return { sketch, section: (loop) => ({ matrix, loop }) };
}

/** Loft (sıralı kapalı kesitler) ve süpürme (profil + yol) katıları. */
function sectionFeatureSolid(feature: Feature, byId: Map<string, Feature>): Solid {
  const closed = (sketch: Feature, owner: Feature): Loop => {
    const loops = sketchDataLoops(sketchDataOf(sketch));
    if (loops.length !== 1) {
      throw new Error(`${owner.name}: "${sketch.name}" tek bir kapalı şekil içermeli (${loops.length ? `${loops.length} tane var` : "kapalı şekil yok"})`);
    }
    return loops[0];
  };
  if (feature.type === "loft") {
    const ids = feature.sections ?? [];
    if (ids.length < 2) throw new Error(`${feature.name}: loft için en az iki kesit eskizi gerekir`);
    const sections = ids.map((id) => {
      const { sketch, section } = sketchSection(byId.get(id), feature, "kesit");
      return section(closed(sketch, feature));
    });
    return { kind: "loft", sections, ruled: (feature.params.ruled ?? 0) >= 1 };
  }
  const profile = sketchSection(feature.sketch ? byId.get(feature.sketch) : undefined, feature, "profil");
  const path = sketchSection(feature.path ? byId.get(feature.path) : undefined, feature, "yol");
  const chain = sketchDataChain(sketchDataOf(path.sketch));
  if (!chain) throw new Error(`${feature.name}: "${path.sketch.name}" tek parça, açık bir yol olmalı (uç uca bağlı çizgi / yay)`);
  return { kind: "sweep", profile: profile.section(closed(profile.sketch, feature)), path: path.section(chain) };
}

/** Eskizden ekstrüzyon / döndürme katısı. Eskiz içinde iç içe şekiller delik açar. */
function sketchFeatureSolid(feature: Feature, byId: Map<string, Feature>): Solid {
  const { sketch, profiles, loops } = profilesOf(feature, byId);
  const plane = sketch.plane ?? "XY";
  if (!(plane in PLANES)) throw new Error(`${sketch.name}: bilinmeyen düzlem ${plane}`);
  let local: Solid;
  if (feature.type === "extrude" || feature.type === "rib") {
    const distance = feature.params.distance ?? 10;
    if (!Number.isFinite(distance) || distance === 0) throw new Error(`${feature.name}: mesafe sıfır olamaz`);
    local = { kind: "extrude", polygons: profiles, height: Math.abs(distance), fillRule: "EvenOdd", loops };
    const shift = feature.direction === "symmetric" ? -Math.abs(distance) / 2 : Math.min(0, distance);
    if (shift !== 0) local = { kind: "transform", translate: [0, 0, shift], child: local };
  } else {
    const axis = feature.axis ?? "V";
    // Manifold Y ekseni etrafında döndürür; U ekseni için profilin eksenleri yer değiştirir.
    const swap = (p: Vec2): Vec2 => [p[1], p[0]];
    const flip = (p: Vec2): Vec2 => [-p[0], p[1]];
    let back: number[] | null = null;
    let polys = axis === "V" ? profiles : profiles.map((p) => p.map(swap).reverse());
    let exact = axis === "V" ? loops : mapLoops(loops, swap);
    if (axis.startsWith("line:")) {
      // Eksen eskizdeki bir çizgi: profil, çizgi +v (dikey) ekseni olacak şekilde kaydırılıp döndürülür; sonuç geri taşınır.
      const data = sketchDataOf(sketch);
      const curve = data.curves.find((c) => c.id === axis.slice(5));
      if (!curve || curve.kind !== "line") throw new Error(`${feature.name}: eksen çizgisi bulunamadı (silinmiş olabilir)`);
      const pm = pointMap(data);
      const p0 = pm.get(curve.p1)!;
      const p1 = pm.get(curve.p2)!;
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (!(len > 1e-9)) throw new Error(`${feature.name}: eksen çizgisinin uzunluğu sıfır`);
      const dx = (p1[0] - p0[0]) / len;
      const dy = (p1[1] - p0[1]) / len;
      // Çizgi yönü d → (0, 1): R(p − p0), R = [[dy, −dx], [dx, dy]]
      const toAxis = (p: Vec2): Vec2 => {
        const x = p[0] - p0[0];
        const y = p[1] - p0[1];
        return [dy * x - dx * y, dx * x + dy * y];
      };
      polys = profiles.map((p) => p.map(toAxis));
      exact = mapLoops(loops, toAxis);
      // Geri dönüşüm: canlı (0,1) → d ve başlangıç p0 (yerel eskiz koordinatlarında, z değişmez).
      back = [dy, -dx, 0, 0, dx, dy, 0, 0, 0, 0, 1, 0, p0[0], p0[1], 0, 1];
    }
    // Profil tamamen eksenin öbür tarafındaysa aynala (kullanıcı hangi tarafa çizerse çizsin çalışsın).
    if (Math.max(...polys.flat().map((p) => p[0])) <= 0) {
      polys = polys.map((p) => p.map(flip).reverse());
      exact = mapLoops(exact, flip);
    }
    local = {
      kind: "transform",
      matrix: axis === "U" ? REVOLVE_U_TO_LOCAL : REVOLVE_V_TO_LOCAL,
      child: { kind: "revolve", polygons: polys, angle: feature.params.angle ?? 360, segments: 96, fillRule: "EvenOdd", loops: exact },
    };
    if (back) local = { kind: "transform", matrix: back, child: local };
  }
  return { kind: "transform", matrix: planeMatrix(sketch.frame ?? plane, sketch.params.offset ?? 0), child: local };
}
