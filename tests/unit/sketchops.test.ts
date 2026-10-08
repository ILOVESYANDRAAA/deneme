import { describe, expect, it } from "vitest";
import {
  SketchEdit,
  buildRect,
  filletCorner,
  hitPoint,
  pointMap,
  sketchDataProfiles,
  type SketchData,
} from "../../src/core/sketchmodel";
import { cutsOf, extendCurve, offsetCurves, patternCircular, patternRect, rotateAbout, selectionCenter, translateBy, trimCurve } from "../../src/core/sketchops";
import type { Vec2 } from "../../src/core/solid";

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);
const pos = (d: SketchData, id: string) => pointMap(d).get(id)!;
const lineEnds = (d: SketchData, id: string): [Vec2, Vec2] => {
  const c = d.curves.find((x) => x.id === id) as { p1: string; p2: string };
  return [pos(d, c.p1), pos(d, c.p2)];
};

/** Yatay bir çizgi (0,0)-(10,0) ve onu x=3 ile x=7'de kesen iki dikey çizgi. */
function crossScene() {
  const ed = new SketchEdit();
  const h = ed.line(ed.point([0, 0]), ed.point([10, 0]));
  const v1 = ed.line(ed.point([3, -5]), ed.point([3, 5]));
  const v2 = ed.line(ed.point([7, -5]), ed.point([7, 5]));
  return { ed, h, v1, v2 };
}

describe("kesişimler", () => {
  it("çizgi–çizgi, çizgi–daire, daire–daire konumları", () => {
    const { ed, h } = crossScene();
    expect(cutsOf(ed.d, h).map((c) => [c.s, c.p])).toEqual([[0.3, [3, 0]], [0.7, [7, 0]]]);
    const e = new SketchEdit();
    const target = e.line(e.point([-10, 0]), e.point([10, 0]));
    e.circle(e.point([0, 0]), 4);
    expect(cutsOf(e.d, target).map((c) => c.p[0])).toEqual([-4, 4]);
    const f = new SketchEdit();
    const c1 = f.circle(f.point([0, 0]), 5);
    f.circle(f.point([6, 0]), 5);
    const pts = cutsOf(f.d, c1).map((c) => c.p);
    expect(pts).toHaveLength(2);
    expect(pts[0][0]).toBeCloseTo(3);
    expect(Math.abs(pts[0][1])).toBeCloseTo(4);
  });

  it("segment dışındaki ve yay dışındaki kesişimleri saymaz", () => {
    const ed = new SketchEdit();
    const target = ed.line(ed.point([0, 0]), ed.point([10, 0]));
    ed.line(ed.point([15, -5]), ed.point([15, 5])); // hedefin uzantısında
    ed.line(ed.point([5, 1]), ed.point([5, 5])); // hedefe değmiyor
    expect(cutsOf(ed.d, target)).toHaveLength(0);
  });
});

describe("kırp", () => {
  it("iki kesişim arasını siler, iki parça bırakır; yeni uçlar kesen çizgi üzerinde kısıtlanır", () => {
    const { ed, h, v1, v2 } = crossScene();
    trimCurve(ed, h, [5, 0]);
    const lines = ed.d.curves.filter((c) => c.kind === "line");
    expect(lines).toHaveLength(4);
    const horizontals = lines.filter((c) => c.id !== v1 && c.id !== v2).map((c) => lineEnds(ed.d, c.id));
    expect(horizontals.map((e) => e.map((p) => p[0]).sort((a, b) => a - b))).toEqual([[0, 3], [7, 10]]);
    expect(ed.d.constraints.filter((k) => k.type === "onCurve")).toHaveLength(2);
  });

  it("tek kesişimde tıklanan taraf silinir", () => {
    const { ed, h } = crossScene();
    trimCurve(ed, h, [1, 0]);
    // İlk kesişim x=3: soldaki 0–3 silinir; 3–7 arası ve 7–10 kalır (ikinci kesişim hâlâ var)
    const rest = ed.d.curves.filter((c) => c.kind === "line" && c.id !== "" && lineEnds(ed.d, c.id)[0][1] === 0 && lineEnds(ed.d, c.id)[1][1] === 0);
    expect(rest).toHaveLength(1);
    const [a, b] = lineEnds(ed.d, rest[0].id);
    expect([a[0], b[0]].sort((x, y) => x - y)).toEqual([3, 10]);
  });

  it("kesişimi olmayan çizgiyi tamamen siler", () => {
    const ed = new SketchEdit();
    const l = ed.line(ed.point([0, 0]), ed.point([4, 0]));
    ed.line(ed.point([0, 5]), ed.point([4, 5]));
    trimCurve(ed, l, [2, 0]);
    expect(ed.d.curves).toHaveLength(1);
    expect(ed.d.points).toHaveLength(2);
  });

  it("yatay kısıt iki parçaya da geçer; uzunluk ölçüsü düşer", () => {
    const { ed, h } = crossScene();
    const c = ed.d.curves.find((x) => x.id === h) as { p1: string; p2: string };
    ed.constrain("horizontal", [h]);
    ed.constrain("distance", [c.p1, c.p2], { value: 10 });
    trimCurve(ed, h, [5, 0]);
    expect(ed.d.constraints.filter((k) => k.type === "horizontal")).toHaveLength(2);
    expect(ed.d.constraints.some((k) => k.type === "distance")).toBe(false);
  });

  it("daireyi iki kesişimle yaya çevirir; bağlı kısıtlar yaya taşınır", () => {
    const ed = new SketchEdit();
    const circle = ed.circle(ed.point([0, 0]), 5);
    ed.constrain("radius", [circle], { value: 5 });
    ed.line(ed.point([-8, 3]), ed.point([8, 3])); // y=3 çizgisi çemberi (±4, 3)'te keser
    trimCurve(ed, circle, [0, -5]); // alttaki büyük yay silinir → üstteki küçük yay kalır
    const arcs = ed.d.curves.filter((c) => c.kind === "arc");
    expect(arcs).toHaveLength(1);
    expect(ed.d.curves.some((c) => c.kind === "circle")).toBe(false);
    const arc = arcs[0] as { c: string; s: string; e: string; id: string };
    const [s, e] = [pos(ed.d, arc.s), pos(ed.d, arc.e)];
    expect(Math.abs(s[0])).toBeCloseTo(4);
    expect(s[1]).toBeCloseTo(3);
    expect(e[1]).toBeCloseTo(3);
    expect(ed.d.constraints.find((k) => k.type === "radius")!.refs).toEqual([arc.id]);
    // Kalan yay üstte: orta noktası (0, 5)
    expect(s[0]).toBeGreaterThan(0); // saat yönünün tersine: sağdan sola
  });

  it("yayı keser", () => {
    const ed = new SketchEdit();
    const c = ed.point([0, 0]);
    const arc = ed.arc(c, ed.point([5, 0]), ed.point([-5, 0])); // üst yarım daire
    ed.line(ed.point([3, -1]), ed.point([3, 6]));
    trimCurve(ed, arc, [5, 0.1]);
    const rest = ed.d.curves.find((x) => x.kind === "arc") as { s: string; e: string };
    expect(pos(ed.d, rest.s)[0]).toBeCloseTo(3);
    expect(pos(ed.d, rest.e)[0]).toBeCloseTo(-5);
  });

  it("çizgi ve daire dışındaki eğrilerde hata", () => {
    const ed = new SketchEdit();
    const e = ed.ellipse(ed.point([0, 0]), 4, 2, 0);
    expect(() => trimCurve(ed, e, [0, 0])).toThrow(/çizgi, yay ve daire/);
  });
});

describe("uzat", () => {
  it("serbest ucu ilk kesişime kadar uzatır ve eğri üzerinde kısıtlar", () => {
    const ed = new SketchEdit();
    const l = ed.line(ed.point([0, 0]), ed.point([4, 0]));
    const wall = ed.line(ed.point([9, -5]), ed.point([9, 5]));
    ed.line(ed.point([12, -5]), ed.point([12, 5]));
    extendCurve(ed, l, [4, 0]);
    expect(lineEnds(ed.d, l)[1]).toEqual([9, 0]);
    expect(ed.d.constraints.some((k) => k.type === "onCurve" && k.refs[1] === wall)).toBe(true);
  });

  it("başlangıç ucunu da uzatır; yönde kesişim yoksa hata", () => {
    const ed = new SketchEdit();
    const l = ed.line(ed.point([2, 0]), ed.point([6, 0]));
    ed.line(ed.point([-3, -5]), ed.point([-3, 5]));
    extendCurve(ed, l, [2, 0]);
    expect(lineEnds(ed.d, l)[0]).toEqual([-3, 0]);
    expect(() => extendCurve(ed, l, [6, 0])).toThrow(/uzatılacak bir kesişim yok/);
  });

  it("bağlı uç uzatılamaz", () => {
    const ed = new SketchEdit();
    const lines = ed.polyline([ed.point([0, 0]), ed.point([4, 0]), ed.point([4, 4])], false);
    ed.line(ed.point([9, -5]), ed.point([9, 5]));
    expect(() => extendCurve(ed, lines[0], [4, 0])).toThrow(/bağlı/);
  });
});

describe("ofset", () => {
  it("kapalı dikdörtgeni dışa öteler (gönyeli köşeler), içe küçültür", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 6], [0, 6]]);
    const first = ed.d.curves[0].id;
    const before = ed.d.curves.length;
    const added = offsetCurves(ed, first, 2, [5, -1]); // alt kenarın dışı
    expect(added).toHaveLength(4);
    const profiles = sketchDataProfiles(ed.d);
    expect(profiles).toHaveLength(2);
    expect(profiles.map(area).sort((a, b) => a - b)[1]).toBeCloseTo(14 * 10);
    const inner = new SketchEdit();
    buildRect(inner, [[0, 0], [10, 0], [10, 6], [0, 6]]);
    offsetCurves(inner, inner.d.curves[0].id, 1, [5, 1]); // alt kenarın içi
    expect(sketchDataProfiles(inner.d).map(area).sort((a, b) => a - b)[0]).toBeCloseTo(8 * 4);
    expect(before).toBe(4);
  });

  it("daireyi tıklanan tarafa göre büyütür / küçültür ve merkezi paylaşır", () => {
    const ed = new SketchEdit();
    const c = ed.circle(ed.point([0, 0]), 5);
    const out = offsetCurves(ed, c, 2, [9, 0])[0];
    const inn = offsetCurves(ed, c, 2, [1, 0])[0];
    const r = (id: string) => (ed.d.curves.find((x) => x.id === id) as { r: number }).r;
    expect([r(out), r(inn)]).toEqual([7, 3]);
    expect((ed.d.curves.find((x) => x.id === out) as { c: string }).c).toBe((ed.d.curves.find((x) => x.id === c) as { c: string }).c);
    expect(() => offsetCurves(ed, c, 9, [1, 0])).toThrow(/sıfırın altına/);
  });

  it("açık çizgi zincirini öteler; mesafe 0 ise imlecin uzaklığı kullanılır", () => {
    const ed = new SketchEdit();
    const lines = ed.polyline([ed.point([0, 0]), ed.point([10, 0]), ed.point([10, 10])], false);
    const added = offsetCurves(ed, lines[0], 0, [4, 3]); // 3 mm yukarı/içeri
    expect(added).toHaveLength(2);
    const ends = added.map((id) => lineEnds(ed.d, id));
    expect(ends[0][0]).toEqual([0, 3]);
    expect(ends[0][1]).toEqual([7, 3]); // gönye: ikinci çizginin ötelenmişi x=7
    expect(ends[1][0]).toEqual([7, 3]);
    expect(ends[1][1]).toEqual([7, 10]);
  });

  it("köşeleri yuvarlatılmış dikdörtgeni bozmadan öteler (teğet süreklilik)", () => {
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [20, 0], [20, 10], [0, 10]]);
    for (const p of [[0, 0], [20, 0], [20, 10], [0, 10]] as Vec2[]) filletCorner(ed, hitPoint(ed.d, p, 0.5)!, 2);
    const bottom = ed.d.curves.find((c) => c.kind === "line")!.id;
    const added = offsetCurves(ed, bottom, 1, [10, -3]);
    expect(added).toHaveLength(8); // 4 çizgi + 4 yay, köprü yok
    const profiles = sketchDataProfiles(ed.d).map(area).sort((a, b) => a - b);
    expect(profiles).toHaveLength(2);
    const corner = (r: number) => (4 - Math.PI) * r * r;
    expect(profiles[0]).toBeCloseTo(200 - corner(2), 1);
    expect(profiles[1]).toBeCloseTo(22 * 12 - corner(3), 1);
  });
});

describe("taşı / döndür / desen", () => {
  it("taşıma ve döndürme dönüşümleri", () => {
    expect(translateBy(3, -2)([1, 1])).toEqual([4, -1]);
    const r = rotateAbout([1, 1], 90)([3, 1]);
    expect(r[0]).toBeCloseTo(1);
    expect(r[1]).toBeCloseTo(3);
  });

  it("seçimi yerinde taşır; sabit kısıtın konumu da güncellenir", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[0, 0], [4, 0], [4, 2], [0, 2]]);
    const corner = ed.d.points[0].id;
    ed.constrain("fix", [corner], { at: [0, 0] });
    ed.transformCurves(lines, translateBy(10, 5));
    expect(pos(ed.d, corner)).toEqual([10, 5]);
    expect(ed.d.constraints.find((k) => k.type === "fix")!.at).toEqual([10, 5]);
    expect(selectionCenter(ed.d, lines)).toEqual([12, 6]);
  });

  it("dikdörtgensel desen: nx·ny − 1 kopya, doğru konumlarda", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[0, 0], [2, 0], [2, 2], [0, 2]]);
    const out = patternRect(ed, lines, 3, 2, 10, 7);
    expect(out).toHaveLength(5 * 4);
    const profiles = sketchDataProfiles(ed.d);
    expect(profiles).toHaveLength(6);
    const xs = new Set(profiles.map((p) => Math.min(...p.map((q) => q[0]))));
    const ys = new Set(profiles.map((p) => Math.min(...p.map((q) => q[1]))));
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 10, 20]);
    expect([...ys].sort((a, b) => a - b)).toEqual([0, 7]);
  });

  it("dairesel desen: 360° tam turda eşit aralık, orijinalin üstüne binmez", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[10, 0], [12, 0], [12, 1], [10, 1]]);
    patternCircular(ed, lines, 4, 360, [0, 0]);
    const profiles = sketchDataProfiles(ed.d);
    expect(profiles).toHaveLength(4);
    const centers = profiles.map((p) => [p.reduce((s, q) => s + q[0], 0) / 4, p.reduce((s, q) => s + q[1], 0) / 4]);
    const angles = centers.map((c) => Math.round((Math.atan2(c[1], c[0]) * 180) / Math.PI + 360) % 360).sort((a, b) => a - b);
    expect(angles).toEqual([3, 93, 183, 273]);
  });

  it("dairesel desen: kısmi açıda son kopya açının sonunda", () => {
    const ed = new SketchEdit();
    const lines = buildRect(ed, [[10, 0], [11, 0], [11, 1], [10, 1]]);
    patternCircular(ed, lines, 3, 90, [0, 0]);
    expect(sketchDataProfiles(ed.d)).toHaveLength(3);
    const maxAngle = Math.max(...sketchDataProfiles(ed.d).map((p) => Math.atan2(p[0][1], p[0][0]) * (180 / Math.PI)));
    expect(maxAngle).toBeCloseTo(90, 0);
  });
});
