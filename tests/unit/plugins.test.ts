import { describe, expect, it } from "vitest";
import { validateManifest } from "../../src/plugins/manifest";
import { createApp, inlinePlugin, pluginFromDisk } from "./helpers";

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("validateManifest", () => {
  const ok = { name: "demo", version: "1.0.0", main: "index.js" };

  it("geçerli manifesti kabul eder", () => {
    expect(validateManifest(pluginFromDisk("gear").manifest).name).toBe("gear");
    expect(validateManifest(ok)).toEqual(ok);
  });

  it.each([
    [{ ...ok, name: "Büyük Harf" }, /name/],
    [{ ...ok, version: "" }, /version/],
    [{ ...ok, main: undefined }, /main/],
    [{ ...ok, contributes: { commands: [{ id: "baska.x", title: "x" }] } }, /demo\./],
    [{ ...ok, contributes: { commands: [{ id: "demo.x", title: "x" }, { id: "demo.x", title: "y" }] } }, /iki kez/],
    [{ ...ok, contributes: { primitives: [{ type: "demo.s", label: "S", params: { a: { label: "A" } } }] } }, /default/],
    [{ ...ok, activationEvents: ["onSomething"] }, /etkinleşme/],
  ])("hatalı manifesti reddeder (%#)", (m, msg) => {
    expect(() => validateManifest(m)).toThrow(msg);
  });
});

describe("PluginHost + örnek dişli eklentisi", () => {
  it("komut ve şekil katkılarını etkinleştirmeden kaydeder", async () => {
    const { app } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    expect(app.commands.get("gear.create")?.category).toBe("Dişli");
    expect(app.commands.has("shape.add.gear.spur")).toBe(true);
    expect(app.primitives.get("gear.spur")?.label).toBe("Düz Dişli");
    expect(app.host.list()[0].state).toBe("inactive");
  });

  it("komut çalışınca eklentiyi başlatır, girdiyi alır ve dişliyi üretir", async () => {
    const { app, ui } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    ui.inputs.push({ teeth: 12, module: 2, thickness: 5, bore: 6 });
    await app.commands.execute("gear.create");
    expect(app.host.list()[0].state).toBe("active");
    const [gear] = app.document.all();
    expect(gear.type).toBe("gear.spur");
    expect(gear.params).toEqual({ teeth: 12, module: 2, thickness: 5, bore: 6 });
    expect(gear.solid?.kind).toBe("extrude");
    const mesh = app.meshes.get(gear.id)!;
    // Hacim: bölüm dairesi alanı civarında, delik çıkarılmış.
    const pitchArea = Math.PI * 12 ** 2;
    expect(mesh.volume).toBeGreaterThan(pitchArea * 5 * 0.8);
    expect(mesh.volume).toBeLessThan(pitchArea * 5 * 1.2);
    expect(ui.messages.at(-1)?.text).toMatch(/Düz Dişli 1 eklendi/);
  });

  it("parametre değişince eklenti şeklini yeniden üretir; geri alma tek adımdır", async () => {
    const { app } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    const gear = await app.addPrimitive("gear.spur", { teeth: 10 });
    const before = app.meshes.get(gear.id)!.volume;
    await app.updateFeature(gear.id, { params: { teeth: 30 } });
    expect(app.document.get(gear.id)!.params.teeth).toBe(30);
    expect(app.meshes.get(gear.id)!.volume).toBeGreaterThan(before * 4);
    app.document.undo();
    expect(app.meshes.get(gear.id)!.volume).toBeCloseTo(before);
  });

  it("dişli profili doğru: uç dairesine ulaşır ve dişler uca doğru incelir", async () => {
    const { app } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    const teeth = 16;
    const module = 2;
    const gear = await app.addPrimitive("gear.spur", { teeth, module, bore: 0 });
    const solid = gear.solid as { kind: "extrude"; polygons: [number, number][][] };
    expect(solid.polygons).toHaveLength(1);
    const pts = solid.polygons[0].map(([x, y]) => ({ r: Math.hypot(x, y), a: Math.atan2(y, x) }));
    const pitchR = (module * teeth) / 2;
    const tipR = pitchR + module;
    expect(Math.max(...pts.map((p) => p.r))).toBeCloseTo(tipR, 6);
    // İlk diş (merkezi 0 rad) üzerinde açısal genişlik.
    const firstTooth = pts.filter((p) => Math.abs(p.a) < Math.PI / teeth);
    const span = (pred: (r: number) => boolean) =>
      Math.max(...firstTooth.filter((p) => pred(p.r)).map((p) => Math.abs(p.a)));
    const tipSpan = span((r) => r > tipR - 1e-6);
    const pitchSpan = span((r) => r < pitchR);
    expect(tipSpan).toBeLessThan(pitchSpan);
    // Bölüm dairesinde diş kalınlığı ≈ diş adımının yarısı (π/(2z) rad yarı açı).
    expect(pitchSpan).toBeGreaterThan(Math.PI / (2 * teeth));
  });

  it("parametreleri manifest sınırlarına çeker", async () => {
    const { app } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    const gear = await app.addPrimitive("gear.spur", { teeth: 2.6 });
    expect(gear.params.teeth).toBe(6);
  });

  it("eklenti yüklü değilken açılan dosya kayıtlı geometriyi gösterir", async () => {
    const { app: withPlugin } = await createApp();
    await withPlugin.loadPlugins([pluginFromDisk("gear")]);
    await withPlugin.addPrimitive("gear.spur");
    const text = withPlugin.document.serialize();

    const { app, ui } = await createApp();
    app.openText(text, "disli.sugar");
    expect(ui.messages[0].text).toMatch(/gear\.spur/);
    expect(app.meshes.size).toBe(1);
  });
});

describe("PluginHost dayanıklılık", () => {
  it("activate atan eklentiyi 'failed' yapar ve sonra yeniden dener", async () => {
    const { app } = await createApp();
    await app.loadPlugins([
      inlinePlugin(
        { name: "bozuk", contributes: { commands: [{ id: "bozuk.calis", title: "Çalış" }] } },
        `exports.activate = () => { throw new Error("patladım"); };`,
      ),
    ]);
    await expect(app.commands.execute("bozuk.calis")).rejects.toThrow(/patladım/);
    expect(app.host.list()[0]).toMatchObject({ state: "failed", error: "patladım" });
    await expect(app.commands.execute("bozuk.calis")).rejects.toThrow(/patladım/);
  });

  it("yanıt vermeyen activate zaman aşımına uğrar", async () => {
    const { app } = await createApp({ activateTimeoutMs: 50 });
    await app.loadPlugins([
      inlinePlugin(
        { name: "yavas", contributes: { commands: [{ id: "yavas.x", title: "X" }] } },
        `exports.activate = () => new Promise(() => {});`,
      ),
    ]);
    await expect(app.commands.execute("yavas.x")).rejects.toThrow(/yanıt vermedi/);
  });

  it("eklentinin ürettiği geçersiz tarifi reddeder", async () => {
    const { app } = await createApp();
    await app.loadPlugins([
      inlinePlugin(
        { name: "kotu", contributes: { primitives: [{ type: "kotu.s", label: "S", params: {} }] } },
        `exports.activate = (s) => s.primitives.register("kotu.s", () => ({ kind: "box", size: [1, 0, 1] }));`,
      ),
    ]);
    await expect(app.addPrimitive("kotu.s")).rejects.toThrow(/size/);
    expect(app.document.all()).toHaveLength(0);
  });

  it("aynı adlı eklentiyi ve çakışan komutu reddeder, diğerlerini yükler", async () => {
    const { app, ui } = await createApp();
    await app.loadPlugins([
      pluginFromDisk("gear"),
      pluginFromDisk("gear"),
      inlinePlugin({ name: "iyi" }, `exports.activate = () => {};`),
    ]);
    expect(app.host.list().map((p) => p.manifest.name)).toEqual(["gear", "iyi"]);
    expect(ui.messages.some((m) => /zaten yüklü/.test(m.text))).toBe(true);
  });

  it("eklenti API'si ile belgeyi okur ve değiştirir; onStartup ile hemen başlar", async () => {
    const { app } = await createApp();
    await app.loadPlugins([
      inlinePlugin(
        { name: "otomatik", activationEvents: ["onStartup"] },
        `exports.activate = async (s) => {
           const a = await s.document.addPrimitive("box", { width: 10, depth: 10, height: 10 });
           const b = await s.document.addPrimitive("cylinder", { radius: 3, height: 10 });
           const r = await s.document.boolean("subtract", a.id, b.id);
           await s.document.updateFeature(r.id, { name: "Delikli kutu" });
           s.commands.register("otomatik.say", async () => (await s.document.getFeatures()).length);
         };`,
      ),
    ]);
    await flush();
    const names = app.document.all().map((f) => f.name);
    expect(names).toContain("Delikli kutu");
    expect(app.document.roots()).toHaveLength(1);
    expect(await app.commands.execute("otomatik.say")).toBe(3);
  });

  it("durdurulan eklenti tekrar kullanılınca yeniden başlar", async () => {
    const { app } = await createApp();
    await app.loadPlugins([pluginFromDisk("gear")]);
    await app.addPrimitive("gear.spur");
    app.host.stop("gear");
    expect(app.host.list()[0].state).toBe("stopped");
    await app.addPrimitive("gear.spur");
    expect(app.host.list()[0].state).toBe("active");
  });
});

describe("PluginHost zaman aşımı", () => {
  it("takılan şekil üreticisi eklentiyi durdurur; sonraki kullanımda yeniden başlar", async () => {
    const { app } = await createApp({ buildTimeoutMs: 50 });
    await app.loadPlugins([
      inlinePlugin(
        { name: "takilan", contributes: { primitives: [{ type: "takilan.s", label: "S", params: {} }] } },
        `let ilk = true;
         exports.activate = (s) => s.primitives.register("takilan.s", () => {
           if (ilk) { ilk = false; return new Promise(() => {}); }
           return s.solids.box([1, 1, 1]);
         });`,
      ),
    ]);
    await expect(app.addPrimitive("takilan.s")).rejects.toThrow(/yanıt vermedi/);
    expect(app.host.list()[0].state).toBe("failed");
    // Yeni işçi = yeni durum: ilk çağrı yine takılır (eklenti kodu baştan yüklenir).
    await expect(app.addPrimitive("takilan.s")).rejects.toThrow(/yanıt vermedi/);
  });
});
