import { curvePath, pointMap, SketchEdit, type SketchData } from "./sketchmodel";
import type { Vec2 } from "./solid";

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
const num = (n: number) => String(Number(n.toFixed(6)) + 0);

/** Eskizi DXF (R12, ASCII) metnine çevirir. Yapı çizgileri "YAPI" katmanına yazılır. */
export function sketchToDxf(d: SketchData): string {
  const out: (string | number)[] = [];
  const g = (code: number, value: string | number) => out.push(code, typeof value === "number" ? num(value) : value);
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  const pm = pointMap(d);
  const P = (id: string): Vec2 => pm.get(id) ?? [0, 0];
  for (const c of d.curves) {
    const layer = c.construction ? "YAPI" : "0";
    switch (c.kind) {
      case "line": {
        const [a, b] = [P(c.p1), P(c.p2)];
        g(0, "LINE"); g(8, layer);
        g(10, a[0]); g(20, a[1]); g(30, 0);
        g(11, b[0]); g(21, b[1]); g(31, 0);
        break;
      }
      case "circle": {
        const m = P(c.c);
        g(0, "CIRCLE"); g(8, layer);
        g(10, m[0]); g(20, m[1]); g(30, 0); g(40, c.r);
        break;
      }
      case "arc": {
        const [m, s, e] = [P(c.c), P(c.s), P(c.e)];
        const norm = (a: number) => ((a * DEG) % 360 + 360) % 360;
        g(0, "ARC"); g(8, layer);
        g(10, m[0]); g(20, m[1]); g(30, 0);
        g(40, Math.hypot(s[0] - m[0], s[1] - m[1]));
        g(50, norm(Math.atan2(s[1] - m[1], s[0] - m[0])));
        g(51, norm(Math.atan2(e[1] - m[1], e[0] - m[0])));
        break;
      }
      case "point": {
        const p = P(c.p);
        g(0, "POINT"); g(8, layer); g(10, p[0]); g(20, p[1]); g(30, 0);
        break;
      }
      case "ellipse":
      case "spline": {
        // Serbest eğriler çokgen olarak yazılır (R12'de elips / spline yok).
        const { points, closed } = curvePath(pm, c);
        g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0);
        for (const p of points) {
          g(0, "VERTEX"); g(8, layer); g(10, p[0]); g(20, p[1]); g(30, 0);
        }
        g(0, "SEQEND"); g(8, layer);
        break;
      }
    }
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.map(String).join("\n") + "\n";
}

interface Entity {
  type: string;
  layer: string;
  /** (kod, değer) çiftleri, sırayla. */
  pairs: [number, string][];
}

function tokenize(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) throw new Error(`DXF biçimi geçersiz (satır ${i + 1}: grup kodu bekleniyordu)`);
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

function entitiesOf(pairs: [number, string][]): Entity[] {
  const out: Entity[] = [];
  let inEntities = false;
  let current: Entity | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      inEntities = pairs[i + 1]?.[0] === 2 && pairs[i + 1][1] === "ENTITIES";
      current = null;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      inEntities = false;
      current = null;
      continue;
    }
    if (!inEntities) continue;
    if (code === 0) {
      current = { type: value, layer: "0", pairs: [] };
      out.push(current);
    } else if (current) {
      if (code === 8) current.layer = value;
      current.pairs.push([code, value]);
    }
  }
  return out;
}

const first = (e: Entity, code: number, fallback = 0): number => {
  const hit = e.pairs.find(([c]) => c === code);
  return hit ? Number(hit[1]) : fallback;
};

/** Köşe listesi (x, y, kabarma): LWPOLYLINE ve POLYLINE/VERTEX için ortak biçim. */
type Vertex = { p: Vec2; bulge: number };

function lwVertices(e: Entity): Vertex[] {
  const v: Vertex[] = [];
  let pendingX: number | null = null;
  for (const [code, value] of e.pairs) {
    if (code === 10) pendingX = Number(value);
    else if (code === 20 && pendingX !== null) {
      v.push({ p: [pendingX, Number(value)], bulge: 0 });
      pendingX = null;
    } else if (code === 42 && v.length) v[v.length - 1].bulge = Number(value);
  }
  return v;
}

/** İki köşe arasındaki kabarmalı yay: merkez, yarıçap ve (saat yönünün tersine) başlangıç / bitiş. */
export function bulgeArc(a: Vec2, b: Vec2, bulge: number): { c: Vec2; r: number; s: Vec2; e: Vec2 } | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (!(L > 1e-9) || Math.abs(bulge) < 1e-9) return null;
  const theta = 4 * Math.atan(bulge); // işaretli yay açısı
  const half = theta / 2;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const offset = L / 2 / Math.tan(half);
  const c: Vec2 = [mid[0] + (-dy / L) * offset, mid[1] + (dx / L) * offset];
  const r = Math.abs(L / (2 * Math.sin(half)));
  return bulge > 0 ? { c, r, s: a, e: b } : { c, r, s: b, e: a };
}

export interface DxfImportResult {
  added: number;
  /** Desteklenmeyip atlanan varlık türleri (ve sayıları). */
  skipped: Record<string, number>;
}

/**
 * DXF metnindeki LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, SPLINE, ELLIPSE ve POINT varlıklarını
 * `ed` eskizine ekler. Aynı konumdaki uç noktalar birleştirilir. Birimler olduğu gibi (mm) alınır.
 */
export function importDxf(text: string, ed: SketchEdit): DxfImportResult {
  const entities = entitiesOf(tokenize(text));
  const keyOf = (p: Vec2) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const shared = new Map<string, string>();
  const pt = (p: Vec2): string => {
    const k = keyOf(p);
    const hit = shared.get(k);
    if (hit) return hit;
    const id = ed.point(p);
    shared.set(k, id);
    return id;
  };
  const result: DxfImportResult = { added: 0, skipped: {} };
  const construction = (e: Entity) => /yapi|konstr|constr|guide|aux/i.test(e.layer);
  const polyline = (vs: Vertex[], closed: boolean, cons: boolean) => {
    const n = closed ? vs.length : vs.length - 1;
    for (let i = 0; i < n; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const arc = bulgeArc(a.p, b.p, a.bulge);
      if (arc) {
        // Yayın uçları bulunduğu konumda ortak noktaya bağlanır; merkez ayrı bir nokta
        ed.arc(ed.point(arc.c), pt(arc.s), pt(arc.e), cons);
      } else if (Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) > 1e-9) {
        ed.line(pt(a.p), pt(b.p), cons);
      } else continue;
      result.added++;
    }
  };
  const sampled = (points: Vec2[], closed: boolean, cons: boolean) => polyline(points.map((p) => ({ p, bulge: 0 })), closed, cons);
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const cons = construction(e);
    switch (e.type) {
      case "LINE": {
        const a: Vec2 = [first(e, 10), first(e, 20)];
        const b: Vec2 = [first(e, 11), first(e, 21)];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) {
          ed.line(pt(a), pt(b), cons);
          result.added++;
        }
        break;
      }
      case "CIRCLE": {
        const r = first(e, 40);
        if (r > 0) {
          ed.circle(ed.point([first(e, 10), first(e, 20)]), r, cons);
          result.added++;
        }
        break;
      }
      case "ARC": {
        const c: Vec2 = [first(e, 10), first(e, 20)];
        const r = first(e, 40);
        const a0 = (first(e, 50) / DEG) % TAU;
        const a1 = (first(e, 51) / DEG) % TAU;
        if (r > 0) {
          ed.arc(ed.point(c), pt([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)]), pt([c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)]), cons);
          result.added++;
        }
        break;
      }
      case "POINT":
        ed.standalone(pt([first(e, 10), first(e, 20)]));
        result.added++;
        break;
      case "LWPOLYLINE":
        polyline(lwVertices(e), (first(e, 70) & 1) === 1, cons);
        break;
      case "POLYLINE": {
        // R12 biçimi: ardışık VERTEX varlıkları SEQEND'e kadar sürer.
        const vs: Vertex[] = [];
        let j = i + 1;
        for (; j < entities.length && entities[j].type !== "SEQEND"; j++) {
          if (entities[j].type === "VERTEX") vs.push({ p: [first(entities[j], 10), first(entities[j], 20)], bulge: first(entities[j], 42) });
        }
        i = j;
        polyline(vs, (first(e, 70) & 1) === 1, cons);
        break;
      }
      case "SPLINE": {
        const fit: Vec2[] = [];
        const ctrl: Vec2[] = [];
        let px: number | null = null;
        let kind: 10 | 11 | null = null;
        for (const [code, value] of e.pairs) {
          if (code === 10 || code === 11) {
            px = Number(value);
            kind = code;
          } else if ((code === 20 || code === 21) && px !== null && kind !== null) {
            (kind === 11 ? fit : ctrl).push([px, Number(value)]);
            px = null;
          }
        }
        const pts = fit.length >= 2 ? fit : ctrl;
        if (pts.length >= 2) sampled(pts, (first(e, 70) & 1) === 1, cons);
        break;
      }
      case "ELLIPSE": {
        const c: Vec2 = [first(e, 10), first(e, 20)];
        const major: Vec2 = [first(e, 11), first(e, 21)];
        const ratio = first(e, 40, 1);
        const a = Math.hypot(major[0], major[1]);
        const rot = Math.atan2(major[1], major[0]);
        const t0 = first(e, 41, 0);
        let t1 = first(e, 42, TAU);
        if (t1 <= t0) t1 += TAU;
        const full = Math.abs(t1 - t0 - TAU) < 1e-6;
        const n = 64;
        const pts: Vec2[] = [];
        for (let k = 0; k <= (full ? n - 1 : n); k++) {
          const t = t0 + ((t1 - t0) * k) / n;
          const x = a * Math.cos(t);
          const y = a * ratio * Math.sin(t);
          pts.push([c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
        }
        sampled(pts, full, cons);
        break;
      }
      case "VERTEX":
      case "SEQEND":
        break;
      default:
        result.skipped[e.type] = (result.skipped[e.type] ?? 0) + 1;
    }
  }
  return result;
}
