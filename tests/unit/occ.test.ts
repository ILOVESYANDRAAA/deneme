import opencascade from "replicad-opencascadejs";
import { beforeAll, describe, expect, it } from "vitest";
import type { EdgeRef, FaceRef, Solid, Vec2 } from "../../src/core/solid";
import { OccEvaluator, describeShape, edgeRefOf, faceRefOf, installKernel } from "../../src/geometry/occ/build";
import type { MeshData } from "../../src/geometry/evaluate";
import { SolidEvaluator } from "../../src/geometry/evaluate";
import { manifold } from "./helpers";

let occ: OccEvaluator;

beforeAll(async () => {
  installKernel(await opencascade({}));
  occ = new OccEvaluator();
});

function bbox(mesh: MeshData) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], mesh.positions[i]);
    max[i % 3] = Math.max(max[i % 3], mesh.positions[i]);
  }
  const r = (v: number[]) => v.map((x) => Math.round(x * 100) / 100 + 0);
  return { min: r(min), max: r(max) };
}

function run(solid: Solid) {
  const shape = occ.evaluate(solid);
  return { shape, mesh: occ.toMesh(shape) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const BOX: Solid = { kind: "box", size: [40, 20, 10] };

describe("OpenCascade: manifold ile aynı yerleşim", () => {
  it("kutu, silindir, küre", async () => {
    const m = new SolidEvaluator(await manifold());
    for (const solid of [BOX, { kind: "cylinder", radius: 5, height: 12 }, { kind: "sphere", radius: 7 }] as Solid[]) {
      const a = bbox(run(solid).mesh);
      const b = bbox(m.toMesh(m.evaluate(solid)));
      expect(a.min.map(Math.round)).toEqual(b.min.map(Math.round));
      expect(a.max.map(Math.round)).toEqual(b.max.map(Math.round));
    }
    expect(run(BOX).mesh.volume).toBeCloseTo(8000, 3);
    expect(run({ kind: "cylinder", radius: 5, height: 12 }).mesh.volume).toBeCloseTo(Math.PI * 25 * 12, 2);
    expect(run({ kind: "sphere", radius: 7 }).mesh.volume).toBeCloseTo((4 / 3) * Math.PI * 343, 1);
  });

  it("ekstrüzyon: delikli plaka (EvenOdd) ve yer değiştirme dönüşümü", async () => {
    const solid: Solid = {
      kind: "transform",
      translate: [0, 0, 3],
      child: { kind: "extrude", polygons: [rect(0, 0, 10, 20), rect(3, 5, 7, 15)], height: 5, fillRule: "EvenOdd" },
    };
    const r = run(solid);
    expect(r.mesh.volume).toBeCloseTo((200 - 40) * 5, 3);
    expect(bbox(r.mesh)).toEqual({ min: [0, 0, 3], max: [10, 20, 8] });
  });

  it("kesin daire profili tam silindir verir; döndürme manifold ile aynı yöne", async () => {
    const m = new SolidEvaluator(await manifold());
    const cyl: Solid = { kind: "extrude", polygons: [rect(-1, -1, 1, 1)], height: 4, loops: [{ circle: { c: [2, 3], r: 5 } }] };
    expect(run(cyl).mesh.volume).toBeCloseTo(Math.PI * 25 * 4, 3);
    const rev: Solid = { kind: "revolve", polygons: [rect(2, 0, 4, 10)], angle: 180 };
    const a = bbox(run(rev).mesh);
    const b = bbox(m.toMesh(m.evaluate(rev)));
    expect(a.min.map(Math.round)).toEqual(b.min.map(Math.round));
    expect(a.max.map(Math.round)).toEqual(b.max.map(Math.round));
    expect(run(rev).mesh.volume).toBeCloseTo((Math.PI * 12 * 10) / 2, 2);
  });

  it("matris dönüşümleri: ayna, ölçek ve döndürme manifold ile aynı", async () => {
    const m = new SolidEvaluator(await manifold());
    const base: Solid = { kind: "extrude", polygons: [rect(1, 2, 4, 7)], height: 3 };
    const matrices: number[][] = [
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1], // XY aynası
      [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // YZ aynası
      [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1], // ölçek
      [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], // revolve V → yerel
      [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 5, 6, 7, 1], // devrik + öteleme
    ];
    for (const matrix of matrices) {
      const solid: Solid = { kind: "transform", matrix, child: base };
      const a = bbox(run(solid).mesh);
      const b = bbox(m.toMesh(m.evaluate(solid)));
      expect(a).toEqual(b);
    }
  });

  it("boolean: çıkarma ve kesişim", () => {
    const hole: Solid = { kind: "cylinder", radius: 3, height: 10 };
    const cut = run({ kind: "boolean", op: "subtract", children: [BOX, { kind: "transform", translate: [0, 0, 0], child: hole }] });
    expect(cut.mesh.volume).toBeCloseTo(8000 - Math.PI * 9 * 10, 2);
    const inter = run({ kind: "boolean", op: "intersect", children: [BOX, { kind: "sphere", radius: 6 }] });
    expect(inter.mesh.volume).toBeGreaterThan(0);
    expect(inter.mesh.volume).toBeLessThan((4 / 3) * Math.PI * 216);
  });
});

describe("OpenCascade: yuvarlatma, pah, kabuk", () => {
  const verticalEdges = (): EdgeRef[] => run(BOX).shape.edges.map(edgeRefOf).filter((e) => e.dir && Math.abs(e.dir[2]) > 0.99);
  const topFace = (): FaceRef => run(BOX).shape.faces.map(faceRefOf).find((f) => f.normal && f.normal[2] > 0.99)!;

  it("dikey kenarları yuvarlatır: hacim tam formülle", () => {
    const edges = verticalEdges();
    expect(edges).toHaveLength(4);
    const r = run({ kind: "fillet", child: BOX, radius: 3, edges });
    expect(r.mesh.volume).toBeCloseTo(8000 - 4 * (1 - Math.PI / 4) * 9 * 10, 2);
    // Dört köşe silindir yüzeyi oldu
    expect(r.shape.faces.filter((f) => String(f.geomType) === "CYLINDRE")).toHaveLength(4);
  });

  it("kenarları pah kırar", () => {
    const r = run({ kind: "chamfer", child: BOX, distance: 2, edges: verticalEdges().slice(0, 2) });
    expect(r.mesh.volume).toBeCloseTo(8000 - 2 * 0.5 * 4 * 10, 3);
  });

  it("üst yüzü açıp içini oyar", () => {
    const r = run({ kind: "shell", child: BOX, thickness: 1.5, faces: [topFace()] });
    expect(r.mesh.volume).toBeCloseTo(8000 - 37 * 17 * 8.5, 2);
    expect(bbox(r.mesh)).toEqual({ min: [-20, -10, 0], max: [20, 10, 10] });
  });

  it("kenar imzası gövde yeniden boyutlanınca da aynı kenarı bulur", () => {
    const edges = verticalEdges();
    const wide: Solid = { kind: "box", size: [60, 30, 15] };
    const r = run({ kind: "fillet", child: wide, radius: 3, edges });
    expect(r.mesh.volume).toBeCloseTo(60 * 30 * 15 - 4 * (1 - Math.PI / 4) * 9 * 15, 2);
  });

  it("kenar bulunamayınca ve yarıçap çok büyükken anlaşılır hata verir", () => {
    const far: EdgeRef = { mid: [500, 500, 500], len: 10, kind: "LINE", dir: [0, 0, 1] };
    expect(() => run({ kind: "fillet", child: BOX, radius: 1, edges: [far] })).toThrow(/kenar bulunamadı/);
    expect(() => run({ kind: "fillet", child: BOX, radius: 50, edges: verticalEdges() })).toThrow(/Yuvarlatma uygulanamadı/);
    const sideFace: FaceRef = { center: [900, 0, 5], normal: [1, 0, 0], kind: "PLANE" };
    expect(() => run({ kind: "shell", child: BOX, thickness: 1, faces: [sideFace] })).toThrow(/yüz bulunamadı/);
  });

  it("yuvarlatılmış gövde üzerinde boolean ve dönüşüm çalışır", () => {
    const filleted: Solid = { kind: "fillet", child: BOX, radius: 2, edges: verticalEdges() };
    const mirrored: Solid = {
      kind: "boolean",
      op: "union",
      children: [filleted, { kind: "transform", matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 0, 0, 1], child: filleted }],
    };
    const one = run(filleted).mesh.volume;
    expect(run(mirrored).mesh.volume).toBeCloseTo(2 * one, 2);
  });
});

describe("OpenCascade: seçim betimi", () => {
  it("kutunun 12 kenarı, 6 yüzü ve yüz başına üçgen eşlemesi", () => {
    const info = describeShape(run(BOX).shape);
    expect(info.edges).toHaveLength(12);
    expect(info.faces).toHaveLength(6);
    expect(info.edges.every((e) => e.points.length === 6)).toBe(true); // doğru kenar: 2 nokta
    expect(info.faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([200, 200, 400, 400, 800, 800]);
    expect(info.pick.triFace.length).toBe(info.pick.indices.length / 3);
    const perFace = new Map<number, number>();
    info.pick.triFace.forEach((f) => perFace.set(f, (perFace.get(f) ?? 0) + 1));
    expect([...perFace.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("silindirin eğri kenarları çok noktalı örneklenir; imzadan çözülür", () => {
    const shape = run({ kind: "cylinder", radius: 5, height: 12 }).shape;
    const info = describeShape(shape);
    const circles = info.edges.filter((e) => e.ref.kind === "CIRCLE");
    expect(circles).toHaveLength(2);
    expect(circles[0].points.length / 3).toBeGreaterThan(8);
    const top = circles.find((c) => c.ref.mid[2] > 6)!.ref;
    const r = run({ kind: "fillet", child: { kind: "cylinder", radius: 5, height: 12 }, radius: 1, edges: [top] });
    expect(r.mesh.volume).toBeLessThan(Math.PI * 25 * 12);
  });
});
