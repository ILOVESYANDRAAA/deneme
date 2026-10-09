/**
 * Eskizde seçim ve yakalama yardımcıları (saf mantık): dikdörtgenle seçim ve diğer noktalarla hizalama.
 */
import { arcInfo, curveById, curveSegments, pointMap, type SketchData } from "./sketchmodel";
import type { Vec2 } from "./solid";

export interface Box {
  min: Vec2;
  max: Vec2;
}

export const boxOf = (a: Vec2, b: Vec2): Box => ({
  min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
});

const inside = (p: Vec2, box: Box) => p[0] >= box.min[0] && p[0] <= box.max[0] && p[1] >= box.min[1] && p[1] <= box.max[1];

/** a–b doğru parçası dikdörtgenle kesişiyor mu? (Liang–Barsky) */
function segmentHitsBox(a: Vec2, b: Vec2, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
    return true;
  };
  return (
    clip(-d[0], a[0] - box.min[0]) &&
    clip(d[0], box.max[0] - a[0]) &&
    clip(-d[1], a[1] - box.min[1]) &&
    clip(d[1], box.max[1] - a[1]) &&
    t0 <= t1
  );
}

/**
 * Dikdörtgenin seçtiği eğriler. `crossing` kapalıysa (pencere seçimi) eğrinin tamamı içeride olmalı;
 * açıksa (kesen seçim) herhangi bir parçası dikdörtgene değmesi yeter.
 */
export function curvesInBox(d: SketchData, box: Box, crossing: boolean): string[] {
  const pm = pointMap(d);
  const out: string[] = [];
  for (const c of d.curves) {
    if (c.kind === "point") {
      const p = pm.get(c.p);
      if (p && inside(p, box)) out.push(c.id);
      continue;
    }
    const segs = curveSegments(d, c, pm);
    if (!segs.length) continue;
    const hit = crossing
      ? segs.some(([a, b]) => inside(a, box) || inside(b, box) || segmentHitsBox(a, b, box))
      : segs.every(([a, b]) => inside(a, box) && inside(b, box));
    if (hit) out.push(c.id);
  }
  return out;
}

export interface Alignment {
  /** İmleçle aynı x'te olan kaynak nokta (dikey kılavuz). */
  x?: Vec2;
  /** İmleçle aynı y'de olan kaynak nokta (yatay kılavuz). */
  y?: Vec2;
}

/**
 * İmleç, başka noktalarla yatay / dikey hizaya `tol` içinde yaklaştıysa o hizaları bulur
 * (her eksende imlece en yakın kaynak).
 */
export function findAlignment(sources: readonly Vec2[], raw: Vec2, tol: number): Alignment {
  const out: Alignment = {};
  let bestX = tol;
  let bestY = tol;
  for (const s of sources) {
    const dx = Math.abs(s[0] - raw[0]);
    const dy = Math.abs(s[1] - raw[1]);
    // Aynı eksende birden çok aday varsa imlece daha yakın olanı seç.
    if (dx < bestX || (dx === bestX && out.x && Math.abs(s[1] - raw[1]) < Math.abs(out.x[1] - raw[1]))) {
      bestX = dx;
      out.x = s;
    }
    if (dy < bestY || (dy === bestY && out.y && Math.abs(s[0] - raw[0]) < Math.abs(out.y[0] - raw[0]))) {
      bestY = dy;
      out.y = s;
    }
  }
  return out;
}

export interface CurveSnap {
  /** Eğri üzerindeki en yakın nokta. */
  p: Vec2;
  curveId: string;
}

const TAU = Math.PI * 2;

/**
 * İmlece en yakın eğri noktası (çizgi, daire, yay: çözücünün "eğri üzerinde" kısıtı kurabildikleri).
 * `tol` içinde eğri yoksa null; `only` verilirse yalnızca o eğri bakılır.
 */
export function nearestOnCurve(d: SketchData, raw: Vec2, tol: number, only?: string): CurveSnap | null {
  const pm = pointMap(d);
  let best: CurveSnap | null = null;
  let bestDist = tol;
  const consider = (p: Vec2, curveId: string) => {
    const dd = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
    if (dd <= bestDist) {
      bestDist = dd;
      best = { p, curveId };
    }
  };
  for (const c of only ? [curveById(d, only)].filter((x) => !!x) : d.curves) {
    if (!c) continue;
    if (c.kind === "line") {
      const a = pm.get(c.p1)!;
      const b = pm.get(c.p2)!;
      const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (l2 < 1e-18) continue;
      const t = Math.max(0, Math.min(1, ((raw[0] - a[0]) * ab[0] + (raw[1] - a[1]) * ab[1]) / l2));
      consider([a[0] + ab[0] * t, a[1] + ab[1] * t], c.id);
    } else if (c.kind === "circle") {
      const o = pm.get(c.c)!;
      const v: Vec2 = [raw[0] - o[0], raw[1] - o[1]];
      const l = Math.hypot(v[0], v[1]);
      if (l < 1e-12) continue;
      consider([o[0] + (v[0] / l) * c.r, o[1] + (v[1] / l) * c.r], c.id);
    } else if (c.kind === "arc") {
      const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
      const v: Vec2 = [raw[0] - g.c[0], raw[1] - g.c[1]];
      const l = Math.hypot(v[0], v[1]);
      if (l < 1e-12) continue;
      // Yayın açısal aralığında mı? (uçlar noktalarla yakalanır)
      const rel = (((Math.atan2(v[1], v[0]) - g.a0) % TAU) + TAU) % TAU;
      if (rel > g.sweep) continue;
      consider([g.c[0] + (v[0] / l) * g.r, g.c[1] + (v[1] / l) * g.r], c.id);
    }
  }
  return best;
}
