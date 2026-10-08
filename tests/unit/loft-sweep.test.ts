import { describe, expect, it } from "vitest";
import { sketchDataChain, sketchDataLoops, SketchEdit, buildRect } from "../../src/core/sketchmodel";
import { createApp } from "./helpers";

type App = Awaited<ReturnType<typeof createApp>>["app"];

function rectSketch(app: App, plane: "XY" | "XZ" | "YZ", offset: number, a: [number, number], b: [number, number]) {
  const sk = app.createSketch(plane, offset);
  const ed = new SketchEdit();
  buildRect(ed, [a, [b[0], a[1]], b, [a[0], b[1]]]);
  app.document.update(sk.id, { sketchData: ed.result() });
  return sk;
}

function circleSketch(app: App, plane: "XY" | "XZ" | "YZ", offset: number, r: number, c: [number, number] = [0, 0]) {
  const sk = app.createSketch(plane, offset);
  const ed = new SketchEdit();
  ed.circle(ed.point(c), r);
  app.document.update(sk.id, { sketchData: ed.result() });
  return sk;
}

describe("Loft", () => {
  it("aynı boyutlu iki kare arası düz prizma gibi (ruled): hacim = alan × yükseklik", async () => {
    const { app } = await createApp({ brep: true });
    const a = rectSketch(app, "XY", 0, [-5, -5], [5, 5]);
    const b = rectSketch(app, "XY", 10, [-5, -5], [5, 5]);
    const f = app.addLoftFeature([a.id, b.id])!;
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(1000, 1);
    expect(app.document.roots().map((r) => r.id)).toEqual([f.id]);
  });

  it("kare → daire geçişi: hacim iki prizma arasında; düz geçiş farklı sonuç verir", async () => {
    const { app } = await createApp({ brep: true });
    const sq = rectSketch(app, "XY", 0, [-5, -5], [5, 5]);
    const ci = circleSketch(app, "XY", 10, 4);
    const f = app.addLoftFeature([sq.id, ci.id])!;
    const v = app.meshes.get(f.id)!.volume;
    expect(v).toBeGreaterThan(Math.PI * 16 * 10);
    expect(v).toBeLessThan(1000);
    await app.updateFeature(f.id, { params: { ruled: 1 } });
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeGreaterThan(Math.PI * 16 * 10);
  });

  it("üç kesit, farklı düzlemlerde; seçim sırası önemlidir", async () => {
    const { app } = await createApp({ brep: true });
    const a = circleSketch(app, "XY", 0, 5);
    const b = circleSketch(app, "XY", 10, 3);
    const c = circleSketch(app, "XY", 20, 5);
    const f = app.addLoftFeature([a.id, b.id, c.id])!;
    expect(app.errors.get(f.id)).toBeUndefined();
    const v = app.meshes.get(f.id)!.volume;
    expect(v).toBeGreaterThan(Math.PI * 9 * 20);
    expect(v).toBeLessThan(Math.PI * 25 * 20);
  });

  it("hatalar: tek eskiz, kapalı şekli olmayan ya da birden çok şekilli eskiz", async () => {
    const { app, ui } = await createApp({ brep: true });
    const a = circleSketch(app, "XY", 0, 5);
    expect(app.addLoftFeature([a.id])).toBeNull();
    expect(ui.messages.at(-1)?.text).toMatch(/en az iki eskizi/);
    const empty = app.createSketch("XY", 10);
    const f = app.addLoftFeature([a.id, empty.id])!;
    expect(app.errors.get(f.id)).toMatch(/kapalı şekil yok/);
  });

  it("birleştir / kes işlemi ve kaydet / aç", async () => {
    const { app } = await createApp({ brep: true });
    const base = rectSketch(app, "XY", 0, [-10, -10], [10, 10]);
    const block = app.addSketchFeature("extrude", base.id)!;
    await app.updateFeature(block.id, { params: { distance: 10 } });
    const a = circleSketch(app, "XY", 10, 5);
    const b = circleSketch(app, "XY", 20, 2);
    const loft = app.addLoftFeature([a.id, b.id])!;
    await app.setOperation(loft.id, "join");
    expect(app.errors.get(loft.id)).toBeUndefined();
    expect(app.meshes.get(loft.id)!.volume).toBeGreaterThan(4000);
    const { app: copy } = await createApp({ brep: true });
    copy.openText(app.document.serialize(), "x.sugar");
    expect(copy.meshes.get(loft.id)!.volume).toBeCloseTo(app.meshes.get(loft.id)!.volume, 3);
  });
});

describe("Süpürme", () => {
  /** Z ekseni boyunca 20 mm düz yol (XZ düzleminde) ve XY'de daire profil. */
  function straight(app: App) {
    const path = app.createSketch("XZ");
    const ed = new SketchEdit();
    ed.line(ed.point([0, 0]), ed.point([0, 20])); // XZ: u = X, v = Z
    app.document.update(path.id, { sketchData: ed.result() });
    return { path, profile: circleSketch(app, "XY", 0, 3) };
  }

  it("daireyi düz yol boyunca süpürmek silindir verir", async () => {
    const { app } = await createApp({ brep: true });
    const { path, profile } = straight(app);
    const f = app.addSweepFeature([profile.id, path.id])!;
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(Math.PI * 9 * 20, 1);
    expect(app.document.roots().map((r) => r.id)).toEqual([f.id]);
  });

  it("seçim sırası fark etmez (kapalı = profil, açık = yol); eğri yolda Pappus hacmi", async () => {
    const { app } = await createApp({ brep: true });
    // Yay saat yönünün tersine gider: merkez (10, 0), yarıçap 10; (0,0) → (10, 10) = 270° (180° → 90°).
    const path = app.createSketch("XZ");
    const ed = new SketchEdit();
    const c = ed.point([10, 0]);
    ed.arc(c, ed.point([0, 0]), ed.point([10, 10]));
    app.document.update(path.id, { sketchData: ed.result() });
    // Profil: yola dik, başlangıçta (0,0,0): normali ±Z olan, ... yol başlangıçta +Z yönüne dik değil teğet Z → profil XY
    const profile = circleSketch(app, "XY", 0, 2);
    const f = app.addSweepFeature([path.id, profile.id])!; // ters sırada seçildi
    expect(app.errors.get(f.id)).toBeUndefined();
    // Pappus: V = alan × merkez yolu uzunluğu = π r² × (3π R / 2)
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(Math.PI * 4 * ((3 * Math.PI * 10) / 2), 0);
  });

  it("yol eskizleri: zincir çıkarma ve hatalar", async () => {
    const ed = new SketchEdit();
    const a = ed.point([0, 0]);
    const b = ed.point([10, 0]);
    const c = ed.point([10, 10]);
    ed.line(a, b);
    ed.line(b, c);
    const chain = sketchDataChain(ed.result())!;
    expect("from" in chain && chain.from).toEqual([0, 0]);
    expect("segs" in chain && chain.segs.map((s) => s.to)).toEqual([[10, 0], [10, 10]]);
    expect(sketchDataLoops(ed.result())).toHaveLength(0);
    // Y şeklinde dallanma ve kapalı şekil yol sayılmaz
    const y = new SketchEdit();
    const m = y.point([0, 0]);
    y.line(m, y.point([5, 0]));
    y.line(m, y.point([0, 5]));
    y.line(m, y.point([-5, 0]));
    expect(sketchDataChain(y.result())).toBeNull();
    const closed = new SketchEdit();
    buildRect(closed, [[0, 0], [5, 0], [5, 5], [0, 5]]);
    expect(sketchDataChain(closed.result())).toBeNull();
  });

  it("hata: iki kapalı eskiz seçilirse anlaşılır uyarı", async () => {
    const { app, ui } = await createApp({ brep: true });
    const a = circleSketch(app, "XY", 0, 3);
    const b = circleSketch(app, "XY", 10, 3);
    expect(app.addSweepFeature([a.id, b.id])).toBeNull();
    expect(ui.messages.at(-1)?.text).toMatch(/kapalı şekil \(profil\), diğeri açık/);
  });
});
