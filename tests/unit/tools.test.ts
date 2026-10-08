import { fromLegacyEntities } from "../../src/core/sketchmodel";
import { describe, expect, it } from "vitest";
import {
  arcGeometry,
  circleFrom3,
  describeSketch,
  entityPath,
  filletCorner,
  findLoops,
  hitCorner,
  hitEntity,
  mirrorEntity,
  polygonPoints,
  profileRegions,
  sketchProfiles,
  type SketchEntity,
} from "../../src/core/sketch";
import type { Vec2 } from "../../src/core/solid";
import { createApp } from "./helpers";

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);
const line = (...points: Vec2[]): SketchEntity => ({ kind: "polyline", points, closed: false });

describe("yeni eskiz öğeleri", () => {
  it("üç noktadan çember ve yay", () => {
    const c = circleFrom3([1, 0], [0, 1], [-1, 0])!;
    expect(c.c[0]).toBeCloseTo(0);
    expect(c.c[1]).toBeCloseTo(0);
    expect(c.r).toBeCloseTo(1);
    expect(circleFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
    // Üstten geçen yarım çember saat yönünün tersine, alttan geçen saat yönünde
    expect(arcGeometry([1, 0], [0, 1], [-1, 0])!.sweep).toBeCloseTo(Math.PI);
    expect(arcGeometry([1, 0], [0, -1], [-1, 0])!.sweep).toBeCloseTo(-Math.PI);
  });

  it("yay uçları birebir tıklanan noktalardır", () => {
    const { points } = entityPath({ kind: "arc", p0: [3, 0], p1: [0, 3], p2: [-3, 0] });
    expect(points[0]).toEqual([3, 0]);
    expect(points.at(-1)).toEqual([-3, 0]);
  });

  it("kanal, elips ve çokgen kapalı profildir", () => {
    const [slot, ellipse, poly] = sketchProfiles([
      { kind: "slot", a: [0, 0], b: [10, 0], r: 2 },
      { kind: "ellipse", c: [0, 0], rx: 4, ry: 2, rot: 0.3 },
      { kind: "polyline", points: polygonPoints([0, 0], [5, 0], 6), closed: true },
    ]);
    expect(area(slot)).toBeCloseTo(10 * 4 + Math.PI * 4, 0);
    expect(area(ellipse)).toBeCloseTo(Math.PI * 8, 0);
    expect(area(poly)).toBeCloseTo((3 * Math.sqrt(3) * 25) / 2, 3);
  });

  it("yapı çizgileri profile katılmaz", () => {
    const entities: SketchEntity[] = [
      { kind: "rect", a: [0, 0], b: [10, 10] },
      { kind: "circle", c: [5, 5], r: 2, construction: true },
    ];
    expect(sketchProfiles(entities)).toHaveLength(1);
    expect(describeSketch(entities)).toBe("2 öğe · 1 kapalı profil · 1 yapı çizgisi");
  });

  it("eğri (spline) kontrol noktalarından geçer", () => {
    const { points } = entityPath({ kind: "spline", points: [[0, 0], [5, 5], [10, 0]], closed: false });
    expect(points[0]).toEqual([0, 0]);
    expect(points.some((p) => Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 5) < 1e-9)).toBe(true);
    expect(points.at(-1)).toEqual([10, 0]);
  });
});

describe("uç uca birleşen çizgilerden profil", () => {
  it("dört ayrı çizgi dikdörtgen olur", () => {
    const profiles = sketchProfiles([line([0, 0], [10, 0]), line([10, 0], [10, 5]), line([0, 5], [10, 5]), line([0, 5], [0, 0])]);
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo(50);
  });

  it("çizgi + yay ile D şekli; ölü uçlar döngüyü bozmaz", () => {
    const profiles = sketchProfiles([
      line([-5, 0], [5, 0]),
      { kind: "arc", p0: [5, 0], p1: [0, 5], p2: [-5, 0] },
      line([5, 0], [9, -3]), // sarkan çizgi
    ]);
    expect(profiles).toHaveLength(1);
    expect(area(profiles[0])).toBeCloseTo((Math.PI * 25) / 2, 0);
  });

  it("kapanmayan zincir profil üretmez", () => {
    expect(findLoops([[[0, 0], [1, 0]], [[1, 0], [1, 1]]])).toEqual([]);
  });
});

describe("eskiz düzenleme araçları", () => {
  it("dikdörtgen köşesini yuvarlatır (alan azalır)", () => {
    const rect: SketchEntity = { kind: "rect", a: [0, 0], b: [10, 10] };
    const hit = hitCorner([rect], [9.8, 10.1], 1)!;
    expect(hit).toEqual({ entity: 0, vertex: 2 });
    const rounded = filletCorner(rect, hit.vertex, 2);
    expect(rounded.kind).toBe("polyline");
    const [profile] = sketchProfiles([rounded]);
    expect(area(profile)).toBeCloseTo(100 - (4 - Math.PI), 1);
  });

  it("yarıçap kenar yarısını aşmaz", () => {
    const rounded = filletCorner({ kind: "rect", a: [0, 0], b: [4, 4] }, 0, 100);
    const [profile] = sketchProfiles([rounded]);
    expect(area(profile)).toBeGreaterThan(16 - (4 - Math.PI) * 4 - 0.1);
  });

  it("öğeye tıklama ve aynalama", () => {
    const entities: SketchEntity[] = [{ kind: "circle", c: [10, 0], r: 3 }, line([0, 0], [0, 10])];
    expect(hitEntity(entities, [13.2, 0], 0.5)).toBe(0);
    expect(hitEntity(entities, [0.3, 5], 0.5)).toBe(1);
    expect(hitEntity(entities, [5, 5], 0.5)).toBe(-1);
    expect(mirrorEntity(entities[0], "V")).toEqual({ kind: "circle", c: [-10, 0], r: 3 });
    expect(mirrorEntity({ kind: "arc", p0: [1, 1], p1: [2, 2], p2: [3, 1] }, "U")).toEqual({
      kind: "arc",
      p0: [1, -1],
      p1: [2, -2],
      p2: [3, -1],
    });
  });

  it("iç içe profiller bölgelere ayrılır", () => {
    const outer: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: Vec2[] = [[2, 2], [8, 2], [8, 8], [2, 8]];
    const island: Vec2[] = [[4, 4], [6, 4], [6, 6], [4, 6]];
    const regions = profileRegions([outer, hole, island]);
    expect(regions).toHaveLength(2);
    expect(regions[0].holes).toEqual([hole]);
    expect(regions[1]).toEqual({ outer: island, holes: [] });
  });
});

async function makePlate() {
  const { app, ui } = await createApp();
  const sketch = app.createSketch("XY");
  app.document.update(sketch.id, { sketchData: fromLegacyEntities([{ kind: "rect", a: [0, 0], b: [20, 10] }]) });
  const plate = app.addSketchFeature("extrude", sketch.id)!;
  await app.updateFeature(plate.id, { params: { distance: 5 } });
  return { app, ui, plate };
}

describe("ekstrüzyon seçenekleri", () => {
  it("simetrik ekstrüzyon düzlemin iki yanına uzanır", async () => {
    const { app, plate } = await makePlate();
    await app.updateFeature(plate.id, { direction: "symmetric" });
    const mesh = app.meshes.get(plate.id)!;
    const zs = [...mesh.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(-2.5);
    expect(Math.max(...zs)).toBeCloseTo(2.5);
    expect(mesh.volume).toBeCloseTo(1000);
  });

  it("Kes işlemi tek gövdeyi hedef seçer ve delik açar", async () => {
    const { app, plate } = await makePlate();
    const s2 = app.createSketch("XY");
    app.document.update(s2.id, { sketchData: fromLegacyEntities([{ kind: "circle", c: [10, 5], r: 2 }]) });
    const cut = app.addSketchFeature("extrude", s2.id)!;
    expect(app.targetCandidates(cut.id).map((f) => f.id)).toEqual([plate.id]);
    await app.setOperation(cut.id, "cut");
    const f = app.document.get(cut.id)!;
    expect(f.target).toBe(plate.id);
    expect(app.document.roots().map((r) => r.id)).toEqual([cut.id]);
    expect(app.meshes.get(cut.id)!.volume).toBeCloseTo(1000 - Math.PI * 4 * 10 * 0.5, 0);
    // Yeni gövdeye dönünce hedef serbest kalır
    await app.setOperation(cut.id, "new");
    expect(app.document.get(cut.id)!.target).toBeUndefined();
    expect(app.document.roots()).toHaveLength(2);
  });

  it("hedef seçilmeden Kes anlaşılır hata verir", async () => {
    const { app } = await createApp();
    const s = app.createSketch("XY");
    app.document.update(s.id, { sketchData: fromLegacyEntities([{ kind: "rect", a: [0, 0], b: [1, 1] }]) });
    const e = app.addSketchFeature("extrude", s.id)!;
    await app.setOperation(e.id, "cut");
    expect(app.errors.get(e.id)).toMatch(/hedef gövde/);
  });
});

describe("gövde özellikleri", () => {
  it("ayna, gövdeyi düzlemin öbür yanına kopyalar", async () => {
    const { app, plate } = await makePlate();
    const mirror = app.addBodyFeature("mirror", plate.id)!;
    const mesh = app.meshes.get(mirror.id)!;
    expect(mesh.volume).toBeCloseTo(2000);
    const xs = [...mesh.positions].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-20);
    await app.updateFeature(mirror.id, { plane: "XY" });
    expect(app.meshes.get(mirror.id)!.volume).toBeCloseTo(2000);
  });

  it("dikdörtgensel ve dairesel desen", async () => {
    const { app, plate } = await makePlate();
    const pattern = app.addBodyFeature("linearPattern", plate.id)!;
    await app.updateFeature(pattern.id, { params: { countX: 2, spacingX: 30, countY: 2, spacingY: 15 } });
    expect(app.meshes.get(pattern.id)!.volume).toBeCloseTo(4000);
    await app.document.undo();
    await app.document.undo();
    const circular = app.addBodyFeature("circularPattern", plate.id)!;
    await app.updateFeature(circular.id, { params: { count: 4 }, worldAxis: "Y" });
    // 0° ve 180° kopyaları Y ekseni etrafında; plaka X ekseni boyunca 0..20
    const xs = [...app.meshes.get(circular.id)!.positions].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-20);
  });

  it("ölçek hacmi küpüyle büyütür", async () => {
    const { app, plate } = await makePlate();
    const s = app.addBodyFeature("scale", plate.id)!;
    expect(app.meshes.get(s.id)!.volume).toBeCloseTo(8000);
  });

  it("seçim yoksa uyarır; döngü kuran hedef reddedilir", async () => {
    const { app, ui, plate } = await makePlate();
    app.document.setSelection([]);
    expect(app.addBodyFeature("mirror")).toBeNull();
    expect(ui.messages.at(-1)?.kind).toBe("warning");
    const mirror = app.addBodyFeature("mirror", plate.id)!;
    // Plaka aynanın girdisi; plakanın hedefi ayna olamaz
    expect(() => app.document.update(plate.id, { operation: "join", target: mirror.id })).toThrow(/döngü/);
  });

  it("gizlenen gövde hesaplanmaya devam eder", async () => {
    const { app, plate } = await makePlate();
    app.toggleVisibility([plate.id]);
    expect(app.document.get(plate.id)!.hidden).toBe(true);
    expect(app.meshes.get(plate.id)).toBeDefined();
    app.toggleVisibility([plate.id]);
    expect("hidden" in app.document.get(plate.id)!).toBe(false);
  });
});
