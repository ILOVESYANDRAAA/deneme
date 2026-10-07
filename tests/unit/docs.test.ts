import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../src/plugins/manifest";
import { createApp } from "./helpers";

/** Rehberdeki örnek eklenti gerçekten çalışmalı: kod blokları doğrudan dosyadan alınır. */
function guideBlocks(lang: string): string[] {
  const md = readFileSync(resolve(__dirname, "../../docs/eklenti-yazma.md"), "utf8");
  return [...md.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1]);
}

describe("docs/eklenti-yazma.md", () => {
  it("flanş örneği yüklenir, şekil üretir ve komutu çalışır", async () => {
    const manifest = JSON.parse(guideBlocks("json")[0]) as PluginManifest;
    const code = guideBlocks("js")[0];
    const { app, ui } = await createApp();
    await app.loadPlugins([{ manifest, code, location: "user" }]);
    expect(ui.messages.filter((m) => m.kind === "error")).toEqual([]);

    const flans = await app.addPrimitive("flans.flans");
    const mesh = app.meshes.get(flans.id)!;
    const r = 40;
    const expected = Math.PI * (r ** 2 - (r * 0.4) ** 2 - 4 * (r * 0.08) ** 2) * 8;
    expect(mesh.volume).toBeGreaterThan(expected * 0.97);
    expect(mesh.volume).toBeLessThan(expected * 1.01);

    await app.commands.execute("flans.merhaba");
    expect(ui.messages.at(-1)?.text).toBe("Flanş Üretici: Çizimde 1 özellik var");
  });

  it("belge API örneği çalışır", async () => {
    const snippet = guideBlocks("js")[1];
    const { app, ui } = await createApp();
    ui.inputs.push({ en: 30 });
    await app.loadPlugins([
      {
        manifest: { name: "ornek", version: "1.0.0", main: "index.js", activationEvents: ["onStartup"] },
        code: `exports.activate = async (sugarcad) => {\n${snippet}\n};`,
        location: "user",
      },
    ]);
    await new Promise((r) => setTimeout(r, 30));
    const [root] = app.document.roots();
    expect(root.name).toBe("Delikli plaka");
    expect(root.position).toEqual([0, 0, 5]);
    expect(app.host.list()[0].state).toBe("active");
  });
});
