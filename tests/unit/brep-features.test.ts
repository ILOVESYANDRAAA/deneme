import { describe, expect, it } from "vitest";
import type { Feature } from "../../src/core/features";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { createApp } from "./helpers";

/** 40×20 dikdörtgen eskizi + 10 mm ekstrüzyon (veya daire) kurar. */
async function body(kind: "rect" | "circle" = "rect") {
  const { app, ui } = await createApp({ brep: true });
  const sketch = app.createSketch("XY");
  const ed = new SketchEdit();
  if (kind === "rect") buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
  else ed.circle(ed.point([0, 0]), 8);
  app.document.update(sketch.id, { sketchData: ed.result() });
  const extrude = app.addSketchFeature("extrude")!;
  await app.updateFeature(extrude.id, { params: { distance: 10 } });
  return { app, ui, extrude };
}

describe("B-rep özellikleri (uygulama düzeyi)", () => {
  it("dikdörtgen gövdenin dikey kenarlarını yuvarlatır; hacim tam formülle, özellik parametrik", async () => {
    const { app, extrude } = await body();
    const info = await app.describeBody(extrude.id);
    expect(info.edges).toHaveLength(12);
    const vertical = info.edges.filter((e) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99).map((e) => e.ref);
    const f = app.addBrepFeature("fillet", extrude.id, { edges: vertical }, 3);
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(8000 - 4 * (1 - Math.PI / 4) * 9 * 10, 1);
    // Kaynak gövde tüketildi: tek kök var
    expect(app.document.roots().map((r) => r.id)).toEqual([f.id]);
    expect(app.meshes.has(extrude.id)).toBe(false);
    // Yarıçap parametresi değişince yeniden hesaplanır
    await app.updateFeature(f.id, { params: { radius: 5 } });
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(8000 - 4 * (1 - Math.PI / 4) * 25 * 10, 1);
    // Geri al / yinele
    app.document.undo();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(8000 - 4 * (1 - Math.PI / 4) * 9 * 10, 1);
  });

  it("gövde ölçüsü değişince seçilen kenarlar yerinde kalır", async () => {
    const { app, extrude } = await body();
    const info = await app.describeBody(extrude.id);
    const vertical = info.edges.filter((e) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99).map((e) => e.ref);
    const f = app.addBrepFeature("fillet", extrude.id, { edges: vertical }, 2);
    await app.updateFeature(extrude.id, { params: { distance: 25 } });
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(800 * 25 - 4 * (1 - Math.PI / 4) * 4 * 25, 1);
  });

  it("daire eskizinin ekstrüzyonu gerçek silindir: üst çemberi yuvarlatınca hacim azalır", async () => {
    const { app, extrude } = await body("circle");
    const info = await app.describeBody(extrude.id);
    expect(info.faces).toHaveLength(3); // taban, tavan, silindir yüzeyi
    const top = info.edges.find((e) => e.ref.kind === "CIRCLE" && e.ref.mid[2] > 5)!;
    const f = app.addBrepFeature("fillet", extrude.id, { edges: [top.ref] }, 1);
    const cylinder = Math.PI * 64 * 10;
    expect(app.meshes.get(f.id)!.volume).toBeLessThan(cylinder);
    expect(app.meshes.get(f.id)!.volume).toBeGreaterThan(cylinder - 2 * Math.PI * 8 * 0.215 * 1); // kaba üst sınır kontrolü
  });

  it("pah ve kabuk; kabuk açılan yüzü kaldırır", async () => {
    const { app, extrude } = await body();
    const info = await app.describeBody(extrude.id);
    const ch = app.addBrepFeature("chamfer", extrude.id, { edges: [info.edges[0].ref] }, 2);
    expect(app.meshes.get(ch.id)!.volume).toBeLessThan(8000);
    const { app: app2, extrude: ex2 } = await body();
    const info2 = await app2.describeBody(ex2.id);
    const top = info2.faces.find((f) => f.ref.normal && f.ref.normal[2] > 0.99)!;
    const sh = app2.addBrepFeature("shell", ex2.id, { faces: [top.ref] }, 1.5);
    expect(app2.meshes.get(sh.id)!.volume).toBeCloseTo(800 * 10 - 37 * 17 * 8.5, 1);
  });

  it("hatalar anlaşılır: kenar seçilmemiş, yarıçap çok büyük", async () => {
    const { app, extrude } = await body();
    expect(() => app.addBrepFeature("fillet", extrude.id, { edges: [] })).toThrow(/en az bir kenar/i);
    const info = await app.describeBody(extrude.id);
    const f = app.addBrepFeature("fillet", extrude.id, { edges: [info.edges[0].ref] }, 50);
    expect(app.errors.get(f.id)).toMatch(/Yuvarlatma uygulanamadı/);
  });

  it("kaydet / aç B-rep özelliklerini korur; ağaçta kaynak gövde tüketilmiş görünür", async () => {
    const { app, extrude } = await body();
    const info = await app.describeBody(extrude.id);
    const f = app.addBrepFeature("fillet", extrude.id, { edges: [info.edges[0].ref] }, 2);
    const { app: copy } = await createApp({ brep: true });
    copy.openText(app.document.serialize(), "x.sugar");
    const g = copy.document.get(f.id) as Feature;
    expect(g.type).toBe("fillet");
    expect(g.edges).toEqual(f.edges);
    expect(copy.meshes.get(f.id)!.volume).toBeCloseTo(app.meshes.get(f.id)!.volume, 6);
  });

  it("yuvarlatılmış gövdeyi aynalama ve ekstrüzyonla kesme çalışır", async () => {
    const { app, extrude } = await body();
    const info = await app.describeBody(extrude.id);
    const vertical = info.edges.filter((e) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99).map((e) => e.ref);
    const f = app.addBrepFeature("fillet", extrude.id, { edges: vertical }, 2);
    const one = app.meshes.get(f.id)!.volume;
    const m = app.addBodyFeature("mirror", f.id)!;
    await app.updateFeature(m.id, { plane: "YZ" });
    expect(app.errors.get(m.id)).toBeUndefined();
    expect(app.meshes.get(m.id)!.volume).toBeGreaterThan(one);
  });
});
