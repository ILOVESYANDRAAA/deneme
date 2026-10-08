import { describe, expect, it } from "vitest";
import { frameFromFace } from "../../src/core/sketch";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { createApp } from "./helpers";

async function boxApp() {
  const { app, ui } = await createApp();
  const sketch = app.createSketch("XY");
  const ed = new SketchEdit();
  buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
  app.document.update(sketch.id, { sketchData: ed.result() });
  const base = app.addSketchFeature("extrude")!;
  await app.updateFeature(base.id, { params: { distance: 10 } });
  return { app, ui, base };
}

function rectSketch(app: Awaited<ReturnType<typeof boxApp>>["app"], frame: ReturnType<typeof frameFromFace>, a: [number, number], b: [number, number]) {
  const sk = app.createSketch(frame);
  const ed = new SketchEdit();
  buildRect(ed, [a, [b[0], a[1]], b, [a[0], b[1]]]);
  app.document.update(sk.id, { sketchData: ed.result() });
  return sk;
}

describe("Yüzeye eskiz", () => {
  it("üst yüzde eskiz çiz, birleştirerek yukarı çek", async () => {
    const { app, base } = await boxApp();
    const frame = frameFromFace([12, 7, 10], [0, 0, 1]);
    const sk = rectSketch(app, frame, [10, 5], [20, 15]);
    expect(app.document.get(sk.id)!.frame).toEqual(frame);
    const boss = app.addSketchFeature("extrude", sk.id)!;
    await app.updateFeature(boss.id, { params: { distance: 5 } });
    await app.setOperation(boss.id, "join");
    expect(app.errors.get(boss.id)).toBeUndefined();
    expect(app.meshes.get(boss.id)!.volume).toBeCloseTo(8000 + 100 * 5, 2);
    expect(app.document.parentOf(base.id)?.id).toBe(boss.id);
  });

  it("üst yüzde eskiz çiz, negatif mesafe ile kes (cep)", async () => {
    const { app } = await boxApp();
    const sk = rectSketch(app, frameFromFace([0, 0, 10], [0, 0, 1]), [10, 5], [20, 15]);
    const pocket = app.addSketchFeature("extrude", sk.id)!;
    await app.updateFeature(pocket.id, { params: { distance: -3 } });
    await app.setOperation(pocket.id, "cut");
    expect(app.meshes.get(pocket.id)!.volume).toBeCloseTo(8000 - 100 * 3, 2);
  });

  it("yan yüzde eskiz: u = Y, v = Z; dışarı doğru çıkıntı", async () => {
    const { app } = await boxApp();
    const frame = frameFromFace([40, 5, 3], [1, 0, 0]);
    expect(frame.u).toEqual([0, 1, 0]);
    const sk = rectSketch(app, frame, [5, 2], [10, 7]); // Y 5..10, Z 2..7
    const boss = app.addSketchFeature("extrude", sk.id)!;
    await app.updateFeature(boss.id, { params: { distance: 4 } });
    await app.setOperation(boss.id, "join");
    expect(app.meshes.get(boss.id)!.volume).toBeCloseTo(8000 + 25 * 4, 2);
    const m = app.meshes.get(boss.id)!;
    let maxX = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) maxX = Math.max(maxX, m.positions[i]);
    expect(maxX).toBeCloseTo(44, 3);
  });

  it("kaydet / aç çerçeveyi korur; kopyalama da", async () => {
    const { app } = await boxApp();
    const frame = frameFromFace([0, 0, 10], [0, 0, 1]);
    const sk = rectSketch(app, frame, [1, 1], [3, 3]);
    const { app: copy } = await createApp();
    copy.openText(app.document.serialize(), "x.sugar");
    expect(copy.document.get(sk.id)!.frame).toEqual(frame);
  });

  it("geçersiz çerçeve reddedilir", async () => {
    const { app } = await boxApp();
    expect(() => app.createSketch({ origin: [0, 0, NaN], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] })).toThrow(/Geçersiz eskiz düzlemi/);
  });
});
