import { describe, expect, it } from "vitest";
import { sketchProfiles, type SketchEntity } from "../../src/core/sketch";
import {
  SketchEdit,
  buildPolygon,
  buildRect,
  buildSlot,
  describeSketchData,
  filletCorner,
  fromLegacyEntities,
  hitCurve,
  hitPoint,
  sketchDataProfiles,
} from "../../src/core/sketchmodel";
import type { Vec2 } from "../../src/core/solid";

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

describe("eskiz modeli (nokta / eğri / kısıt)", () => {
  it("dikdörtgen: 4 çizgi, 4 ortak köşe, yatay-dikey kısıtlar, tek profil", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    const d = ed.result();
    expect(d.points).toHaveLength(4);
    expect(d.curves).toHaveLength(4);
    expect(d.constraints.map((k) => k.type).sort()).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
    const profiles = sketchDataProfiles(d);
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo(50);
  });

  it("döndürülmüş dikdörtgene dik/paralel kısıtları ekler", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [4, 3], [1, 7], [-3, 4]]);
    expect(ed.d.constraints.map((k) => k.type).sort()).toEqual(["parallel", "parallel", "perpendicular"]);
  });

  it("kanal: iki çizgi + iki yarım daire, teğet kısıtlı, alan = 2·L·r + π·r²", () => {
    const ed = new SketchEdit();
    buildSlot(ed, [0, 0], [10, 0], 2);
    const d = ed.result();
    expect(d.curves.map((c) => c.kind).sort()).toEqual(["arc", "arc", "line", "line"]);
    expect(d.constraints.filter((k) => k.type === "tangent")).toHaveLength(4);
    const profiles = sketchDataProfiles(d);
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo(10 * 4 + Math.PI * 4, 0);
  });

  it("düzgün çokgen: yapı çemberi profile girmez, kenarlar eşit", () => {
    const ed = new SketchEdit();
    buildPolygon(ed, [0, 0], [5, 0], 6);
    const d = ed.result();
    expect(d.curves.filter((c) => c.construction)).toHaveLength(1);
    expect(sketchDataProfiles(d)).toHaveLength(1);
    expect(d.constraints.filter((k) => k.type === "equal")).toHaveLength(5);
    expect(describeSketchData(d)).toContain("1 yapı çizgisi");
  });

  it("köşe yuvarlatma: iki çizgi kısalır, teğet yay ve yarıçap ölçüsü eklenir", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const corner = hitPoint(ed.d, [10, 10], 0.5)!;
    filletCorner(ed, corner, 2);
    const d = ed.result();
    expect(d.curves.filter((c) => c.kind === "arc")).toHaveLength(1);
    expect(d.constraints.some((k) => k.type === "radius" && k.value === 2)).toBe(true);
    const [profile] = sketchDataProfiles(d);
    // Alan = 100 − (4 − π)
    expect(area(profile)).toBeCloseTo(100 - (4 - Math.PI), 1);
  });

  it("çok büyük yarıçap ve paralel çizgi hata verir", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(() => filletCorner(ed, hitPoint(ed.d, [10, 10], 0.5)!, 50)).toThrow(/büyük/);
    const e2 = new SketchEdit();
    const [a, b, c] = [e2.point([0, 0]), e2.point([5, 0]), e2.point([10, 0])];
    e2.polyline([a, b, c], false);
    expect(() => filletCorner(e2, b, 1)).toThrow(/Paralel/);
  });

  it("eğri silinince yalnız onun noktaları ve kısıtları gider", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    ed.deleteCurves([lines[0]]);
    const d = ed.result();
    expect(d.curves).toHaveLength(3);
    expect(d.points).toHaveLength(4); // köşeler hâlâ başka çizgilerde kullanılıyor
    expect(d.constraints.every((k) => k.refs[0] !== lines[0])).toBe(true);
    ed.deleteCurves(d.curves.map((c) => c.id));
    expect(ed.result().points).toHaveLength(0);
    expect(ed.result().constraints).toHaveLength(0);
  });

  it("noktaları birleştirir ve dejenere çizgiyi siler", () => {
    const ed = new SketchEdit();
    const a = ed.point([0, 0]);
    const b = ed.point([5, 0]);
    const c = ed.point([5.0000001, 0]);
    const d1 = ed.point([10, 5]);
    const l1 = ed.line(a, b);
    ed.line(c, d1);
    ed.constrain("horizontal", [l1]);
    ed.mergePoints(b, c);
    expect(ed.d.points.map((p) => p.id)).not.toContain(c);
    expect(ed.d.curves).toHaveLength(2);
    const e = new SketchEdit();
    const p = e.point([0, 0]);
    const q = e.point([0, 0]);
    e.line(p, q);
    e.mergePoints(p, q);
    expect(e.d.curves).toHaveLength(0);
  });

  it("isabet: eğri ve nokta bulma", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 5], [0, 5]]);
    expect(hitCurve(ed.d, [5, 0.2], 0.5)).not.toBeNull();
    expect(hitCurve(ed.d, [5, 2.5], 0.5)).toBeNull();
    expect(hitPoint(ed.d, [9.8, 0.1], 0.5)).not.toBeNull();
  });

  it("kopya: aynalama uçları ve iç kısıtları korur", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[2, 0], [6, 0], [6, 3], [2, 3]]);
    const copies = ed.copyCurves(lines, ([x, y]) => [-x, y], true);
    expect(copies).toHaveLength(4);
    expect(ed.d.points).toHaveLength(8);
    expect(ed.d.constraints.filter((k) => k.type === "horizontal")).toHaveLength(4);
    const profiles = sketchDataProfiles(ed.d);
    expect(profiles).toHaveLength(2);
    expect(Math.min(...profiles.flat().map((p) => p[0]))).toBeCloseTo(-6);
  });
});

describe("eski (v1) eskizleri yeni modele çevirme", () => {
  const legacy: SketchEntity[] = [
    { kind: "rect", a: [0, 0], b: [20, 10] },
    { kind: "circle", c: [10, 5], r: 2 },
    { kind: "slot", a: [0, 20], b: [10, 20], r: 1 },
    { kind: "arc", p0: [30, 0], p1: [33, 3], p2: [30, 6] },
    { kind: "ellipse", c: [50, 0], rx: 4, ry: 2, rot: 0.3 },
    { kind: "polyline", points: [[0, 40], [10, 40], [10, 50]], closed: true, radii: [0, 0, 2] },
    { kind: "circle", c: [0, 0], r: 1, construction: true },
  ];

  it("her öğe için aynı profilleri üretir", () => {
    const old = sketchProfiles(legacy)
      .map(area)
      .sort((a, b) => a - b);
    const next = sketchDataProfiles(fromLegacyEntities(legacy))
      .map(area)
      .sort((a, b) => a - b);
    expect(next).toHaveLength(old.length);
    next.forEach((a, i) => expect(a).toBeCloseTo(old[i], 0));
  });

  it("yapı çizgisi korunur", () => {
    const d = fromLegacyEntities(legacy);
    expect(d.curves.filter((c) => c.construction)).toHaveLength(1);
  });
});
