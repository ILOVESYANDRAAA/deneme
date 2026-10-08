/**
 * Parametrik eskiz modeli: noktalar, bu noktalara bağlı eğriler (çizgi, daire, yay, elips,
 * eğri, tek nokta) ve kısıtlar / ölçüler. Uç uca bağlı eğriler aynı noktayı paylaşır;
 * böylece bir köşe taşınınca ona bağlı her şey birlikte gelir.
 *
 * Model JSON'a çevrilebilir ve belgede `Feature.sketchData` olarak saklanır. Kısıtları
 * çözmek `solver.ts`'in işidir; buradaki her şey eşzamanlı ve saf geometridir.
 */
import { arcGeometry, circleFrom3, findLoops, type SketchEntity } from "./sketch";
import type { Loop, Vec2 } from "./solid";

export interface SPoint {
  id: string;
  x: number;
  y: number;
}

interface CurveBase {
  id: string;
  /** Yapı (yardımcı) eğrisi: çizilir, yakalanır ama profile katılmaz. */
  construction?: boolean;
}

export type SCurve = CurveBase &
  (
    | { kind: "line"; p1: string; p2: string }
    | { kind: "circle"; c: string; r: number }
    /** Merkez `c` etrafında `s`'den `e`'ye saat yönünün tersine yay. Yarıçap |s − c|'dir. */
    | { kind: "arc"; c: string; s: string; e: string }
    /** `rot`: büyük eksenin u eksenine göre açısı (radyan). Sadece merkezi kısıtlanabilir. */
    | { kind: "ellipse"; c: string; rx: number; ry: number; rot: number }
    /** Noktalardan geçen yumuşak eğri (Catmull-Rom). Noktaları tek tek kısıtlanabilir. */
    | { kind: "spline"; pts: string[]; closed: boolean }
    /** Tek başına nokta (Nokta aracı); profile katılmaz. */
    | { kind: "point"; p: string }
  );

export type CurveKind = SCurve["kind"];

/** Kimliği henüz verilmemiş eğri (birleşim tipinin her koluna ayrı uygulanır). */
type NewCurve = SCurve extends infer T ? (T extends SCurve ? Omit<T, "id" | "construction"> : never) : never;

export type GeometricConstraintType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equal"
  | "fix"
  | "midpoint"
  | "concentric"
  | "onCurve"
  | "symmetric";

export type DimensionType = "distance" | "hdistance" | "vdistance" | "pointLine" | "radius" | "diameter" | "angle";

export type ConstraintType = GeometricConstraintType | DimensionType;

/**
 * Kısıt ya da ölçü. `refs` nokta ve eğri kimlikleridir; sıra türe göre anlamlıdır:
 * - coincident: [nokta, nokta] · fix: [nokta] · midpoint/onCurve: [nokta, eğri]
 * - horizontal/vertical: [çizgi] · parallel/perpendicular/equal/tangent/concentric: [eğri, eğri]
 * - symmetric: [nokta, nokta, çizgi]
 * - distance/hdistance/vdistance: [nokta, nokta] · pointLine: [nokta, çizgi]
 * - radius/diameter: [daire|yay] · angle: [çizgi, çizgi]
 */
export interface SConstraint {
  id: string;
  type: ConstraintType;
  refs: string[];
  /** Ölçü değeri (mm ya da derece). hdistance/vdistance/angle işaretlidir (yön korunur). */
  value?: number;
  /** Ölçü değeri bir parametre ifadesinden geliyorsa metni (örn. "genislik / 2"); `value` en son hesaplanan değerdir. */
  expr?: string;
  /** fix: sabitlenen konum. */
  at?: Vec2;
  /** Ölçü etiketinin geometriden kayması (eskiz koordinatlarında). */
  offset?: Vec2;
}

export interface SketchData {
  points: SPoint[];
  curves: SCurve[];
  constraints: SConstraint[];
  /** Kimlik sayacı. */
  next: number;
}

export const DIMENSION_TYPES: readonly ConstraintType[] = ["distance", "hdistance", "vdistance", "pointLine", "radius", "diameter", "angle"];

export function isDimension(c: SConstraint): boolean {
  return DIMENSION_TYPES.includes(c.type);
}

export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  coincident: "Çakışık",
  horizontal: "Yatay",
  vertical: "Dikey",
  parallel: "Paralel",
  perpendicular: "Dik",
  tangent: "Teğet",
  equal: "Eşit",
  fix: "Sabit",
  midpoint: "Orta Nokta",
  concentric: "Eş Merkezli",
  onCurve: "Eğri Üzerinde",
  symmetric: "Simetrik",
  distance: "Mesafe",
  hdistance: "Yatay Mesafe",
  vdistance: "Dikey Mesafe",
  pointLine: "Noktadan Çizgiye Mesafe",
  radius: "Yarıçap",
  diameter: "Çap",
  angle: "Açı",
};

/** Görünümde kısıt simgesi olarak gösterilen kısa işaretler. */
export const CONSTRAINT_GLYPHS: Record<GeometricConstraintType, string> = {
  coincident: "●",
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  tangent: "T",
  equal: "=",
  fix: "⚓",
  midpoint: "M",
  concentric: "◎",
  onCurve: "∘",
  symmetric: "⇹",
};

export const CURVE_LABELS: Record<CurveKind, string> = {
  line: "Çizgi",
  circle: "Daire",
  arc: "Yay",
  ellipse: "Elips",
  spline: "Eğri",
  point: "Nokta",
};

export function emptySketch(): SketchData {
  return { points: [], curves: [], constraints: [], next: 1 };
}

// ---- küçük 2B yardımcılar ----

const TAU = 2 * Math.PI;
const EPS = 1e-9;
export const CIRCLE_SEGMENTS = 96;
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r6 = (n: number) => Number(n.toFixed(6)) + 0;
export const round2 = (p: Vec2): Vec2 => [r6(p[0]), r6(p[1])];
const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;
const unit = (a: Vec2): Vec2 => {
  const l = Math.hypot(a[0], a[1]);
  return l < EPS ? [1, 0] : [a[0] / l, a[1] / l];
};

/** Kimlik → nokta konumu. */
export function pointMap(d: SketchData): Map<string, Vec2> {
  return new Map(d.points.map((p) => [p.id, [p.x, p.y] as Vec2]));
}

export function curveById(d: SketchData, id: string): SCurve | undefined {
  return d.curves.find((c) => c.id === id);
}

/** Eğrinin kullandığı nokta kimlikleri (uçlar, merkez, eğri noktaları). */
export function curvePoints(c: SCurve): string[] {
  switch (c.kind) {
    case "line":
      return [c.p1, c.p2];
    case "circle":
    case "ellipse":
      return [c.c];
    case "arc":
      return [c.c, c.s, c.e];
    case "spline":
      return [...c.pts];
    case "point":
      return [c.p];
  }
}

/** Yayın geometrisi (merkez, yarıçap, başlangıç açısı, saat yönü tersine taradığı açı 0..2π). */
export function arcInfo(c: Vec2, s: Vec2, e: Vec2): { c: Vec2; r: number; a0: number; sweep: number } {
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  const a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  let sweep = normAngle(a1 - a0);
  if (sweep < 1e-9) sweep = TAU;
  return { c, r: dist2(c, s), a0, sweep };
}

function arcSamples(c: Vec2, r: number, a0: number, sweep: number, perCircle: number): Vec2[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / TAU) * perCircle));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

function ellipseSamples(c: Vec2, rx: number, ry: number, rot: number, n: number): Vec2[] {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (TAU * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
  }
  return out;
}

/** Catmull-Rom eğrisi; kontrol noktalarından geçer. */
export function splineSamples(points: Vec2[], closed: boolean, perSpan = 16): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  const at = (i: number): Vec2 => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return sub(mul(points[0], 2), points[1]);
    if (i >= n) return sub(mul(points[n - 1], 2), points[n - 2]);
    return points[i];
  };
  const spans = closed ? n : n - 1;
  const out: Vec2[] = [];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k: 0 | 1) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  if (!closed) out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}

/** Eğrinin örneklenmiş yolu. Kapalı yollarda son nokta tekrar edilmez. */
export function curvePath(d: SketchData | Map<string, Vec2>, c: SCurve, fine = true): { points: Vec2[]; closed: boolean } {
  const pm = d instanceof Map ? d : pointMap(d);
  const P = (id: string): Vec2 => pm.get(id) ?? [0, 0];
  const seg = fine ? CIRCLE_SEGMENTS : 64;
  switch (c.kind) {
    case "line":
      return { points: [P(c.p1), P(c.p2)], closed: false };
    case "circle":
      return { points: arcSamples(P(c.c), c.r, 0, TAU, seg).slice(0, -1), closed: true };
    case "arc": {
      const g = arcInfo(P(c.c), P(c.s), P(c.e));
      const pts = arcSamples(g.c, g.r, g.a0, g.sweep, seg);
      // Uçlar birebir nokta konumları olsun ki komşu eğrilerle birleşsin.
      pts[0] = P(c.s);
      pts[pts.length - 1] = P(c.e);
      return { points: pts, closed: false };
    }
    case "ellipse":
      return { points: ellipseSamples(P(c.c), c.rx, c.ry, c.rot, seg), closed: true };
    case "spline":
      return { points: splineSamples(c.pts.map(P), c.closed, fine ? 16 : 10), closed: c.closed };
    case "point":
      return { points: [P(c.p)], closed: false };
  }
}

/** Kapalı profiller (katıya çevrilebilen şekiller). Yapı eğrileri ve noktalar hariç. */
export function sketchDataProfiles(d: SketchData): Vec2[][] {
  const pm = pointMap(d);
  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];
  for (const c of d.curves) {
    if (c.construction || c.kind === "point") continue;
    const { points, closed: isClosed } = curvePath(pm, c);
    if (isClosed) {
      if (points.length >= 3 && (c.kind !== "circle" || c.r > EPS)) closed.push(points);
    } else if (points.length >= 2) open.push(points);
  }
  return [...closed, ...findLoops(open)];
}


const JOIN = 1e-6;

interface ExactEdge {
  /** Köşe noktaları (n + 1) ve aralarındaki yay orta noktaları (n; düz çizgide undefined). */
  pts: Vec2[];
  vias: (Vec2 | undefined)[];
}

function reversedEdge(e: ExactEdge): ExactEdge {
  return { pts: [...e.pts].reverse(), vias: [...e.vias].reverse() };
}

/** Eğriyi kesin kenara çevirir; çizgi ve yay dışındakiler (açık eğri) örneklenmiş çizgilerle yaklaşılır. */
function exactEdge(pm: Map<string, Vec2>, c: SCurve): ExactEdge | null {
  const P = (id: string): Vec2 => pm.get(id) ?? [0, 0];
  if (c.kind === "line") return { pts: [P(c.p1), P(c.p2)], vias: [undefined] };
  if (c.kind === "arc") {
    const g = arcInfo(P(c.c), P(c.s), P(c.e));
    const mid = g.a0 + g.sweep / 2;
    return { pts: [P(c.s), P(c.e)], vias: [[g.c[0] + g.r * Math.cos(mid), g.c[1] + g.r * Math.sin(mid)]] };
  }
  if (c.kind === "spline" && !c.closed) {
    const { points } = curvePath(pm, c);
    return { pts: points, vias: points.slice(1).map(() => undefined) };
  }
  return null;
}

/**
 * Kapalı profillerin kesin hâli (çizgi + yay + daire). `sketchDataProfiles` ile aynı şekilleri bulur
 * ama eğrileri örneklemez; elips ve kapalı eğri gibi serbest şekiller çokgen olarak gelir.
 */
export function sketchDataLoops(d: SketchData): Loop[] {
  const pm = pointMap(d);
  const loops: Loop[] = [];
  const edges: ExactEdge[] = [];
  for (const c of d.curves) {
    if (c.construction || c.kind === "point") continue;
    if (c.kind === "circle") {
      if (c.r > EPS) loops.push({ circle: { c: pm.get(c.c) ?? [0, 0], r: c.r } });
      continue;
    }
    const exact = exactEdge(pm, c);
    if (exact) {
      edges.push(exact);
      continue;
    }
    const { points, closed } = curvePath(pm, c);
    if (closed && points.length >= 3) loops.push({ from: points[0], segs: [...points.slice(1), points[0]].map((to) => ({ to })) });
  }
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN;
  const nodes: Vec2[] = [];
  const nodeOf = (p: Vec2): number => {
    const i = nodes.findIndex((n) => near(n, p));
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const list = edges.map((e) => ({ e, a: nodeOf(e.pts[0]), b: nodeOf(e.pts[e.pts.length - 1]), alive: true }));
  const emit = (chain: ExactEdge[]) => {
    const segs: { to: Vec2; via?: Vec2 }[] = [];
    for (const e of chain) {
      for (let i = 0; i < e.vias.length; i++) segs.push({ to: e.pts[i + 1], ...(e.vias[i] ? { via: e.vias[i] } : {}) });
    }
    // Son nokta ilk noktaya birebir otursun.
    segs[segs.length - 1] = { ...segs[segs.length - 1], to: chain[0].pts[0] };
    if (segs.length >= 2) loops.push({ from: chain[0].pts[0], segs });
  };
  // Kendi üstüne kapanan tek yol.
  for (const it of list) {
    if (it.a === it.b) {
      it.alive = false;
      if (it.e.pts.length >= 4) emit([it.e]);
    }
  }
  // Dallanmadan kalan ölü uçları ayıkla.
  for (let changed = true; changed; ) {
    changed = false;
    const degree = new Map<number, number>();
    for (const it of list) {
      if (!it.alive) continue;
      degree.set(it.a, (degree.get(it.a) ?? 0) + 1);
      degree.set(it.b, (degree.get(it.b) ?? 0) + 1);
    }
    for (const it of list) {
      if (it.alive && ((degree.get(it.a) ?? 0) < 2 || (degree.get(it.b) ?? 0) < 2)) {
        it.alive = false;
        changed = true;
      }
    }
  }
  const used = new Set<number>();
  for (let s = 0; s < list.length; s++) {
    if (!list[s].alive || used.has(s)) continue;
    used.add(s);
    const chainNodes = [list[s].a];
    const chain: { i: number; reversed: boolean }[] = [{ i: s, reversed: false }];
    let at = list[s].b;
    for (let guard = 0; guard < list.length + 1; guard++) {
      const seen = chainNodes.indexOf(at);
      if (seen >= 0) {
        emit(chain.slice(seen).map(({ i, reversed }) => (reversed ? reversedEdge(list[i].e) : list[i].e)));
        break;
      }
      chainNodes.push(at);
      const next = list.findIndex((it, i) => it.alive && !used.has(i) && (it.a === at || it.b === at));
      if (next < 0) break;
      used.add(next);
      const reversed = list[next].b === at;
      chain.push({ i: next, reversed });
      at = reversed ? list[next].a : list[next].b;
    }
  }
  return loops;
}

/**
 * Eskizdeki tek açık yol (süpürme yolu): uç uca bağlı çizgi / yay zinciri. Dallanma, birden çok zincir
 * ya da kapalı şekil varsa null döner. Kapalı bir zincirse (uç yok) null; yol açık olmalıdır.
 */
export function sketchDataChain(d: SketchData): Loop | null {
  const pm = pointMap(d);
  const edges: ExactEdge[] = [];
  for (const c of d.curves) {
    if (c.construction || c.kind === "point") continue;
    const e = exactEdge(pm, c);
    if (!e) return null; // daire, elips, kapalı eğri: yol değil
    edges.push(e);
  }
  if (!edges.length) return null;
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN;
  const ends = (e: ExactEdge): [Vec2, Vec2] => [e.pts[0], e.pts[e.pts.length - 1]];
  const degree = (p: Vec2) => edges.reduce((n, e) => n + ends(e).filter((q) => near(q, p)).length, 0);
  const endpoints = edges.flatMap(ends).filter((p) => degree(p) === 1);
  if (edges.flatMap(ends).some((p) => degree(p) > 2) || endpoints.length !== 2) return null;
  const used = new Set<number>();
  const chain: ExactEdge[] = [];
  let at = endpoints[0];
  for (let guard = 0; guard <= edges.length; guard++) {
    const next = edges.findIndex((e, i) => !used.has(i) && ends(e).some((q) => near(q, at)));
    if (next < 0) break;
    used.add(next);
    const e = edges[next];
    const oriented = near(e.pts[0], at) ? e : reversedEdge(e);
    chain.push(oriented);
    at = oriented.pts[oriented.pts.length - 1];
  }
  if (chain.length !== edges.length) return null; // birbirinden kopuk parçalar var
  const segs: { to: Vec2; via?: Vec2 }[] = [];
  for (const e of chain) for (let i = 0; i < e.vias.length; i++) segs.push({ to: e.pts[i + 1], ...(e.vias[i] ? { via: e.vias[i] } : {}) });
  return { from: chain[0].pts[0], segs };
}

/** Üç noktadan geçen yayın (a → b, `via` üzerinden) örneklenmiş noktaları; a hariç, b dahil. */
function sampleThreePointArc(a: Vec2, via: Vec2, b: Vec2, perCircle = 48): Vec2[] {
  const g = circleFrom3(a, via, b);
  if (!g) return [b];
  const [cx, cy] = g.c;
  const ang = (p: Vec2) => Math.atan2(p[1] - cy, p[0] - cx);
  const a0 = ang(a);
  let sweep = ang(b) - a0;
  const sv = ang(via) - a0;
  const wrap = (x: number) => ((x % TAU) + TAU) % TAU;
  // `via`, a ile b arasındaki yayın üzerindedir: saat yönünün tersi mi (pozitif) yoksa tersi mi?
  const ccw = wrap(sv) < wrap(sweep);
  sweep = ccw ? wrap(sweep) : wrap(sweep) - TAU;
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / TAU) * perCircle));
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    out.push(i === n ? b : [cx + g.r * Math.cos(t), cy + g.r * Math.sin(t)]);
  }
  return out;
}

/** Açık yolu (çizgi + yay) örneklenmiş çoklu çizgiye çevirir. */
export function chainPoints(chain: Loop): Vec2[] {
  if (!("segs" in chain)) return [];
  const pts: Vec2[] = [chain.from];
  let prev = chain.from;
  for (const seg of chain.segs) {
    pts.push(...(seg.via ? sampleThreePointArc(prev, seg.via, seg.to) : [seg.to]));
    prev = seg.to;
  }
  return pts;
}

/**
 * Açık yolu `thickness` kalınlığında kapalı bir çokgene çevirir (kaburga profili): yolun iki yanına
 * `thickness / 2` ofset, köşelerde gönyeli birleşim, uçlar dik kesik. Çok keskin dönüşlerde gönye kısaltılır.
 */
export function thickenChain(chain: Loop, thickness: number): Vec2[] {
  const pts = chainPoints(chain).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-9);
  if (pts.length < 2) throw new Error("Yol en az iki noktalı olmalı");
  const h = thickness / 2;
  const normal = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const offsetAt = (i: number): Vec2 => {
    if (i === 0) return normal(pts[0], pts[1]);
    if (i === pts.length - 1) return normal(pts[i - 1], pts[i]);
    const n1 = normal(pts[i - 1], pts[i]);
    const n2 = normal(pts[i], pts[i + 1]);
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const m: Vec2 = [n1[0] + n2[0], n1[1] + n2[1]];
    // Gönye uzunluğu 1/cos(θ/2); aşırı keskin dönüşlerde sınırlanır.
    const scale = 1 / Math.max(k, 0.2);
    return [m[0] * scale, m[1] * scale];
  };
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  pts.forEach((p, i) => {
    const o = offsetAt(i);
    left.push([p[0] + o[0] * h, p[1] + o[1] * h]);
    right.push([p[0] - o[0] * h, p[1] - o[1] * h]);
  });
  return [...left, ...right.reverse()];
}

/** Ekranda çizim için her eğrinin parçaları. */
export function curveSegments(d: SketchData, c: SCurve, pm = pointMap(d)): [Vec2, Vec2][] {
  if (c.kind === "point") return [];
  const { points, closed } = curvePath(pm, c, false);
  const segs: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
  if (closed && points.length > 2) segs.push([points[points.length - 1], points[0]]);
  return segs;
}

export type SnapKind = "köşe" | "merkez" | "orta nokta" | "nokta";

/** Yakalama noktaları: uç noktalar, merkezler, tek noktalar ve çizgi ortaları. */
export function snapCandidates(d: SketchData): { p: Vec2; kind: SnapKind; pointId?: string; curveId?: string }[] {
  const pm = pointMap(d);
  const out: { p: Vec2; kind: SnapKind; pointId?: string; curveId?: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, kind: SnapKind) => {
    if (seen.has(id)) return;
    seen.add(id);
    const p = pm.get(id);
    if (p) out.push({ p, kind, pointId: id });
  };
  for (const c of d.curves) {
    switch (c.kind) {
      case "line": {
        add(c.p1, "köşe");
        add(c.p2, "köşe");
        const a = pm.get(c.p1)!;
        const b = pm.get(c.p2)!;
        out.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: "orta nokta", curveId: c.id });
        break;
      }
      case "arc":
        add(c.s, "köşe");
        add(c.e, "köşe");
        add(c.c, "merkez");
        break;
      case "circle":
      case "ellipse":
        add(c.c, "merkez");
        break;
      case "spline":
        c.pts.forEach((p) => add(p, "köşe"));
        break;
      case "point":
        add(c.p, "nokta");
        break;
    }
  }
  return out;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist2(p, add(a, mul(ab, t)));
}

/** `p`'ye `tol` mesafeden yakın en yakın eğri (yoksa null). */
export function hitCurve(d: SketchData, p: Vec2, tol: number, filter?: (c: SCurve) => boolean): string | null {
  const pm = pointMap(d);
  let best: string | null = null;
  let bestDist = tol;
  for (const c of d.curves) {
    if (filter && !filter(c)) continue;
    if (c.kind === "point") {
      const q = pm.get(c.p)!;
      const dd = dist2(p, q);
      if (dd <= bestDist) {
        bestDist = dd;
        best = c.id;
      }
      continue;
    }
    const { points, closed } = curvePath(pm, c, false);
    const n = points.length;
    for (let k = 0; k < n - (closed ? 0 : 1); k++) {
      const dd = distToSegment(p, points[k], points[(k + 1) % n]);
      if (dd <= bestDist) {
        bestDist = dd;
        best = c.id;
      }
    }
  }
  return best;
}

/** `p`'ye en yakın nokta (eğrilerin uçları, merkezleri). */
export function hitPoint(d: SketchData, p: Vec2, tol: number): string | null {
  let best: string | null = null;
  let bestDist = tol;
  const used = new Set(d.curves.flatMap(curvePoints));
  for (const q of d.points) {
    if (!used.has(q.id)) continue;
    const dd = dist2(p, [q.x, q.y]);
    if (dd <= bestDist) {
      bestDist = dd;
      best = q.id;
    }
  }
  return best;
}

export function describeSketchData(d: SketchData): string {
  const curves = d.curves.filter((c) => c.kind !== "point").length;
  if (curves === 0 && d.curves.length === 0) return "Boş eskiz";
  const profiles = sketchDataProfiles(d).length;
  const construction = d.curves.filter((c) => c.construction).length;
  const dims = d.constraints.filter(isDimension).length;
  const cons = d.constraints.length - dims;
  const parts = [`${d.curves.length} öğe`, `${profiles} kapalı profil`];
  if (construction) parts.push(`${construction} yapı çizgisi`);
  if (cons) parts.push(`${cons} kısıt`);
  if (dims) parts.push(`${dims} ölçü`);
  return parts.join(" · ");
}

// ---- düzenleme ----

/**
 * Bir eskiz kopyası üzerinde değişiklik yapmak için yardımcı. Kimlik üretir, eğrileri ve
 * kısıtları ekler; `result()` yeni (değişmez) veriyi verir.
 */
export class SketchEdit {
  readonly d: SketchData;

  constructor(source: SketchData = emptySketch()) {
    this.d = structuredClone(source);
  }

  private id(prefix: string): string {
    return `${prefix}${this.d.next++}`;
  }

  get pm(): Map<string, Vec2> {
    return pointMap(this.d);
  }

  point(p: Vec2): string {
    const id = this.id("p");
    this.d.points.push({ id, x: r6(p[0]), y: r6(p[1]) });
    return id;
  }

  /** Verilen konumda var olan noktayı (yakalanmışsa) kullanır, yoksa yenisini ekler. */
  pointAt(p: Vec2, existing?: string | null): string {
    if (existing && this.d.points.some((q) => q.id === existing)) return existing;
    return this.point(p);
  }

  movePoint(id: string, p: Vec2): void {
    const q = this.d.points.find((x) => x.id === id);
    if (q) {
      q.x = r6(p[0]);
      q.y = r6(p[1]);
    }
  }

  private addCurve(c: NewCurve, construction?: boolean): string {
    const id = this.id("c");
    this.d.curves.push({ ...c, id, ...(construction ? { construction: true } : {}) } as SCurve);
    return id;
  }

  line(a: string, b: string, construction?: boolean): string {
    return this.addCurve({ kind: "line", p1: a, p2: b }, construction);
  }

  circle(c: string, r: number, construction?: boolean): string {
    return this.addCurve({ kind: "circle", c, r: r6(r) }, construction);
  }

  arc(c: string, s: string, e: string, construction?: boolean): string {
    return this.addCurve({ kind: "arc", c, s, e }, construction);
  }

  ellipse(c: string, rx: number, ry: number, rot: number, construction?: boolean): string {
    return this.addCurve({ kind: "ellipse", c, rx: r6(rx), ry: r6(ry), rot: Number(rot.toFixed(9)) }, construction);
  }

  spline(pts: string[], closed: boolean, construction?: boolean): string {
    return this.addCurve({ kind: "spline", pts, closed }, construction);
  }

  standalone(p: string): string {
    return this.addCurve({ kind: "point", p });
  }

  constrain(type: ConstraintType, refs: string[], extra: Partial<Omit<SConstraint, "id" | "type" | "refs">> = {}): string {
    const id = this.id("k");
    this.d.constraints.push({ id, type, refs, ...extra });
    return id;
  }

  /** Bir eğri zinciri ekler; ardışık noktalar paylaşılır. `closed` ise son → ilk de bağlanır. */
  polyline(pointIds: string[], closed: boolean, construction?: boolean): string[] {
    const lines: string[] = [];
    for (let i = 0; i + 1 < pointIds.length; i++) lines.push(this.line(pointIds[i], pointIds[i + 1], construction));
    if (closed && pointIds.length > 2) lines.push(this.line(pointIds[pointIds.length - 1], pointIds[0], construction));
    return lines;
  }

  /** Eğrileri siler; onlara bağlı kısıtları ve artık kullanılmayan noktaları da temizler. */
  deleteCurves(ids: Iterable<string>): void {
    const gone = new Set(ids);
    this.d.curves = this.d.curves.filter((c) => !gone.has(c.id));
    this.cleanup(gone);
  }

  deleteConstraints(ids: Iterable<string>): void {
    const gone = new Set(ids);
    this.d.constraints = this.d.constraints.filter((k) => !gone.has(k.id));
  }

  /** Hiçbir eğrinin kullanmadığı noktaları ve var olmayan şeylere bakan kısıtları siler. */
  cleanup(removed: Set<string> = new Set()): void {
    const used = new Set(this.d.curves.flatMap(curvePoints));
    for (const p of this.d.points) if (!used.has(p.id)) removed.add(p.id);
    this.d.points = this.d.points.filter((p) => used.has(p.id));
    const alive = new Set([...this.d.points.map((p) => p.id), ...this.d.curves.map((c) => c.id)]);
    this.d.constraints = this.d.constraints.filter((k) => k.refs.every((r) => alive.has(r) && !removed.has(r)));
  }

  /** `b` noktasını `a` ile birleştirir: `b`'ye bağlı her şey `a`'ya bağlanır. */
  mergePoints(a: string, b: string): void {
    if (a === b) return;
    const swap = (id: string) => (id === b ? a : id);
    for (const c of this.d.curves) {
      switch (c.kind) {
        case "line":
          c.p1 = swap(c.p1);
          c.p2 = swap(c.p2);
          break;
        case "circle":
        case "ellipse":
          c.c = swap(c.c);
          break;
        case "arc":
          c.c = swap(c.c);
          c.s = swap(c.s);
          c.e = swap(c.e);
          break;
        case "spline":
          c.pts = c.pts.map(swap);
          break;
        case "point":
          c.p = swap(c.p);
          break;
      }
    }
    for (const k of this.d.constraints) k.refs = k.refs.map(swap);
    // Kendi kendine çakışık kısıtları at.
    this.d.constraints = this.d.constraints.filter((k) => !(k.type === "coincident" && k.refs[0] === k.refs[1]));
    this.d.points = this.d.points.filter((p) => p.id !== b);
    // Çizgi iki ucunda aynı noktaya düştüyse sil.
    const degenerate = this.d.curves.filter((c) => c.kind === "line" && c.p1 === c.p2).map((c) => c.id);
    if (degenerate.length) this.deleteCurves(degenerate);
  }

  /**
   * Seçili eğrilerin dönüştürülmüş kopyasını ekler (ayna, taşı, döndür, desen). İç
   * kısıtlar (refs'in tamamı seçimdeyse) kopyalanır; aynalamada yönlü ölçüler çevrilir.
   * Yeni eğri kimliklerini döndürür.
   */
  copyCurves(ids: string[], map: (p: Vec2) => Vec2, mirror = false): string[] {
    const sel = new Set(ids);
    const pm = this.pm;
    const pointCopy = new Map<string, string>();
    const P = (id: string) => {
      let n = pointCopy.get(id);
      if (!n) {
        n = this.point(map(pm.get(id)!));
        pointCopy.set(id, n);
      }
      return n;
    };
    const curveCopy = new Map<string, string>();
    for (const c of this.d.curves.filter((x) => sel.has(x.id))) {
      let id: string;
      switch (c.kind) {
        case "line":
          id = this.line(P(c.p1), P(c.p2), c.construction);
          break;
        case "circle":
          id = this.circle(P(c.c), c.r, c.construction);
          break;
        case "arc":
          // Aynalama yönü çevirir: saat yönü tersine kalsın diye uçlar yer değiştirir.
          id = mirror ? this.arc(P(c.c), P(c.e), P(c.s), c.construction) : this.arc(P(c.c), P(c.s), P(c.e), c.construction);
          break;
        case "ellipse": {
          const center = pm.get(c.c)!;
          const axis = map([center[0] + Math.cos(c.rot), center[1] + Math.sin(c.rot)]);
          const mc = map(center);
          id = this.ellipse(P(c.c), c.rx, c.ry, Math.atan2(axis[1] - mc[1], axis[0] - mc[0]), c.construction);
          break;
        }
        case "spline":
          id = this.spline(c.pts.map(P), c.closed, c.construction);
          break;
        case "point":
          id = this.standalone(P(c.p));
          break;
      }
      curveCopy.set(c.id, id);
    }
    const remap = (r: string) => curveCopy.get(r) ?? pointCopy.get(r);
    for (const k of [...this.d.constraints]) {
      if (k.type === "fix") continue;
      const refs = k.refs.map(remap);
      if (refs.some((r) => !r)) continue;
      const flip = mirror && (k.type === "angle" || k.type === "hdistance" || k.type === "vdistance");
      this.constrain(k.type, refs as string[], {
        ...(k.value !== undefined ? { value: flip && k.type !== "vdistance" ? -k.value : k.value } : {}),
      });
    }
    return [...curveCopy.values()];
  }

  /** Seçili eğrilerin noktalarını yerinde dönüştürür (taşı / döndür). */
  transformCurves(ids: string[], map: (p: Vec2) => Vec2): void {
    const sel = new Set(ids);
    const pts = new Set(this.d.curves.filter((c) => sel.has(c.id)).flatMap(curvePoints));
    const pm = this.pm;
    for (const id of pts) this.movePoint(id, map(pm.get(id)!));
    for (const c of this.d.curves) {
      if (!sel.has(c.id) || c.kind !== "ellipse") continue;
      const center = pm.get(c.c)!;
      const axis = map([center[0] + Math.cos(c.rot), center[1] + Math.sin(c.rot)]);
      const mc = map(center);
      c.rot = Number(Math.atan2(axis[1] - mc[1], axis[0] - mc[0]).toFixed(9));
    }
    // Taşınan noktalara bağlı "sabit" kısıtların konumu güncellenir.
    for (const k of this.d.constraints) {
      if (k.type === "fix" && pts.has(k.refs[0])) {
        const q = this.pm.get(k.refs[0])!;
        k.at = [q[0], q[1]];
      }
    }
  }

  result(): SketchData {
    return this.d;
  }
}

// ---- şekil kurucular (araçların ürettiği eğriler ve otomatik kısıtlar) ----

export interface BuildOptions {
  construction?: boolean;
  /** Tıklanan noktaların yakalandığı mevcut nokta kimlikleri (aynı sırayla). */
  snapped?: (string | null | undefined)[];
}

/** Dikdörtgen: 4 çizgi, ortak köşeler, yatay/dikey kısıtlar (eksenlere paralelse). */
export function buildRect(ed: SketchEdit, corners: Vec2[], opts: BuildOptions = {}): string[] {
  const ids = corners.map((p, i) => ed.pointAt(p, opts.snapped?.[i]));
  const lines = ed.polyline(ids, true, opts.construction);
  const pm = ed.pm;
  for (const l of lines) {
    const c = curveById(ed.d, l) as Extract<SCurve, { kind: "line" }>;
    const a = pm.get(c.p1)!;
    const b = pm.get(c.p2)!;
    if (Math.abs(a[1] - b[1]) < 1e-9) ed.constrain("horizontal", [l]);
    else if (Math.abs(a[0] - b[0]) < 1e-9) ed.constrain("vertical", [l]);
  }
  // Döndürülmüş (3 noktalı) dikdörtgende köşeler dik ve karşılıklı kenarlar paralel kalsın.
  if (!ed.d.constraints.some((k) => k.refs[0] === lines[0] && (k.type === "horizontal" || k.type === "vertical"))) {
    ed.constrain("perpendicular", [lines[0], lines[1]]);
    ed.constrain("parallel", [lines[0], lines[2]]);
    ed.constrain("parallel", [lines[1], lines[3]]);
  }
  return lines;
}

/** Çizgi zinciri; neredeyse yatay/dikey çizgilere otomatik kısıt eklenir. */
export function buildPolyline(ed: SketchEdit, pts: Vec2[], closed: boolean, opts: BuildOptions = {}, autoHV = true): string[] {
  const ids = pts.map((p, i) => ed.pointAt(p, opts.snapped?.[i]));
  // Kapalı zincirde ilk nokta tekrar tıklandıysa kapatma çizgisi ilk noktaya bağlanır.
  const lines = ed.polyline(ids, closed, opts.construction);
  if (autoHV) addAutoHV(ed, lines);
  return lines;
}

/** Eksenlere hizalı (1e-6 içinde) çizgilere yatay / dikey kısıt ekler. */
export function addAutoHV(ed: SketchEdit, lines: string[]): void {
  const pm = ed.pm;
  for (const l of lines) {
    const c = curveById(ed.d, l);
    if (c?.kind !== "line") continue;
    const a = pm.get(c.p1)!;
    const b = pm.get(c.p2)!;
    if (dist2(a, b) < 1e-9) continue;
    if (Math.abs(a[1] - b[1]) < 1e-6) ed.constrain("horizontal", [l]);
    else if (Math.abs(a[0] - b[0]) < 1e-6) ed.constrain("vertical", [l]);
  }
}

/** Düzgün çokgen: kenarlar eşit, köşeler yapı çemberi üzerinde. */
export function buildPolygon(ed: SketchEdit, center: Vec2, corner: Vec2, sides: number, opts: BuildOptions = {}): string[] {
  const n = Math.max(3, Math.round(sides));
  const r = dist2(center, corner);
  const start = Math.atan2(corner[1] - center[1], corner[0] - center[0]);
  const c = ed.pointAt(center, opts.snapped?.[0]);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + (TAU * i) / n;
    ids.push(i === 0 ? ed.pointAt(corner, opts.snapped?.[1]) : ed.point([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]));
  }
  const lines = ed.polyline(ids, true, opts.construction);
  const guide = ed.circle(c, r, true);
  ids.forEach((p) => ed.constrain("onCurve", [p, guide]));
  for (let i = 1; i < lines.length; i++) ed.constrain("equal", [lines[0], lines[i]]);
  return [...lines, guide];
}

/** Kanal: iki paralel çizgi + iki teğet yarım daire. */
export function buildSlot(ed: SketchEdit, a: Vec2, b: Vec2, r: number, opts: BuildOptions = {}): string[] {
  const d = unit(sub(b, a));
  const n: Vec2 = [-d[1], d[0]];
  const ca = ed.pointAt(a, opts.snapped?.[0]);
  const cb = ed.pointAt(b, opts.snapped?.[1]);
  const a1 = ed.point(add(a, mul(n, r)));
  const a2 = ed.point(sub(a, mul(n, r)));
  const b1 = ed.point(add(b, mul(n, r)));
  const b2 = ed.point(sub(b, mul(n, r)));
  const top = ed.line(b1, a1, opts.construction);
  const bottom = ed.line(a2, b2, opts.construction);
  // Yaylar saat yönünün tersine: b etrafında b2 → b1, a etrafında a1 → a2.
  const arcB = ed.arc(cb, b2, b1, opts.construction);
  const arcA = ed.arc(ca, a1, a2, opts.construction);
  ed.constrain("tangent", [top, arcB]);
  ed.constrain("tangent", [top, arcA]);
  ed.constrain("tangent", [bottom, arcB]);
  ed.constrain("tangent", [bottom, arcA]);
  ed.constrain("equal", [arcA, arcB]);
  return [top, bottom, arcA, arcB];
}

/** Üç noktalı yay: başlangıç, bitiş ve üzerinden geçtiği nokta. Doğrusalsa null. */
export function buildArc3(ed: SketchEdit, start: Vec2, end: Vec2, through: Vec2, opts: BuildOptions = {}): string | null {
  const g = arcGeometry(start, through, end);
  if (!g) return null;
  const c = ed.point(g.c);
  const s = ed.pointAt(start, opts.snapped?.[0]);
  const e = ed.pointAt(end, opts.snapped?.[1]);
  // Saat yönündeyse uçları değiştir (model saat yönü tersine yay tutar).
  return g.sweep > 0 ? ed.arc(c, s, e, opts.construction) : ed.arc(c, e, s, opts.construction);
}

export function buildCircle3(ed: SketchEdit, a: Vec2, b: Vec2, c: Vec2, opts: BuildOptions = {}): string | null {
  const g = circleFrom3(a, b, c);
  if (!g) return null;
  return ed.circle(ed.point(g.c), g.r, opts.construction);
}

// ---- köşe yuvarlatma ----

/**
 * İki çizginin paylaştığı köşeyi yuvarlatır: çizgiler kısalır, aralarına teğet bir yay girer.
 * Başarısızsa (paralel çizgiler, yarıçap çok büyük) hata fırlatır.
 */
export function filletCorner(ed: SketchEdit, pointId: string, r: number): string {
  const lines = ed.d.curves.filter(
    (c): c is Extract<SCurve, { kind: "line" }> => c.kind === "line" && (c.p1 === pointId || c.p2 === pointId),
  );
  if (lines.length !== 2) throw new Error("Köşe yuvarlatma için iki çizginin birleştiği bir köşeye tıklayın");
  const pm = ed.pm;
  const v = pm.get(pointId)!;
  const far = lines.map((l) => (l.p1 === pointId ? l.p2 : l.p1));
  const d1 = unit(sub(pm.get(far[0])!, v));
  const d2 = unit(sub(pm.get(far[1])!, v));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) throw new Error("Paralel çizgiler yuvarlatılamaz");
  const t = r / Math.tan(theta / 2);
  const maxT = Math.min(dist2(v, pm.get(far[0])!), dist2(v, pm.get(far[1])!));
  if (t >= maxT - 1e-9) throw new Error("Yarıçap bu köşe için çok büyük");
  const t1 = add(v, mul(d1, t));
  const t2 = add(v, mul(d2, t));
  const center = add(v, mul(unit(add(d1, d2)), r / Math.sin(theta / 2)));
  const p1 = ed.point(t1);
  const p2 = ed.point(t2);
  // Çizgilerin köşe ucu yeni teğet noktalarına taşınır.
  lines[0].p1 === pointId ? (lines[0].p1 = p1) : (lines[0].p2 = p1);
  lines[1].p1 === pointId ? (lines[1].p1 = p2) : (lines[1].p2 = p2);
  const c = ed.point(center);
  // Saat yönü tersine olacak şekilde uçları sırala.
  const ccw = cross(sub(t1, center), sub(t2, center)) > 0;
  const arc = ccw ? ed.arc(c, p1, p2) : ed.arc(c, p2, p1);
  ed.constrain("tangent", [lines[0].id, arc]);
  ed.constrain("tangent", [lines[1].id, arc]);
  ed.constrain("radius", [arc], { value: r6(r) });
  // Köşe noktasına bağlı kısıtlar (çakışık vb.) artık anlamsız; temizle.
  ed.cleanup();
  return arc;
}

// ---- eski (v1) öğelerden dönüştürme ----

/** Eski bütün-şekil öğelerini (dikdörtgen, çizgi listesi, kanal...) yeni modele çevirir. */
export function fromLegacyEntities(entities: readonly SketchEntity[]): SketchData {
  const ed = new SketchEdit();
  const cache = new Map<string, string>();
  // Aynı konumdaki uç noktalar paylaşılsın ki çizgilerden profil oluşsun.
  const P = (p: Vec2): string => {
    const key = `${r6(p[0])},${r6(p[1])}`;
    let id = cache.get(key);
    if (!id) {
      id = ed.point(p);
      cache.set(key, id);
    }
    return id;
  };
  for (const e of entities) {
    const k = e.construction;
    switch (e.kind) {
      case "rect":
        buildRect(ed, [e.a, [e.b[0], e.a[1]], e.b, [e.a[0], e.b[1]]].map((q) => q as Vec2), { construction: k, snapped: [e.a, [e.b[0], e.a[1]], e.b, [e.a[0], e.b[1]]].map((q) => P(q as Vec2)) });
        break;
      case "polyline": {
        const ids = e.points.map(P);
        const lines = ed.polyline(ids, e.closed, k);
        addAutoHV(ed, lines);
        // Yuvarlatılmış köşeler yay olarak yeniden kurulur.
        e.radii?.forEach((r, i) => {
          if (r > 0 && (e.closed || (i > 0 && i < e.points.length - 1))) {
            try {
              filletCorner(ed, ids[i], r);
            } catch {
              /* geçersiz yuvarlatma: köşe keskin kalır */
            }
          }
        });
        break;
      }
      case "circle":
        ed.circle(P(e.c), e.r, k);
        break;
      case "arc": {
        const g = arcGeometry(e.p0, e.p1, e.p2);
        if (!g) {
          ed.line(P(e.p0), P(e.p2), k);
          break;
        }
        const c = P(g.c);
        if (g.sweep > 0) ed.arc(c, P(e.p0), P(e.p2), k);
        else ed.arc(c, P(e.p2), P(e.p0), k);
        break;
      }
      case "slot":
        buildSlot(ed, e.a, e.b, e.r, { construction: k, snapped: [P(e.a), P(e.b)] });
        break;
      case "ellipse":
        ed.ellipse(P(e.c), e.rx, e.ry, e.rot, k);
        break;
      case "spline":
        ed.spline(e.points.map(P), e.closed, k);
        break;
    }
  }
  return ed.result();
}
