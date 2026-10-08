import { describe, expect, it } from "vitest";
import { buildRect, chainPoints, SketchEdit, thickenChain } from "../../src/core/sketchmodel";
import type { Loop } from "../../src/core/solid";
import { createApp } from "./helpers";

const area = (p: [number, number][]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

describe("yolu kalınlaştırma", () => {
  it("düz çizgi: uzunluk × kalınlık dikdörtgen", () => {
    const chain: Loop = { from: [0, 0], segs: [{ to: [10, 0] }] };
    const poly = thickenChain(chain, 2);
    expect(area(poly)).toBeCloseTo(20, 9);
    expect(Math.min(...poly.map((p) => p[1]))).toBeCloseTo(-1, 9);
  });

  it("L şekli: iç köşe gönyeli, alan = uzunluk × kalınlık (köşe fazlalığı hariç)", () => {
    const chain: Loop = { from: [0, 0], segs: [{ to: [10, 0] }, { to: [10, 10] }] };
    const poly = thickenChain(chain, 2);
    // Orta çizgi uzunluğu 20; gönyeli köşede alan tam 20·2 = 40 (iç ve dış köşe birbirini götürür)
    expect(area(poly)).toBeCloseTo(40, 6);
  });

  it("yay: yarım daire yol (R=10) kalınlığı 2 → alan ≈ π·R·t", () => {
    const chain: Loop = { from: [-10, 0], segs: [{ to: [10, 0], via: [0, 10] }] };
    const pts = chainPoints(chain);
    expect(pts[0]).toEqual([-10, 0]);
    expect(pts.at(-1)).toEqual([10, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(10, 1);
    expect(area(thickenChain(chain, 2))).toBeCloseTo(Math.PI * 10 * 2, 0);
    // via'nın öbür tarafında kalan (saat yönündeki) yay da doğru gidiyor
    const below: Loop = { from: [-10, 0], segs: [{ to: [10, 0], via: [0, -10] }] };
    expect(Math.min(...chainPoints(below).map((p) => p[1]))).toBeCloseTo(-10, 1);
  });
});

describe("Kaburga", () => {
  it("XZ düzleminde çizilen çizgiden kaburga: kalınlık × uzunluk × yükseklik; gövdeye birleşir", async () => {
    const { app } = await createApp();
    // 40×20×10 taban
    const base = app.createSketch("XY");
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
    app.document.update(base.id, { sketchData: ed.result() });
    const block = app.addSketchFeature("extrude", base.id)!;
    await app.updateFeature(block.id, { params: { distance: 10 } });
    // Üst yüzde (z = 10) bir çizgi: x 5..35, y = 10 → kaburga 4 yüksek, 2 kalın
    const { frameFromFace } = await import("../../src/core/sketch");
    const sk = app.createSketch(frameFromFace([0, 0, 10], [0, 0, 1]));
    const e2 = new SketchEdit();
    e2.line(e2.point([5, 10]), e2.point([35, 10]));
    app.document.update(sk.id, { sketchData: e2.result() });
    const rib = app.addSketchFeature("rib", sk.id)!;
    await app.updateFeature(rib.id, { params: { thickness: 2, distance: 4 } });
    await app.setOperation(rib.id, "join");
    expect(app.errors.get(rib.id)).toBeUndefined();
    expect(app.meshes.get(rib.id)!.volume).toBeCloseTo(8000 + 30 * 2 * 4, 2);
  });

  it("kapalı şekilli eskiz kaburga olmaz; anlaşılır hata", async () => {
    const { app } = await createApp();
    const sk = app.createSketch("XY");
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [5, 0], [5, 5], [0, 5]]);
    app.document.update(sk.id, { sketchData: ed.result() });
    const rib = app.addSketchFeature("rib", sk.id)!;
    expect(app.errors.get(rib.id)).toMatch(/açık bir yol/);
  });
});

describe("Döndürmede eksen olarak eskiz çizgisi", () => {
  /** Eksen çizgisi (yapı) + profil dikdörtgeni; döndürülünce Pappus hacmi. */
  async function revolveAbout(axisFrom: [number, number], axisTo: [number, number], rect: [[number, number], [number, number]]) {
    const { app } = await createApp();
    const sk = app.createSketch("XY");
    const ed = new SketchEdit();
    const axis = ed.line(ed.point(axisFrom), ed.point(axisTo));
    for (const c of ed.d.curves) if (c.id === axis) c.construction = true;
    const [a, b] = rect;
    buildRect(ed, [a, [b[0], a[1]], b, [a[0], b[1]]]);
    app.document.update(sk.id, { sketchData: ed.result() });
    const f = app.addSketchFeature("revolve", sk.id)!;
    await app.updateFeature(f.id, { axis: `line:${axis}` });
    return { app, f };
  }

  it("dik çizgi x = 10 etrafında: kutu x 12..14 → boru, hacim = π(16²−12²... )", async () => {
    // Eksen x=10 (dikey), profil x 12..14 → eksenden 2..4 uzaklık, yükseklik 5
    const { app, f } = await revolveAbout([10, -5], [10, 20], [[12, 0], [14, 5]]);
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(Math.PI * (16 - 4) * 5, -1);
    const m = app.meshes.get(f.id)!;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]);
      maxX = Math.max(maxX, m.positions[i]);
    }
    expect(minX).toBeCloseTo(6, 1); // 10 − 4
    expect(maxX).toBeCloseTo(14, 1);
  });

  it("eğik çizgi (45°) etrafında: hacim eksene uzaklıkla aynı, konum doğru", async () => {
    // Eksen y = x doğrusu; profil: eksene 3..5 uzaklıkta, eksen boyunca 4 uzunlukta bir dikdörtgen
    // Profil köşeleri (eksen yönü d = (1,1)/√2, normal n = (−1,1)/√2): s ∈ [0,4], t ∈ [3,5]
    const d = [Math.SQRT1_2, Math.SQRT1_2];
    const n = [-Math.SQRT1_2, Math.SQRT1_2];
    const P = (s: number, t: number): [number, number] => [d[0] * s + n[0] * t, d[1] * s + n[1] * t];
    const { app } = await createApp();
    const sk = app.createSketch("XY");
    const ed = new SketchEdit();
    const axis = ed.line(ed.point([0, 0]), ed.point([10, 10]));
    for (const c of ed.d.curves) if (c.id === axis) c.construction = true;
    const pts = [P(0, 3), P(4, 3), P(4, 5), P(0, 5)].map((p) => ed.point(p));
    ed.polyline(pts, true);
    app.document.update(sk.id, { sketchData: ed.result() });
    const f = app.addSketchFeature("revolve", sk.id)!;
    await app.updateFeature(f.id, { axis: `line:${axis}` });
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(Math.PI * (25 - 9) * 4, -1);
    // Dönel gövde ekseni y = x doğrusunda: her köşe noktasının eksene uzaklığı ≤ 5
    const m = app.meshes.get(f.id)!;
    let maxDist = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
      const along = (x + y) * Math.SQRT1_2;
      const perp = Math.hypot((x - y) * Math.SQRT1_2, z);
      maxDist = Math.max(maxDist, perp);
      expect(along).toBeGreaterThan(-0.01);
      expect(along).toBeLessThan(4.01);
    }
    expect(maxDist).toBeCloseTo(5, 1);
  });

  it("silinmiş eksen çizgisi anlaşılır hata verir", async () => {
    const { app, f } = await revolveAbout([10, -5], [10, 20], [[12, 0], [14, 5]]);
    await app.updateFeature(f.id, { axis: "line:c9999" });
    expect(app.errors.get(f.id)).toMatch(/eksen çizgisi bulunamadı/);
  });
});
