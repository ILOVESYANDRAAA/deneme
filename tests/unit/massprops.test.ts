import { describe, expect, it } from "vitest";
import { massGrams, massProperties } from "../../src/core/massprops";
import { SolidEvaluator } from "../../src/geometry/evaluate";
import type { Solid } from "../../src/core/solid";
import { manifold } from "./helpers";

async function props(solid: Solid) {
  const ev = new SolidEvaluator(await manifold());
  const m = ev.toMesh(ev.evaluate(solid));
  return massProperties(m.positions, m.indices);
}

describe("kütle özellikleri", () => {
  it("kutu: hacim, alan, merkez, eylemsizlik formülleri (a×b×c = 40×20×10)", async () => {
    const r = await props({ kind: "box", size: [40, 20, 10] });
    expect(r.volume).toBeCloseTo(8000, 6);
    expect(r.area).toBeCloseTo(2 * (800 + 400 + 200), 6);
    expect(r.centroid[0]).toBeCloseTo(0, 6);
    expect(r.centroid[1]).toBeCloseTo(0, 6);
    expect(r.centroid[2]).toBeCloseTo(5, 6);
    // Birim yoğunlukta I = V/12 · (b² + c²)
    expect(r.inertia[0][0]).toBeCloseTo((8000 / 12) * (400 + 100), 3);
    expect(r.inertia[1][1]).toBeCloseTo((8000 / 12) * (1600 + 100), 3);
    expect(r.inertia[2][2]).toBeCloseTo((8000 / 12) * (1600 + 400), 3);
    expect(r.inertia[0][1]).toBeCloseTo(0, 3); // çarpım terimleri yok
    expect(r.bbox).toEqual({ min: [-20, -10, 0], max: [20, 10, 10] });
  });

  it("ötelenmiş kutuda merkez kayar, eylemsizlik (merkez etrafında) değişmez", async () => {
    const a = await props({ kind: "box", size: [10, 20, 30] });
    const b = await props({ kind: "transform", translate: [100, -50, 7], child: { kind: "box", size: [10, 20, 30] } });
    expect(b.centroid[0]).toBeCloseTo(100, 4);
    expect(b.centroid[1]).toBeCloseTo(-50, 4);
    expect(b.centroid[2]).toBeCloseTo(7 + 15, 4);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(b.inertia[i][j]).toBeCloseTo(a.inertia[i][j], 2);
  });

  it("silindir (çok kenarlı): Izz = V·r²/2, Ixx = V·(3r² + h²)/12", async () => {
    const r = 5, h = 12;
    const s = await props({ kind: "cylinder", radius: r, height: h, segments: 256 });
    const v = Math.PI * r * r * h;
    expect(s.volume / v).toBeCloseTo(1, 3);
    expect(s.inertia[2][2] / ((v * r * r) / 2)).toBeCloseTo(1, 2);
    expect(s.inertia[0][0] / ((v * (3 * r * r + h * h)) / 12)).toBeCloseTo(1, 2);
    expect(s.centroid[2]).toBeCloseTo(h / 2, 4);
  });

  it("bileşik gövde (L şekli): ağırlık merkezi parçaların ağırlıklı ortalaması", async () => {
    const r = await props({
      kind: "boolean",
      op: "union",
      children: [
        { kind: "box", size: [10, 10, 10] },
        { kind: "transform", translate: [10, 0, 0], child: { kind: "box", size: [10, 10, 10] } },
      ],
    });
    expect(r.volume).toBeCloseTo(2000, 4);
    expect(r.centroid[0]).toBeCloseTo(5, 4);
  });

  it("ters yönlü ağda da pozitif hacim; boş ağda sıfır; kütle çevirimi", async () => {
    const ev = new SolidEvaluator(await manifold());
    const m = ev.toMesh(ev.evaluate({ kind: "box", size: [2, 2, 2] }));
    const flipped = new Uint32Array(m.indices);
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    expect(massProperties(m.positions, flipped).volume).toBeCloseTo(8, 6);
    expect(massProperties(new Float32Array(), new Uint32Array()).volume).toBe(0);
    expect(massGrams(1000, 7.85)).toBeCloseTo(7.85, 9); // 1 cm³ çelik
  });
});
