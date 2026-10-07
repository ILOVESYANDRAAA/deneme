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

export function isPlaneName(value: unknown): value is PlaneName {
  return value === "XY" || value === "XZ" || value === "YZ";
}

export type SketchEntity =
  | { kind: "polyline"; points: Vec2[]; closed: boolean }
  | { kind: "rect"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number };

export const CIRCLE_SEGMENTS = 96;

/** Eskizin yerel (u, v, n) koordinatlarını dünyaya taşıyan 4×4 matris (sütun öncelikli). */
export function planeMatrix(plane: PlaneName, offset = 0): number[] {
  const { u, v, n } = PLANES[plane];
  return [...u, 0, ...v, 0, ...n, 0, n[0] * offset, n[1] * offset, n[2] * offset, 1];
}

export function toWorld(plane: PlaneName, offset: number, [a, b]: Vec2): Vec3 {
  const { u, v, n } = PLANES[plane];
  return [0, 1, 2].map((i) => u[i] * a + v[i] * b + n[i] * offset) as Vec3;
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

const EPS = 1e-9;

/** Kapalı profiller (katıya çevrilebilen şekiller). Açık çizgiler yardımcı çizgi sayılır. */
export function sketchProfiles(entities: readonly SketchEntity[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const e of entities) {
    if (e.kind === "polyline" && e.closed && e.points.length >= 3) out.push(e.points.map((p) => [p[0], p[1]]));
    if (e.kind === "rect" && Math.abs(e.a[0] - e.b[0]) > EPS && Math.abs(e.a[1] - e.b[1]) > EPS) {
      out.push(rectPoints(e.a, e.b));
    }
    if (e.kind === "circle" && e.r > EPS) out.push(circlePoints(e.c, e.r));
  }
  return out;
}

/** Çizim için çizgi parçaları: [a0, a1, b0, b1, ...] (eskiz düzleminde). */
export function sketchSegments(entities: readonly SketchEntity[]): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = [];
  const loop = (pts: Vec2[], closed: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
    if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  };
  for (const e of entities) {
    if (e.kind === "polyline") loop(e.points, e.closed);
    if (e.kind === "rect") loop(rectPoints(e.a, e.b), true);
    if (e.kind === "circle") loop(circlePoints(e.c, e.r, 64), true);
  }
  return segs;
}

/** Yakalama (snap) noktaları: köşeler ve daire merkezleri. */
export function sketchSnapPoints(entities: readonly SketchEntity[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const e of entities) {
    if (e.kind === "polyline") pts.push(...e.points);
    if (e.kind === "rect") pts.push(...rectPoints(e.a, e.b));
    if (e.kind === "circle") pts.push(e.c);
  }
  return pts;
}

export function describeSketch(entities: readonly SketchEntity[]): string {
  const profiles = sketchProfiles(entities).length;
  if (entities.length === 0) return "Boş eskiz";
  return `${entities.length} öğe · ${profiles} kapalı profil`;
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
  const r = (x: number) => Number((Math.round(x / step) * step).toFixed(6));
  return [r(a), r(b)];
}
