import { describe, expect, it } from "vitest";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { SugarDocument } from "../../src/core/document";
import { createApp, webSolverForTests } from "./helpers";

async function setup() {
  const { app, ui } = await createApp();
  app.solver = await webSolverForTests();
  return { app, ui };
}

/** 40×20 dikdörtgen eskizi (ölçüsüz); ekstrüzyon 10 mm. */
async function plate(app: Awaited<ReturnType<typeof setup>>["app"]) {
  const sk = app.createSketch("XY");
  const ed = new SketchEdit();
  buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
  app.document.update(sk.id, { sketchData: ed.result() });
  const f = app.addSketchFeature("extrude", sk.id)!;
  await app.updateFeature(f.id, { params: { distance: 10 } });
  return { sk, f };
}

describe("parametre tablosu (belge)", () => {
  it("ekle / güncelle / sil, geri al ve yinele; kaydet / aç", () => {
    const doc = new SugarDocument();
    doc.setParameter("w", "40");
    doc.setParameter("h", "w / 2");
    expect(doc.resolvedParameters().values).toEqual({ w: 40, h: 20 });
    doc.setParameter("w", "60");
    expect(doc.resolvedParameters().values).toEqual({ w: 60, h: 30 });
    doc.undo();
    expect(doc.resolvedParameters().values.w).toBe(40);
    doc.redo();
    expect(doc.resolvedParameters().values.w).toBe(60);
    const copy = new SugarDocument();
    copy.load(SugarDocument.parse(doc.serialize()));
    expect(copy.parameters()).toEqual([{ name: "w", expr: "60" }, { name: "h", expr: "w / 2" }]);
    // parametresiz belgede dosyada alan yok
    expect(JSON.parse(new SugarDocument().serialize()).parameters).toBeUndefined();
  });

  it("geçersiz ad, boş değer, döngü ve bilinmeyen başvuru reddedilir; belge değişmez", () => {
    const doc = new SugarDocument();
    doc.setParameter("a", "1");
    expect(() => doc.setParameter("2x", "1")).toThrow(/harf/);
    expect(() => doc.setParameter("sin", "1")).toThrow(/ayrılmış/);
    expect(() => doc.setParameter("b", "  ")).toThrow(/boş/);
    expect(() => doc.setParameter("b", "yok + 1")).toThrow(/Bilinmeyen parametre/);
    doc.setParameter("b", "a + 1");
    expect(() => doc.setParameter("a", "b + 1")).toThrow(/Döngüsel başvuru/);
    expect(doc.parameters()).toEqual([{ name: "a", expr: "1" }, { name: "b", expr: "a + 1" }]);
  });

  it("kullanımdaki parametre silinemez / yeniden adlandırılamaz; kullanılmayan olur", () => {
    const doc = new SugarDocument();
    doc.setParameter("a", "1");
    doc.setParameter("b", "a * 2");
    expect(() => doc.removeParameter("a")).toThrow(/kullanımda: parametre b/);
    expect(() => doc.renameParameter("a", "c")).toThrow(/kullanımda/);
    expect(() => doc.renameParameter("b", "a")).toThrow(/zaten var/);
    doc.renameParameter("b", "toplam");
    doc.removeParameter("toplam");
    doc.removeParameter("a");
    expect(doc.parameters()).toEqual([]);
  });

  it("batch: tek geri alma adımı, tek bildirim; hata olursa hiçbir şey değişmez", () => {
    const doc = new SugarDocument();
    let events = 0;
    doc.onDidChange.on(() => events++);
    doc.batch(() => {
      doc.setParameter("a", "1");
      doc.setParameter("b", "2");
      doc.setParameter("c", "3");
    });
    expect(events).toBe(1);
    expect(doc.parameters()).toHaveLength(3);
    doc.undo();
    expect(doc.parameters()).toHaveLength(0);
    doc.redo();
    expect(() =>
      doc.batch(() => {
        doc.setParameter("d", "4");
        throw new Error("bozuldu");
      }),
    ).toThrow(/bozuldu/);
    expect(doc.parameters()).toHaveLength(3);
    expect(doc.canUndo).toBe(true);
  });
});

describe("parametreli modelleme (uygulama)", () => {
  it("ekstrüzyon mesafesi ifade: parametre değişince hacim anında güncellenir; tek geri alma adımı", async () => {
    const { app } = await setup();
    const { f } = await plate(app);
    await app.setParameter("kalinlik", "10");
    await app.setFeatureParam(f.id, "distance", "kalinlik / 2");
    expect(app.document.get(f.id)!.params.distance).toBe(5);
    expect(app.document.get(f.id)!.exprs).toEqual({ distance: "kalinlik / 2" });
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(800 * 5, 3);
    await app.setParameter("kalinlik", "30");
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(800 * 15, 3);
    app.document.undo(); // hem parametre hem özellik değeri geri gelir
    expect(app.document.get(f.id)!.params.distance).toBe(5);
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(800 * 5, 3);
    // düz sayı ifadeyi kaldırır
    await app.setFeatureParam(f.id, "distance", "12");
    expect(app.document.get(f.id)!.exprs).toBeUndefined();
  });

  it("eskiz ölçüsü ifade: parametre değişince şekil yeniden çözülür", async () => {
    const { app } = await setup();
    const sk = app.createSketch("XY");
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[0, 0], [40, 0], [40, 20], [0, 20]]);
    app.document.update(sk.id, { sketchData: ed.result() });
    await app.setParameter("genislik", "40");
    // alt kenarın uzunluk ölçüsü: ifade "genislik"
    const data = structuredClone(app.document.get(sk.id)!.sketchData!);
    const bottom = data.curves.find((c) => c.id === lines[0]) as { p1: string; p2: string };
    data.constraints.push({ id: "k90", type: "distance", refs: [bottom.p1, bottom.p2], value: 40, expr: "genislik" });
    app.document.update(sk.id, { sketchData: data });
    await app.setParameter("genislik", "55");
    const solved = app.document.get(sk.id)!.sketchData!;
    const k = solved.constraints.find((c) => c.id === "k90")!;
    expect(k.value).toBe(55);
    const p = (id: string) => solved.points.find((q) => q.id === id)!;
    expect(Math.hypot(p(bottom.p2).x - p(bottom.p1).x, p(bottom.p2).y - p(bottom.p1).y)).toBeCloseTo(55, 4);
    const f = app.addSketchFeature("extrude", sk.id)!;
    expect(app.errors.get(f.id)).toBeUndefined();
  });

  it("kullanımdaki parametre silinemez; hatalı ifade özelliği bozmaz", async () => {
    const { app } = await setup();
    const { f } = await plate(app);
    await app.setParameter("t", "8");
    await app.setFeatureParam(f.id, "distance", "t * 2");
    expect(() => app.document.removeParameter("t")).toThrow(/kullanımda: .*Ekstrüzyon/);
    await expect(app.setFeatureParam(f.id, "distance", "yok + 1")).rejects.toThrow(/Bilinmeyen parametre/);
    expect(app.document.get(f.id)!.params.distance).toBe(16);
    // Parametre özelliği sıfır mesafeye götürürse hata özellikte gösterilir; parametre yine de kaydedilir
    await app.setParameter("t", "0");
    expect(app.errors.get(f.id)).toMatch(/mesafe sıfır olamaz/);
    await app.setParameter("t", "8");
    expect(app.errors.get(f.id)).toBeUndefined();
  });

  it("kaydet / aç: ifadeler ve parametreler korunur, değerler yeniden hesaplanır", async () => {
    const { app } = await setup();
    const { f } = await plate(app);
    await app.setParameter("t", "6");
    await app.setFeatureParam(f.id, "distance", "t + 4");
    const { app: copy } = await createApp();
    copy.openText(app.document.serialize(), "x.sugar");
    expect(copy.document.parameters()).toEqual([{ name: "t", expr: "6" }]);
    expect(copy.document.get(f.id)!.exprs).toEqual({ distance: "t + 4" });
    expect(copy.meshes.get(f.id)!.volume).toBeCloseTo(800 * 10, 3);
    await copy.setParameter("t", "16");
    expect(copy.meshes.get(f.id)!.volume).toBeCloseTo(800 * 20, 3);
  });
});
