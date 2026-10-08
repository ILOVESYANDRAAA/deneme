import { describe, expect, it } from "vitest";
import type { Solid } from "../../src/core/solid";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { createApp, occ } from "./helpers";

const BOX: Solid = { kind: "box", size: [40, 20, 10] };
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("STEP", () => {
  it("dışa aktarılan dosya geçerli STEP başlığı taşır; ad ve gövde sayısı korunur", async () => {
    const session = await occ();
    const bytes = await session.exportStep([
      { id: "a", name: "Kutu", solid: BOX },
      { id: "b", name: "Silindir", solid: { kind: "cylinder", radius: 5, height: 12 } },
    ]);
    const text = decode(bytes);
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    expect(text).toContain("END-ISO-10303-21;");
    expect(text).toContain("Kutu");
    expect(text).toContain("Silindir");
    expect(text.match(/MANIFOLD_SOLID_BREP/g)?.length).toBe(2);
  });

  it("gidiş-dönüş: dışa aktarıp içe aktarınca hacim ve sınır kutusu aynı", async () => {
    const session = await occ();
    const filleted: Solid = { kind: "boolean", op: "subtract", children: [BOX, { kind: "transform", translate: [0, 0, 5], child: { kind: "cylinder", radius: 4, height: 10 } }] };
    const text = decode(await session.exportStep([{ id: "a", name: "Parça", solid: filleted }]));
    const { app } = await createApp({ brep: true });
    const f = app.importStepText("parca.step", text);
    expect(f.name).toMatch(/^parca/);
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(8000 - Math.PI * 16 * 5, 1);
    const m = app.meshes.get(f.id)!;
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) max[i % 3] = Math.max(max[i % 3], m.positions[i]);
    max.forEach((v, i) => expect(v).toBeCloseTo([20, 10, 10][i], 3));
  });

  it("içe aktarılan gövde tam bir B-rep'tir: kenarlar seçilip yuvarlatılabilir, delik açılabilir", async () => {
    const session = await occ();
    const text = decode(await session.exportStep([{ id: "a", name: "k", solid: BOX }]));
    const { app } = await createApp({ brep: true });
    const f = app.importStepText("k.stp", text);
    const info = await app.describeBody(f.id);
    expect(info.edges).toHaveLength(12);
    const vertical = info.edges.filter((e) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99).map((e) => e.ref);
    const fillet = app.addBrepFeature("fillet", f.id, { edges: vertical }, 3);
    expect(app.errors.get(fillet.id) ?? "").toBe("");
    expect(app.meshes.get(fillet.id)!.volume).toBeCloseTo(8000 - 4 * (1 - Math.PI / 4) * 9 * 10, 1);
    const filletVolume = app.meshes.get(fillet.id)!.volume;
    const hole = app.addHoleFeature(fillet.id, [{ at: [0, 0, 10], normal: [0, 0, 1] }], { params: { diameter: 6, depth: 4 } });
    expect(app.errors.get(hole.id)).toBeUndefined();
    expect(app.meshes.get(hole.id)!.volume).toBeLessThan(filletVolume);
  });

  it("konum / dönüş dönüşümü içe aktarılan gövdeye uygulanır; kaydet / aç veriyi korur", async () => {
    const session = await occ();
    const text = decode(await session.exportStep([{ id: "a", name: "k", solid: BOX }]));
    const { app } = await createApp({ brep: true });
    const f = app.importStepText("k.step", text);
    await app.updateFeature(f.id, { position: [100, 0, 0] });
    const m = app.meshes.get(f.id)!;
    let minX = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) minX = Math.min(minX, m.positions[i]);
    expect(minX).toBeCloseTo(80, 3);
    const { app: copy } = await createApp({ brep: true });
    copy.openText(app.document.serialize(), "x.sugar");
    expect(copy.document.get(f.id)!.stepData).toBe(text);
    expect(copy.meshes.get(f.id)!.volume).toBeCloseTo(8000, 1);
  });

  it("aynı STEP verisi iki kez içe aktarılınca (kopya) hâlâ çalışır; boolean ile birleşir", async () => {
    const session = await occ();
    const text = decode(await session.exportStep([{ id: "a", name: "k", solid: BOX }]));
    const { app } = await createApp({ brep: true });
    const a = app.importStepText("a.step", text);
    const b = app.importStepText("b.step", text);
    await app.updateFeature(b.id, { position: [20, 0, 0] });
    app.document.setSelection([a.id, b.id]);
    app.booleanFromSelection("union");
    const root = app.document.roots()[0];
    expect(app.errors.get(root.id)).toBeUndefined();
    expect(app.meshes.get(root.id)!.volume).toBeCloseTo(12000, 0); // 40 + 20 genişlik üst üste
  });

  it("hatalar: STEP olmayan metin ve bozuk STEP anlaşılır mesaj verir", async () => {
    const { app } = await createApp({ brep: true });
    expect(() => app.importStepText("x.step", "merhaba dünya")).toThrow(/STEP dosyasına benzemiyor/);
    const bad = app.importStepText("bozuk.step", "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=FOO(;\nENDSEC;\nEND-ISO-10303-21;\n");
    expect(app.errors.get(bad.id)).toMatch(/STEP dosyası okunamadı|katı gövde yok/);
  });

  it("kodlama: Türkçe gövde adı korunur", async () => {
    const session = await occ();
    const text = decode(await session.exportStep([{ id: "a", name: "Çıkıntı", solid: BOX }]));
    expect(text).toMatch(/\\X2\\|Çıkıntı|\\X\\/); // STEP kaçış dizisi ya da düz metin
    const { app } = await createApp({ brep: true });
    const f = app.importStepText("c.step", text);
    expect(app.errors.get(f.id)).toBeUndefined();
  });
});
