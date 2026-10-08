import { PLANES, planeMatrix, type PlaneName, type SketchEntity } from "./sketch";
import { fromLegacyEntities, sketchDataLoops, sketchDataProfiles, type SketchData } from "./sketchmodel";
import type { BooleanOp, EdgeRef, FaceRef, Loop, Solid, Vec2, Vec3 } from "./solid";

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
  position: Vec3;
  /** Derece cinsinden X, Y, Z dönüşü. */
  rotation: Vec3;
  /** Sadece boolean özellikleri için. */
  op?: BooleanOp;
  operands?: [string, string];
  /** Eskiz: düzlem ve geometri (noktalar, eğriler, kısıtlar). */
  plane?: PlaneName;
  sketchData?: SketchData;
  /** Eski (v1) dosyalardaki eskiz öğeleri; açılırken `sketchData`'ya çevrilir. */
  entities?: SketchEntity[];
  /** Ekstrüzyon / döndürme: kullanılan eskizin kimliği. */
  sketch?: string;
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
}

export type RevolveAxis = "U" | "V";
export type WorldAxis = "X" | "Y" | "Z";
export type BodyOperation = "new" | "join" | "cut" | "intersect";
export type ExtrudeDirection = "one" | "symmetric";

export const AXIS_LABELS: Record<RevolveAxis, string> = {
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
} as const;

export type BuiltinFeatureType = keyof typeof FEATURE_LABELS;

/** Kaynak gövdenin kenarlarını / yüzlerini değiştiren B-rep özellikleri (OpenCascade çekirdeği gerekir). */
export const BREP_FEATURES = ["fillet", "chamfer", "shell"] as const;
export type BrepFeatureType = (typeof BREP_FEATURES)[number];

export const BREP_LABELS: Record<BrepFeatureType, string> = {
  fillet: "Yuvarlatma",
  chamfer: "Pah",
  shell: "Kabuk",
};

export function isBrepFeature(type: string): type is BrepFeatureType {
  return (BREP_FEATURES as readonly string[]).includes(type);
}

/** Bir gövdeyi girdi alan (kopyalayan / değiştiren) özellikler. */
export const BODY_FEATURES = ["mirror", "linearPattern", "circularPattern", "scale"] as const;
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
  fillet: { radius: { label: "Yarıçap", default: 2, min: 0.001, step: 0.5 } },
  chamfer: { distance: { label: "Mesafe", default: 2, min: 0.001, step: 0.5 } },
  shell: { thickness: { label: "Et kalınlığı", default: 2, min: 0.001, step: 0.5 } },
};

/** Bu özelliğin girdi olarak kullandığı (tükettiği) diğer özellikler. */
export function featureRefs(f: Feature): string[] {
  return [
    ...(f.operands ?? []),
    ...(f.sketch ? [f.sketch] : []),
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
    label: "Küre",
    params: {
      radius: { label: "Yarıçap", default: 10, min: 0.01, step: 1 },
      segments: { label: "Bölüm sayısı", default: 48, min: 4, max: 256, step: 4, integer: true },
    },
    build: (p) => ({ kind: "sphere", radius: p.radius, segments: p.segments }),
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
    } else if (feature.type === "extrude" || feature.type === "revolve") {
      base = sketchFeatureSolid(feature, byId);
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

/** Eskizden ekstrüzyon / döndürme katısı. Eskiz içinde iç içe şekiller delik açar. */
function sketchFeatureSolid(feature: Feature, byId: Map<string, Feature>): Solid {
  const { sketch, profiles, loops } = profilesOf(feature, byId);
  const plane = sketch.plane ?? "XY";
  if (!(plane in PLANES)) throw new Error(`${sketch.name}: bilinmeyen düzlem ${plane}`);
  let local: Solid;
  if (feature.type === "extrude") {
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
    let polys = axis === "V" ? profiles : profiles.map((p) => p.map(swap).reverse());
    let exact = axis === "V" ? loops : mapLoops(loops, swap);
    // Profil tamamen eksenin öbür tarafındaysa aynala (kullanıcı hangi tarafa çizerse çizsin çalışsın).
    if (Math.max(...polys.flat().map((p) => p[0])) <= 0) {
      polys = polys.map((p) => p.map(flip).reverse());
      exact = mapLoops(exact, flip);
    }
    local = {
      kind: "transform",
      matrix: axis === "V" ? REVOLVE_V_TO_LOCAL : REVOLVE_U_TO_LOCAL,
      child: { kind: "revolve", polygons: polys, angle: feature.params.angle ?? 360, segments: 96, fillRule: "EvenOdd", loops: exact },
    };
  }
  return { kind: "transform", matrix: planeMatrix(plane, sketch.params.offset ?? 0), child: local };
}
