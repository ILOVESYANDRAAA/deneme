import { init_planegcs_module } from "@salusoft89/planegcs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dimensionAnchor, constraintAnchor, measureDimension, planConstraint, planDimension } from "../../src/core/constrain";
import { SketchSolver } from "../../src/core/solver";
import { SketchEdit, buildPolyline, type SketchData } from "../../src/core/sketchmodel";

let solver: SketchSolver;
beforeAll(async () => {
  solver = await SketchSolver.create(() => init_planegcs_module({ print: () => {}, printErr: () => {} } as never));
});
afterAll(() => solver.dispose());

/** Eğik iki çizgi + bir daire + bir yay içeren deneme eskizi. */
function scene() {
  const ed = new SketchEdit();
  const [a, b, c, d] = [ed.point([0, 0]), ed.point([10, 1]), ed.point([2, 8]), ed.point([9, 12])];
  const l1 = ed.line(a, b);
  const l2 = ed.line(c, d);
  const cc = ed.point([20, 0]);
  const circle = ed.circle(cc, 3);
  const [ac, as, ae] = [ed.point([30, 0]), ed.point([34, 0]), ed.point([30, 4])];
  const arc = ed.arc(ac, as, ae);
  const loose = ed.point([5, 5]);
  ed.standalone(loose);
  return { ed, d: ed.d as SketchData, a, b, c, d2: d, l1, l2, circle, arc, cc, ac, as, ae, loose };
}

describe("kısıt planlama", () => {
  it("yatay/dikey: çizgiler ya da iki nokta; yanlış seçimde açıklayıcı hata", () => {
    const s = scene();
    expect(planConstraint(s.d, "horizontal", [s.l1, s.l2]).add.map((p) => p.refs)).toEqual([[s.l1], [s.l2]]);
    expect(planConstraint(s.d, "vertical", [s.a, s.b]).add[0]).toMatchObject({ type: "vertical", refs: [s.a, s.b] });
    expect(() => planConstraint(s.d, "horizontal", [s.circle])).toThrow(/Yatay.*çizgi/);
    expect(() => planConstraint(s.d, "horizontal", [])).toThrow(/önce eskizde öğe seçin/);
  });

  it("çakışık: iki nokta, nokta+eğri → eğri üzerinde", () => {
    const s = scene();
    expect(planConstraint(s.d, "coincident", [s.a, s.c]).add[0]).toMatchObject({ type: "coincident" });
    expect(planConstraint(s.d, "coincident", [s.loose, s.l1]).add[0]).toMatchObject({ type: "onCurve", refs: [s.loose, s.l1] });
    expect(() => planConstraint(s.d, "coincident", [s.l1, s.l2])).toThrow(/iki nokta/);
  });

  it("paralel/dik: çizgi zinciri; dik tam iki çizgi ister", () => {
    const s = scene();
    expect(planConstraint(s.d, "parallel", [s.l1, s.l2]).add).toHaveLength(1);
    expect(() => planConstraint(s.d, "perpendicular", [s.l1])).toThrow(/en az iki çizgi/);
    expect(() => planConstraint(s.d, "parallel", [s.l1, s.circle])).toThrow(/çizgi/);
  });

  it("eşit: aynı tür; farklı türde hata", () => {
    const s = scene();
    expect(planConstraint(s.d, "equal", [s.l1, s.l2]).add).toHaveLength(1);
    expect(planConstraint(s.d, "equal", [s.circle, s.arc]).add).toHaveLength(1);
    expect(() => planConstraint(s.d, "equal", [s.l1, s.circle])).toThrow(/aynı türden/);
  });

  it("teğet: iki çizgi olamaz; çizgi+daire olur", () => {
    const s = scene();
    expect(() => planConstraint(s.d, "tangent", [s.l1, s.l2])).toThrow(/iki çizgi teğet olamaz/);
    expect(planConstraint(s.d, "tangent", [s.l1, s.circle]).add).toHaveLength(1);
  });

  it("orta nokta, eş merkez, eğri üzerinde, simetri", () => {
    const s = scene();
    expect(planConstraint(s.d, "midpoint", [s.loose, s.l1]).add[0]).toMatchObject({ refs: [s.loose, s.l1] });
    expect(planConstraint(s.d, "concentric", [s.circle, s.arc]).add).toHaveLength(1);
    expect(planConstraint(s.d, "onCurve", [s.loose, s.circle]).add).toHaveLength(1);
    expect(planConstraint(s.d, "symmetric", [s.a, s.b, s.l2]).add[0].refs).toEqual([s.a, s.b, s.l2]);
    expect(() => planConstraint(s.d, "symmetric", [s.a, s.b])).toThrow(/simetri çizgisi/);
  });

  it("sabit: noktalar ya da eğrinin tüm noktaları; ikinci kez uygulamak geri alır", () => {
    const s = scene();
    const plan = planConstraint(s.d, "fix", [s.l1]);
    expect(plan.add.map((p) => p.refs[0]).sort()).toEqual([s.a, s.b].sort());
    expect(plan.add[0].at).toBeDefined();
    for (const p of plan.add) s.ed.constrain("fix", p.refs, { at: p.at });
    const undo = planConstraint(s.ed.d, "fix", [s.l1]);
    expect(undo.add).toHaveLength(0);
    expect(undo.remove).toHaveLength(2);
    // Yarısı sabitse kalanı sabitlenir
    const half = planConstraint(s.ed.d, "fix", [s.l1, s.c]);
    expect(half.add.map((p) => p.refs[0])).toEqual([s.c]);
  });

  it("aynı kısıt iki kez eklenmez", () => {
    const s = scene();
    s.ed.constrain("parallel", [s.l1, s.l2]);
    expect(planConstraint(s.ed.d, "parallel", [s.l2, s.l1]).add).toHaveLength(0);
  });
});

describe("ölçü planlama", () => {
  it("çizgi → uzunluk (+ yatay/dikey seçenekleri); daire → çap; yay → yarıçap", () => {
    const s = scene();
    const line = planDimension(s.d, [s.l1]);
    expect(line.map((c) => c.type)).toEqual(["distance", "hdistance", "vdistance"]);
    expect(line[0].value).toBeCloseTo(Math.hypot(10, 1), 5);
    expect(line[1].value).toBe(10);
    expect(line[2].value).toBe(1);
    expect(planDimension(s.d, [s.circle]).map((c) => [c.type, c.value])).toEqual([["diameter", 6], ["radius", 3]]);
    expect(planDimension(s.d, [s.arc])[0]).toMatchObject({ type: "radius", value: 4 });
  });

  it("iki nokta, nokta+çizgi, iki çizgi", () => {
    const s = scene();
    expect(planDimension(s.d, [s.a, s.b])[0]).toMatchObject({ type: "distance" });
    const pl = planDimension(s.d, [s.loose, s.l1]);
    expect(pl).toHaveLength(1);
    expect(pl[0].type).toBe("pointLine");
    expect(pl[0].value).toBeCloseTo(Math.abs(10 * 5 - 1 * 5) / Math.hypot(10, 1), 4);
    const ang = planDimension(s.d, [s.l1, s.l2]);
    expect(ang[0].type).toBe("angle");
    // l1 = (10, 1), l2 = (7, 4): çarpım 33, nokta çarpımı 74
    expect(ang[0].value).toBeCloseTo((Math.atan2(33, 74) * 180) / Math.PI, 3);
  });

  it("uygun olmayan seçimde hata", () => {
    const s = scene();
    expect(() => planDimension(s.d, [s.circle, s.l1])).toThrow(/Ölçü için/);
    expect(() => planDimension(s.d, [])).toThrow();
  });

  it("açı ölçüsü: l1'den l2'ye saat yönünün tersine işaretli", () => {
    const ed = new SketchEdit();
    const [o, x, y] = [ed.point([0, 0]), ed.point([5, 0]), ed.point([0, 5])];
    const l1 = ed.line(o, x);
    const l2 = ed.line(o, y);
    expect(measureDimension(ed.d, "angle", [l1, l2])).toBeCloseTo(90);
    expect(measureDimension(ed.d, "angle", [l2, l1])).toBeCloseTo(-90);
  });

  it("ölçü eklenince çözücü değeri uygular; ölçü tabloları tutarlı", () => {
    const s = scene();
    s.ed.constrain("fix", [s.a], { at: [0, 0] });
    s.ed.constrain("fix", [s.b], { at: [10, 1] });
    const choice = planDimension(s.ed.d, [s.l2])[0];
    s.ed.constrain(choice.type, choice.refs, { value: 20 });
    const r = solver.solve(s.ed.d);
    expect(r.ok).toBe(true);
    expect(measureDimension(r.data, "distance", choice.refs)).toBeCloseTo(20, 4);
  });

  it("etiket konumu ve kısıt simgesi konumu", () => {
    const s = scene();
    const k = s.ed.constrain("distance", [s.a, s.b], { value: 10 });
    const dim = s.ed.d.constraints.find((c) => c.id === k)!;
    expect(dimensionAnchor(s.ed.d, dim)).toEqual([5, 0.5]);
    dim.offset = [0, 3];
    expect(dimensionAnchor(s.ed.d, dim)).toEqual([5, 3.5]);
    const h = s.ed.constrain("horizontal", [s.l1]);
    const hk = s.ed.d.constraints.find((c) => c.id === h)!;
    expect(constraintAnchor(s.ed.d, hk)).toEqual([5, 0.5]);
  });
});

describe("kısıt uygulama: gerçek şekil üzerinde uçtan uca", () => {
  it("üç çizgiyi yatay/dikey yapınca ve ölçü verince şekil tam tanımlanır", () => {
    const ed = new SketchEdit();
    const lines = buildPolyline(ed, [[0, 0], [9, 1], [11, 6], [-1, 4]], true, {}, false);
    const [p0] = ed.d.points;
    ed.constrain("fix", [p0.id], { at: [0, 0] });
    planConstraint(ed.d, "horizontal", [lines[0], lines[2]]).add.forEach((p) => ed.constrain(p.type, p.refs));
    planConstraint(ed.d, "vertical", [lines[1], lines[3]]).add.forEach((p) => ed.constrain(p.type, p.refs));
    const w = planDimension(ed.d, [lines[0]])[0];
    ed.constrain(w.type, w.refs, { value: 40 });
    const h = planDimension(ed.d, [lines[1]])[0];
    ed.constrain(h.type, h.refs, { value: 20 });
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
  });
});
