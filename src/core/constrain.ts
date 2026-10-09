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

/**
 * Bir ölçünün çizimi (eskiz koordinatlarında): uzatma + ölçü çizgileri, oklar ve etiket.
 * Ölçü etiketi `base + offset` konumundadır; `offset` yoksa ölçü çizgisi öğelerden `gap` kadar
 * uzağa kurulur (ekranda sabit bir mesafe olsun diye çağıran, yakınlaştırmaya göre verir).
 */
export interface DimensionLayout {
  lines: Vec2[][];
  /** `at`: okun ucu (çizginin ucu), `dir`: okun baktığı birim yön. */
  arrows: { at: Vec2; dir: Vec2 }[];
  /** Etiketin merkezi. */
  label: Vec2;
  /** Doğrusal ölçülerde oklar arası; ekranda darsa oklar ölçü çizgisinin dışına çevrilir. */
  span?: [Vec2, Vec2];
}

const vadd = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const vsub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const vmul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const vdot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const vlen = (a: Vec2) => Math.hypot(a[0], a[1]);
const vunit = (a: Vec2, fallback: Vec2 = [1, 0]): Vec2 => {
  const l = vlen(a);
  return l < 1e-12 ? fallback : [a[0] / l, a[1] / l];
};

/** İki çizginin kesişimi (paralelse null). */
function lineIntersection(p: Vec2, v: Vec2, q: Vec2, w: Vec2): Vec2 | null {
  const cross = v[0] * w[1] - v[1] * w[0];
  if (Math.abs(cross) < 1e-9 * vlen(v) * vlen(w)) return null;
  const t = ((q[0] - p[0]) * w[1] - (q[1] - p[1]) * w[0]) / cross;
  return vadd(p, vmul(v, t));
}

interface DimensionFrame {
  /** Etiket konumu = base + offset. */
  base: Vec2;
  /** Ofset verilmezse kullanılacak varsayılan (gap eskiz birimi). */
  fallback: (gap: number) => Vec2;
  /** Ofset verilince çizimi kurar. */
  build: (offset: Vec2, gap: number) => DimensionLayout;
}

/** Doğrusal ölçü: a–b ölçülür; ölçü çizgisi a2–b2, uzatma çizgileri a–a2 ve b–b2. */
function linearLayout(a: Vec2, b: Vec2, a2: Vec2, b2: Vec2, label: Vec2, gap: number): DimensionLayout {
  const lines: Vec2[][] = [[a2, b2]];
  // Uzatma çizgisi ölçü çizgisini biraz aşar.
  for (const [from, to] of [[a, a2], [b, b2]] as const) {
    const run = vsub(to, from);
    if (vlen(run) > 1e-9) lines.push([from, vadd(to, vmul(vunit(run), gap * 0.25))]);
  }
  const arrows: DimensionLayout["arrows"] = [];
  if (vlen(vsub(b2, a2)) > 1e-9) {
    arrows.push({ at: a2, dir: vunit(vsub(a2, b2)) }, { at: b2, dir: vunit(vsub(b2, a2)) });
  }
  return { lines, arrows, label, span: [a2, b2] };
}

/** Çember / yay ölçüsü: merkezden `offset` yönünde, etikete uzanan çizgi. */
function radialLayout(c: Vec2, r: number, offset: Vec2, diameter: boolean): DimensionLayout {
  const dir = vunit(offset, [Math.SQRT1_2, Math.SQRT1_2]);
  const reach = Math.max(vlen(offset), r);
  const rim = vadd(c, vmul(dir, r));
  const arrows = [{ at: rim, dir }];
  const from = diameter ? vsub(c, vmul(dir, r)) : c;
  if (diameter) arrows.push({ at: from, dir: vmul(dir, -1) });
  return { lines: [[from, vadd(c, vmul(dir, reach))]], arrows, label: vadd(c, offset) };
}

function dimensionFrame(d: SketchData, k: Pick<SConstraint, "type" | "refs">): DimensionFrame | null {
  const pm = pointMap(d);
  // Ölçü çizgisi varsayılan olarak şeklin dışına (merkezden uzağa) kurulur.
  const n = d.points.length || 1;
  const centroid: Vec2 = [d.points.reduce((s, p) => s + p.x, 0) / n, d.points.reduce((s, p) => s + p.y, 0) / n];
  const outward = (from: Vec2, dir: Vec2): Vec2 => (vdot(vsub(from, centroid), dir) < -1e-9 ? vmul(dir, -1) : dir);
  switch (k.type) {
    case "distance":
    case "hdistance":
    case "vdistance": {
      const a = pm.get(k.refs[0]);
      const b = pm.get(k.refs[1]);
      if (!a || !b) return null;
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (k.type === "hdistance") {
        return {
          base: mid,
          fallback: (gap) => vmul(outward(mid, [0, 1]), Math.abs(a[1] - b[1]) / 2 + gap),
          build: (o, gap) => linearLayout(a, b, [a[0], mid[1] + o[1]], [b[0], mid[1] + o[1]], vadd(mid, o), gap),
        };
      }
      if (k.type === "vdistance") {
        return {
          base: mid,
          fallback: (gap) => vmul(outward(mid, [1, 0]), Math.abs(a[0] - b[0]) / 2 + gap),
          build: (o, gap) => linearLayout(a, b, [mid[0] + o[0], a[1]], [mid[0] + o[0], b[1]], vadd(mid, o), gap),
        };
      }
      const u = vunit(vsub(b, a));
      const nrm: Vec2 = [-u[1], u[0]];
      return {
        base: mid,
        fallback: (gap) => vmul(outward(mid, nrm), gap),
        build: (o, gap) => {
          const shift = vmul(nrm, vdot(o, nrm));
          return linearLayout(a, b, vadd(a, shift), vadd(b, shift), vadd(mid, o), gap);
        },
      };
    }
    case "pointLine": {
      const p = pm.get(k.refs[0]);
      const l = curveById(d, k.refs[1]);
      if (!p || l?.kind !== "line") return null;
      const a = pm.get(l.p1)!;
      const b = pm.get(l.p2)!;
      const u = vunit(vsub(b, a));
      const foot = vadd(a, vmul(u, vdot(vsub(p, a), u)));
      const mid: Vec2 = [(p[0] + foot[0]) / 2, (p[1] + foot[1]) / 2];
      return {
        base: mid,
        fallback: (gap) => vmul(u, gap),
        build: (o, gap) => {
          const shift = vmul(u, vdot(o, u));
          return linearLayout(p, foot, vadd(p, shift), vadd(foot, shift), vadd(mid, o), gap);
        },
      };
    }
    case "radius":
    case "diameter": {
      const c = curveById(d, k.refs[0]);
      const diameter = k.type === "diameter";
      if (c?.kind === "circle") {
        const center = pm.get(c.c)!;
        const dir: Vec2 = [Math.SQRT1_2, Math.SQRT1_2];
        return { base: center, fallback: (gap) => vmul(dir, c.r + gap), build: (o) => radialLayout(center, c.r, o, diameter) };
      }
      if (c?.kind === "arc") {
        const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
        const mid = g.a0 + g.sweep / 2;
        const dir: Vec2 = [Math.cos(mid), Math.sin(mid)];
        return { base: g.c, fallback: (gap) => vmul(dir, g.r + gap), build: (o) => radialLayout(g.c, g.r, o, diameter) };
      }
      return null;
    }
    case "angle": {
      const l1 = curveById(d, k.refs[0]);
      const l2 = curveById(d, k.refs[1]);
      if (l1?.kind !== "line" || l2?.kind !== "line") return null;
      const [a1, b1, a2, b2] = [l1.p1, l1.p2, l2.p1, l2.p2].map((id) => pm.get(id)!);
      const v1 = vsub(b1, a1);
      const v2 = vsub(b2, a2);
      if (vlen(v1) < 1e-12 || vlen(v2) < 1e-12) return null;
      let apex = lineIntersection(a1, v1, a2, v2);
      if (!apex) {
        // Paralel çizgiler: birbirine en yakın uçların ortası.
        let best: [Vec2, Vec2] = [a1, a2];
        let bestD = Infinity;
        for (const p of [a1, b1]) {
          for (const q of [a2, b2]) {
            const dd = vlen(vsub(p, q));
            if (dd < bestD) {
              bestD = dd;
              best = [p, q];
            }
          }
        }
        apex = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2];
      }
      const origin = apex;
      const theta = Math.atan2(v1[1], v1[0]);
      const sweep = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], vdot(v1, v2));
      const bisector = theta + sweep / 2;
      return {
        base: origin,
        fallback: (gap) => [Math.cos(bisector) * gap * 3, Math.sin(bisector) * gap * 3],
        build: (o, gap) => {
          const R = Math.max(vlen(o), gap * 1.2);
          const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
          const arc: Vec2[] = [];
          for (let i = 0; i <= steps; i++) {
            const t = theta + (sweep * i) / steps;
            arc.push([origin[0] + R * Math.cos(t), origin[1] + R * Math.sin(t)]);
          }
          const lines: Vec2[][] = [arc];
          // Çizgiler yayın yarıçapına varmıyorsa yay çizgilere uzatma çizgisiyle bağlanır.
          for (const [dir, ends] of [
            [vunit(v1), [a1, b1]],
            [vunit(v2), [a2, b2]],
          ] as const) {
            const reach = Math.max(0, ...ends.map((e) => vdot(vsub(e, origin), dir)));
            if (reach < R) lines.push([vadd(origin, vmul(dir, reach)), vadd(origin, vmul(dir, R))]);
          }
          const tangent = (t: number): Vec2 => vmul([-Math.sin(t), Math.cos(t)], Math.sign(sweep) || 1);
          const arrows = [
            { at: arc[0], dir: vmul(tangent(theta), -1) },
            { at: arc[steps], dir: tangent(theta + sweep) },
          ];
          return { lines, arrows, label: vadd(origin, o) };
        },
      };
    }
    default:
      return null;
  }
}

/** Ölçünün çizimi; `gap`: ölçü çizgisinin öğelerden varsayılan uzaklığı (eskiz birimi). Çizilemiyorsa null. */
export function dimensionLayout(d: SketchData, k: Pick<SConstraint, "type" | "refs" | "offset">, gap: number): DimensionLayout | null {
  const frame = dimensionFrame(d, k);
  return frame ? frame.build(k.offset ?? frame.fallback(gap), gap) : null;
}

/** Etiket `point`'e gelsin diye `offset` ne olmalı? (etiketi sürüklemek için) */
export function dimensionOffsetFor(d: SketchData, k: Pick<SConstraint, "type" | "refs">, point: Vec2): Vec2 | null {
  const frame = dimensionFrame(d, k);
  return frame ? [Number((point[0] - frame.base[0]).toFixed(6)) + 0, Number((point[1] - frame.base[1]).toFixed(6)) + 0] : null;
}

/** Ölçü etiketinin merkezi (eskiz koordinatlarında). */
export function dimensionAnchor(d: SketchData, k: Pick<SConstraint, "type" | "refs" | "offset">, gap = 0): Vec2 | null {
  return dimensionLayout(d, k, gap)?.label ?? null;
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
