import { init_planegcs_module } from "@salusoft89/planegcs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SketchSolver } from "../../src/core/solver";
import {
  SketchEdit,
  buildRect,
  buildSlot,
  filletCorner,
  hitPoint,
  pointMap,
  sketchDataProfiles,
  type SketchData,
} from "../../src/core/sketchmodel";
import type { Vec2 } from "../../src/core/solid";

let solver: SketchSolver;
beforeAll(async () => {
  solver = await SketchSolver.create(() => init_planegcs_module({ print: () => {}, printErr: () => {} } as never));
});
afterAll(() => solver.dispose());

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);
const at = (d: SketchData, id: string) => pointMap(d).get(id)!;

/** Köşeleri (0,0)-(w,h) olan, yatay/dikey kısıtlı dikdörtgen kurar. */
function rect(w = 10, h = 6) {
  const ed = new SketchEdit();
  const lines = buildRect(ed, [[0, 0], [w, 0], [w, h], [0, h]]);
  return { ed, lines, pts: ed.d.points.map((p) => p.id) };
}

describe("kısıt çözücü", () => {
  it("ölçüler dikdörtgeni tam tanımlar: sabit köşe + genişlik + yükseklik → dof 0", () => {
    const { ed, lines, pts } = rect(10, 6);
    ed.constrain("fix", [pts[0]], { at: [0, 0] });
    ed.constrain("distance", [pts[0], pts[1]], { value: 40 });
    ed.constrain("distance", [pts[1], pts[2]], { value: 20 });
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(at(r.data, pts[1])[0]).toBeCloseTo(40);
    expect(at(r.data, pts[2])[1]).toBeCloseTo(20);
    expect(area(sketchDataProfiles(r.data)[0])).toBeCloseTo(800);
    expect(lines).toHaveLength(4);
  });

  it("serbest dikdörtgen dof > 0; ölçü ekledikçe azalır", () => {
    const { ed, pts } = rect();
    const free = solver.solve(ed.d).dof;
    ed.constrain("fix", [pts[0]], { at: [0, 0] });
    const pinned = solver.solve(ed.d).dof;
    ed.constrain("distance", [pts[0], pts[1]], { value: 25 });
    const dimmed = solver.solve(ed.d).dof;
    expect(free).toBeGreaterThan(pinned);
    expect(pinned).toBeGreaterThan(dimmed);
    expect(dimmed).toBe(1);
  });

  it("çelişen ölçüleri bildirir ve çizimi bozmaz", () => {
    const { ed, pts } = rect();
    ed.constrain("fix", [pts[0]], { at: [0, 0] });
    const k1 = ed.constrain("distance", [pts[0], pts[1]], { value: 30 });
    const k2 = ed.constrain("distance", [pts[0], pts[1]], { value: 50 });
    const before = structuredClone(ed.d.points);
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(false);
    expect(r.conflicting.sort()).toEqual([k1, k2].sort());
    expect(r.data.points).toEqual(before);
  });

  it("yatay / dikey mesafe işaretlidir (yönü korur)", () => {
    const ed = new SketchEdit();
    const a = ed.point([0, 0]);
    const b = ed.point([3, 3]);
    ed.line(a, b);
    ed.constrain("fix", [a], { at: [1, 1] });
    ed.constrain("hdistance", [a, b], { value: -5 });
    ed.constrain("vdistance", [a, b], { value: 7 });
    const r = solver.solve(ed.d);
    expect(at(r.data, b)[0]).toBeCloseTo(-4);
    expect(at(r.data, b)[1]).toBeCloseTo(8);
  });

  it("açı ölçüsü: l1'den l2'ye saat yönünün tersine, derece", () => {
    const ed = new SketchEdit();
    const o = ed.point([0, 0]);
    const a = ed.point([10, 0]);
    const b = ed.point([6, 3]);
    const l1 = ed.line(o, a);
    const l2 = ed.line(o, b);
    ed.constrain("fix", [o], { at: [0, 0] });
    ed.constrain("fix", [a], { at: [10, 0] });
    ed.constrain("angle", [l1, l2], { value: 30 });
    const r = solver.solve(ed.d);
    const [x, y] = at(r.data, b);
    expect((Math.atan2(y, x) * 180) / Math.PI).toBeCloseTo(30, 3);
  });

  it("paralel, dik, eşit uzunluk ve orta nokta", () => {
    const ed = new SketchEdit();
    const [a, b, c, d, m] = [ed.point([0, 0]), ed.point([10, 0]), ed.point([2, 5]), ed.point([9, 8]), ed.point([4, 1])];
    const l1 = ed.line(a, b);
    const l2 = ed.line(c, d);
    ed.constrain("fix", [a], { at: [0, 0] });
    ed.constrain("fix", [b], { at: [10, 0] });
    ed.constrain("parallel", [l1, l2]);
    ed.constrain("equal", [l1, l2]);
    const mid = ed.line(a, m);
    ed.constrain("midpoint", [m, l1]);
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(true);
    const [pc, pd] = [at(r.data, c), at(r.data, d)];
    expect(pd[1] - pc[1]).toBeCloseTo(0, 4);
    expect(Math.hypot(pd[0] - pc[0], pd[1] - pc[1])).toBeCloseTo(10, 4);
    expect(at(r.data, m)[0]).toBeCloseTo(5, 4);
    expect(at(r.data, m)[1]).toBeCloseTo(0, 4);
    expect(mid).toBeTruthy();
  });

  it("dik kısıtı", () => {
    const ed = new SketchEdit();
    const [o, a, b] = [ed.point([0, 0]), ed.point([10, 0]), ed.point([3, 8])];
    const l1 = ed.line(o, a);
    const l2 = ed.line(o, b);
    ed.constrain("fix", [o], { at: [0, 0] });
    ed.constrain("fix", [a], { at: [10, 0] });
    ed.constrain("perpendicular", [l1, l2]);
    const r = solver.solve(ed.d);
    expect(at(r.data, b)[0]).toBeCloseTo(0, 4);
  });

  it("daire yarıçap / çap, eşit çember, eş merkez", () => {
    const ed = new SketchEdit();
    const [c1, c2] = [ed.point([0, 0]), ed.point([10, 1])];
    const k1 = ed.circle(c1, 3);
    const k2 = ed.circle(c2, 5);
    ed.constrain("fix", [c1], { at: [0, 0] });
    ed.constrain("diameter", [k1], { value: 12 });
    ed.constrain("equal", [k1, k2]);
    ed.constrain("concentric", [k1, k2]);
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(true);
    const radii = r.data.curves.filter((c) => c.kind === "circle").map((c) => (c as { r: number }).r);
    expect(radii).toEqual([6, 6]);
    expect(at(r.data, c2)[0]).toBeCloseTo(0, 4);
    expect(at(r.data, c2)[1]).toBeCloseTo(0, 4);
  });

  it("noktadan çizgiye mesafe", () => {
    const ed = new SketchEdit();
    const [a, b, p] = [ed.point([0, 0]), ed.point([10, 0]), ed.point([3, 2])];
    const l = ed.line(a, b);
    ed.standalone(p);
    ed.constrain("fix", [a], { at: [0, 0] });
    ed.constrain("fix", [b], { at: [10, 0] });
    ed.constrain("pointLine", [p, l], { value: 5 });
    const r = solver.solve(ed.d);
    expect(Math.abs(at(r.data, p)[1])).toBeCloseTo(5, 4);
  });

  it("simetri", () => {
    const ed = new SketchEdit();
    const [o, v, a, b] = [ed.point([0, 0]), ed.point([0, 5]), ed.point([2, 1]), ed.point([-1, 3])];
    const axis = ed.line(o, v);
    ed.standalone(a);
    ed.standalone(b);
    ed.constrain("fix", [o], { at: [0, 0] });
    ed.constrain("fix", [v], { at: [0, 5] });
    ed.constrain("fix", [a], { at: [2, 1] });
    ed.constrain("symmetric", [a, b, axis]);
    const r = solver.solve(ed.d);
    expect(at(r.data, b)[0]).toBeCloseTo(-2, 4);
    expect(at(r.data, b)[1]).toBeCloseTo(1, 4);
  });

  it("kanal: teğet kısıtlı yaylar genişlik ölçüsüyle birlikte tutarlı kalır", () => {
    const ed = new SketchEdit();
    buildSlot(ed, [0, 0], [10, 0], 2);
    const arcs = ed.d.curves.filter((c) => c.kind === "arc");
    ed.constrain("radius", [arcs[0].id], { value: 3 });
    const r = solver.solve(ed.d);
    expect(r.ok).toBe(true);
    const [profile] = sketchDataProfiles(r.data);
    // Çözücü hem yarıçapı 3'e getirip hem teğetliği korumalı: alan = 2·L·r + π·r² (L = merkez uzaklığı)
    const centers = r.data.curves.filter((c) => c.kind === "arc").map((c) => at(r.data, (c as { c: string }).c));
    const L = Math.hypot(centers[0][0] - centers[1][0], centers[0][1] - centers[1][1]);
    expect(area(profile)).toBeCloseTo(2 * L * 3 + Math.PI * 9, 0);
  });

  it("köşe yuvarlatma: yarıçap ölçüsü değişince alan tam hesaplanır", () => {
    const { ed, pts } = rect(10, 10);
    // pts: (0,0) (10,0) (10,10) (0,10). Yuvarlatılacak köşe (10,10); diğer üçü sabit.
    const corner = hitPoint(ed.d, [10, 10], 0.5)!;
    filletCorner(ed, corner, 2);
    for (const i of [0, 1, 3]) ed.constrain("fix", [pts[i]], { at: at(ed.d, pts[i]) });
    const arc = ed.d.curves.find((c) => c.kind === "arc")!;
    const k = ed.d.constraints.find((c) => c.type === "radius")!;
    expect(k.refs).toEqual([arc.id]);
    const cut = (r: number) => 100 - (r * r - (Math.PI * r * r) / 4);
    const r2 = solver.solve(ed.d);
    expect(r2.ok).toBe(true);
    expect(area(sketchDataProfiles(r2.data)[0])).toBeCloseTo(cut(2), 1);
    k.value = 4;
    const r4 = solver.solve(ed.d);
    expect(r4.ok).toBe(true);
    expect(area(sketchDataProfiles(r4.data)[0])).toBeCloseTo(cut(4), 1);
    // Köşe yuvarlatmada dof 0 olmalı: kenarlar sabit köşelerden yatay/dikey, yay ölçülü
    expect(r4.dof).toBe(0);
  });

  it("sürükleme: serbest köşe imleci izler, kısıtlar korunur", () => {
    const { ed, pts } = rect(10, 6);
    ed.constrain("fix", [pts[0]], { at: [0, 0] });
    const r = solver.solve(ed.d, { drag: { point: pts[2], to: [14, 9] } });
    expect(r.ok).toBe(true);
    // Dikdörtgen yatay/dikey kaldı: karşı köşeler hizalı
    expect(at(r.data, pts[1])[1]).toBeCloseTo(0, 3);
    expect(at(r.data, pts[3])[0]).toBeCloseTo(0, 3);
    expect(at(r.data, pts[2])[0]).toBeCloseTo(14, 2);
    expect(at(r.data, pts[2])[1]).toBeCloseTo(9, 2);
    expect(at(r.data, pts[1])[0]).toBeCloseTo(14, 2);
  });

  it("sürükleme: ölçülü kenar sabit kalır, sabit nokta sürüklenemez", () => {
    const { ed, pts } = rect(10, 6);
    ed.constrain("fix", [pts[0]], { at: [0, 0] });
    ed.constrain("distance", [pts[0], pts[1]], { value: 10 });
    const r = solver.solve(ed.d, { drag: { point: pts[2], to: [30, 12] } });
    expect(at(r.data, pts[1])[0]).toBeCloseTo(10, 3);
    const pinned = solver.solve(ed.d, { drag: { point: pts[0], to: [5, 5] } });
    expect(at(pinned.data, pts[0])).toEqual([0, 0]);
  });

  it("geçersiz kısıt atlanır, uyarı verir, çözüm sürer", () => {
    const { ed, pts } = rect();
    ed.constrain("tangent", [pts[0], pts[1]]);
    ed.constrain("radius", [ed.d.curves[0].id], { value: 3 });
    const r = solver.solve(ed.d);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(true);
  });

  it("silinen şeye bağlı kısıtı temizler (yetim kalmaz)", () => {
    const { ed, lines } = rect();
    ed.constrain("equal", [lines[0], lines[1]]);
    ed.deleteCurves([lines[1]]);
    expect(ed.d.constraints.some((k) => k.refs.includes(lines[1]))).toBe(false);
    expect(solver.solve(ed.d).warnings).toEqual([]);
  });
});
