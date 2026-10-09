import { describe, expect, it } from "vitest";
import { fromLegacyEntities } from "../../src/core/sketchmodel";
import { validateSolid } from "../../src/core/solid";
import { createApp } from "./helpers";

async function makePlate() {
  const { app, ui } = await createApp();
  const sketch = app.createSketch("XY");
  app.document.update(sketch.id, { sketchData: fromLegacyEntities([{ kind: "rect", a: [0, 0], b: [20, 10] }]) });
  const plate = app.addSketchFeature("extrude", sketch.id)!;
  await app.updateFeature(plate.id, { params: { distance: 5 } });
  return { app, ui, plate };
}

const bounds = (positions: Float32Array, axis: 0 | 1 | 2) => {
  const v = [...positions].filter((_, i) => i % 3 === axis);
  return [Math.min(...v), Math.max(...v)];
};

describe("Taşı / Kopyala", () => {
  it("gövdeyi kaydırır, hacmi korur", async () => {
    const { app, plate } = await makePlate();
    const move = app.addBodyFeature("move", plate.id)!;
    await app.updateFeature(move.id, { params: { dx: 100, dy: 0, dz: 0 } });
    const mesh = app.meshes.get(move.id)!;
    expect(mesh.volume).toBeCloseTo(1000);
    expect(bounds(mesh.positions, 0)[0]).toBeCloseTo(100);
    expect(bounds(mesh.positions, 0)[1]).toBeCloseTo(120);
  });

  it("döndürür", async () => {
    const { app, plate } = await makePlate();
    const move = app.addBodyFeature("move", plate.id)!;
    await app.updateFeature(move.id, { params: { dx: 0, rz: 90 } });
    const mesh = app.meshes.get(move.id)!;
    // 20 × 10 plaka Z etrafında 90°: X artık 0..-10, Y 0..20
    expect(bounds(mesh.positions, 0)[0]).toBeCloseTo(-10);
    expect(bounds(mesh.positions, 1)[1]).toBeCloseTo(20);
  });

  it("kopya seçeneği orijinali de bırakır", async () => {
    const { app, plate } = await makePlate();
    const move = app.addBodyFeature("move", plate.id)!;
    await app.updateFeature(move.id, { params: { dx: 50, copy: 1 } });
    const mesh = app.meshes.get(move.id)!;
    expect(mesh.volume).toBeCloseTo(2000);
    expect(bounds(mesh.positions, 0)).toEqual([expect.closeTo(0), expect.closeTo(70)]);
  });
});

describe("Gövdeyi Böl", () => {
  it("düzlemin normal yönündeki yarıyı tutar", async () => {
    const { app, plate } = await makePlate();
    const split = app.addBodyFeature("split", plate.id)!;
    expect(app.document.get(split.id)!.plane).toBe("XY");
    // Plaka z: 0..5, düzlem z = 2
    await app.updateFeature(split.id, { params: { offset: 2, keep: 1 } });
    let mesh = app.meshes.get(split.id)!;
    expect(mesh.volume).toBeCloseTo(600);
    expect(bounds(mesh.positions, 2)[0]).toBeCloseTo(2);
    await app.updateFeature(split.id, { params: { offset: 2, keep: 0 } });
    mesh = app.meshes.get(split.id)!;
    expect(mesh.volume).toBeCloseTo(400);
    expect(bounds(mesh.positions, 2)[1]).toBeCloseTo(2);
  });

  it("farklı düzlemle çalışır", async () => {
    const { app, plate } = await makePlate();
    const split = app.addBodyFeature("split", plate.id)!;
    await app.updateFeature(split.id, { plane: "YZ", params: { offset: 5, keep: 1 } });
    // YZ düzleminin normali +X: x = 5'ten büyük kısım, 20 → 15 uzunluk
    expect(app.meshes.get(split.id)!.volume).toBeCloseTo(750);
  });
});

describe("temel şekiller", () => {
  it("simit, boru ve helis için Ekle komutu vardır; kutu / silindir / küre arayüzde gizli kalır", async () => {
    const { app } = await createApp();
    for (const type of ["torus", "pipe", "coil"]) expect(app.commands.has(`shape.add.${type}`)).toBe(true);
    for (const type of ["box", "cylinder", "sphere"]) expect(app.commands.has(`shape.add.${type}`)).toBe(false);
  });

  it("simit hacmi 2π²Rr²", async () => {
    const { app } = await createApp();
    const t = await app.addPrimitive("torus", { radius: 20, tube: 5, segments: 128 });
    // Tüp kesiti 32 kenarlı çokgen olduğundan %1 içinde
    expect(app.meshes.get(t.id)!.volume / (2 * Math.PI ** 2 * 20 * 25)).toBeGreaterThan(0.99);
    expect(app.meshes.get(t.id)!.volume / (2 * Math.PI ** 2 * 20 * 25)).toBeLessThan(1.001);
  });

  it("simitte tüp yarıçapı büyükse hata verir", async () => {
    const { app } = await createApp();
    const t = await app.addPrimitive("torus", { radius: 5, tube: 7 });
    expect(app.errors.get(t.id)).toMatch(/Simit/);
  });

  it("boru hacmi π(R²−r²)h", async () => {
    const { app } = await createApp();
    const p = await app.addPrimitive("pipe", { outer: 10, wall: 2, height: 30, segments: 256 });
    expect(app.meshes.get(p.id)!.volume).toBeCloseTo(Math.PI * (100 - 64) * 30, -1);
  });

  it("helis hacmi ≈ tel kesiti × yol uzunluğu; yüksekliği adım × tur", async () => {
    const { app } = await createApp();
    const c = await app.addPrimitive("coil", { radius: 10, wire: 1, pitch: 5, turns: 4, segments: 64 });
    const mesh = app.meshes.get(c.id)!;
    const path = 4 * Math.hypot(2 * Math.PI * 10, 5);
    expect(mesh.volume).toBeGreaterThan(Math.PI * 0.95 * path);
    expect(mesh.volume).toBeLessThan(Math.PI * 1.05 * path);
    const [z0, z1] = bounds(mesh.positions, 2);
    // Tel ekseni Z=0'dan başlar; tel kalınlığı iki uçta ±tel yarıçapı (≈1) taşar
    expect(z1 - z0).toBeCloseTo(4 * 5 + 2, 0);
  });

  it("sarımlar birbirine giriyorsa helis hata verir", async () => {
    const { app } = await createApp();
    const c = await app.addPrimitive("coil", { radius: 10, wire: 3, pitch: 5, turns: 3 });
    expect(app.errors.get(c.id)).toMatch(/Helis/);
  });

  it("helis tarifi doğrulanır", () => {
    expect(() => validateSolid({ kind: "coil", radius: 5, wire: 1, pitch: 4, turns: 3 })).not.toThrow();
    expect(() => validateSolid({ kind: "coil", radius: 5, wire: 1, pitch: 1.5, turns: 3 })).toThrow(/pitch/);
    expect(() => validateSolid({ kind: "coil", radius: 5, wire: 1, pitch: 4, turns: 0 })).toThrow(/turns/);
    expect(() => validateSolid({ kind: "coil", radius: 1, wire: 1, pitch: 4, turns: 3 })).toThrow(/wire/);
  });
});
