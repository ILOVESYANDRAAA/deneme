import type { Vec2, Vec3 } from "./solid";

export type PlaneName = "XY" | "XZ" | "YZ";

export interface PlaneInfo {
  label: string;
  /** Eskizin yatay ekseni (u), dikey ekseni (v) ve normali (n) dünya koordinatlarında. u × v = n. */
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Başlangıç düzlemleri. Ekstrüzyon normal (n) yönünde yapılır. */
export const PLANES: Record<PlaneName, PlaneInfo> = {
  XY: { label: "XY (Üst)", u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  XZ: { label: "XZ (Ön)", u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  YZ: { label: "YZ (Sağ)", u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

/** Serbest eskiz düzlemi (örn. bir gövde yüzeyi): başlangıç noktası ve (u, v, n) eksenleri. u × v = n. */
export interface PlaneFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Eskizin üzerinde durduğu düzlem: başlangıç düzlemlerinden biri ya da serbest çerçeve. */
export type PlaneRef = PlaneName | PlaneFrame;

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Düzlemin başlangıç noktası ve eksenleri. */
export function frameOf(ref: PlaneRef): PlaneFrame {
  if (typeof ref !== "string") return ref;
  return { origin: [0, 0, 0], ...PLANES[ref] };
}

export function planeLabel(ref: PlaneRef): string {
  return typeof ref === "string" ? PLANES[ref].label : "Yüzey";
}

/** İki düzlemin aynı olup olmadığını (eskiz yeniden kurulsun mu?) anlamak için kısa anahtar. */
export function planeKey(ref: PlaneRef): string {
  return typeof ref === "string" ? ref : JSON.stringify(ref);
}

/**
 * Yüzey noktası ve dışa bakan normalden eskiz çerçevesi: başlangıç noktası, dünya başlangıcının düzleme
 * izdüşümüdür (üst yüzde eskiz orijini dünya orijininin üstünde kalır); u yatay, v "yukarı" bakar.
 */
export function frameFromFace(point: Vec3, normal: Vec3): PlaneFrame {
  const n = unit3(normal);
  const d = n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
  const round = (v: Vec3): Vec3 => v.map((x) => Math.round(x * 1e6) / 1e6 + 0) as Vec3;
  const origin: Vec3 = [n[0] * d, n[1] * d, n[2] * d];
  const u = Math.abs(n[2]) > 0.999 ? ([1, 0, 0] as Vec3) : unit3(cross3([0, 0, 1], n));
  const v = cross3(n, u);
  return { origin: round(origin), u: round(u), v: round(v), n: round(n) };
}

export function isPlaneName(value: unknown): value is PlaneName {
  return value === "XY" || value === "XZ" || value === "YZ";
}

/**
 * Eskiz öğeleri. `construction` (yapı çizgisi) öğeler sadece yardımcıdır: çizilir ve
 * yakalanır ama profile katılmaz.
 */
export type SketchEntity = (
  /** `radii`: köşe başına yuvarlatma yarıçapı (0 = keskin). Açık çizginin uçları yuvarlatılmaz. */
  | { kind: "polyline"; points: Vec2[]; closed: boolean; radii?: number[] }
  | { kind: "rect"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number }
  /** Üç noktalı yay: başlangıç, üzerinden geçtiği nokta, bitiş. */
  | { kind: "arc"; p0: Vec2; p1: Vec2; p2: Vec2 }
  /** Merkezden merkeze kanal: iki yarım daire merkezi ve yarıçap. */
  | { kind: "slot"; a: Vec2; b: Vec2; r: number }
  /** `rot`: büyük eksenin u eksenine göre açısı (radyan). */
  | { kind: "ellipse"; c: Vec2; rx: number; ry: number; rot: number }
  /** Noktalardan geçen yumuşak eğri (Catmull-Rom). */
  | { kind: "spline"; points: Vec2[]; closed: boolean }
) & { construction?: boolean };

export type SketchEntityKind = SketchEntity["kind"];

export const CIRCLE_SEGMENTS = 96;

/** Eskizin yerel (u, v, n) koordinatlarını dünyaya taşıyan 4×4 matris (sütun öncelikli). */
export function planeMatrix(plane: PlaneRef, offset = 0): number[] {
  const { origin, u, v, n } = frameOf(plane);
  return [...u, 0, ...v, 0, ...n, 0, origin[0] + n[0] * offset, origin[1] + n[1] * offset, origin[2] + n[2] * offset, 1];
}

export function toWorld(plane: PlaneRef, offset: number, [a, b]: Vec2): Vec3 {
  const { origin, u, v, n } = frameOf(plane);
  return [0, 1, 2].map((i) => origin[i] + u[i] * a + v[i] * b + n[i] * offset) as Vec3;
}

// ---- küçük 2B yardımcılar ----

const EPS = 1e-9;
/** Uç noktaların "aynı" sayıldığı mesafe (birleşen çizgiler için). */
const JOIN_TOL = 1e-6;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const samePoint = (a: Vec2, b: Vec2, tol = JOIN_TOL): boolean => dist(a, b) <= tol;
const round6 = (n: number): number => Number(n.toFixed(6)) + 0;
export const roundPoint = (p: Vec2): Vec2 => [round6(p[0]), round6(p[1])];

function unit(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? [1, 0] : [a[0] / l, a[1] / l];
}

/** Sola dik birim vektör. */
export function perp(a: Vec2): Vec2 {
  const u = unit(a);
  return [-u[1], u[0]];
}

function circlePoints(c: Vec2, r: number, segments = CIRCLE_SEGMENTS): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

function rectPoints(a: Vec2, b: Vec2): Vec2[] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

/** Üç noktadan geçen çember; noktalar doğrusal ise null. */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const scaleRef = Math.max(dist(a, b), dist(b, c), dist(a, c), 1e-12);
  if (Math.abs(d) < 1e-9 * scaleRef * scaleRef) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const center: Vec2 = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
  return { c: center, r: dist(center, a) };
}

/** Yayın merkezi, yarıçapı, başlangıç açısı ve işaretli taradığı açı (radyan). Doğrusal noktalarda null. */
export function arcGeometry(p0: Vec2, p1: Vec2, p2: Vec2): { c: Vec2; r: number; start: number; sweep: number } | null {
  const circle = circleFrom3(p0, p1, p2);
  if (!circle) return null;
  const ang = (p: Vec2) => Math.atan2(p[1] - circle.c[1], p[0] - circle.c[0]);
  const tau = 2 * Math.PI;
  const norm = (a: number) => ((a % tau) + tau) % tau;
  const a0 = ang(p0);
  const ccw = norm(ang(p2) - a0);
  const through = norm(ang(p1) - a0);
  const sweep = through < ccw ? ccw : ccw - tau;
  return { c: circle.c, r: circle.r, start: a0, sweep };
}

function arcPoints(c: Vec2, r: number, start: number, sweep: number, perCircle = CIRCLE_SEGMENTS): Vec2[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * perCircle));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

/** Merkez ve köşe noktasından düzgün çokgen köşeleri. */
export function polygonPoints(c: Vec2, corner: Vec2, sides: number): Vec2[] {
  const n = Math.max(3, Math.round(sides));
  const r = dist(c, corner);
  const start = Math.atan2(corner[1] - c[1], corner[0] - c[0]);
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + (2 * Math.PI * i) / n;
    pts.push(roundPoint([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]));
  }
  return pts;
}

/** Köşe yuvarlatmalı çizgi noktaları. */
function filletedPolyline(points: Vec2[], closed: boolean, radii: number[] | undefined, perCircle: number): Vec2[] {
  if (!radii || !radii.some((r) => r > EPS) || points.length < 3) return points.map((p) => [p[0], p[1]]);
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = points[i];
    const r = radii[i] ?? 0;
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd || r <= EPS) {
      out.push([v[0], v[1]]);
      continue;
    }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const d1 = unit(sub(prev, v));
    const d2 = unit(sub(next, v));
    const cos = Math.min(1, Math.max(-1, dot(d1, d2)));
    const theta = Math.acos(cos);
    if (theta < 1e-6 || Math.PI - theta < 1e-6) {
      out.push([v[0], v[1]]);
      continue;
    }
    // Teğet noktası köşeden t uzakta; komşu kenarın yarısını geçmesin (iki köşe de yuvarlatılabilsin).
    const maxT = Math.min(dist(prev, v), dist(next, v)) * 0.5;
    const t = Math.min(r / Math.tan(theta / 2), maxT);
    const rr = t * Math.tan(theta / 2);
    const t1 = add(v, scale(d1, t));
    const t2 = add(v, scale(d2, t));
    const center = add(v, scale(unit(add(d1, d2)), rr / Math.sin(theta / 2)));
    const a1 = Math.atan2(t1[1] - center[1], t1[0] - center[0]);
    let sweep = Math.atan2(t2[1] - center[1], t2[0] - center[0]) - a1;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    out.push(...arcPoints(center, rr, a1, sweep, perCircle));
  }
  return out;
}

function ellipsePoints(c: Vec2, rx: number, ry: number, rot: number, segments = CIRCLE_SEGMENTS): Vec2[] {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
  }
  return pts;
}

function slotPoints(a: Vec2, b: Vec2, r: number, perCircle = CIRCLE_SEGMENTS): Vec2[] {
  if (samePoint(a, b)) return circlePoints(a, r, perCircle);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // b etrafında sağdan sola, a etrafında soldan sağa yarım daireler.
  const right = arcPoints(b, r, ang - Math.PI / 2, Math.PI, perCircle);
  const left = arcPoints(a, r, ang + Math.PI / 2, Math.PI, perCircle);
  return [...right, ...left];
}

/** Catmull-Rom eğrisi; kontrol noktalarından geçer. */
function splinePoints(points: Vec2[], closed: boolean, perSpan = 16): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  const at = (i: number): Vec2 => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return sub(scale(points[0], 2), points[1]);
    if (i >= n) return sub(scale(points[n - 1], 2), points[n - 2]);
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

/**
 * Öğenin örneklenmiş yolu. Kapalı yollarda son nokta tekrar edilmez.
 * `fine = false` ekranda çizim için daha az nokta kullanır.
 */
export function entityPath(e: SketchEntity, fine = true): { points: Vec2[]; closed: boolean } {
  const seg = fine ? CIRCLE_SEGMENTS : 64;
  switch (e.kind) {
    case "polyline":
      return { points: filletedPolyline(e.points, e.closed, e.radii, seg), closed: e.closed };
    case "rect":
      return { points: rectPoints(e.a, e.b), closed: true };
    case "circle":
      return { points: circlePoints(e.c, e.r, seg), closed: true };
    case "arc": {
      const g = arcGeometry(e.p0, e.p1, e.p2);
      if (!g) return { points: [e.p0, e.p2].map((p) => [p[0], p[1]] as Vec2), closed: false };
      const pts = arcPoints(g.c, g.r, g.start, g.sweep, seg);
      // Uçlar birebir tıklanan noktalar olsun ki başka çizgilerle birleşebilsin.
      pts[0] = [e.p0[0], e.p0[1]];
      pts[pts.length - 1] = [e.p2[0], e.p2[1]];
      return { points: pts, closed: false };
    }
    case "slot":
      return { points: slotPoints(e.a, e.b, e.r, seg), closed: true };
    case "ellipse":
      return { points: ellipsePoints(e.c, e.rx, e.ry, e.rot, seg), closed: true };
    case "spline":
      return { points: splinePoints(e.points, e.closed, fine ? 16 : 10), closed: e.closed };
  }
}

/** Öğe tek başına kapalı ve geçerli bir profil mi? */
function isValidClosed(e: SketchEntity): boolean {
  switch (e.kind) {
    case "polyline":
    case "spline":
      return e.closed && e.points.length >= 3;
    case "rect":
      return Math.abs(e.a[0] - e.b[0]) > EPS && Math.abs(e.a[1] - e.b[1]) > EPS;
    case "circle":
    case "slot":
      return e.r > EPS;
    case "ellipse":
      return e.rx > EPS && e.ry > EPS;
    case "arc":
      return false;
  }
}

/**
 * Uç uca eklenmiş açık yollardan kapalı döngüler bulur (ör. dört ayrı çizgi ya da
 * çizgi + yay). Önce dallanmadan kalan ölü uçlar ayıklanır, sonra her döngü yürünerek çıkarılır.
 */
export function findLoops(paths: Vec2[][]): Vec2[][] {
  const edges = paths.filter((p) => p.length >= 2);
  // Uç noktaları düğümlere eşle.
  const nodes: Vec2[] = [];
  const nodeOf = (p: Vec2): number => {
    const i = nodes.findIndex((n) => samePoint(n, p));
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const list = edges.map((pts) => ({ pts, a: nodeOf(pts[0]), b: nodeOf(pts[pts.length - 1]), alive: true }));
  const loops: Vec2[][] = [];
  // Kendi üstüne kapanan tek yol (ilk ve son nokta aynı).
  for (const e of list) {
    if (e.a === e.b) {
      e.alive = false;
      if (e.pts.length >= 4) loops.push(e.pts.slice(0, -1));
    }
  }
  // Derecesi 1 olan düğümlere bağlı kenarları tekrar tekrar ayıkla.
  for (let changed = true; changed; ) {
    changed = false;
    const degree = new Map<number, number>();
    for (const e of list) {
      if (!e.alive) continue;
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    for (const e of list) {
      if (e.alive && ((degree.get(e.a) ?? 0) < 2 || (degree.get(e.b) ?? 0) < 2)) {
        e.alive = false;
        changed = true;
      }
    }
  }
  const used = new Set<number>();
  for (let s = 0; s < list.length; s++) {
    if (!list[s].alive || used.has(s)) continue;
    used.add(s);
    const chainNodes = [list[s].a];
    const chainEdges: { i: number; reversed: boolean }[] = [{ i: s, reversed: false }];
    let at = list[s].b;
    for (let guard = 0; guard < list.length + 1; guard++) {
      const seen = chainNodes.indexOf(at);
      if (seen >= 0) {
        // Döngü kapandı (başlangıçta ya da yolun ortasında).
        const loopEdges = chainEdges.slice(seen);
        const pts: Vec2[] = [];
        for (const { i, reversed } of loopEdges) {
          const p = reversed ? [...list[i].pts].reverse() : list[i].pts;
          pts.push(...p.slice(0, -1).map((q) => [q[0], q[1]] as Vec2));
        }
        if (pts.length >= 3) loops.push(pts);
        break;
      }
      chainNodes.push(at);
      const next = list.findIndex((e, i) => e.alive && !used.has(i) && (e.a === at || e.b === at));
      if (next < 0) break;
      used.add(next);
      const reversed = list[next].b === at;
      chainEdges.push({ i: next, reversed });
      at = reversed ? list[next].a : list[next].b;
    }
  }
  return loops;
}

/** Kapalı profiller (katıya çevrilebilen şekiller). Yapı çizgileri ve döngü oluşturmayan açık çizgiler hariç. */
export function sketchProfiles(entities: readonly SketchEntity[]): Vec2[][] {
  const out: Vec2[][] = [];
  const open: Vec2[][] = [];
  for (const e of entities) {
    if (e.construction) continue;
    if (isValidClosed(e)) out.push(entityPath(e).points);
    else if (e.kind === "arc" || ((e.kind === "polyline" || e.kind === "spline") && !e.closed)) open.push(entityPath(e).points);
  }
  return [...out, ...findLoops(open)];
}

/** Nokta çokgenin içinde mi (çift-tek kuralı)? */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Profilleri çift-tek kuralına göre dolu bölgelere ayırır: her dış sınır, doğrudan
 * içindeki delikleriyle. Ekranda profil gölgelendirmesi için kullanılır.
 */
export function profileRegions(profiles: readonly Vec2[][]): { outer: Vec2[]; holes: Vec2[][] }[] {
  const depth = profiles.map((p, i) => profiles.filter((q, j) => j !== i && pointInPolygon(p[0], q)).length);
  const area = (p: readonly Vec2[]) => Math.abs(p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]), 0) / 2);
  const regions: { outer: Vec2[]; holes: Vec2[][]; index: number }[] = [];
  profiles.forEach((p, i) => {
    if (depth[i] % 2 === 0) regions.push({ outer: p as Vec2[], holes: [], index: i });
  });
  profiles.forEach((p, i) => {
    if (depth[i] % 2 === 0) return;
    // Deliği, onu içeren en küçük ve bir seviye dıştaki bölgeye ekle.
    const owners = regions.filter((r) => depth[r.index] === depth[i] - 1 && pointInPolygon(p[0], r.outer));
    owners.sort((a, b) => area(a.outer) - area(b.outer));
    owners[0]?.holes.push(p as Vec2[]);
  });
  return regions.map(({ outer, holes }) => ({ outer, holes }));
}

/** Çizim için çizgi parçaları (eskiz düzleminde). */
export function sketchSegments(entities: readonly SketchEntity[]): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = [];
  for (const e of entities) {
    const { points, closed } = entityPath(e, false);
    for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
    if (closed && points.length > 2) segs.push([points[points.length - 1], points[0]]);
  }
  return segs;
}

export type SnapKind = "köşe" | "merkez" | "orta nokta";

/** Yakalama (snap) noktaları: köşeler, uçlar, merkezler ve düz kenarların ortaları. */
export function sketchSnapPoints(entities: readonly SketchEntity[]): { p: Vec2; kind: SnapKind }[] {
  const out: { p: Vec2; kind: SnapKind }[] = [];
  const corner = (p: Vec2) => out.push({ p, kind: "köşe" });
  const center = (p: Vec2) => out.push({ p, kind: "merkez" });
  const mids = (pts: Vec2[], closed: boolean) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: "orta nokta" });
    }
  };
  for (const e of entities) {
    switch (e.kind) {
      case "polyline":
        e.points.forEach(corner);
        if (!e.radii?.some((r) => r > 0)) mids(e.points, e.closed);
        break;
      case "rect": {
        const pts = rectPoints(e.a, e.b);
        pts.forEach(corner);
        mids(pts, true);
        center([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]);
        break;
      }
      case "circle":
      case "ellipse":
        center(e.c);
        break;
      case "arc": {
        corner(e.p0);
        corner(e.p2);
        const g = arcGeometry(e.p0, e.p1, e.p2);
        if (g) center(g.c);
        break;
      }
      case "slot":
        center(e.a);
        center(e.b);
        break;
      case "spline":
        e.points.forEach(corner);
        break;
    }
  }
  return out;
}

/** Noktanın bir parçaya uzaklığı. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** `p` noktasına `tol` mesafeden yakın en yakın öğenin indeksi (yoksa -1). */
export function hitEntity(entities: readonly SketchEntity[], p: Vec2, tol: number): number {
  let best = -1;
  let bestDist = tol;
  entities.forEach((e, i) => {
    const { points, closed } = entityPath(e, false);
    const n = points.length;
    for (let k = 0; k < n - (closed ? 0 : 1); k++) {
      const d = distToSegment(p, points[k], points[(k + 1) % n]);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
  });
  return best;
}

/** Yuvarlatılabilecek en yakın köşe: çizgi köşeleri ve dikdörtgen köşeleri. */
export function hitCorner(entities: readonly SketchEntity[], p: Vec2, tol: number): { entity: number; vertex: number } | null {
  let best: { entity: number; vertex: number } | null = null;
  let bestDist = tol;
  entities.forEach((e, i) => {
    let pts: Vec2[] = [];
    let closed = true;
    if (e.kind === "polyline") {
      pts = e.points;
      closed = e.closed;
    } else if (e.kind === "rect") pts = rectPoints(e.a, e.b);
    pts.forEach((q, k) => {
      if (!closed && (k === 0 || k === pts.length - 1)) return;
      const d = dist(p, q);
      if (d <= bestDist) {
        bestDist = d;
        best = { entity: i, vertex: k };
      }
    });
  });
  return best;
}

/** Köşeyi yuvarlatır (r = 0 köşeyi keskinleştirir). Dikdörtgen yuvarlatılınca çizgiye dönüşür. */
export function filletCorner(e: SketchEntity, vertex: number, r: number): SketchEntity {
  const base: Extract<SketchEntity, { kind: "polyline" }> =
    e.kind === "rect"
      ? { kind: "polyline", points: rectPoints(e.a, e.b), closed: true, ...(e.construction ? { construction: true } : {}) }
      : e.kind === "polyline"
        ? { ...e, points: e.points.map((p) => [p[0], p[1]] as Vec2) }
        : (() => {
            throw new Error("Sadece çizgi ve dikdörtgen köşeleri yuvarlatılabilir");
          })();
  const radii = base.points.map((_, i) => base.radii?.[i] ?? 0);
  radii[vertex] = Math.max(0, r);
  return { ...base, radii };
}

/** Öğeyi eskizin dikey (V: u → −u) ya da yatay (U: v → −v) ekseninde aynalar. */
export function mirrorEntity(e: SketchEntity, axis: "U" | "V"): SketchEntity {
  const m = ([a, b]: Vec2): Vec2 => (axis === "V" ? [-a, b] : [a, -b]) as Vec2;
  const fix = (p: Vec2) => roundPoint(m(p));
  switch (e.kind) {
    case "polyline":
      return { ...e, points: e.points.map(fix) };
    case "rect":
      return { ...e, a: fix(e.a), b: fix(e.b) };
    case "circle":
      return { ...e, c: fix(e.c) };
    case "arc":
      return { ...e, p0: fix(e.p0), p1: fix(e.p1), p2: fix(e.p2) };
    case "slot":
      return { ...e, a: fix(e.a), b: fix(e.b) };
    case "ellipse":
      return { ...e, c: fix(e.c), rot: round6(axis === "V" ? Math.PI - e.rot : -e.rot) };
    case "spline":
      return { ...e, points: e.points.map(fix) };
  }
}

export const ENTITY_LABELS: Record<SketchEntityKind, string> = {
  polyline: "Çizgi",
  rect: "Dikdörtgen",
  circle: "Daire",
  arc: "Yay",
  slot: "Kanal",
  ellipse: "Elips",
  spline: "Eğri",
};

export function describeSketch(entities: readonly SketchEntity[]): string {
  const profiles = sketchProfiles(entities).length;
  if (entities.length === 0) return "Boş eskiz";
  const construction = entities.filter((e) => e.construction).length;
  return `${entities.length} öğe · ${profiles} kapalı profil${construction ? ` · ${construction} yapı çizgisi` : ""}`;
}

/**
 * 1-5-10 dizisinden, `min`'den büyük ilk adım. 2'li adımlar bilerek yok:
 * hangi yakınlaştırmada olursa olsun 5 ve 10 gibi yuvarlak ölçüler tutturulabilsin.
 */
export function niceStep(min: number): number {
  const steps = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000];
  return steps.find((s) => s >= min) ?? 1000;
}

export function snapToGrid([a, b]: Vec2, step: number): Vec2 {
  const r = (x: number) => Number((Math.round(x / step) * step).toFixed(6)) + 0;
  return [r(a), r(b)];
}
