/**
 * Eskiz düzenleme işlemleri (saf geometri): kırp, uzat, ofset, taşı / döndür ve desen.
 * Hepsi `SketchEdit` üzerinde çalışır; sonucu çözücüyle çözmek çağıranın işidir.
 */
import { arcInfo, curveById, curvePoints, dist2, round2, type SCurve, type SketchData, type SketchEdit } from "./sketchmodel";
import type { Vec2 } from "./solid";

const TAU = 2 * Math.PI;
const EPS = 1e-9;
/** Parametre (0..1) uçlarına bu kadar yakın kesişimler "uçta" sayılır. */
const END_TOL = 1e-6;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < EPS ? [1, 0] : [a[0] / l, a[1] / l];
};
const leftOf = (d: Vec2): Vec2 => [-d[1], d[0]];

// ---- kesişimler ----

function lineLine(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { p: Vec2; t: number; u: number } | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const q = sub(b1, a1);
  const t = (q[0] * s[1] - q[1] * s[0]) / den;
  const u = (q[0] * r[1] - q[1] * r[0]) / den;
  return { p: [a1[0] + t * r[0], a1[1] + t * r[1]], t, u };
}

function lineCircle(p1: Vec2, p2: Vec2, c: Vec2, r: number): { p: Vec2; t: number }[] {
  const d = sub(p2, p1);
  const f = sub(p1, c);
  const A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const ts = disc < 1e-9 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map((t) => ({ p: [p1[0] + t * d[0], p1[1] + t * d[1]] as Vec2, t }));
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist2(c1, c2);
  if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ux = (c2[0] - c1[0]) / d;
  const uy = (c2[1] - c1[1]) / d;
  const mx = c1[0] + a * ux;
  const my = c1[1] + a * uy;
  if (h < 1e-9) return [[mx, my]];
  return [
    [mx - h * uy, my + h * ux],
    [mx + h * uy, my - h * ux],
  ];
}

interface Geo {
  kind: "line" | "arc" | "circle";
  /** Çizgi uçları. */
  a?: Vec2;
  b?: Vec2;
  /** Daire / yay. */
  c?: Vec2;
  r?: number;
  a0?: number;
  sweep?: number;
}

function geoOf(pm: Map<string, Vec2>, c: SCurve): Geo | null {
  switch (c.kind) {
    case "line":
      return { kind: "line", a: pm.get(c.p1)!, b: pm.get(c.p2)! };
    case "circle":
      return { kind: "circle", c: pm.get(c.c)!, r: c.r, a0: 0, sweep: TAU };
    case "arc": {
      const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
      return { kind: "arc", c: g.c, r: g.r, a0: g.a0, sweep: g.sweep };
    }
    default:
      return null;
  }
}

/** Noktanın yay üzerindeki konumu (0..1, saat yönünün tersine); yay dışındaysa null. */
function arcFraction(g: Geo, p: Vec2): number | null {
  const s = norm(Math.atan2(p[1] - g.c![1], p[0] - g.c![0]) - g.a0!) / g.sweep!;
  return s <= 1 + 1e-9 ? Math.min(1, s) : null;
}

/** Çizgi üzerindeki konum (0..1, birim uzunluk değil parametre). */
function lineFraction(g: Geo, p: Vec2): number {
  const d = sub(g.b!, g.a!);
  return dot(sub(p, g.a!), d) / (dot(d, d) || 1);
}

export interface Cut {
  /** Hedef eğri üzerindeki konum (çizgi / yay için 0..1; daire için 0..1 = 0..2π). */
  s: number;
  p: Vec2;
  cutter: string;
}

/** `target` eğrisinin diğer eğrilerle kesişimleri (konuma göre sıralı). Elips / eğri / nokta kesici sayılmaz. */
export function cutsOf(d: SketchData, targetId: string): Cut[] {
  const pm = new Map(d.points.map((p) => [p.id, [p.x, p.y] as Vec2]));
  const target = curveById(d, targetId);
  const T = target && geoOf(pm, target);
  if (!target || !T) return [];
  const out: Cut[] = [];
  const push = (s: number, p: Vec2, cutter: string) => {
    if (T.kind === "circle") out.push({ s: s >= 1 - 1e-12 ? 0 : s, p, cutter });
    else if (s >= -END_TOL && s <= 1 + END_TOL) out.push({ s: Math.min(1, Math.max(0, s)), p, cutter });
  };
  for (const other of d.curves) {
    if (other.id === targetId) continue;
    const O = geoOf(pm, other);
    if (!O) continue;
    if (T.kind === "line") {
      if (O.kind === "line") {
        const hit = lineLine(T.a!, T.b!, O.a!, O.b!);
        if (hit && hit.u >= -END_TOL && hit.u <= 1 + END_TOL) push(hit.t, hit.p, other.id);
      } else {
        for (const h of lineCircle(T.a!, T.b!, O.c!, O.r!)) if (O.kind === "circle" || arcFraction(O, h.p) !== null) push(h.t, h.p, other.id);
      }
    } else {
      // Hedef daire / yay: kesici çizgi → doğru–çember; kesici daire / yay → çember–çember.
      const frac = (p: Vec2) => (T.kind === "circle" ? norm(Math.atan2(p[1] - T.c![1], p[0] - T.c![0])) / TAU : arcFraction(T, p));
      const pts: Vec2[] =
        O.kind === "line"
          ? lineCircle(O.a!, O.b!, T.c!, T.r!)
              .filter((h) => h.t >= -END_TOL && h.t <= 1 + END_TOL)
              .map((h) => h.p)
          : circleCircle(T.c!, T.r!, O.c!, O.r!).filter((p) => O.kind === "circle" || arcFraction(O, p) !== null);
      for (const p of pts) {
        const s = frac(p);
        if (s !== null) push(s, p, other.id);
      }
    }
  }
  return out.sort((x, y) => x.s - y.s);
}

// ---- yardımcılar ----

/** Verilen konumda zaten bir nokta varsa onu, yoksa yenisini döndürür. */
function pointNear(ed: SketchEdit, p: Vec2, exclude: string[] = []): { id: string; created: boolean } {
  const hit = ed.d.points.find((q) => !exclude.includes(q.id) && Math.hypot(q.x - p[0], q.y - p[1]) < 1e-6);
  if (hit) return { id: hit.id, created: false };
  return { id: ed.point(p), created: true };
}

/** Eğriye bağlı kısıtları siler; `keep` türleri kalır. */
function dropConstraints(ed: SketchEdit, curveId: string, keep: string[]): void {
  ed.d.constraints = ed.d.constraints.filter((k) => !k.refs.includes(curveId) || keep.includes(k.type));
}

/** Verilen iki nokta arasındaki mesafe ölçülerini siler (uç noktası değişen çizgi için). */
function dropDimensionsOnPoints(ed: SketchEdit, pts: string[]): void {
  const dims = new Set(["distance", "hdistance", "vdistance", "pointLine", "angle"]);
  ed.d.constraints = ed.d.constraints.filter((k) => !(dims.has(k.type) && k.refs.some((r) => pts.includes(r))));
}

// ---- kırp ----

/**
 * İki kesişim arasında kalan, tıklanan parçayı siler (Fusion'daki Kırp). Kesişim yoksa eğrinin
 * tamamı silinir. Çizgi ve yaylar iki parçaya bölünebilir; daire bir yaya dönüşür.
 */
export function trimCurve(ed: SketchEdit, curveId: string, click: Vec2): void {
  const c = curveById(ed.d, curveId);
  if (!c || (c.kind !== "line" && c.kind !== "arc" && c.kind !== "circle")) throw new Error("Kırpma çizgi, yay ve daire için çalışır");
  const pm = ed.pm;
  const G = geoOf(pm, c)!;
  const cuts = cutsOf(ed.d, curveId);
  if (!cuts.length) {
    ed.deleteCurves([curveId]);
    return;
  }
  const sc = G.kind === "line" ? Math.min(1, Math.max(0, lineFraction(G, click))) : (arcFraction(G, click) ?? nearestEndFraction(G, click));
  const eps = END_TOL;
  const mk = (cut: Cut) => {
    const q = pointNear(ed, cut.p);
    return { id: q.id, cut, created: q.created };
  };
  if (G.kind === "circle") {
    const distinct = cuts.filter((x, i) => i === 0 || Math.abs(x.s - cuts[i - 1].s) > eps);
    if (distinct.length < 2) throw new Error("Daireyi kırpmak için en az iki kesişim gerekir");
    const lower = [...distinct].reverse().find((x) => x.s < sc - eps) ?? distinct[distinct.length - 1];
    const upper = distinct.find((x) => x.s > sc + eps) ?? distinct[0];
    const lo = mk(lower);
    const up = mk(upper);
    const center = c.kind === "circle" ? c.c : "";
    // Kalan yay: üst kesişimden saat yönünün tersine alt kesişime.
    const id = ed.arc(center, up.id, lo.id, c.construction);
    retarget(ed, curveId, id);
    ed.d.curves = ed.d.curves.filter((x) => x.id !== curveId);
    for (const m of [lo, up]) if (m.created) ed.constrain("onCurve", [m.id, m.cut.cutter]);
    ed.cleanup();
    return;
  }
  const lowerCut = [...cuts].reverse().find((x) => x.s < sc - eps && x.s > eps);
  const upperCut = cuts.find((x) => x.s > sc + eps && x.s < 1 - eps);
  const keepA = !!lowerCut;
  const keepB = !!upperCut;
  if (!keepA && !keepB) {
    ed.deleteCurves([curveId]);
    return;
  }
  const lo = lowerCut ? mk(lowerCut) : null;
  const up = upperCut ? mk(upperCut) : null;
  if (c.kind === "line") {
    const oldP1 = c.p1;
    const oldP2 = c.p2;
    dropConstraints(ed, curveId, ["horizontal", "vertical"]);
    dropDimensionsOnPoints(ed, [oldP1, oldP2]);
    const hv = ed.d.constraints.filter((k) => k.refs.length === 1 && k.refs[0] === curveId && (k.type === "horizontal" || k.type === "vertical"));
    if (keepA && keepB) {
      c.p2 = lo!.id;
      const piece = ed.line(up!.id, oldP2, c.construction);
      for (const k of hv) ed.constrain(k.type, [piece]);
    } else if (keepA) c.p2 = lo!.id;
    else c.p1 = up!.id;
  } else if (c.kind === "arc") {
    const oldE = c.e;
    dropConstraints(ed, curveId, ["radius", "diameter"]);
    if (keepA && keepB) {
      c.e = lo!.id;
      const piece = ed.arc(c.c, up!.id, oldE, c.construction);
      for (const k of ed.d.constraints.filter((x) => x.refs[0] === curveId && (x.type === "radius" || x.type === "diameter"))) {
        ed.constrain(k.type, [piece], { value: k.value });
      }
    } else if (keepA) c.e = lo!.id;
    else c.s = up!.id;
  }
  for (const m of [lo, up]) if (m?.created) ed.constrain("onCurve", [m.id, m.cut.cutter]);
  ed.cleanup();
}

function nearestEndFraction(G: Geo, p: Vec2): number {
  const a = G.a0!;
  const b = G.a0! + G.sweep!;
  const at = (t: number): Vec2 => [G.c![0] + G.r! * Math.cos(t), G.c![1] + G.r! * Math.sin(t)];
  return dist2(p, at(a)) <= dist2(p, at(b)) ? 0 : 1;
}

/** Bir eğriye bağlı bütün kısıtları başka bir eğriye aktarır (daire → yay dönüşümünde). */
function retarget(ed: SketchEdit, from: string, to: string): void {
  for (const k of ed.d.constraints) k.refs = k.refs.map((r) => (r === from ? to : r));
}

// ---- uzat ----

/**
 * Çizginin tıklanan ucunu, o yönde karşılaştığı ilk eğriye kadar uzatır. Uç başka öğelerle
 * paylaşılıyorsa uzatılamaz (paylaşılan nokta taşınırsa onlar da bozulur).
 */
export function extendCurve(ed: SketchEdit, curveId: string, click: Vec2): void {
  const c = curveById(ed.d, curveId);
  if (!c || c.kind !== "line") throw new Error("Uzatma şimdilik sadece çizgiler için çalışır");
  const pm = ed.pm;
  const a = pm.get(c.p1)!;
  const b = pm.get(c.p2)!;
  const atP2 = dist2(click, b) <= dist2(click, a);
  const endId = atP2 ? c.p2 : c.p1;
  const shared = ed.d.curves.some((o) => o.id !== curveId && curvePoints(o).includes(endId));
  if (shared) throw new Error("Bu uç başka öğelere bağlı; önce bağlantıyı kaldırın");
  // Işın: bu uçtan dışa doğru.
  const from = atP2 ? a : b;
  const to = atP2 ? b : a;
  const dir = unit(sub(to, from));
  const far = add(to, mul(dir, 1e6));
  let best: { p: Vec2; cutter: string; d: number } | null = null;
  const consider = (p: Vec2, cutter: string) => {
    const along = dot(sub(p, to), dir);
    if (along > END_TOL && (!best || along < best.d)) best = { p, cutter, d: along };
  };
  for (const o of ed.d.curves) {
    if (o.id === curveId) continue;
    const O = geoOf(pm, o);
    if (!O) continue;
    if (O.kind === "line") {
      const hit = lineLine(to, far, O.a!, O.b!);
      if (hit && hit.t > 0 && hit.u >= -END_TOL && hit.u <= 1 + END_TOL) consider(hit.p, o.id);
    } else {
      for (const h of lineCircle(to, far, O.c!, O.r!)) if (h.t > 0 && (O.kind === "circle" || arcFraction(O, h.p) !== null)) consider(h.p, o.id);
    }
  }
  if (!best) throw new Error("Bu yönde uzatılacak bir kesişim yok");
  const hit = best as { p: Vec2; cutter: string; d: number };
  ed.movePoint(endId, hit.p);
  dropDimensionsOnPoints(ed, [c.p1, c.p2]);
  ed.constrain("onCurve", [endId, hit.cutter]);
}

// ---- ofset ----

interface ChainItem {
  curve: SCurve;
  /** true: eğrinin kendi yönünde (çizgi p1→p2, yay s→e) gezilir. */
  forward: boolean;
}

/** Bir eğriden başlayıp uç uca bağlı çizgi / yayları (zinciri) toplar; kapalıysa `closed` döner. */
function chainFrom(d: SketchData, startId: string): { items: ChainItem[]; closed: boolean } {
  const start = curveById(d, startId)!;
  const ends = (c: SCurve, forward: boolean): [string, string] => {
    const [a, b] = c.kind === "line" ? [c.p1, c.p2] : c.kind === "arc" ? [c.s, c.e] : ["", ""];
    return forward ? [a, b] : [b, a];
  };
  const users = (pt: string) => d.curves.filter((c) => (c.kind === "line" || c.kind === "arc") && (c.kind === "line" ? [c.p1, c.p2] : [c.s, c.e]).includes(pt));
  const items: ChainItem[] = [{ curve: start, forward: true }];
  const seen = new Set([start.id]);
  const walk = (dirFwd: boolean): boolean => {
    for (;;) {
      const last = dirFwd ? items[items.length - 1] : items[0];
      const tail = dirFwd ? ends(last.curve, last.forward)[1] : ends(last.curve, last.forward)[0];
      const next = users(tail).filter((c) => c.id !== last.curve.id);
      if (next.length !== 1) return false;
      const n = next[0];
      if (seen.has(n.id)) return n.id === (dirFwd ? items[0] : items[items.length - 1]).curve.id;
      seen.add(n.id);
      const nEnds = n.kind === "line" ? [n.p1, n.p2] : n.kind === "arc" ? [n.s, n.e] : ["", ""];
      if (dirFwd) items.push({ curve: n, forward: nEnds[0] === tail });
      else items.unshift({ curve: n, forward: nEnds[1] === tail });
    }
  };
  const closed = walk(true);
  if (!closed) walk(false);
  return { items, closed };
}

/**
 * Çizgi / yay zincirini ya da daireyi `distance` kadar öteler. Taraf, tıklanan noktanın
 * eğriye göre bulunduğu taraftır. Dönen değer: yeni eğri kimlikleri.
 */
export function offsetCurves(ed: SketchEdit, curveId: string, distance: number, click: Vec2): string[] {
  const start = curveById(ed.d, curveId);
  if (!start || (start.kind !== "line" && start.kind !== "arc" && start.kind !== "circle")) throw new Error("Ofset çizgi, yay ve daire için çalışır");
  const pm = ed.pm;
  if (start.kind === "circle") {
    const c = pm.get(start.c)!;
    const outside = dist2(click, c) > start.r;
    const dd = distance > 0 ? distance : Math.abs(dist2(click, c) - start.r);
    const r = outside ? start.r + dd : start.r - dd;
    if (r <= EPS) throw new Error("Ofset yarıçapı sıfırın altına düşüyor");
    return [ed.circle(start.c, r, start.construction)];
  }
  const { items, closed } = chainFrom(ed.d, curveId);
  // Taraf: tıklanan eğrinin gezinme yönündeki soluna göre işaretli mesafe.
  const sideOf = (it: ChainItem): { n: Vec2; dist: number } => {
    const g = geoOf(pm, it.curve)!;
    if (g.kind === "line") {
      const dir = unit(it.forward ? sub(g.b!, g.a!) : sub(g.a!, g.b!));
      const n = leftOf(dir);
      const base = it.forward ? g.a! : g.b!;
      return { n, dist: dot(sub(click, base), n) };
    }
    const radial = sub(click, g.c!);
    // Sol: saat yönünün tersine gezerken merkeze doğru, saat yönünde gezerken dışarı.
    const toward = unit(mul(radial, -1));
    const n = it.forward ? toward : mul(toward, -1);
    return { n, dist: it.forward ? g.r! - len(radial) : len(radial) - g.r! };
  };
  const first = items.find((x) => x.curve.id === curveId)!;
  const probe = sideOf(first);
  const sign = probe.dist >= 0 ? 1 : -1;
  const delta = sign * (distance > 0 ? distance : Math.abs(probe.dist));
  if (Math.abs(delta) < EPS) throw new Error("Ofset mesafesi sıfır olamaz");

  // Her parçanın ötelenmiş uçları (gezinme sırasında başlangıç / bitiş).
  const pieces = items.map((it) => {
    const g = geoOf(pm, it.curve)!;
    if (g.kind === "line") {
      const a = it.forward ? g.a! : g.b!;
      const b = it.forward ? g.b! : g.a!;
      const n = leftOf(unit(sub(b, a)));
      return { it, g, s: add(a, mul(n, delta)), e: add(b, mul(n, delta)), line: true as const };
    }
    const sPt = it.forward ? pm.get((it.curve as Extract<SCurve, { kind: "arc" }>).s)! : pm.get((it.curve as Extract<SCurve, { kind: "arc" }>).e)!;
    const ePt = it.forward ? pm.get((it.curve as Extract<SCurve, { kind: "arc" }>).e)! : pm.get((it.curve as Extract<SCurve, { kind: "arc" }>).s)!;
    const r2 = it.forward ? g.r! - delta : g.r! + delta;
    if (r2 <= EPS) throw new Error("Ofset yarıçapı sıfırın altına düşüyor");
    const k = r2 / g.r!;
    return { it, g, s: add(g.c!, mul(sub(sPt, g.c!), k)), e: add(g.c!, mul(sub(ePt, g.c!), k)), line: false as const };
  });
  // Köşeler: ardışık iki çizgide ötelenmiş doğruların kesişimi (gönye); diğer durumlarda uçlar zaten süreklidir.
  const n = pieces.length;
  const joinCount = closed ? n : n - 1;
  for (let i = 0; i < joinCount; i++) {
    const A = pieces[i];
    const B = pieces[(i + 1) % n];
    if (A.line && B.line) {
      const hit = lineLine(A.s, A.e, B.s, B.e);
      if (hit) {
        A.e = hit.p;
        B.s = hit.p;
      }
    }
  }
  // Yeni noktalar: ardışık parçalar ortak köşeyi paylaşır; kopukluk varsa (ör. çizgi–yay) bir köprü çizgisi eklenir.
  const starts: string[] = new Array(n).fill("");
  const ends: string[] = new Array(n).fill("");
  const bridges: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    ends[i] = ed.point(round2(pieces[i].e));
    if (!closed && i === n - 1) continue;
    if (dist2(pieces[i].e, pieces[next].s) <= 1e-6) starts[next] = ends[i];
    else {
      starts[next] = ed.point(round2(pieces[next].s));
      bridges.push([ends[i], starts[next]]);
    }
  }
  if (!closed) starts[0] = ed.point(round2(pieces[0].s));
  const newIds: string[] = [];
  pieces.forEach((p, i) => {
    if (p.line) newIds.push(ed.line(starts[i], ends[i], p.it.curve.construction));
    else {
      const arc = p.it.curve as Extract<SCurve, { kind: "arc" }>;
      // Ters gezilen yayda uçlar yer değiştirir (model yayı hep saat yönünün tersine tutar).
      newIds.push(p.it.forward ? ed.arc(arc.c, starts[i], ends[i], arc.construction) : ed.arc(arc.c, ends[i], starts[i], arc.construction));
    }
  });
  for (const [a, b] of bridges) newIds.push(ed.line(a, b));
  ed.cleanup();
  return newIds;
}

// ---- taşı / döndür / desen ----

/** Noktayı `center` etrafında saat yönünün tersine `deg` derece döndüren dönüşüm. */
export function rotateAbout(center: Vec2, deg: number): (p: Vec2) => Vec2 {
  const t = (deg * Math.PI) / 180;
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  return (p) => round2([center[0] + (p[0] - center[0]) * cs - (p[1] - center[1]) * sn, center[1] + (p[0] - center[0]) * sn + (p[1] - center[1]) * cs]);
}

export function translateBy(dx: number, dy: number): (p: Vec2) => Vec2 {
  return (p) => round2([p[0] + dx, p[1] + dy]);
}

/** Seçili eğrilerin ağırlık merkezi (noktaların ortalaması). */
export function selectionCenter(d: SketchData, curveIds: string[]): Vec2 {
  const pm = new Map(d.points.map((p) => [p.id, [p.x, p.y] as Vec2]));
  const ids = new Set(curveIds.flatMap((id) => curvePoints(curveById(d, id)!)));
  const pts = [...ids].map((id) => pm.get(id)!);
  return pts.length ? round2([pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]) : [0, 0];
}

/** Dikdörtgensel desen: orijinal + (nx·ny − 1) kopya. Her kopya bağımsızdır. Yeni eğri kimliklerini döndürür. */
export function patternRect(ed: SketchEdit, ids: string[], nx: number, ny: number, dx: number, dy: number): string[] {
  const out: string[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i === 0 && j === 0) continue;
      out.push(...ed.copyCurves(ids, translateBy(i * dx, j * dy)));
    }
  }
  return out;
}

/** Dairesel desen: `count` adet (orijinal dahil), toplam `angle` derece üzerine eşit aralıkla. */
export function patternCircular(ed: SketchEdit, ids: string[], count: number, angle: number, center: Vec2): string[] {
  const out: string[] = [];
  // Tam turda son kopya orijinalin üstüne binmesin: 360° için adım = 360 / count.
  const step = Math.abs(angle - 360) < 1e-9 ? angle / count : count > 1 ? angle / (count - 1) : 0;
  for (let i = 1; i < count; i++) out.push(...ed.copyCurves(ids, rotateAbout(center, i * step)));
  return out;
}

