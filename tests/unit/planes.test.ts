import { describe, expect, it } from "vitest";
import { angledFrame, frameFromPoints, frameOf } from "../../src/core/sketch";
import { buildRect, SketchEdit } from "../../src/core/sketchmodel";
import { createApp } from "./helpers";

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

describe("açılı ve 3 noktalı düzlem", () => {
  it("açılı düzlem: u ekseni etrafında 90° → XY, XZ benzeri; her zaman u × v = n", () => {
    const f = angledFrame("XY", "U", 90);
    near(f.u, [1, 0, 0]);
    near(f.v, [0, 0, 1]);
    near(f.n, [0, -1, 0]);
    for (const base of ["XY", "XZ", "YZ"] as const) {
      for (const axis of ["U", "V"] as const) {
        for (const a of [-135, -30, 0, 17, 45, 90, 180]) {
          const g = angledFrame(base, axis, a);
          near(cross(g.u, g.v), g.n);
          expect(Math.hypot(...g.n)).toBeCloseTo(1, 9);
        }
      }
    }
    near(angledFrame("XY", "V", 0).n, [0, 0, 1]);
    const tilt = angledFrame("XY", "U", 45);
    near(tilt.n, [0, -Math.SQRT1_2, Math.SQRT1_2]);
  });

  it("üç noktadan düzlem: başlangıç ilk nokta, u ilk ikisi, normal sağ el kuralıyla; doğrusalsa null", () => {
    const f = frameFromPoints([1, 2, 3], [11, 2, 3], [1, 12, 3])!;
    near(f.origin, [1, 2, 3]);
    near(f.u, [1, 0, 0]);
    near(f.n, [0, 0, 1]);
    near(f.v, [0, 1, 0]);
    expect(frameFromPoints([0, 0, 0], [1, 1, 1], [2, 2, 2])).toBeNull();
    expect(frameFromPoints([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
    const tilted = frameFromPoints([0, 0, 0], [10, 0, 0], [0, 10, 10])!;
    near(tilted.n, [0, -Math.SQRT1_2, Math.SQRT1_2]);
    expect(frameOf(tilted)).toBe(tilted);
  });

  it("45° eğik düzlemde eskiz: dikdörtgen eğik düzleme dik çekilince hacim = alan × mesafe", async () => {
    const { app } = await createApp();
    const frame = angledFrame("XY", "U", 45);
    const sk = app.createSketch(frame);
    const ed = new SketchEdit();
    buildRect(ed, [[0, 0], [10, 0], [10, 6], [0, 6]]);
    app.document.update(sk.id, { sketchData: ed.result() });
    const f = app.addSketchFeature("extrude", sk.id)!;
    await app.updateFeature(f.id, { params: { distance: 5 } });
    expect(app.errors.get(f.id)).toBeUndefined();
    expect(app.meshes.get(f.id)!.volume).toBeCloseTo(300, 3);
    // Eğik düzlemin normali (0, −sin45, cos45): kutunun bir köşesi Y = 6·cos45 kadar kalkar
    const m = app.meshes.get(f.id)!;
    let maxZ = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) maxZ = Math.max(maxZ, m.positions[i]);
    expect(maxZ).toBeCloseTo(6 * Math.SQRT1_2 + 5 * Math.SQRT1_2, 3);
  });
});
