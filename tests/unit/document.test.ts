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
