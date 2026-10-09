import { describe, expect, it } from "vitest";
import { SketchEdit } from "../../src/core/sketchmodel";
import { boxOf, curvesInBox, findAlignment, nearestOnCurve } from "../../src/core/sketchpick";

function scene() {
  const ed = new SketchEdit();
  const near = ed.line(ed.point([1, 1]), ed.point([4, 1]));
  const across = ed.line(ed.point([3, 2]), ed.point([20, 2])); // kutudan dışarı taşar
  const far = ed.line(ed.point([30, 30]), ed.point([40, 30]));
  const circle = ed.circle(ed.point([2, 4]), 1);
  const dot = ed.point([9, 9]);
  ed.standalone(dot);
  return { d: ed.d, near, across, far, circle, dotCurve: ed.d.curves.find((c) => c.kind === "point")!.id };
}

describe("kutu seçimi", () => {
  it("pencere: yalnızca tamamı içeridekiler", () => {
    const s = scene();
    const ids = curvesInBox(s.d, boxOf([0, 0], [10, 10]), false);
    expect(ids.sort()).toEqual([s.near, s.circle, s.dotCurve].sort());
  });

  it("kesen: içeri giren ya da değen her şey; ters köşe sırası fark etmez", () => {
    const s = scene();
    const ids = curvesInBox(s.d, boxOf([10, 0], [0, 10]), true);
    expect(ids.sort()).toEqual([s.near, s.across, s.circle, s.dotCurve].sort());
    expect(ids).not.toContain(s.far);
  });

  it("kesen: köşesi kutuda olmayan ama içinden geçen doğru da seçilir", () => {
    const ed = new SketchEdit();
    const through = ed.line(ed.point([-5, 5]), ed.point([15, 5]));
    expect(curvesInBox(ed.d, boxOf([0, 0], [10, 10]), true)).toEqual([through]);
    expect(curvesInBox(ed.d, boxOf([0, 0], [10, 10]), false)).toEqual([]);
    expect(curvesInBox(ed.d, boxOf([0, 6], [10, 10]), true)).toEqual([]);
  });
});

describe("hizalama", () => {
  it("her eksende imlece en yakın kaynağı bulur", () => {
    const al = findAlignment([[10, 0], [10.3, 50], [0, 7]], [10.1, 7.2], 0.5);
    expect(al.x).toEqual([10, 0]); // |dx| = 0.1 (diğeri 0.2)
    expect(al.y).toEqual([0, 7]);
  });

  it("tolerans dışındaysa hizalanmaz", () => {
    expect(findAlignment([[10, 10]], [12, 15], 0.5)).toEqual({});
  });
});

describe("eğri üzerine yakalama", () => {
  it("çizgide dik izdüşüm, uçlarla sınırlı", () => {
    const ed = new SketchEdit();
    const l = ed.line(ed.point([0, 0]), ed.point([10, 0]));
    expect(nearestOnCurve(ed.d, [4, 0.5], 1)).toEqual({ p: [4, 0], curveId: l });
    // Uçtan taşan imleç uca yapışır (uç noktalar ayrıca nokta yakalamasıyla gelir)
    expect(nearestOnCurve(ed.d, [10.4, 0.3], 1)?.p).toEqual([10, 0]);
    expect(nearestOnCurve(ed.d, [4, 3], 1)).toBeNull();
  });

  it("daire üzerinde merkezden imlece doğru en yakın nokta", () => {
    const ed = new SketchEdit();
    const c = ed.circle(ed.point([0, 0]), 5);
    const hit = nearestOnCurve(ed.d, [0, 5.4], 1)!;
    expect(hit.curveId).toBe(c);
    expect(hit.p[0]).toBeCloseTo(0, 9);
    expect(hit.p[1]).toBeCloseTo(5, 9);
    expect(nearestOnCurve(ed.d, [0, 0], 1)).toBeNull(); // merkez: eğriye uzak
  });

  it("yayda yalnızca süpürülen aralıkta (üst yarım yay)", () => {
    const ed = new SketchEdit();
    // Saat yönünün tersine (10,0) → (-10,0): üst yarı
    const arc = ed.arc(ed.point([0, 0]), ed.point([10, 0]), ed.point([-10, 0]));
    expect(nearestOnCurve(ed.d, [0, 10.3], 1)?.curveId).toBe(arc);
    expect(nearestOnCurve(ed.d, [0, -10.3], 1)).toBeNull();
  });

  it("only: yalnızca o eğriye bakar", () => {
    const ed = new SketchEdit();
    const a = ed.line(ed.point([0, 0]), ed.point([10, 0]));
    const b = ed.line(ed.point([0, 0.2]), ed.point([10, 0.2]));
    expect(nearestOnCurve(ed.d, [5, 0.1], 1, a)?.curveId).toBe(a);
    expect(nearestOnCurve(ed.d, [5, 0.1], 1, b)?.curveId).toBe(b);
  });
});
