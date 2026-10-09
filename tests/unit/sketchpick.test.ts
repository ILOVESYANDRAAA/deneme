import { describe, expect, it } from "vitest";
import { SketchEdit } from "../../src/core/sketchmodel";
import { boxOf, curvesInBox, findAlignment } from "../../src/core/sketchpick";

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
