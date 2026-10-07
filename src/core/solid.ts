/**
 * Solid: geometri motorunun anladığı, JSON'a çevrilebilir katı tarifi.
 * Hem yerleşik özellikler hem de eklentiler şekillerini bu tarifle anlatır;
 * gerçek ağ (mesh) hesabı geometri işçisinde yapılır.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type BooleanOp = "union" | "subtract" | "intersect";

/** "Positive": saat yönünün tersi dolu, saat yönü delik. "EvenOdd": iç içe her şekil bir delik açar (eskizler). */
export type FillRule = "Positive" | "EvenOdd";

export type Solid =
  | { kind: "box"; size: Vec3 }
  | { kind: "cylinder"; radius: number; height: number; segments?: number }
  | { kind: "sphere"; radius: number; segments?: number }
  | { kind: "extrude"; polygons: Vec2[][]; height: number; fillRule?: FillRule }
  /** Çokgenleri Y ekseni etrafında döndürür; sonuçta Y ekseni Z olur (manifold kuralı). Sadece x > 0 tarafı kullanılır. */
  | { kind: "revolve"; polygons: Vec2[][]; angle: number; segments?: number; fillRule?: FillRule }
  | { kind: "boolean"; op: BooleanOp; children: Solid[] }
  /** `matrix`: 4×4 sütun öncelikli; varsa önce o, sonra rotate, sonra translate uygulanır. */
  | { kind: "transform"; matrix?: number[]; translate?: Vec3; rotate?: Vec3; child: Solid };

const MAX_DEPTH = 64;

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n && v.every(isNum);
}

/**
 * Eklentilerden gelen tarifler güvenilmezdir; geometri motoruna gitmeden
 * önce yapısını doğrular. Hata varsa açıklayıcı bir Error fırlatır.
 */
export function validateSolid(value: unknown, path = "solid", depth = 0): Solid {
  if (depth > MAX_DEPTH) throw new Error(`${path}: tarif çok derin`);
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path}: nesne bekleniyordu`);
  }
  const s = value as Record<string, unknown>;
  switch (s.kind) {
    case "box":
      if (!isVec(s.size, 3) || (s.size as number[]).some((n) => n <= 0)) {
        throw new Error(`${path}.size: üç pozitif sayı olmalı`);
      }
      return s as unknown as Solid;
    case "cylinder":
      if (!isNum(s.radius) || s.radius <= 0) throw new Error(`${path}.radius: pozitif olmalı`);
      if (!isNum(s.height) || s.height <= 0) throw new Error(`${path}.height: pozitif olmalı`);
      if (s.segments !== undefined && (!isNum(s.segments) || s.segments < 3)) {
        throw new Error(`${path}.segments: en az 3 olmalı`);
      }
      return s as unknown as Solid;
    case "sphere":
      if (!isNum(s.radius) || s.radius <= 0) throw new Error(`${path}.radius: pozitif olmalı`);
      if (s.segments !== undefined && (!isNum(s.segments) || s.segments < 4)) {
        throw new Error(`${path}.segments: en az 4 olmalı`);
      }
      return s as unknown as Solid;
    case "extrude":
    case "revolve":
      if (s.kind === "extrude" && (!isNum(s.height) || s.height <= 0)) throw new Error(`${path}.height: pozitif olmalı`);
      if (s.kind === "revolve" && (!isNum(s.angle) || s.angle <= 0 || s.angle > 360)) {
        throw new Error(`${path}.angle: 0 ile 360 arasında olmalı`);
      }
      if (s.kind === "revolve" && s.segments !== undefined && (!isNum(s.segments) || s.segments < 3)) {
        throw new Error(`${path}.segments: en az 3 olmalı`);
      }
      if (s.fillRule !== undefined && s.fillRule !== "Positive" && s.fillRule !== "EvenOdd") {
        throw new Error(`${path}.fillRule: Positive | EvenOdd olmalı`);
      }
      if (
        !Array.isArray(s.polygons) ||
        s.polygons.length === 0 ||
        !s.polygons.every(
          (poly) => Array.isArray(poly) && poly.length >= 3 && poly.every((p) => isVec(p, 2)),
        )
      ) {
        throw new Error(`${path}.polygons: en az 3 noktalı [x, y] listeleri olmalı`);
      }
      return s as unknown as Solid;
    case "boolean":
      if (s.op !== "union" && s.op !== "subtract" && s.op !== "intersect") {
        throw new Error(`${path}.op: union | subtract | intersect olmalı`);
      }
      if (!Array.isArray(s.children) || s.children.length === 0) {
        throw new Error(`${path}.children: en az bir çocuk olmalı`);
      }
      s.children.forEach((c, i) => validateSolid(c, `${path}.children[${i}]`, depth + 1));
      return s as unknown as Solid;
    case "transform":
      if (s.matrix !== undefined && !isVec(s.matrix, 16)) {
        throw new Error(`${path}.matrix: 16 sayılık 4×4 matris olmalı`);
      }
      if (s.translate !== undefined && !isVec(s.translate, 3)) {
        throw new Error(`${path}.translate: [x, y, z] olmalı`);
      }
      if (s.rotate !== undefined && !isVec(s.rotate, 3)) {
        throw new Error(`${path}.rotate: [x, y, z] derece olmalı`);
      }
      validateSolid(s.child, `${path}.child`, depth + 1);
      return s as unknown as Solid;
    default:
      throw new Error(`${path}.kind: bilinmeyen tür ${JSON.stringify(s.kind)}`);
  }
}

/** Önbellek anahtarı: aynı tarif → aynı anahtar. */
export function solidKey(solid: Solid): string {
  return JSON.stringify(solid);
}
