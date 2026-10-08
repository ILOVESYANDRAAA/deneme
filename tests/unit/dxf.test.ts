import { describe, expect, it } from "vitest";
import { bulgeArc, importDxf, sketchToDxf } from "../../src/core/dxf";
import { buildRect, filletCorner, hitPoint, pointMap, sketchDataProfiles, SketchEdit } from "../../src/core/sketchmodel";

const area = (p: [number, number][]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

function dxf(...entities: string[]): string {
  return ["0", "SECTION", "2", "ENTITIES", ...entities.flatMap((e) => e.trim().split(/\s*\n\s*/)), "0", "ENDSEC", "0", "EOF"].join("\n");
}

describe("DXF dışa aktarma", () => {
  it("R12 başlığı, LINE / CIRCLE / ARC ve yapı katmanı", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    ed.circle(ed.point([20, 20]), 3);
    const c = ed.point([0, 0]);
    ed.arc(c, ed.point([5, 0]), ed.point([0, 5]));
    const guide = ed.line(ed.point([-5, 0]), ed.point([15, 0]));
    for (const k of ed.d.curves) if (k.id === guide) k.construction = true;
    const text = sketchToDxf(ed.result());
    const lines = text.split("\n");
    expect(lines.slice(0, 6)).toEqual(["0", "SECTION", "2", "HEADER", "9", "$ACADVER"]);
    expect(lines.at(-2)).toBe("EOF");
    expect(text.match(/\nLINE\n/g)).toHaveLength(5);
    expect(text.match(/\nCIRCLE\n/g)).toHaveLength(1);
    expect(text).toContain("\nYAPI\n"); // yapı çizgisi ayrı katmanda
    // ARC: 0°'den 90°'ye
    const arcAt = lines.indexOf("ARC");
    expect(lines.slice(arcAt, arcAt + 18).join(",")).toContain("50,0,51,90");
  });

  it("gidiş-dönüş: kapalı şekil aynı alanı verir (dikdörtgen + yuvarlatılmış köşe + daire)", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [30, 0], [30, 20], [0, 20]]);
    filletCorner(ed, hitPoint(ed.d, [30, 20], 0.5)!, 4);
    ed.circle(ed.point([10, 10]), 3);
    const before = sketchDataProfiles(ed.result()).map(area).sort((a, b) => b - a);
    const back = new SketchEdit();
    const r = importDxf(sketchToDxf(ed.result()), back);
    expect(r.added).toBe(ed.d.curves.length);
    expect(r.skipped).toEqual({});
    const after = sketchDataProfiles(back.result()).map(area).sort((a, b) => b - a);
    expect(after).toHaveLength(before.length);
    after.forEach((a, i) => expect(a).toBeCloseTo(before[i], 1));
  });

  it("elips ve spline çokgen olarak yazılır, geri okununca kapalı profil kalır", () => {
    const ed = new SketchEdit();
    ed.ellipse(ed.point([0, 0]), 10, 5, 0);
    const text = sketchToDxf(ed.result());
    expect(text).toContain("\nPOLYLINE\n");
    const back = new SketchEdit();
    importDxf(text, back);
    const profiles = sketchDataProfiles(back.result());
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo(Math.PI * 10 * 5, 0);
  });
});

describe("DXF içe aktarma", () => {
  it("LINE ile çizilen dörtgenin uçları ortak noktaya bağlanır ve profil olur", () => {
    const ed = new SketchEdit();
    const text = dxf(
      "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0",
      "0\nLINE\n8\n0\n10\n10\n20\n0\n11\n10\n21\n10",
      "0\nLINE\n8\n0\n10\n10\n20\n10\n11\n0\n21\n10",
      "0\nLINE\n8\n0\n10\n0\n20\n10\n11\n0\n21\n0",
    );
    expect(importDxf(text, ed).added).toBe(4);
    expect(ed.d.points).toHaveLength(4); // her köşe tek nokta
    const profiles = sketchDataProfiles(ed.result());
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo(100, 6);
  });

  it("CIRCLE ve ARC: açılar derece, saat yönünün tersine", () => {
    const ed = new SketchEdit();
    importDxf(dxf("0\nCIRCLE\n10\n5\n20\n5\n40\n2", "0\nARC\n10\n0\n20\n0\n40\n10\n50\n90\n51\n180"), ed);
    const circle = ed.d.curves.find((c) => c.kind === "circle")!;
    expect(circle).toMatchObject({ kind: "circle", r: 2 });
    const arc = ed.d.curves.find((c) => c.kind === "arc")! as { s: string; e: string };
    const pm = pointMap(ed.d);
    expect(pm.get(arc.s)!.map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([0, 10]);
    expect(pm.get(arc.e)!.map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([-10, 0]);
  });

  it("LWPOLYLINE: kabarma (bulge) ile yarım daire kapalı şekli", () => {
    const ed = new SketchEdit();
    // (−5,0) → (5,0) bulge 1 (yarım daire, saat yönünün tersi) → kapat (çizgi)
    const text = dxf("0\nLWPOLYLINE\n90\n2\n70\n1\n10\n-5\n20\n0\n42\n1\n10\n5\n20\n0");
    expect(importDxf(text, ed).added).toBe(2);
    expect(ed.d.curves.map((c) => c.kind).sort()).toEqual(["arc", "line"]);
    const profiles = sketchDataProfiles(ed.result());
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo((Math.PI * 25) / 2, 0);
  });

  it("R12 POLYLINE / VERTEX / SEQEND ve kapalı bayrağı", () => {
    const ed = new SketchEdit();
    const text = dxf(
      "0\nPOLYLINE\n8\n0\n66\n1\n70\n1",
      "0\nVERTEX\n8\n0\n10\n0\n20\n0",
      "0\nVERTEX\n8\n0\n10\n8\n20\n0",
      "0\nVERTEX\n8\n0\n10\n8\n20\n6",
      "0\nSEQEND\n8\n0",
    );
    expect(importDxf(text, ed).added).toBe(3);
    expect(area(sketchDataProfiles(ed.result())[0])).toBeCloseTo(24, 6);
  });

  it("SPLINE (uyum noktaları), ELLIPSE ve POINT; yapı katmanı yapı çizgisi olur; bilinmeyenler sayılır", () => {
    const ed = new SketchEdit();
    const text = dxf(
      "0\nSPLINE\n70\n8\n11\n0\n21\n0\n11\n5\n21\n3\n11\n10\n21\n0",
      "0\nELLIPSE\n10\n0\n20\n0\n11\n10\n21\n0\n40\n0.5\n41\n0\n42\n6.283185307179586",
      "0\nPOINT\n10\n1\n20\n2",
      "0\nLINE\n8\nYAPI\n10\n0\n20\n0\n11\n5\n21\n0",
      "0\nHATCH\n8\n0",
      "0\nTEXT\n8\n0",
      "0\nTEXT\n8\n0",
    );
    const r = importDxf(text, ed);
    expect(r.skipped).toEqual({ HATCH: 1, TEXT: 2 });
    expect(ed.d.curves.some((c) => c.kind === "point")).toBe(true);
    const guide = ed.d.curves.filter((c) => c.construction);
    expect(guide).toHaveLength(1);
    // Elips tam: kapalı profil, alan π·10·5
    const areas = sketchDataProfiles(ed.result()).map(area);
    expect(areas.some((a) => Math.abs(a - Math.PI * 50) < 1)).toBe(true);
  });

  it("geçersiz dosya anlaşılır hata verir", () => {
    expect(() => importDxf("merhaba\ndünya\n", new SketchEdit())).toThrow(/DXF biçimi geçersiz/);
    expect(importDxf("0\nEOF\n", new SketchEdit()).added).toBe(0);
  });

  it("kabarma yayı: merkez ve yarıçap (bulge = tan(θ/4))", () => {
    const arc = bulgeArc([0, 0], [10, 0], 1)!; // yarım daire, ccw: merkez (5, 0), r = 5
    expect(arc.c[0]).toBeCloseTo(5, 9);
    expect(arc.c[1]).toBeCloseTo(0, 9);
    expect(arc.r).toBeCloseTo(5, 9);
    const cw = bulgeArc([0, 0], [10, 0], -1)!;
    expect(cw.s).toEqual([10, 0]); // saat yönünde: bizim yaylar hep ccw olduğundan uçlar yer değiştirir
    expect(bulgeArc([0, 0], [0, 0], 1)).toBeNull();
    expect(bulgeArc([0, 0], [10, 0], 0)).toBeNull();
  });
});

describe("DXF → eskiz → katı (uygulama düzeyi)", () => {
  it("içe aktarılan dikdörtgen + delik ekstrüzyonda doğru hacmi verir; geri al çalışır", async () => {
    const { createApp } = await import("./helpers");
    const { app } = await createApp();
    const sk = app.createSketch("XY");
    const text = dxf(
      "0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n40\n20\n0\n10\n40\n20\n20\n10\n0\n20\n20",
      "0\nCIRCLE\n10\n20\n20\n10\n40\n5",
    );
    const r = app.importDxfInto(sk.id, text);
    expect(r.added).toBe(5);
    const f = app.addSketchFeature("extrude", sk.id)!;
    await app.updateFeature(f.id, { params: { distance: 10 } });
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo((800 - Math.PI * 25) * 10, -1);
    app.document.undo(); // mesafe değişikliği geri alındı
    app.document.undo(); // ekstrüzyon özelliği kalktı
    app.document.undo(); // DXF içe aktarma kalktı
    expect(app.document.get(sk.id)!.sketchData!.curves).toHaveLength(0);
  });

  it("boş ya da çizimsiz DXF anlaşılır hata verir; eskiz olmayan hedef reddedilir", async () => {
    const { createApp } = await import("./helpers");
    const { app } = await createApp();
    const sk = app.createSketch("XY");
    expect(() => app.importDxfInto(sk.id, dxf("0\nTEXT\n8\n0"))).toThrow(/içe aktarılabilir çizim öğesi/);
    expect(() => app.importDxfInto("f99", "0\nEOF\n")).toThrow(/bir eskiz gerekir/);
  });
});
