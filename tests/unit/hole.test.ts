import { describe, expect, it } from "vitest";
import { holeProfile } from "../../src/core/features";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { createApp } from "./helpers";

/** 40×20×10 kutu (X 0–40, Y 0–20, Z 0–10). */
async function box(options: { brep?: boolean } = {}) {
  const { app, ui } = await createApp(options);
  const sketch = app.createSketch("XY");
  const ed = new SketchEdit();
  buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
  app.document.update(sketch.id, { sketchData: ed.result() });
  const extrude = app.addSketchFeature("extrude")!;
  await app.updateFeature(extrude.id, { params: { distance: 10 } });
  return { app, ui, extrude };
}

/** 96 kenarlı çokgenin alanı daireden bu oranda küçüktür. */
const POLY = (Math.sin((2 * Math.PI) / 96) * 96) / (2 * Math.PI);
const close = (a: number, b: number, rel = 0.002) => expect(Math.abs(a - b) / b).toBeLessThan(rel);
const TOP = { at: [20, 10, 10] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

describe("Delik", () => {
  it("basit kör delik: hacim silindir kadar azalır", async () => {
    const { app, extrude } = await box();
    const f = app.addHoleFeature(extrude.id, [TOP], { params: { diameter: 8, depth: 4 } });
    expect(app.errors.get(f.id)).toBeUndefined();
    close(app.meshes.get(f.id)!.volume, 8000 - Math.PI * 16 * 4 * POLY);
    expect(app.document.roots().map((r) => r.id)).toEqual([f.id]); // kaynak tüketildi
  });

  it("boydan boya (derinlik 0) ve yan yüzden delik", async () => {
    const { app, extrude } = await box();
    const through = app.addHoleFeature(extrude.id, [TOP], { params: { diameter: 6, depth: 0 } });
    close(app.meshes.get(through.id)!.volume, 8000 - Math.PI * 9 * 10 * POLY);
    const { app: app2, extrude: ex2 } = await box();
    // sağ yüzden (x=40) X yönünde 5 mm derin delik
    const side = app2.addHoleFeature(ex2.id, [{ at: [40, 10, 5], normal: [1, 0, 0] }], { params: { diameter: 4, depth: 5 } });
    close(app2.meshes.get(side.id)!.volume, 8000 - Math.PI * 4 * 5 * POLY);
  });

  it("birden çok delik tek özellikte; değer değişince yeniden hesaplanır", async () => {
    const { app, extrude } = await box();
    const f = app.addHoleFeature(extrude.id, [{ ...TOP, at: [10, 10, 10] }, { ...TOP, at: [30, 10, 10] }], { params: { diameter: 4, depth: 5 } });
    close(app.meshes.get(f.id)!.volume, 8000 - 2 * Math.PI * 4 * 5 * POLY);
    await app.updateFeature(f.id, { params: { depth: 8 } });
    close(app.meshes.get(f.id)!.volume, 8000 - 2 * Math.PI * 4 * 8 * POLY);
    app.document.undo();
    close(app.meshes.get(f.id)!.volume, 8000 - 2 * Math.PI * 4 * 5 * POLY);
  });

  it("silindirik havşa ve konik havşa hacimleri", async () => {
    const { app, extrude } = await box();
    const cb = app.addHoleFeature(extrude.id, [TOP], { type: "counterbore", params: { diameter: 6, depth: 8, cbDiameter: 12, cbDepth: 3 } });
    close(app.meshes.get(cb.id)!.volume, 8000 - Math.PI * (36 * 3 + 9 * 5) * POLY);
    const { app: app2, extrude: ex2 } = await box();
    const cs = app2.addHoleFeature(ex2.id, [TOP], { type: "countersink", params: { diameter: 6, depth: 8, csDiameter: 12, csAngle: 90 } });
    // 90° konik havşa: koni yüksekliği (R - r) = 3; frustum + kalan silindir
    const frustum = (Math.PI * 3 * (36 + 18 + 9)) / 3;
    close(app2.meshes.get(cs.id)!.volume, 8000 - (frustum + Math.PI * 9 * 5) * POLY, 0.004);
  });

  it("geçersiz değerlerde anlaşılır hata", async () => {
    const { app, extrude } = await box();
    const f = app.addHoleFeature(extrude.id, [TOP], { type: "counterbore", params: { diameter: 10, depth: 8, cbDiameter: 6, cbDepth: 3 } });
    expect(app.errors.get(f.id)).toMatch(/havşa çapı delik çapından büyük/);
    expect(() => app.addHoleFeature(extrude.id, [TOP])).toThrow(/boştaki bir katı gövde/); // kaynak artık tüketilmiş
    const fresh = await box();
    expect(() => fresh.app.addHoleFeature(fresh.extrude.id, [])).toThrow(/konumu seçilmemiş/);
    expect(() => holeProfile({ name: "D", params: { diameter: 6, depth: 2, csDiameter: 20, csAngle: 90 }, holeType: "countersink" })).toThrow(/konik havşadan/);
  });

  it("yuvarlatılmış gövdede de çalışır (OpenCascade yolu) ve kaydedilir", async () => {
    const { app, extrude } = await box({ brep: true });
    const info = await app.describeBody(extrude.id);
    const vertical = info.edges.filter((e) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99).map((e) => e.ref);
    const fillet = app.addBrepFeature("fillet", extrude.id, { edges: vertical }, 2);
    const base = app.meshes.get(fillet.id)!.volume;
    const hole = app.addHoleFeature(fillet.id, [TOP], { params: { diameter: 8, depth: 4 } });
    expect(app.errors.get(hole.id)).toBeUndefined();
    close(base - app.meshes.get(hole.id)!.volume, Math.PI * 16 * 4, 0.003);
    const { app: copy } = await createApp({ brep: true });
    copy.openText(app.document.serialize(), "x.sugar");
    expect(copy.document.get(hole.id)!.holes).toEqual([TOP]);
    close(copy.meshes.get(hole.id)!.volume, app.meshes.get(hole.id)!.volume, 1e-6);
  });
});
