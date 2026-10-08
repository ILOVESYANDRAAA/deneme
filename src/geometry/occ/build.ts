import {
  cast,
  draw,
  getOC,
  drawCircle,
  makeBaseBox,
  makeCylinder,
  makeSphere,
  measureVolume,
  setOC,
  type Drawing,
  type Edge,
  type Face,
  type Shape3D,
} from "replicad";
import type { EdgeRef, FaceRef, Loop, Solid, Vec2, Vec3 } from "../../core/solid";
import { solidKey } from "../../core/solid";
import type { BrepInfo } from "../brep";
import type { MeshData } from "../evaluate";

/** replicad'in kendi OpenCascade örneği: `replicad-opencascadejs` fabrikasının çıktısı. */
export function installKernel(oc: unknown): void {
  setOC(oc as Parameters<typeof setOC>[0]);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const tuple = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

// ---- profiller ----

function loopDrawing(loop: Loop): Drawing {
  if ("circle" in loop) return drawCircle(loop.circle.r).translate(loop.circle.c[0], loop.circle.c[1]);
  let pen = draw(loop.from);
  const last = loop.segs.length - 1;
  loop.segs.forEach((seg, i) => {
    // Son çizgi başlangıca dönüyorsa `close()` onu çizer; sıfır uzunluklu çizgi eklenmez.
    if (i === last && !seg.via) return;
    pen = seg.via ? pen.threePointsArcTo(seg.to, seg.via) : pen.lineTo(seg.to);
  });
  return pen.close();
}

function polygonLoop(poly: Vec2[]): Loop {
  return { from: poly[0], segs: poly.slice(1).concat([poly[0]]).map((to) => ({ to })) };
}

function signedArea(poly: Vec2[]): number {
  return poly.reduce((s, a, i) => s + (a[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * a[1]), 0) / 2;
}

/** Profilleri tek bir 2B bölgeye çevirir: "EvenOdd" iç içe şekilleri delik yapar, "Positive" yönüne bakar. */
function profileDrawing(solid: Extract<Solid, { kind: "extrude" | "revolve" }>): Drawing {
  const rule = solid.fillRule ?? "Positive";
  const exact = solid.loops && solid.loops.length ? solid.loops : null;
  const items: { drawing: Drawing; sign: number }[] = exact
    ? exact.map((l) => ({ drawing: loopDrawing(l), sign: 1 }))
    : solid.polygons.map((p) => ({ drawing: loopDrawing(polygonLoop(p)), sign: signedArea(p) >= 0 ? 1 : -1 }));
  let acc: Drawing | null = null;
  for (const { drawing, sign } of items) {
    if (!acc) acc = drawing;
    else if (rule === "EvenOdd") acc = acc.cut(drawing).fuse(drawing.cut(acc));
    else acc = sign > 0 ? acc.fuse(drawing) : acc.cut(drawing);
  }
  if (!acc) throw new Error("Profil boş");
  return acc;
}

/** Aynı yüzeye ait bölünmüş yüz / kenarları birleştirir (yarım yaylardan oluşan daire tek çember olur). */
function tidy(raw: Shape3D): Shape3D {
  try {
    const clean = raw.simplify() as Shape3D;
    raw.delete();
    return clean;
  } catch {
    return raw;
  }
}

// ---- dönüşüm ----

/**
 * 4×4 sütun öncelikli matrisi (döndürme + düzgün ölçek + yansıma + öteleme) sırayla uygular.
 * Dikkat: replicad'in dönüşümleri işlenen şekli tüketir; bu yüzden çağıran bir kopya verir.
 */
function applyMatrix(owned: Shape3D, m: number[]): Shape3D {
  const c0: Vec3 = [m[0], m[1], m[2]];
  const c1: Vec3 = [m[4], m[5], m[6]];
  let c2: Vec3 = [m[8], m[9], m[10]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const det = dot3(c0, cross(c1, c2));
  const scale = Math.cbrt(Math.abs(det));
  if (!(scale > 1e-12)) throw new Error("Dönüşüm matrisi tekil");
  let result = owned;
  if (det < 0) {
    // Yansıma önce uygulanır (XY düzlemine göre); kalan kısım saf döndürme + ölçek olur.
    result = result.mirror("XY", [0, 0, 0]) as Shape3D;
    c2 = [-c2[0], -c2[1], -c2[2]];
  }
  // R: sütunları c0, c1, c2 olan (ölçeksiz) döndürme matrisi → eksen-açı
  const cols = [c0, c1, c2];
  const r = (row: number, col: number) => cols[col][row] / scale;
  const trace = r(0, 0) + r(1, 1) + r(2, 2);
  const angle = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
  // matris = T · R · S: önce ölçek, sonra döndürme, sonra öteleme
  if (Math.abs(scale - 1) > 1e-12) result = result.scale(scale, [0, 0, 0]) as Shape3D;
  if (angle > 1e-9) {
    let axis: Vec3 = [r(2, 1) - r(1, 2), r(0, 2) - r(2, 0), r(1, 0) - r(0, 1)];
    if (len3(axis) < 1e-9) {
      // 180°: eksen simetrik kısımdan bulunur.
      const diag = [r(0, 0), r(1, 1), r(2, 2)];
      const k = diag.indexOf(Math.max(...diag));
      axis = [0, 0, 0];
      axis[k] = Math.sqrt(Math.max(0, (r(k, k) + 1) / 2));
      for (let j = 0; j < 3; j++) if (j !== k) axis[j] = (r(k, j) + r(j, k)) / (4 * axis[k] || 1);
    }
    result = result.rotate((angle * 180) / Math.PI, [0, 0, 0], unit(axis)) as Shape3D;
  }
  if (m[12] || m[13] || m[14]) result = result.translate([m[12], m[13], m[14]]) as Shape3D;
  return result;
}

// ---- kenar / yüz imzaları ----

export function edgeRefOf(e: Edge): EdgeRef {
  const kind = String(e.geomType);
  const ref: EdgeRef = { mid: tuple(e.pointAt(0.5)), len: e.length, kind };
  if (kind === "LINE") ref.dir = unit(sub(tuple(e.endPoint), tuple(e.startPoint)));
  return ref;
}

export function faceRefOf(f: Face): FaceRef {
  const kind = String(f.geomType);
  const ref: FaceRef = { center: tuple(f.center), kind };
  if (kind === "PLANE") ref.normal = unit(tuple(f.normalAt()));
  return ref;
}

function boundsOf(shape: Shape3D): [Vec3, Vec3] {
  const b = shape.boundingBox.bounds as unknown as [Vec3, Vec3];
  return [[b[0][0], b[0][1], b[0][2]], [b[1][0], b[1][1], b[1][2]]];
}

function diagonal(shape: Shape3D): number {
  const [lo, hi] = boundsOf(shape);
  return len3(sub(hi, lo));
}

/**
 * Kenar imzasına en çok uyan kenarı bulur. Önce tam eşleşme (konum), yoksa aynı türde ve yönde
 * en yakın kenar: ölçüler değişince seçilen kenar çoğunlukla yerinde kalır.
 */
export function resolveEdges(shape: Shape3D, refs: EdgeRef[]): Edge[] {
  const edges = shape.edges;
  const diag = diagonal(shape) || 1;
  const found: Edge[] = [];
  for (const ref of refs) {
    let best: { e: Edge; score: number } | null = null;
    for (const e of edges) {
      const cand = edgeRefOf(e);
      if (cand.kind !== ref.kind) continue;
      if (ref.dir && cand.dir && Math.abs(dot3(ref.dir, cand.dir)) < 0.999) continue;
      const score = len3(sub(cand.mid, ref.mid)) + 0.25 * Math.abs(cand.len - ref.len);
      if (!best || score < best.score) best = { e, score };
    }
    if (!best || best.score > 0.5 * diag) {
      throw new Error("Seçilen kenar bulunamadı (gövde çok değişmiş olabilir); kenarı yeniden seçin");
    }
    if (!found.some((f) => f.isSame(best!.e))) found.push(best.e);
  }
  return found;
}

export function resolveFaces(shape: Shape3D, refs: FaceRef[]): Face[] {
  const faces = shape.faces;
  const diag = diagonal(shape) || 1;
  const found: Face[] = [];
  for (const ref of refs) {
    let best: { f: Face; score: number } | null = null;
    for (const f of faces) {
      const cand = faceRefOf(f);
      if (cand.kind !== ref.kind) continue;
      if (ref.normal && cand.normal && dot3(ref.normal, cand.normal) < 0.999) continue;
      const score = len3(sub(cand.center, ref.center));
      if (!best || score < best.score) best = { f, score };
    }
    if (!best || best.score > 0.5 * diag) {
      throw new Error("Seçilen yüz bulunamadı (gövde çok değişmiş olabilir); yüzü yeniden seçin");
    }
    if (!found.some((f) => f.isSame(best!.f))) found.push(best.f);
  }
  return found;
}

/**
 * Seçili yüzlere eğim verir. Nötr düzlem, gövdenin çekme yönündeki en alt noktasından `neutral` kadar
 * ilerdedir; yüzler bu düzlemden uzaklaştıkça eğimle içeri (pozitif açı) ya da dışarı (negatif) kayar.
 */
function draftFaces(shape: Shape3D, faces: Face[], angle: number, pull: Vec3, neutral: number): Shape3D {
  const oc = getOC();
  const dir = unit(pull);
  const [lo, hi] = boundsOf(shape);
  let minAlong = Infinity;
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) minAlong = Math.min(minAlong, dot3([x, y, z], dir));
  const at = neutral + minAlong;
  const gDir = new oc.gp_Dir(dir[0], dir[1], dir[2]);
  const gPnt = new oc.gp_Pnt(dir[0] * at, dir[1] * at, dir[2] * at);
  const plane = new oc.gp_Pln(gPnt, gDir);
  const maker = new oc.BRepOffsetAPI_DraftAngle(shape.wrapped);
  try {
    for (const face of faces) {
      maker.Add(face.wrapped, gDir, (angle * Math.PI) / 180, plane, true);
      if (!maker.AddDone()) throw new Error("Bir yüze eğim verilemedi");
    }
    maker.Build();
    if (!maker.IsDone()) throw new Error("Eğim uygulanamadı");
    return cast(maker.Shape()) as Shape3D;
  } catch (e) {
    throw new Error("Açılı yüzey uygulanamadı: açı çok büyük olabilir ya da seçilen yüzler çekme yönüne uygun değil", { cause: e });
  } finally {
    for (const o of [maker, plane, gPnt, gDir]) o.delete();
  }
}

// ---- değerlendirici ----

/**
 * Tarifleri OpenCascade (replicad) ile gerçek B-rep katıya çevirir. Manifold değerlendiricisi gibi alt
 * ağaçları anahtarlarıyla önbelleğe alır. Kürede, silindirde ve dairesel profillerde tam yüzeyler üretir.
 */
export class OccEvaluator {
  private cache = new Map<string, Shape3D>();
  private used = new Set<string>();

  beginPass(): void {
    this.used.clear();
  }

  endPass(): void {
    for (const [key, shape] of this.cache) {
      if (!this.used.has(key)) {
        shape.delete();
        this.cache.delete(key);
      }
    }
  }

  /** Bu turda kullanılmayanları silme: `describe` gibi tur dışı değerlendirmeler önbelleği küçültmesin. */
  keepAll(): void {
    for (const key of this.cache.keys()) this.used.add(key);
  }

  evaluate(solid: Solid): Shape3D {
    const key = solidKey(solid);
    this.used.add(key);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.build(solid);
    this.cache.set(key, result);
    return result;
  }

  private build(solid: Solid): Shape3D {
    switch (solid.kind) {
      case "box": {
        const [w, d, h] = solid.size;
        // Merkezi XY'de, tabanı Z=0'da (manifold ile aynı).
        return makeBox(w, d, h);
      }
      case "cylinder":
        return makeCylinderShape(solid.radius, solid.height);
      case "sphere":
        return makeSphereShape(solid.radius);
      case "extrude":
        return tidy(profileDrawing(solid).sketchOnPlane("XY").extrude(solid.height) as Shape3D);
      case "revolve": {
        // Profil x → yarıçap, y → Z; manifold gibi +X'ten saat yönünün tersine döner.
        const sketch = profileDrawing(solid).sketchOnPlane("XZ");
        return tidy(sketch.revolve([0, 0, 1], { angle: solid.angle }) as Shape3D);
      }
      case "boolean": {
        const parts = solid.children.map((c) => this.evaluate(c));
        let acc: Shape3D = parts[0];
        const owned: Shape3D[] = [];
        for (const next of parts.slice(1)) {
          const out: Shape3D =
            solid.op === "union" ? acc.fuse(next) : solid.op === "subtract" ? acc.cut(next) : (acc.intersect(next) as Shape3D);
          const clean = tidy(out);
          owned.push(clean);
          acc = clean;
        }
        // Ara sonuçlar silinir, sonuncusu döner; tek çocukta kopya alınır (önbellekteki paylaşılmasın).
        if (!owned.length) return parts[0].clone() as Shape3D;
        owned.slice(0, -1).forEach((o) => o.delete());
        return owned[owned.length - 1];
      }
      case "transform": {
        // replicad dönüşümleri şekli tüketir: önbellekteki çocuğun kopyası üzerinde çalışılır.
        let m = this.evaluate(solid.child).clone() as Shape3D;
        if (solid.matrix) m = applyMatrix(m, solid.matrix);
        if (solid.rotate) {
          const [rx, ry, rz] = solid.rotate;
          if (rx) m = m.rotate(rx, [0, 0, 0], [1, 0, 0]) as Shape3D;
          if (ry) m = m.rotate(ry, [0, 0, 0], [0, 1, 0]) as Shape3D;
          if (rz) m = m.rotate(rz, [0, 0, 0], [0, 0, 1]) as Shape3D;
        }
        if (solid.translate) m = m.translate(solid.translate) as Shape3D;
        return m;
      }
      case "fillet":
      case "chamfer": {
        const child = this.evaluate(solid.child);
        const edges = resolveEdges(child, solid.edges);
        const pick = (f: { when: (fn: (x: { element: Edge }) => boolean) => unknown }) =>
          f.when(({ element }) => edges.some((e) => e.isSame(element)));
        try {
          return (solid.kind === "fillet"
            ? child.fillet(solid.radius, pick as never)
            : child.chamfer(solid.distance, pick as never)) as Shape3D;
        } catch (e) {
          const what = solid.kind === "fillet" ? "Yuvarlatma" : "Pah";
          throw new Error(`${what} uygulanamadı: ${solid.kind === "fillet" ? "yarıçap" : "mesafe"} çok büyük olabilir ya da kenarlar uygun değil`, { cause: e });
        }
      }
      case "draft": {
        const child = this.evaluate(solid.child);
        const faces = resolveFaces(child, solid.faces);
        return draftFaces(child, faces, solid.angle, solid.pull, solid.neutral ?? 0);
      }
      case "shell": {
        const child = this.evaluate(solid.child);
        const faces = resolveFaces(child, solid.faces);
        try {
          return child.shell(
            solid.thickness,
            ((f: { when: (fn: (x: { element: Face }) => boolean) => unknown }) =>
              f.when(({ element }) => faces.some((x) => x.isSame(element)))) as never,
          ) as Shape3D;
        } catch (e) {
          throw new Error("Kabuk oluşturulamadı: kalınlık çok büyük olabilir ya da seçilen yüzler uygun değil", { cause: e });
        }
      }
    }
  }

  toMesh(shape: Shape3D): MeshData {
    const diag = diagonal(shape) || 1;
    const mesh = shape.mesh({ tolerance: Math.max(1e-3, diag / 2500), angularTolerance: 0.12 });
    return {
      positions: new Float32Array(mesh.vertices),
      indices: new Uint32Array(mesh.triangles),
      volume: Math.abs(measureVolume(shape)),
      triangles: mesh.triangles.length / 3,
    };
  }
}


function makeBox(w: number, d: number, h: number): Shape3D {
  const box = makeBaseBox(w, d, h);
  const [lo, hi] = boundsOf(box);
  const shift: Vec3 = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  return box.translate(shift) as Shape3D;
}

function makeCylinderShape(r: number, h: number): Shape3D {
  return makeCylinder(r, h) as unknown as Shape3D;
}

function makeSphereShape(r: number): Shape3D {
  return makeSphere(r) as unknown as Shape3D;
}

/** Kenar çizgisini örnekler: doğru kenar iki nokta, eğriler uzunluğa göre 8-96 nokta. */
function edgePolyline(e: Edge, diag: number): Float32Array {
  const kind = String(e.geomType);
  const pts: Vec3[] = [];
  if (kind === "LINE") pts.push(tuple(e.startPoint), tuple(e.endPoint));
  else {
    const n = Math.min(96, Math.max(8, Math.ceil((e.length / diag) * 120)));
    for (let i = 0; i <= n; i++) pts.push(tuple(e.pointAt(i / n)));
  }
  return new Float32Array(pts.flat());
}

/** Gövdenin kenarlarını, yüzlerini ve yüz seçimi için ağını çıkarır. */
export function describeShape(shape: Shape3D): BrepInfo {
  const diag = diagonal(shape) || 1;
  const faces = shape.faces;
  const mesh = shape.mesh({ tolerance: Math.max(1e-3, diag / 1500), angularTolerance: 0.2 });
  const faceIndex = new Map(faces.map((f, i) => [f.hashCode, i]));
  const triFace = new Uint32Array(mesh.triangles.length / 3);
  for (const g of mesh.faceGroups) {
    const index = faceIndex.get(g.faceId) ?? 0;
    triFace.fill(index, g.start / 3, (g.start + g.count) / 3);
  }
  // Yüz alanı: o yüzün üçgenlerinin alanları toplamı.
  const areas = new Array<number>(faces.length).fill(0);
  const v = mesh.vertices;
  for (let t = 0; t < triFace.length; t++) {
    const [a, b, c] = [mesh.triangles[t * 3] * 3, mesh.triangles[t * 3 + 1] * 3, mesh.triangles[t * 3 + 2] * 3];
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    areas[triFace[t]] += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  return {
    edges: shape.edges.map((e) => ({ ref: edgeRefOf(e), points: edgePolyline(e, diag) })),
    faces: faces.map((f, i) => ({ ref: faceRefOf(f), area: areas[i] })),
    pick: { positions: new Float32Array(mesh.vertices), indices: new Uint32Array(mesh.triangles), triFace },
  };
}
