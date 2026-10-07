import { PLANES, planeMatrix, sketchProfiles, type PlaneName, type SketchEntity } from "./sketch";
import type { BooleanOp, Solid, Vec2, Vec3 } from "./solid";

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
  /** Eskiz: düzlem ve çizilen öğeler. */
  plane?: PlaneName;
  entities?: SketchEntity[];
  /** Ekstrüzyon / döndürme: kullanılan eskizin kimliği. */
  sketch?: string;
  /** Döndürme ekseni: eskizin dikey (V) ya da yatay (U) ekseni. */
  axis?: RevolveAxis;
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

export const AXIS_LABELS: Record<RevolveAxis, string> = {
  V: "Dikey eksen (V)",
  U: "Yatay eksen (U)",
};

/** Eskiz tabanlı özelliklerin türleri ve görünen adları. */
export const SKETCH_FEATURE_LABELS = {
  sketch: "Eskiz",
  extrude: "Ekstrüzyon",
  revolve: "Döndürme",
} as const;

/** Yerleşik (şekil olmayan) özelliklerin düzenlenebilir parametreleri. */
export const FEATURE_PARAMS: Record<string, Record<string, ParamSpec>> = {
  sketch: { offset: { label: "Düzlem ofseti", default: 0, step: 1 } },
  extrude: { distance: { label: "Mesafe (− ters yön)", default: 10, step: 1 } },
  revolve: { angle: { label: "Açı (°)", default: 360, min: 0.1, max: 360, step: 15 } },
};

/** Bu özelliğin girdi olarak kullandığı (tükettiği) diğer özellikler. */
export function featureRefs(f: Feature): string[] {
  return [...(f.operands ?? []), ...(f.sketch ? [f.sketch] : [])];
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

function profilesOf(feature: Feature, byId: Map<string, Feature>): { sketch: Feature; profiles: Vec2[][] } {
  const sketch = feature.sketch ? byId.get(feature.sketch) : undefined;
  if (!sketch || sketch.type !== "sketch") throw new Error(`${feature.name}: eskiz bulunamadı`);
  const profiles = sketchProfiles(sketch.entities ?? []);
  if (profiles.length === 0) {
    throw new Error(`${feature.name}: "${sketch.name}" içinde kapalı şekil yok (dikdörtgen, daire ya da kapatılmış çizgi çizin)`);
  }
  return { sketch, profiles };
}

// Döndürme sonucunu (manifold: profil x → yarıçap, y → Z) eskizin yerel (u, v, n) eksenlerine taşır.
const REVOLVE_V_TO_LOCAL = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const REVOLVE_U_TO_LOCAL = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

/** Eskizden ekstrüzyon / döndürme katısı. Eskiz içinde iç içe şekiller delik açar. */
function sketchFeatureSolid(feature: Feature, byId: Map<string, Feature>): Solid {
  const { sketch, profiles } = profilesOf(feature, byId);
  const plane = sketch.plane ?? "XY";
  if (!(plane in PLANES)) throw new Error(`${sketch.name}: bilinmeyen düzlem ${plane}`);
  let local: Solid;
  if (feature.type === "extrude") {
    const distance = feature.params.distance ?? 10;
    if (!Number.isFinite(distance) || distance === 0) throw new Error(`${feature.name}: mesafe sıfır olamaz`);
    local = { kind: "extrude", polygons: profiles, height: Math.abs(distance), fillRule: "EvenOdd" };
    if (distance < 0) local = { kind: "transform", translate: [0, 0, distance], child: local };
  } else {
    const axis = feature.axis ?? "V";
    // Manifold Y ekseni etrafında döndürür; U ekseni için profilin eksenleri yer değiştirir.
    let polys = axis === "V" ? profiles : profiles.map((p) => p.map(([a, b]) => [b, a] as Vec2).reverse());
    // Profil tamamen eksenin öbür tarafındaysa aynala (kullanıcı hangi tarafa çizerse çizsin çalışsın).
    if (Math.max(...polys.flat().map((p) => p[0])) <= 0) polys = polys.map((p) => p.map(([a, b]) => [-a, b] as Vec2).reverse());
    local = {
      kind: "transform",
      matrix: axis === "V" ? REVOLVE_V_TO_LOCAL : REVOLVE_U_TO_LOCAL,
      child: { kind: "revolve", polygons: polys, angle: feature.params.angle ?? 360, segments: 96, fillRule: "EvenOdd" },
    };
  }
  return { kind: "transform", matrix: planeMatrix(plane, sketch.params.offset ?? 0), child: local };
}
