import { describe, expect, it } from "vitest";
import type { Feature } from "../../src/core/features";
import type { PlaneName, SketchEntity } from "../../src/core/sketch";
import { niceStep, sketchProfiles, sketchSegments, snapToGrid, toWorld } from "../../src/core/sketch";
import { createApp } from "./helpers";

const rect = (a: [number, number], b: [number, number]): SketchEntity => ({ kind: "rect", a, b });
const circle = (c: [number, number], r: number): SketchEntity => ({ kind: "circle", c, r });

/** Eskiz + ekstrüzyon/döndürme kurar; sonucun hacmini ve sınır kutusunu döndürür. */
async function build(
  plane: PlaneName,
  entities: SketchEntity[],
  feature: { type: "extrude"; distance?: number } | { type: "revolve"; angle?: number; axis?: "U" | "V" },
  offset = 0,
) {
  const { app, ui } = await createApp();
  const sketch = app.createSketch(plane);
  app.document.update(sketch.id, { entities, params: { offset } });
  const f = app.addSketchFeature(feature.type)!;
  if (feature.type === "extrude" && feature.distance !== undefined) await app.updateFeature(f.id, { params: { distance: feature.distance } });
  if (feature.type === "revolve") {
    await app.updateFeature(f.id, { params: { angle: feature.angle ?? 360 }, axis: feature.axis ?? "V" });
  }
  const mesh = app.meshes.get(f.id);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  if (mesh) {
    for (let i = 0; i < mesh.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], mesh.positions[i]);
      max[i % 3] = Math.max(max[i % 3], mesh.positions[i]);
    }
  }
  const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000 + 0);
  return { app, ui, f, sketch, volume: mesh?.volume ?? 0, min: round(min), max: round(max), error: app.errors.get(f.id) };
}

describe("eskiz yardımcıları", () => {
  it("sadece kapalı şekilleri profil sayar", () => {
    const profiles = sketchProfiles([
      rect([0, 0], [10, 5]),
      rect([1, 1], [1, 4]), // sıfır genişlik → atlanır
      circle([0, 0], 3),
      { kind: "polyline", points: [[0, 0], [5, 0], [5, 5]], closed: true },
      { kind: "polyline", points: [[0, 0], [5, 0], [5, 5]], closed: false },
    ]);
    expect(profiles.map((p) => p.length)).toEqual([4, 96, 3]);
  });

  it("açık çizgileri de çizim için parçalara böler", () => {
    expect(sketchSegments([{ kind: "polyline", points: [[0, 0], [1, 0], [1, 1]], closed: false }])).toHaveLength(2);
    expect(sketchSegments([rect([0, 0], [1, 1])])).toHaveLength(4);
  });

  it("düzlem eksenleri sağ el kuralına uyar", () => {
    expect(toWorld("XY", 0, [1, 2])).toEqual([1, 2, 0]);
    expect(toWorld("XZ", 0, [1, 2])).toEqual([1, 0, 2]);
    expect(toWorld("YZ", 3, [1, 2])).toEqual([3, 1, 2]);
  });

  it("ızgara adımı ve yapışma", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(3)).toBe(5);
    expect(snapToGrid([1.26, -2.74], 0.5)).toEqual([1.5, -2.5]);
  });
});

describe("Ekstrüzyon", () => {
  it("XY: dikdörtgeni Z yönünde çeker", async () => {
    const r = await build("XY", [rect([0, 0], [20, 10])], { type: "extrude", distance: 5 });
    expect(r.volume).toBeCloseTo(1000, 3);
    expect(r.min).toEqual([0, 0, 0]);
    expect(r.max).toEqual([20, 10, 5]);
  });

  it("iç içe daire delik açar", async () => {
    const r = await build("XY", [rect([0, 0], [10, 20]), circle([5, 10], 2)], { type: "extrude", distance: 5 });
    expect(r.volume).toBeCloseTo((200 - Math.PI * 4) * 5, 0);
  });

  it("negatif mesafe ters yöne çeker", async () => {
    const r = await build("XY", [rect([0, 0], [2, 2])], { type: "extrude", distance: -5 });
    expect(r.min[2]).toBe(-5);
    expect(r.max[2]).toBe(0);
  });

  it("XZ (ön) ve YZ (sağ) düzlemleri doğru yöne bakar", async () => {
    const xz = await build("XZ", [rect([0, 0], [10, 20])], { type: "extrude", distance: 5 });
    expect(xz.min).toEqual([0, -5, 0]);
    expect(xz.max).toEqual([10, 0, 20]);
    const yz = await build("YZ", [rect([0, 0], [10, 20])], { type: "extrude", distance: 5 });
    expect(yz.min).toEqual([0, 0, 0]);
    expect(yz.max).toEqual([5, 10, 20]);
  });

  it("düzlem ofseti eskizi normal yönünde kaydırır", async () => {
    const r = await build("XY", [rect([0, 0], [1, 1])], { type: "extrude", distance: 2 }, 7);
    expect(r.min[2]).toBe(7);
    expect(r.max[2]).toBe(9);
  });

  it("kapalı şekli olmayan eskizde anlaşılır hata verir", async () => {
    const r = await build("XY", [{ kind: "polyline", points: [[0, 0], [5, 5]], closed: false }], { type: "extrude" });
    expect(r.volume).toBe(0);
    expect(r.error).toMatch(/kapalı şekil yok/);
  });
});

describe("Döndürme", () => {
  it("dikey eksen (V) etrafında boru üretir", async () => {
    const r = await build("XY", [rect([2, 0], [4, 10])], { type: "revolve" });
    expect(r.volume).toBeCloseTo(Math.PI * (16 - 4) * 10, -1);
    // XY eskizinde V = dünya Y ekseni
    expect(r.min[1]).toBe(0);
    expect(r.max[1]).toBe(10);
    expect(r.max[0]).toBeCloseTo(4, 1);
    expect(r.min[2]).toBeCloseTo(-4, 1);
  });

  it("yatay eksen (U) etrafında döndürür", async () => {
    const r = await build("XY", [rect([0, 2], [10, 4])], { type: "revolve", axis: "U" });
    expect(r.volume).toBeCloseTo(Math.PI * (16 - 4) * 10, -1);
    expect(r.min[0]).toBe(0);
    expect(r.max[0]).toBe(10);
    expect(r.max[2]).toBeCloseTo(4, 1);
  });

  it("eksenin sol tarafına çizilen profil de çalışır; yarım tur yarı hacim", async () => {
    const full = await build("XY", [rect([-4, 0], [-2, 10])], { type: "revolve" });
    expect(full.volume).toBeCloseTo(Math.PI * 12 * 10, -1);
    const half = await build("XY", [rect([2, 0], [4, 10])], { type: "revolve", angle: 180 });
    expect(half.volume).toBeCloseTo((Math.PI * 12 * 10) / 2, -1);
  });
});

describe("eskiz tabanlı özellik ağacı", () => {
  it("eskiz ekstrüzyonun girdisi olur; silme sırası korunur", async () => {
    const { app } = await build("XY", [rect([0, 0], [1, 1])], { type: "extrude" });
    const [sketch, extrude] = app.document.all();
    expect(app.document.roots().map((f) => f.id)).toEqual([extrude.id]);
    expect(app.document.parentOf(sketch.id)?.id).toBe(extrude.id);
    expect(() => app.document.remove(sketch.id)).toThrow(/önce onu silin/);
    // İkisi birlikte seçilip silinince önce ekstrüzyon silinir
    app.document.setSelection([sketch.id, extrude.id]);
    app.deleteSelection();
    expect(app.document.all()).toHaveLength(0);
  });

  it("eskiz boolean işleneni olamaz", async () => {
    const { app } = await createApp();
    const a = app.createSketch("XY");
    const b = await app.addPrimitive("box");
    expect(() => app.addBoolean("union", b.id, a.id)).toThrow(/eskiz/);
  });

  it("eskizi düzenlemek ekstrüzyonu günceller (parametrik)", async () => {
    const { app, sketch, f, volume } = await build("XY", [rect([0, 0], [10, 10])], { type: "extrude", distance: 1 });
    expect(volume).toBeCloseTo(100);
    app.document.update(sketch.id, { entities: [rect([0, 0], [10, 20])] });
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(200);
    app.document.undo();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(100);
  });

  it("seçim yoksa tek boş eskizi kullanır, yoksa uyarır", async () => {
    const { app, ui } = await createApp();
    expect(app.addSketchFeature("extrude")).toBeNull();
    expect(ui.messages.at(-1)?.kind).toBe("warning");
    const s1 = app.createSketch("XY");
    app.createSketch("XZ");
    app.document.setSelection([]);
    expect(app.addSketchFeature("extrude")).toBeNull(); // iki aday var
    app.document.setSelection([s1.id]);
    expect(app.addSketchFeature("extrude")?.sketch).toBe(s1.id);
  });

  it("kaydet/aç eskizleri ve bağlantıları korur", async () => {
    const { app } = await build("YZ", [circle([0, 5], 2)], { type: "extrude", distance: 3 }, 1);
    const { app: copy } = await createApp();
    copy.openText(app.document.serialize(), "x.sugar");
    const ids = (a: typeof app) => a.document.all().map((f: Feature) => [f.type, f.plane, f.sketch]);
    expect(ids(copy)).toEqual(ids(app));
    const extrude = copy.document.all()[1];
    expect(copy.meshes.get(extrude.id)!.volume).toBeCloseTo(Math.PI * 4 * 3, 0);
  });
});
