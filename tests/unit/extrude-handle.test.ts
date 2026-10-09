import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../src/core/solid";
import { dragDistanceValue, profileAnchor } from "../../src/ui/extrudetool";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const inside = (p: Vec2, poly: Vec2[]) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};

describe("ekstrüzyon oku: profil noktası", () => {
  it("dikdörtgenin ağırlık merkezi (dönüş yönünden bağımsız)", () => {
    expect(profileAnchor([rect(0, 0, 20, 10)])).toEqual([10, 5]);
    expect(profileAnchor([rect(0, 0, 20, 10).reverse()])).toEqual([10, 5]);
  });

  it("halkada merkez boşlukta kalır: nokta dolu bölgenin içine alınır", () => {
    const outer = rect(-10, -10, 10, 10);
    const hole = rect(-5, -5, 5, 5);
    const p = profileAnchor([outer, hole])!;
    expect(inside(p, outer)).toBe(true);
    expect(inside(p, hole)).toBe(false);
  });

  it("L biçiminde nokta profilin içinde", () => {
    const l: Vec2[] = [
      [0, 0],
      [30, 0],
      [30, 4],
      [4, 4],
      [4, 30],
      [0, 30],
    ];
    const p = profileAnchor([l])!;
    expect(inside(p, l)).toBe(true);
  });

  it("en büyük bölge seçilir; profil yoksa null", () => {
    expect(profileAnchor([rect(0, 0, 2, 2), rect(10, 10, 30, 30)])).toEqual([20, 20]);
    expect(profileAnchor([])).toBeNull();
  });
});

describe("ekstrüzyon oku: sürükleme değeri", () => {
  it("tek yön: yol eklenir, 0.5'e yuvarlanır, ters yöne geçebilir ama sıfır olmaz", () => {
    expect(dragDistanceValue(10, 3.3, "one", 0.5)).toBe(13.5);
    expect(dragDistanceValue(10, -12.2, "one", 0.5)).toBe(-2);
    expect(dragDistanceValue(10, -10.1, "one", 0.5)).toBe(-0.5);
    expect(dragDistanceValue(10, -9.9, "one", 0.5)).toBe(0.5);
    expect(dragDistanceValue(10, 1.23, "one", 0.1)).toBe(11.2);
  });

  it("simetrik: ok yarı mesafede durduğundan yol iki kat; en az bir adım", () => {
    expect(dragDistanceValue(20, 5, "symmetric", 0.5)).toBe(30);
    expect(dragDistanceValue(20, -30, "symmetric", 0.5)).toBe(0.5);
  });
});
