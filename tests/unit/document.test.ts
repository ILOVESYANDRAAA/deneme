import { describe, expect, it } from "vitest";
import { SugarDocument } from "../../src/core/document";

const box = { type: "box", params: { width: 1, depth: 1, height: 1 } };

describe("SugarDocument", () => {
  it("ekler, benzersiz isim ve kimlik verir", () => {
    const doc = new SugarDocument();
    const a = doc.add(box, "Kutu");
    const b = doc.add(box, "Kutu");
    expect(a.id).not.toBe(b.id);
    expect([a.name, b.name]).toEqual(["Kutu 1", "Kutu 2"]);
    expect(doc.dirty).toBe(true);
  });

  it("geri alır ve yineler", () => {
    const doc = new SugarDocument();
    const a = doc.add(box);
    doc.update(a.id, { params: { width: 5, depth: 1, height: 1 } });
    expect(doc.get(a.id)!.params.width).toBe(5);
    doc.undo();
    expect(doc.get(a.id)!.params.width).toBe(1);
    doc.undo();
    expect(doc.all()).toHaveLength(0);
    expect(doc.undo()).toBe(false);
    doc.redo();
    doc.redo();
    expect(doc.get(a.id)!.params.width).toBe(5);
    expect(doc.redo()).toBe(false);
  });

  it("yeni değişiklik yinele geçmişini temizler", () => {
    const doc = new SugarDocument();
    doc.add(box);
    doc.undo();
    doc.add(box);
    expect(doc.canRedo).toBe(false);
  });

  it("boolean işlenenlerini tüketir ve korur", () => {
    const doc = new SugarDocument();
    const a = doc.add(box);
    const b = doc.add(box);
    const c = doc.addBoolean("subtract", a.id, b.id, "Çıkarma");
    expect(doc.roots().map((f) => f.id)).toEqual([c.id]);
    expect(() => doc.remove(a.id)).toThrow(/önce onu silin/);
    expect(() => doc.addBoolean("union", a.id, doc.add(box).id, "x")).toThrow(/zaten/);
    doc.remove(c.id);
    expect(doc.roots()).toHaveLength(3);
  });

  it("aynı şekli iki kez işlenen yapmaz", () => {
    const doc = new SugarDocument();
    const a = doc.add(box);
    expect(() => doc.addBoolean("union", a.id, a.id, "x")).toThrow();
  });

  it("kaydedip açınca aynı belgeyi verir ve kimlik sayacını sürdürür", () => {
    const doc = new SugarDocument();
    const a = doc.add(box);
    doc.add({ type: "sphere", params: { radius: 3, segments: 16 }, position: [1, 2, 3] });
    doc.setSelection([a.id]);
    const copy = new SugarDocument();
    copy.load(SugarDocument.parse(doc.serialize()));
    expect(copy.all()).toEqual(doc.all());
    expect(copy.dirty).toBe(false);
    expect(copy.canUndo).toBe(false);
    expect(copy.getSelection()).toEqual([]);
    expect(copy.add(box).id).toBe("f3");
  });

  it("yabancı ya da yeni sürüm dosyaları reddeder", () => {
    const doc = new SugarDocument();
    expect(() => doc.load({ app: "other" } as never)).toThrow(/sugarCAD/);
    expect(() => doc.load({ app: "sugarCAD", version: 99, features: [] })).toThrow(/sürüm/);
  });

  it("silinen özellikleri seçimden çıkarır", () => {
    const doc = new SugarDocument();
    const a = doc.add(box);
    doc.setSelection([a.id, "yok"]);
    expect(doc.getSelection()).toEqual([a.id]);
    doc.remove(a.id);
    expect(doc.getSelection()).toEqual([]);
  });
});

describe("önizleme oturumu (diyalog canlı önizlemesi)", () => {
  it("oturumdaki bütün değişiklikler tek geri alma adımı olur", () => {
    const doc = new SugarDocument();
    doc.add(box, "Önceki");
    doc.beginSession();
    const a = doc.add(box, "Yeni");
    doc.update(a.id, { params: { width: 5, depth: 1, height: 1 } });
    doc.update(a.id, { params: { width: 9, depth: 1, height: 1 } });
    doc.endSession();
    expect(doc.all()).toHaveLength(2);
    doc.undo();
    expect(doc.all().map((f) => f.name)).toEqual(["Önceki 1"]);
  });

  it("iptal başlangıç durumuna döner ve geri alma yığınında iz bırakmaz", () => {
    const doc = new SugarDocument();
    const first = doc.add(box, "Önceki");
    doc.beginSession();
    const a = doc.add(box, "Yeni");
    doc.update(a.id, { params: { width: 5, depth: 1, height: 1 } });
    doc.cancelSession();
    expect(doc.all().map((f) => f.id)).toEqual([first.id]);
    // Yığında yalnızca iptal öncesi adım var: tek undo "Önceki"yi de siler, fazladan adım yok
    expect(doc.undo()).toBe(true);
    expect(doc.all()).toHaveLength(0);
    expect(doc.undo()).toBe(false);
  });

  it("oturum açıkken geri al / yükle oturumu bitirir ve bildirir; sonraki iptal hiçbir şeyi bozmaz", () => {
    const doc = new SugarDocument();
    doc.add(box, "Önceki");
    let ended = 0;
    doc.onDidEndSession.on(() => ended++);
    doc.beginSession();
    doc.add(box, "Yeni");
    doc.undo(); // oturumun adımını geri alır
    expect(ended).toBe(1);
    expect(doc.inSession).toBe(false);
    doc.cancelSession(); // oturum yok: etkisiz
    expect(doc.all().map((f) => f.name)).toEqual(["Önceki 1"]);
    doc.beginSession();
    doc.load(JSON.parse(doc.serialize()));
    expect(ended).toBe(2);
  });
});
