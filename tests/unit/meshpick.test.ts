import { describe, expect, it } from "vitest";
import { coplanarRegion } from "../../src/core/meshpick";
import { SolidEvaluator } from "../../src/geometry/evaluate";
import { frameFromFace } from "../../src/core/sketch";
import { manifold } from "./helpers";

async function meshOf(solid: Parameters<SolidEvaluator["evaluate"]>[0]) {
  const ev = new SolidEvaluator(await manifold());
  return ev.toMesh(ev.evaluate(solid));
}

/** Verilen normale en iyi uyan ilk üçgen. */
function triFacing(m: { positions: Float32Array; indices: Uint32Array }, want: [number, number, number]): number {
  for (let t = 0; t < m.indices.length / 3; t++) {
    const r = coplanarRegion(m.positions, m.indices, t)!;
    if (r.normal[0] * want[0] + r.normal[1] * want[1] + r.normal[2] * want[2] > 0.999) return t;
  }
  throw new Error("yüz yok");
}

describe("düz yüzey bölgesi", () => {
  it("kutunun her yüzü iki üçgenli tek bölge; alan ve merkez doğru", async () => {
    const m = await meshOf({ kind: "box", size: [40, 20, 10] });
    const top = coplanarRegion(m.positions, m.indices, triFacing(m, [0, 0, 1]))!;
    expect(top.tris).toHaveLength(2);
    expect(top.area).toBeCloseTo(800, 3);
    expect(top.centroid.map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 0, 10]); // kutu XY'de ortalı
    const side = coplanarRegion(m.positions, m.indices, triFacing(m, [1, 0, 0]))!;
    expect(side.area).toBeCloseTo(200, 3);
  });

  it("silindirin düz üst yüzü tek bölge, yanal yüzey ise bölge dışı kalır", async () => {
    const m = await meshOf({ kind: "cylinder", radius: 5, height: 10, segments: 32 });
    const top = coplanarRegion(m.positions, m.indices, triFacing(m, [0, 0, 1]))!;
    expect(top.tris).toHaveLength(30); // 32 kenarlı çokgen yelpazesi
    expect(top.area).toBeCloseTo(0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32), 2);
    // Yanal bir üçgenin bölgesi tek üçgendir (komşular başka normalde)
    const sideTri = (() => {
      for (let t = 0; t < m.indices.length / 3; t++) {
        const r = coplanarRegion(m.positions, m.indices, t)!;
        if (Math.abs(r.normal[2]) < 0.1 && r.tris.length <= 2) return r;
      }
      throw new Error("yanal yüz yok");
    })();
    expect(sideTri.tris.length).toBeLessThanOrEqual(2);
  });

  it("yüzey çerçevesi: üst yüzde orijin dünya orijininin üstünde, u yatay", () => {
    const f = frameFromFace([12, -7, 10], [0, 0, 1]);
    expect(f).toEqual({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });
    const side = frameFromFace([40, 5, 3], [1, 0, 0]);
    expect(side.origin).toEqual([40, 0, 0]);
    expect(side.u).toEqual([0, 1, 0]);
    expect(side.v).toEqual([0, 0, 1]); // v yukarı
    const bottom = frameFromFace([1, 2, 0], [0, 0, -1]);
    // u × v = n her zaman
    const cross = [bottom.u[1] * bottom.v[2] - bottom.u[2] * bottom.v[1], bottom.u[2] * bottom.v[0] - bottom.u[0] * bottom.v[2], bottom.u[0] * bottom.v[1] - bottom.u[1] * bottom.v[0]];
    expect(cross.map((x) => x + 0)).toEqual(bottom.n.map((x) => x + 0));
  });
});
