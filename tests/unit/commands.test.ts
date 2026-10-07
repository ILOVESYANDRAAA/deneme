import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, fuzzyScore } from "../../src/core/commands";

describe("CommandRegistry", () => {
  it("kaydeder, çalıştırır ve kaldırır", async () => {
    const reg = new CommandRegistry();
    const fn = vi.fn(() => 42);
    const d = reg.register({ id: "a.b", title: "AB" }, fn);
    expect(await reg.execute("a.b", 1)).toBe(42);
    expect(fn).toHaveBeenCalledWith(1);
    expect(() => reg.register({ id: "a.b", title: "x" }, fn)).toThrow();
    d.dispose();
    expect(reg.has("a.b")).toBe(false);
    await expect(reg.execute("a.b")).rejects.toThrow(/bulunamadı/);
  });

  it("run() hataları olay olarak bildirir", async () => {
    const reg = new CommandRegistry();
    const failures: unknown[] = [];
    reg.onDidFail.on((f) => failures.push(f.error));
    reg.register({ id: "x", title: "x" }, () => {
      throw new Error("boom");
    });
    await reg.run("x");
    expect((failures[0] as Error).message).toBe("boom");
  });

  it("kısayolları eşleştirir (Mac'te Cmd = Ctrl)", () => {
    const reg = new CommandRegistry();
    reg.register({ id: "palette", title: "P", keybinding: "Ctrl+Shift+P" }, () => {});
    reg.register({ id: "del", title: "D", keybinding: "Delete" }, () => {});
    const base = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(reg.findByKeybinding({ ...base, key: "P", ctrlKey: true, shiftKey: true })).toBe("palette");
    expect(reg.findByKeybinding({ ...base, key: "p", metaKey: true, shiftKey: true })).toBe("palette");
    expect(reg.findByKeybinding({ ...base, key: "p", ctrlKey: true })).toBeUndefined();
    expect(reg.findByKeybinding({ ...base, key: "Delete" })).toBe("del");
  });
});

describe("fuzzyScore", () => {
  it("doğrudan eşleşmeyi öne alır, sıralı harfleri kabul eder", () => {
    expect(fuzzyScore("kutu", "Şekil: Kutu Ekle")).toBeLessThan(fuzzyScore("ke", "Şekil: Kutu Ekle")!);
    expect(fuzzyScore("ke", "Şekil: Kutu Ekle")).not.toBeNull();
    expect(fuzzyScore("zz", "Kaydet")).toBeNull();
    expect(fuzzyScore("İ", "iptal")).toBe(0);
  });
});
