import { describe, expect, it } from "vitest";
import { evaluateExpression, evaluateInput, plainNumber, referencedNames, resolveParameters, validateParameterName } from "../../src/core/expr";

const ev = (s: string, scope: Record<string, number> = {}) => evaluateExpression(s, scope);

describe("ifade değerlendirme", () => {
  it("dört işlem, öncelik ve parantez", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("10 / 4")).toBe(2.5);
    expect(ev("10 % 4")).toBe(2);
    expect(ev("2 - 3 - 4")).toBe(-5); // soldan bağlar
    expect(ev("100 / 10 / 5")).toBe(2);
  });

  it("üs sağdan bağlar ve tekli eksiden güçlüdür", () => {
    expect(ev("2 ^ 3 ^ 2")).toBe(512);
    expect(ev("-2 ^ 2")).toBe(-4);
    expect(ev("2 ^ -1")).toBe(0.5);
    expect(ev("--3")).toBe(3);
  });

  it("parametre adları, Türkçe harfler ve sabitler", () => {
    expect(ev("genişlik / 2 + çap", { genişlik: 40, çap: 3 })).toBe(23);
    expect(ev("2 * pi * r", { r: 1 })).toBeCloseTo(2 * Math.PI, 12);
    expect(ev("e")).toBeCloseTo(Math.E, 12);
  });

  it("işlevler: açılar derece cinsinden", () => {
    expect(ev("sin(30)")).toBeCloseTo(0.5, 12);
    expect(ev("cos(60)")).toBeCloseTo(0.5, 12);
    expect(ev("atan2(1, 1)")).toBeCloseTo(45, 9);
    expect(ev("sqrt(16) + abs(-2)")).toBe(6);
    expect(ev("min(3, 1, 2) + max(4, 9)")).toBe(10);
    expect(ev("round(2.6) + floor(2.6) + ceil(2.2)")).toBe(8);
    expect(ev("pow(2, 10)")).toBe(1024);
    expect(ev("ln(e) + log(100)")).toBeCloseTo(3, 12);
  });

  it("onluk sayılar ve bilimsel gösterim", () => {
    expect(ev("1.5 + .5")).toBe(2);
    expect(ev("1e3 + 2E-1")).toBeCloseTo(1000.2, 9);
  });

  it("hatalar anlaşılır: bilinmeyen ad, sıfıra bölme, söz dizimi, işlev argümanı", () => {
    expect(() => ev("x + 1")).toThrow(/Bilinmeyen parametre: "x"/);
    expect(() => ev("1 / 0")).toThrow(/Sıfıra bölme/);
    expect(() => ev("1 +")).toThrow(/yarım kaldı/);
    expect(() => ev("(1 + 2")).toThrow(/"\)" bekleniyordu/);
    expect(() => ev("1 2")).toThrow(/Beklenmeyen/);
    expect(() => ev("3 $ 4")).toThrow(/Beklenmeyen karakter/);
    expect(() => ev("sqrt()")).toThrow(/bağımsız değişken/);
    expect(() => ev("foo(1)")).toThrow(/Bilinmeyen işlev/);
    expect(() => ev("sqrt(-1)")).toThrow(/geçerli bir sayı değil/);
    expect(() => ev("1..2")).toThrow();
  });

  it("referencedNames sabitleri ve işlevleri saymaz; tekrarsızdır", () => {
    expect(referencedNames("a + b * a + pi + sin(c)").sort()).toEqual(["a", "b", "c"]);
    expect(referencedNames("12")).toEqual([]);
  });

  it("evaluateInput: düz sayı mı ifade mi; virgüllü ondalık", () => {
    expect(evaluateInput("12.5", {})).toEqual({ value: 12.5 });
    expect(evaluateInput("2,5", {})).toEqual({ value: 2.5 });
    expect(evaluateInput(" -3 ", {})).toEqual({ value: -3 });
    expect(evaluateInput("w / 2", { w: 40 })).toEqual({ value: 20, expr: "w / 2" });
    expect(() => evaluateInput("  ", {})).toThrow(/boş/);
    expect(plainNumber("1e3")).toBe(1000);
    expect(plainNumber("w")).toBeNull();
  });
});

describe("parametre tablosu", () => {
  it("birbirine başvuran parametreler sırasız tanımlansa da çözülür", () => {
    const { values, errors } = resolveParameters([
      { name: "c", expr: "a + b" },
      { name: "a", expr: "10" },
      { name: "b", expr: "a * 2" },
    ]);
    expect(errors).toEqual({});
    expect(values).toEqual({ a: 10, b: 20, c: 30 });
  });

  it("döngü, bilinmeyen başvuru ve bağımlı hata parametre başına bildirilir", () => {
    const { values, errors } = resolveParameters([
      { name: "a", expr: "b + 1" },
      { name: "b", expr: "a + 1" },
      { name: "c", expr: "yok * 2" },
      { name: "d", expr: "c + 1" },
      { name: "ok", expr: "5" },
    ]);
    expect(errors.a ?? errors.b).toMatch(/Döngüsel başvuru/);
    expect(errors.c).toMatch(/Bilinmeyen parametre: "yok"/);
    expect(errors.d).toMatch(/"c" geçersiz/);
    expect(values.ok).toBe(5);
    expect(values.c).toBeUndefined();
  });

  it("ad doğrulama", () => {
    expect(validateParameterName("genişlik_2")).toBeNull();
    expect(validateParameterName("_x")).toBeNull();
    expect(validateParameterName("2x")).toMatch(/harf/);
    expect(validateParameterName("a b")).toMatch(/harf/);
    expect(validateParameterName("sin")).toMatch(/ayrılmış/);
    expect(validateParameterName("PI")).toMatch(/ayrılmış/);
    expect(validateParameterName("")).toMatch(/harf/);
  });
});
