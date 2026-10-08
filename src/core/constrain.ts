/**
 * Seçimden kısıt ve ölçü kurma kuralları (saf mantık). Arayüz, seçili öğe kimliklerini (sırasıyla)
 * verir; burası hangi kısıtların ekleneceğini ya da neden eklenemeyeceğini söyler.
 */
import {
  CONSTRAINT_LABELS,
  arcInfo,
  curveById,
  pointMap,
  type DimensionType,
  type GeometricConstraintType,
  type SConstraint,
  type SCurve,
  type SketchData,
} from "./sketchmodel";
import type { Vec2 } from "./solid";

export interface PlannedConstraint {
  type: GeometricConstraintType;
  refs: string[];
  at?: Vec2;
}

export interface ConstraintPlan {
  add: PlannedConstraint[];
  /** Kaldırılacak mevcut kısıt kimlikleri (ör. "Sabit"i geri alma). */
  remove: string[];
}

const isPoint = (id: string) => id.startsWith("p");
const isCurveId = (id: string) => id.startsWith("c");

function kindOf(d: SketchData, id: string): "point" | SCurve["kind"] | null {
  if (isPoint(id)) return d.points.some((p) => p.id === id) ? "point" : null;
  return curveById(d, id)?.kind ?? null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** Aynı türde ve aynı öğelere bağlı kısıt zaten var mı? (öğelerin sırası önemsiz) */
export function hasConstraint(d: SketchData, type: string, refs: string[]): boolean {
  return d.constraints.some((k) => k.type === type && sameSet(k.refs, refs));
}

/** Eğrinin kullandığı noktalar (sabitleme için). */
function pointsOf(c: SCurve): string[] {
  switch (c.kind) {
    case "line":
      return [c.p1, c.p2];
    case "circle":
    case "ellipse":
      return [c.c];
    case "arc":
      return [c.c, c.s, c.e];
    case "spline":
      return c.pts;
    case "point":
      return [c.p];
  }
}

function fail(type: GeometricConstraintType, why: string): never {
  throw new Error(`${CONSTRAINT_LABELS[type]}: ${why}`);
}

/**
 * Seçime uygulanacak kısıtları planlar. Uygun olmayan seçimde açıklayıcı bir hata fırlatır.
 * Zaten var olan kısıtlar tekrar eklenmez.
 */
export function planConstraint(d: SketchData, type: GeometricConstraintType, ids: string[]): ConstraintPlan {
  const items = ids.filter((id) => kindOf(d, id) !== null);
  if (!items.length) fail(type, "önce eskizde öğe seçin (araç yokken tıklayın, Ctrl ile çoklu seçim)");
  const kinds = items.map((id) => kindOf(d, id)!);
  const lines = items.filter((_, i) => kinds[i] === "line");
  const points = items.filter((_, i) => kinds[i] === "point");
  const radial = items.filter((_, i) => kinds[i] === "circle" || kinds[i] === "arc");
  const plan: ConstraintPlan = { add: [], remove: [] };
  const add = (t: GeometricConstraintType, refs: string[], at?: Vec2) => {
    if (!hasConstraint(d, t, refs)) plan.add.push({ type: t, refs, ...(at ? { at } : {}) });
  };

  switch (type) {
    case "horizontal":
    case "vertical":
      if (lines.length && lines.length === items.length) lines.forEach((l) => add(type, [l]));
      else if (points.length === 2 && items.length === 2) add(type, points);
      else fail(type, "çizgi(ler) ya da iki nokta seçin");
      break;
    case "coincident":
      if (items.length === 2 && points.length === 2) add(type, points);
      else if (items.length === 2 && points.length === 1) {
        const curve = items.find((id) => isCurveId(id))!;
        if (!["line", "circle", "arc"].includes(kindOf(d, curve)!)) fail(type, "nokta ile çizgi, daire ya da yay seçin");
        add("onCurve", [points[0], curve]);
      } else fail(type, "iki nokta (ya da nokta ve bir eğri) seçin");
      break;
    case "onCurve": {
      const curves = items.filter((id) => isCurveId(id) && ["line", "circle", "arc"].includes(kindOf(d, id)!));
      if (points.length === 1 && curves.length === 1 && items.length === 2) add(type, [points[0], curves[0]]);
      else fail(type, "bir nokta ve bir çizgi / daire / yay seçin");
      break;
    }
    case "parallel":
    case "perpendicular":
      if (lines.length < 2 || lines.length !== items.length) fail(type, "en az iki çizgi seçin");
      if (type === "perpendicular" && lines.length !== 2) fail(type, "tam iki çizgi seçin");
      for (let i = 0; i + 1 < lines.length; i++) add(type, [lines[i], lines[i + 1]]);
      break;
    case "equal": {
      const curves = items.filter((id) => isCurveId(id));
      if (curves.length < 2 || curves.length !== items.length) fail(type, "en az iki eğri seçin");
      const allLines = curves.every((id) => kindOf(d, id) === "line");
      const allRadial = curves.every((id) => ["circle", "arc"].includes(kindOf(d, id)!));
      if (!allLines && !allRadial) fail(type, "aynı türden (hepsi çizgi ya da hepsi daire / yay) eğriler seçin");
      for (let i = 1; i < curves.length; i++) add(type, [curves[0], curves[i]]);
      break;
    }
    case "tangent": {
      const curves = items.filter((id) => isCurveId(id));
      if (curves.length !== 2 || items.length !== 2) fail(type, "tam iki eğri seçin");
      const k = curves.map((id) => kindOf(d, id));
      const ok = k.every((x) => x === "line" || x === "circle" || x === "arc") && !(k[0] === "line" && k[1] === "line");
      if (!ok) fail(type, "çizgi / daire / yay seçin (iki çizgi teğet olamaz)");
      add(type, curves);
      break;
    }
    case "concentric":
      if (radial.length === 2 && items.length === 2) add(type, radial);
      else fail(type, "iki daire ya da yay seçin");
      break;
    case "midpoint": {
      if (points.length === 1 && lines.length === 1 && items.length === 2) add(type, [points[0], lines[0]]);
      else fail(type, "bir nokta ve bir çizgi seçin");
      break;
    }
    case "symmetric": {
      if (points.length === 2 && lines.length === 1 && items.length === 3) add(type, [points[0], points[1], lines[0]]);
      else fail(type, "iki nokta ve simetri çizgisi olarak bir çizgi seçin");
      break;
    }
    case "fix": {
      const pm = pointMap(d);
      const target = new Set<string>();
      for (const id of items) {
        if (isPoint(id)) target.add(id);
        else {
          const c = curveById(d, id);
          if (c) pointsOf(c).forEach((p) => target.add(p));
        }
      }
      const existing = d.constraints.filter((k) => k.type === "fix" && target.has(k.refs[0]));
      if (existing.length === target.size) {
        // Hepsi zaten sabit: kısıt geri alınır ("Sabit" aç / kapa).
        plan.remove.push(...existing.map((k) => k.id));
      } else {
        for (const id of target) if (!existing.some((k) => k.refs[0] === id)) add("fix", [id], pm.get(id)!);
      }
      break;
    }
  }
  return plan;
}

// ---- ölçüler ----

export interface DimensionChoice {
  type: DimensionType;
  refs: string[];
  /** Eskizdeki mevcut değer (mm ya da derece). */
  value: number;
}

/**
 * Seçilen öğeler için önerilen ölçü ve değiştirilebilecek diğer seçenekler (ilki öneridir).
 * Hiçbir ölçü uygun değilse hata fırlatır.
 */
export function planDimension(d: SketchData, ids: string[]): DimensionChoice[] {
  const items = ids.filter((id) => kindOf(d, id) !== null);
  const kinds = items.map((id) => kindOf(d, id)!);
  const mk = (type: DimensionType, refs: string[]): DimensionChoice => ({ type, refs, value: measureDimension(d, type, refs) ?? 0 });
  if (items.length === 1) {
    const c = curveById(d, items[0]);
    if (c?.kind === "line") return [mk("distance", [c.p1, c.p2]), mk("hdistance", [c.p1, c.p2]), mk("vdistance", [c.p1, c.p2])];
    if (c?.kind === "circle") return [mk("diameter", [c.id]), mk("radius", [c.id])];
    if (c?.kind === "arc") return [mk("radius", [c.id]), mk("diameter", [c.id])];
  }
  if (items.length === 2) {
    if (kinds[0] === "point" && kinds[1] === "point") {
      return [mk("distance", items), mk("hdistance", items), mk("vdistance", items)];
    }
    const pi = kinds.indexOf("point");
    const li = kinds.indexOf("line");
    if (pi >= 0 && li >= 0) return [mk("pointLine", [items[pi], items[li]])];
    if (kinds[0] === "line" && kinds[1] === "line") return [mk("angle", items)];
  }
  throw new Error("Ölçü için bir çizgi, daire / yay, iki nokta, bir nokta ve çizgi ya da iki çizgi seçin");
}

/** Bir ölçünün eskizdeki mevcut değeri (null: ilgili öğeler yok). */
export function measureDimension(d: SketchData, type: DimensionType, refs: string[]): number | null {
  const pm = pointMap(d);
  const P = (id: string) => pm.get(id);
  const round = (n: number) => Number(n.toFixed(6)) + 0;
  switch (type) {
    case "distance":
    case "hdistance":
    case "vdistance": {
      const a = P(refs[0]);
      const b = P(refs[1]);
      if (!a || !b) return null;
      if (type === "hdistance") return round(b[0] - a[0]);
      if (type === "vdistance") return round(b[1] - a[1]);
      return round(Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    case "pointLine": {
      const p = P(refs[0]);
      const l = curveById(d, refs[1]);
      if (!p || l?.kind !== "line") return null;
      const a = P(l.p1)!;
      const b = P(l.p2)!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return len < 1e-12 ? null : round(Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len);
    }
    case "radius":
    case "diameter": {
      const c = curveById(d, refs[0]);
      let r: number | null = null;
      if (c?.kind === "circle") r = c.r;
      else if (c?.kind === "arc") r = arcInfo(P(c.c)!, P(c.s)!, P(c.e)!).r;
      return r === null ? null : round(type === "radius" ? r : 2 * r);
    }
    case "angle": {
      const l1 = curveById(d, refs[0]);
      const l2 = curveById(d, refs[1]);
      if (l1?.kind !== "line" || l2?.kind !== "line") return null;
      const v1: Vec2 = [P(l1.p2)![0] - P(l1.p1)![0], P(l1.p2)![1] - P(l1.p1)![1]];
      const v2: Vec2 = [P(l2.p2)![0] - P(l2.p1)![0], P(l2.p2)![1] - P(l2.p1)![1]];
      const a = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
      return round((a * 180) / Math.PI);
    }
  }
}

export const DIMENSION_UNITS: Record<DimensionType, "mm" | "°"> = {
  distance: "mm",
  hdistance: "mm",
  vdistance: "mm",
  pointLine: "mm",
  radius: "mm",
  diameter: "mm",
  angle: "°",
};

/** Etiketteki önek: ⌀ çap, R yarıçap. */
export function dimensionPrefix(type: DimensionType): string {
  return type === "diameter" ? "⌀" : type === "radius" ? "R" : "";
}

/** Ölçü etiketinin bağlandığı nokta (eskiz koordinatlarında), kaydırma dahil. */
export function dimensionAnchor(d: SketchData, k: SConstraint): Vec2 | null {
  const pm = pointMap(d);
  const off: Vec2 = k.offset ?? [0, 0];
  let base: Vec2 | null = null;
  switch (k.type) {
    case "distance":
    case "hdistance":
    case "vdistance": {
      const a = pm.get(k.refs[0]);
      const b = pm.get(k.refs[1]);
      if (a && b) base = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      break;
    }
    case "pointLine": {
      const p = pm.get(k.refs[0]);
      const l = curveById(d, k.refs[1]);
      if (p && l?.kind === "line") {
        const a = pm.get(l.p1)!;
        const b = pm.get(l.p2)!;
        const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) ** 2 || 1);
        const foot: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        base = [(p[0] + foot[0]) / 2, (p[1] + foot[1]) / 2];
      }
      break;
    }
    case "radius":
    case "diameter": {
      const c = curveById(d, k.refs[0]);
      if (c?.kind === "circle") base = [pm.get(c.c)![0] + c.r * Math.SQRT1_2, pm.get(c.c)![1] + c.r * Math.SQRT1_2];
      else if (c?.kind === "arc") {
        const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
        const mid = g.a0 + g.sweep / 2;
        base = [g.c[0] + g.r * Math.cos(mid), g.c[1] + g.r * Math.sin(mid)];
      }
      break;
    }
    case "angle": {
      const l1 = curveById(d, k.refs[0]);
      const l2 = curveById(d, k.refs[1]);
      if (l1?.kind === "line" && l2?.kind === "line") {
        const pts = [l1.p1, l1.p2, l2.p1, l2.p2].map((id) => pm.get(id)!);
        // İki çizginin birbirine en yakın uçlarının ortası.
        let best: [Vec2, Vec2] = [pts[0], pts[2]];
        let bestD = Infinity;
        for (const a of pts.slice(0, 2)) {
          for (const b of pts.slice(2)) {
            const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (dd < bestD) {
              bestD = dd;
              best = [a, b];
            }
          }
        }
        base = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2];
      }
      break;
    }
    default:
      return null;
  }
  return base ? [base[0] + off[0], base[1] + off[1]] : null;
}

/** Geometrik kısıt simgesinin konumu (eskiz koordinatlarında); gösterilemiyorsa null. */
export function constraintAnchor(d: SketchData, k: SConstraint, slot = 0): Vec2 | null {
  const pm = pointMap(d);
  const lineMid = (id: string): Vec2 | null => {
    const l = curveById(d, id);
    if (l?.kind !== "line") return null;
    const a = pm.get(l.p1)!;
    const b = pm.get(l.p2)!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const curveAt = (id: string): Vec2 | null => {
    const c = curveById(d, id);
    if (!c) return pm.get(id) ?? null;
    if (c.kind === "line") return lineMid(id);
    if (c.kind === "circle") return [pm.get(c.c)![0] + c.r * Math.SQRT1_2, pm.get(c.c)![1] - c.r * Math.SQRT1_2];
    if (c.kind === "arc") {
      const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
      const mid = g.a0 + g.sweep / 2;
      return [g.c[0] + g.r * Math.cos(mid), g.c[1] + g.r * Math.sin(mid)];
    }
    return pm.get(curvePoint(c)) ?? null;
  };
  const refs = k.refs;
  const at = (id: string | undefined) => (id ? curveAt(id) : null);
  switch (k.type) {
    case "horizontal":
    case "vertical":
      if (refs.length === 1) return at(refs[0]);
      return mid2(at(refs[0]), at(refs[1]));
    case "coincident":
      return at(refs[0]);
    case "fix":
      return at(refs[0]);
    case "parallel":
    case "perpendicular":
    case "equal":
    case "tangent":
    case "concentric":
      return at(refs[slot === 0 ? 0 : 1]) ?? at(refs[0]);
    case "midpoint":
    case "onCurve":
      return at(refs[0]);
    case "symmetric":
      return mid2(at(refs[0]), at(refs[1]));
    default:
      return null;
  }
}

function curvePoint(c: SCurve): string {
  return c.kind === "ellipse" || c.kind === "circle" ? c.c : c.kind === "spline" ? c.pts[0] : c.kind === "point" ? c.p : "";
}

function mid2(a: Vec2 | null, b: Vec2 | null): Vec2 | null {
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : (a ?? b);
}
