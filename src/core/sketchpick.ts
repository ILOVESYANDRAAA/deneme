/**
 * Eskizde seçim ve yakalama yardımcıları (saf mantık): dikdörtgenle seçim ve diğer noktalarla hizalama.
 */
import { curveSegments, pointMap, type SketchData } from "./sketchmodel";
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
