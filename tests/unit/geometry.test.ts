import { describe, expect, it } from "vitest";
import { PrimitiveRegistry, featureSolid, type Feature } from "../../src/core/features";
import { validateSolid, type Solid } from "../../src/core/solid";
import { SolidEvaluator } from "../../src/geometry/evaluate";
import { GeometrySession } from "../../src/geometry/session";
import { meshesToStl } from "../../src/geometry/stl";
import { manifold } from "./helpers";

const feature = (f: Partial<Feature> & Pick<Feature, "id" | "type">): Feature => ({
  name: f.id,
  params: {},
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  ...f,
});

describe("featureSolid", () => {
  const reg = new PrimitiveRegistry();

  it("yerleşik şekli ve dönüşümü tarife çevirir", () => {
    const f = feature({ id: "a", type: "box", params: { width: 1, depth: 2, height: 3 }, position: [5, 0, 0] });
    expect(featureSolid(f, new Map([["a", f]]), reg)).toEqual({
      kind: "transform",
      translate: [5, 0, 0],
      child: { kind: "box", size: [1, 2, 3] },
    });
  });

  it("eklenti yüklü değilse kayıtlı tarifi kullanır, o da yoksa hata verir", () => {
    const solid: Solid = { kind: "sphere", radius: 1 };
    const f = feature({ id: "a", type: "baska.sekil", solid });
    expect(featureSolid(f, new Map(), reg)).toEqual(solid);
    expect(() => featureSolid(feature({ id: "b", type: "baska.sekil" }), new Map(), reg)).toThrow(/eklenti/);
  });

  it("döngüsel boolean'ı yakalar", () => {
    const a = feature({ id: "a", type: "boolean", op: "union", operands: ["b", "b"] });
    const b = feature({ id: "b", type: "boolean", op: "union", operands: ["a", "a"] });
    const byId = new Map([["a", a], ["b", b]]);
    expect(() => featureSolid(a, byId, reg)).toThrow(/Döngüsel/);
  });
});

describe("validateSolid", () => {
  it("geçerli tarifleri kabul eder", () => {
    expect(() =>
      validateSolid({
        kind: "boolean",
        op: "subtract",
        children: [
          { kind: "box", size: [1, 1, 1] },
          { kind: "transform", translate: [0, 0, 1], child: { kind: "cylinder", radius: 1, height: 2 } },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    [null, /nesne/],
    [{ kind: "box", size: [1, 1] }, /size/],
    [{ kind: "box", size: [1, -1, 1] }, /size/],
    [{ kind: "cylinder", radius: 1, height: NaN }, /height/],
    [{ kind: "extrude", polygons: [[[0, 0], [1, 0]]], height: 1 }, /polygons/],
    [{ kind: "boolean", op: "xor", children: [] }, /op/],
    [{ kind: "teapot" }, /bilinmeyen/],
  ])("geçersiz tarifi reddeder: %j", (value, msg) => {
    expect(() => validateSolid(value)).toThrow(msg);
  });
});

describe("SolidEvaluator", () => {
  it("kutudan silindir çıkarır", async () => {
    const ev = new SolidEvaluator(await manifold());
    const m = ev.evaluate({
      kind: "boolean",
      op: "subtract",
      children: [
        { kind: "box", size: [10, 10, 10] },
        { kind: "cylinder", radius: 2, height: 10, segments: 128 },
      ],
    });
    expect(m.volume()).toBeCloseTo(1000 - Math.PI * 2 ** 2 * 10, 0);
    const mesh = ev.toMesh(m);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.indices.length / 3).toBe(mesh.triangles);
  });

  it("kutu tabanı Z=0'da ve XY'de ortalı", async () => {
    const ev = new SolidEvaluator(await manifold());
    const box = ev.evaluate({ kind: "box", size: [4, 6, 8] }).boundingBox();
    expect(box.min).toEqual([-2, -3, 0]);
    expect(box.max).toEqual([2, 3, 8]);
  });

  it("döndürüp taşır", async () => {
    const ev = new SolidEvaluator(await manifold());
    const box = ev
      .evaluate({ kind: "transform", rotate: [0, 0, 90], translate: [10, 0, 0], child: { kind: "box", size: [4, 2, 2] } })
      .boundingBox();
    expect(box.min[0]).toBeCloseTo(9);
    expect(box.max[0]).toBeCloseTo(11);
    expect(box.max[1]).toBeCloseTo(2);
  });
});

describe("GeometrySession", () => {
  it("sadece değişenleri gönderir ve silinenleri bildirir", async () => {
    const s = new GeometrySession(await manifold());
    const a = { id: "a", solid: { kind: "box", size: [1, 1, 1] } as Solid };
    const b = { id: "b", solid: { kind: "sphere", radius: 1 } as Solid };
    const r1 = s.handle({ type: "evaluate", seq: 1, items: [a, b] }).response;
    expect(r1.changed.map((c) => c.id)).toEqual(["a", "b"]);
    const r2 = s.handle({ type: "evaluate", seq: 2, items: [a, { id: "b", solid: { kind: "sphere", radius: 2 } }] }).response;
    expect(r2.changed.map((c) => c.id)).toEqual(["b"]);
    const r3 = s.handle({ type: "evaluate", seq: 3, items: [a] }).response;
    expect(r3.changed).toEqual([]);
    expect(r3.removed).toEqual(["b"]);
  });
});

describe("meshesToStl", () => {
  it("ikili STL başlığı ve üçgen sayısı yazar", () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      volume: 0,
      triangles: 1,
    };
    const stl = meshesToStl([mesh, mesh]);
    const view = new DataView(stl.buffer);
    expect(stl.byteLength).toBe(84 + 2 * 50);
    expect(view.getUint32(80, true)).toBe(2);
    expect(view.getFloat32(84 + 8, true)).toBeCloseTo(1); // normal +Z
  });
});
