import { expect, test, type Page } from "@playwright/test";

// Ekran görüntüleri inceleme için; CI hata durumunda bunları yükler.
const S = "test-results/ekran";

type Vec2 = [number, number];

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  return errors;
}

/** Eskiz düzlemindeki (u, v) noktasına gerçek fare tıklaması. */
async function clickSketch(page: Page, p: Vec2, options: { double?: boolean } = {}) {
  const pos = await page.evaluate((p) => {
    const ui = (window as any).sugarcadUi;
    return ui.viewport.screenPoint(ui.sketcher.plane, 0, p);
  }, p);
  await page.mouse.move(pos.x, pos.y);
  if (options.double) await page.mouse.dblclick(pos.x, pos.y);
  else await page.mouse.click(pos.x, pos.y);
}

/** Özellik türü ve (eskizlerde) eğri sayısı. */
const features = (page: Page) =>
  page.evaluate(() => (window as any).sugarcad.document.all().map((f: any) => ({ type: f.type, entities: f.sketchData?.curves.length })));
const sketchData = (page: Page, index = 0) => page.evaluate((i) => (window as any).sugarcad.document.all()[i].sketchData, index);
const volumeOf = (page: Page, index: number) =>
  page.evaluate((i) => {
    const app = (window as any).sugarcad;
    return app.meshes.get(app.document.all()[i].id)?.volume ?? 0;
  }, index);

test("hazır şekiller arayüzde yok, eskiz araçları var", async ({ page }) => {
  const errors = await open(page);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  for (const gone of ["Kutu", "Silindir", "Küre", "Düz Dişli"]) {
    await expect(toolbar.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  }
  for (const name of ["Eskiz", "Ekstrüzyon", "Döndürme"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("combobox", { name: "Komut ara" }).fill("kutu ekle");
  await expect(page.locator(".palette li")).toHaveText(["Eşleşen komut yok"]);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("XY eskizi: dikdörtgen + daire → delikli plaka ekstrüzyonu", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Eskiz", exact: true }).click();
  await expect(page.getByRole("group", { name: "Eskiz düzlemi" })).toBeVisible();
  await page.screenshot({ path: `${S}/01-duzlem-sec.png` });
  await page.getByRole("button", { name: "XY (Üst)" }).click();

  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  await expect(toolbar.getByRole("button", { name: "Eskizi Bitir" })).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · XY (Üst)");

  await page.keyboard.press("r");
  await expect(toolbar.getByRole("button", { name: "Dikdörtgen" })).toHaveAttribute("aria-pressed", "true");
  await clickSketch(page, [-20, -10]);
  await clickSketch(page, [20, 10]);
  await page.keyboard.press("c");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [5, 0]);
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 5 }]);
  await expect(page.locator(".properties")).toContainText("5 öğe · 2 kapalı profil");
  await page.screenshot({ path: `${S}/02-eskiz.png` });

  await toolbar.getByRole("button", { name: "Eskizi Bitir" }).click();
  await toolbar.getByRole("button", { name: "Ekstrüzyon" }).click();
  await expect(page.locator(".tree-row").first()).toHaveText("Ekstrüzyon 1");
  await expect(page.locator(".tree-row.consumed")).toHaveText(["Eskiz 1"]);

  const distance = page.getByLabel("Mesafe (− ters yön)");
  await distance.fill("8");
  await distance.press("Enter");
  await expect.poll(() => volumeOf(page, 1)).toBeCloseTo((40 * 20 - Math.PI * 25) * 8, -1);
  await page.locator(".navbar").getByRole("button", { name: "Ana görünüm" }).click();
  await page.screenshot({ path: `${S}/03-ekstruzyon.png` });
  expect(errors).toEqual([]);
});

test("XZ düzlemine tıklayıp çizgiyle üçgen çiz, döndür", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await expect(page.getByRole("group", { name: "Eskiz düzlemi" })).toBeVisible();
  // XZ (ön) düzlem karesinin ortasına tıkla: dünyada (25, 0, 25)
  const pos = await page.evaluate(() => (window as any).sugarcadUi.viewport.screenPoint("XZ", 0, [25, 25]));
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.click(pos.x, pos.y);
  await expect(page.locator(".statusbar")).toContainText("Eskiz · XZ (Ön)");

  await page.keyboard.press("l");
  for (const p of [[5, 0], [15, 0], [5, 20]] as Vec2[]) await clickSketch(page, p);
  await clickSketch(page, [5, 0]); // ilk noktaya tıklamak şekli kapatır
  await expect.poll(async () => (await sketchData(page)).points.map((p: any) => [p.x, p.y])).toEqual([[5, 0], [15, 0], [5, 20]]);
  const tri = await sketchData(page);
  expect(tri.curves.map((c: any) => c.kind)).toEqual(["line", "line", "line"]);
  // Üçgenin yatay (5,0)-(15,0) ve dikey (5,20)-(5,0) kenarlarına otomatik kısıt eklenir
  expect(tri.constraints.map((k: any) => k.type).sort()).toEqual(["horizontal", "vertical"]);

  await page.keyboard.press("Control+Enter");
  await page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: "Döndürme" }).click();
  // Pappus: alan (100) × 2π × ağırlık merkezi uzaklığı (25/3)
  await expect.poll(() => volumeOf(page, 1)).toBeCloseTo(100 * 2 * Math.PI * (25 / 3), -2);
  await page.screenshot({ path: `${S}/04-dondurme.png` });

  // Açı sınırı 360: büyük değer kırpılır ve alana yansır
  const angle = page.getByLabel("Açı (°)");
  await angle.fill("500");
  await angle.press("Enter");
  await expect(angle).toHaveValue("360");
  expect(errors).toEqual([]);
});

test("eskiz modunda Esc, geri al ve Delete güvenli çalışır", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Eskiz", exact: true }).click();
  await page.getByRole("button", { name: "YZ (Sağ)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await page.keyboard.press("Escape"); // yarım dikdörtgen iptal
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [10, 10]);
  await clickSketch(page, [20, 0]);
  await clickSketch(page, [30, 10]);
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 8 }]);
  await page.keyboard.press("Delete"); // eskizi silmemeli
  await page.keyboard.press("Control+z");
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 4 }]);
  await page.keyboard.press("Escape"); // aracı bırak
  await page.keyboard.press("Escape"); // eskizden çık
  await expect(page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: "Eskiz", exact: true })).toBeVisible();
  // Eskiz sonradan düzenlenebilir
  await page.getByRole("button", { name: "Eskizi Düzenle" }).click();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · YZ (Sağ)");
  // Düzenlerken düzlem değiştirilirse çizim yeni düzleme geçer
  await page.getByLabel("Düzlem", { exact: true }).selectOption("XY");
  await expect(page.locator(".statusbar")).toContainText("Eskiz · XY (Üst)");
  await page.screenshot({ path: `${S}/05-duzlem-degisti.png` });
});

test("ekstrüzyon 3D görünümde tıklanarak seçilir ve silinir", async ({ page }) => {
  await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [-10, -10]);
  await clickSketch(page, [10, 10]);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("e");
  await expect.poll(() => volumeOf(page, 1)).toBeCloseTo(4000, 0);
  const box = (await page.locator("canvas").boundingBox())!;
  await page.locator("canvas").click({ position: { x: box.width / 2, y: 30 } });
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveCount(0);
  const center = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    return ui.viewport.screenPosition((window as any).sugarcad.document.all()[1].id);
  });
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveText("Ekstrüzyon 1");
  await page.keyboard.press("Delete");
  await expect(page.locator(".tree-row")).toHaveText(["Eskiz 1"]);
});

/** Panel başlığını tutup ekranda bir noktaya sürükler. */
async function dragPanel(page: Page, id: string, to: { x: number; y: number }) {
  const head = page.locator(`[data-panel=${id}] .fpanel-title`);
  const b = (await head.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 30, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test("paneller sürüklenir, öbür kenara yanaşır, daraltılır ve kapatılıp açılır", async ({ page }) => {
  const errors = await open(page);
  const stage = (await page.locator(".stage").boundingBox())!;
  const browser = page.locator("[data-panel=browser]");
  await expect(page.locator(".dock.left [data-panel=browser]")).toBeVisible();

  // Sağ kenara bırakınca sağa yanaşır
  await dragPanel(page, "browser", { x: stage.x + stage.width - 12, y: stage.y + 300 });
  await expect(page.locator(".dock.right [data-panel=browser]")).toBeVisible();

  // Ortaya bırakınca serbest (yüzer) kalır ve yerleşim yeniden açılışta korunur
  await dragPanel(page, "browser", { x: stage.x + 500, y: stage.y + 200 });
  await expect(browser).toHaveClass(/floating/);
  const before = (await browser.boundingBox())!;
  await page.reload();
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  await expect(browser).toHaveClass(/floating/);
  const after = (await browser.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  await page.screenshot({ path: `${S}/06-yuzen-panel.png` });

  // Daralt / genişlet
  await page.getByRole("button", { name: "Tarayıcı panelini daralt" }).click();
  await expect(browser.locator(".fpanel-body")).toBeHidden();
  await page.getByRole("button", { name: "Tarayıcı panelini daralt" }).click();
  await expect(browser.locator(".fpanel-body")).toBeVisible();

  // Kapat ve üst çubuktan yeniden aç
  await page.getByRole("button", { name: "Tarayıcı panelini kapat" }).click();
  await expect(browser).toBeHidden();
  const toggle = page.locator(".appbar").getByRole("button", { name: "Tarayıcı" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(browser).toBeVisible();

  // Sola geri yanaştır
  await dragPanel(page, "browser", { x: stage.x + 6, y: stage.y + 100 });
  await expect(page.locator(".dock.left [data-panel=browser]")).toBeVisible();

  // Genişlik kenardan ayarlanır
  const w0 = (await browser.boundingBox())!.width;
  const edge = (await browser.locator(".fpanel-resize").boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 40);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 40, { steps: 4 });
  await page.mouse.up();
  expect((await browser.boundingBox())!.width).toBeGreaterThan(w0 + 60);
  expect(errors).toEqual([]);
});


test("eskiz: ölçü yazarak dikdörtgen, kanal, seçip silme ve köşe yuvarlatma", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await expect(page.locator("[data-panel=sketchPalette]")).toBeVisible();

  // Dikdörtgen: ilk köşe, sonra klavyeden 40 Tab 20 Enter
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await page.keyboard.type("40");
  await expect(page.getByRole("group", { name: "Ölçü girişi" })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sketchData(page)).points.map((p: any) => [p.x, p.y])).toEqual([[0, 0], [40, 0], [40, 20], [0, 20]]);
  const typed = await sketchData(page);
  expect(typed.curves.map((c: any) => c.kind)).toEqual(["line", "line", "line", "line"]);
  expect(typed.constraints.map((k: any) => k.type).sort()).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);

  // Kanal: iki merkez ve genişlik
  await page.keyboard.press("t");
  await clickSketch(page, [10, 30]);
  await clickSketch(page, [30, 30]);
  await clickSketch(page, [30, 35]);
  // Kanal: iki çizgi + iki yay (4 eğri), toplam 8; yaylar teğet kısıtlı
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(8);
  const slot = await sketchData(page);
  expect(slot.curves.filter((c: any) => c.kind === "arc")).toHaveLength(2);
  expect(slot.constraints.filter((k: any) => k.type === "tangent")).toHaveLength(4);
  await page.screenshot({ path: `${S}/07-olcu-yazma.png` });

  // Araç bırakılınca öğeye tıklayıp seç, Delete ile sil
  await page.keyboard.press("Escape");
  await clickSketch(page, [20, 40]); // kanalın üst kenarı (merkez çizgisi 30, yarıçap 5... üst kenar 35)
  await clickSketch(page, [20, 35]);
  await expect(page.locator("[data-panel=sketchPalette]")).toContainText("1 öğe seçili");
  await page.keyboard.press("Delete");
  // Kanalın üst kenarı silindi (tek eğri); geri kalanı yerinde
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(7);

  // Köşe yuvarlatma: şeritteki DEĞİŞTİR grubundan
  await page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: "Köşe Yuvarlatma" }).click();
  await clickSketch(page, [40, 20]);
  // Köşe yuvarlatma: yeni yay + yarıçap ölçüsü 2 + iki teğet kısıt; kanalın 2 yayına eklenir (3 yay)
  await expect.poll(async () => (await sketchData(page)).curves.filter((c: any) => c.kind === "arc").length).toBe(3);
  const filleted = await sketchData(page);
  expect(filleted.constraints.some((k: any) => k.type === "radius" && k.value === 2)).toBe(true);

  // Yay menüden seçilir; çizgi + yay kapalı profil oluşturur
  await page.getByRole("button", { name: "OLUŞTUR menüsü" }).click();
  await page.getByRole("menuitem", { name: "Yay" }).hover();
  await page.getByRole("menuitem", { name: "3 Noktalı Yay" }).click();
  await clickSketch(page, [-20, 0]);
  await clickSketch(page, [-10, 0]);
  await clickSketch(page, [-15, 5]);
  await page.keyboard.press("l");
  await clickSketch(page, [-20, 0]);
  await clickSketch(page, [-10, 0]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".properties")).toContainText("2 kapalı profil");
  await page.screenshot({ path: `${S}/08-yay-profil.png` });
  expect(errors).toEqual([]);
});

test("Kes işlemi, ayna, ölçüm ve kesit analizi", async ({ page }) => {
  const errors = await open(page);
  // Plaka ve üstüne kesilecek daire (API ile hızlı kurulum)
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    const m = (window as any).sugarcadModel;
    const s1 = app.createSketch("XY");
    const e1 = new m.SketchEdit();
    m.buildRect(e1, [[0, 0], [40, 0], [40, 20], [0, 20]]);
    app.document.update(s1.id, { sketchData: e1.result() });
    app.addSketchFeature("extrude", s1.id);
    const s2 = app.createSketch("XY");
    const e2 = new m.SketchEdit();
    e2.circle(e2.point([20, 10]), 5);
    app.document.update(s2.id, { sketchData: e2.result() });
    app.addSketchFeature("extrude", s2.id);
  });
  await page.getByLabel("İşlem", { exact: true }).selectOption("cut");
  await expect(page.getByLabel("Hedef gövde")).toHaveValue("f2");
  await expect.poll(() => volumeOf(page, 3)).toBeCloseTo((800 - Math.PI * 25) * 10, -1);
  await expect(page.locator(".tree-row").first()).toHaveText("Ekstrüzyon 2");

  // Ayna: seçili gövdeyi YZ düzleminde aynala
  await page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: "Ayna" }).click();
  await expect.poll(() => volumeOf(page, 4)).toBeCloseTo((800 - Math.PI * 25) * 20, -1);

  // Ölç: iki köşe arası
  await page.keyboard.press("i");
  await expect(page.getByRole("dialog", { name: "Ölç" })).toBeVisible();
  for (const p of [[39.6, 0.4, 10], [39.6, 19.6, 10]]) {
    const pos = await page.evaluate((p) => (window as any).sugarcadUi.viewport.screenOf(p), p);
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.click(pos.x, pos.y);
  }
  // İmleç köşeye yakın: köşeye yapışır
  await expect(page.locator(".measure-result")).toHaveText("Mesafe: 20 mm");
  await page.screenshot({ path: `${S}/09-olc.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Ölç" })).toBeHidden();

  // Kesit analizi
  await page.locator(".navbar").getByRole("button", { name: "Kesit Analizi" }).click();
  await expect(page.getByRole("dialog", { name: "Kesit Analizi" })).toBeVisible();
  await page.getByLabel("Kesit düzlemi").selectOption("YZ");
  await page.screenshot({ path: `${S}/10-kesit.png` });
  await page.getByRole("button", { name: "Kesit Analizi kapat" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.section)).toBeNull();

  // Koyu tema
  await page.getByRole("button", { name: "Dosya menüsü" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Koyu tema" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `${S}/11-koyu-tema.png` });
  expect(errors).toEqual([]);
});

/** Eskiz düzleminde iki nokta arasında gerçek fare sürüklemesi. */
async function dragSketch(page: Page, from: Vec2, to: Vec2) {
  const [a, b] = await page.evaluate(
    ([f, t]) => {
      const ui = (window as any).sugarcadUi;
      return [ui.viewport.screenPoint(ui.sketcher.plane, 0, f), ui.viewport.screenPoint(ui.sketcher.plane, 0, t)];
    },
    [from, to] as [Vec2, Vec2],
  );
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

/** Eskizdeki noktaların sınırları (çözücü şekli yeniden konumlandırabildiği için tıklama noktaları buradan türetilir). */
const bounds = async (page: Page) => {
  const ps = (await sketchData(page)).points as { x: number; y: number }[];
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

const pts = async (page: Page) => (await sketchData(page)).points.map((p: any) => [p.x, p.y]);
const constraintTypes = async (page: Page) => (await sketchData(page)).constraints.map((k: any) => k.type).sort();

test("kısıt çözücü yüklenir; ölçü aracı, ölçü düzenleme, sabitleme ve tam tanımlı durum", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("body[data-solver=true]")).toBeAttached();
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [30, 20]);
  await expect.poll(() => constraintTypes(page)).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
  await expect(page.locator(".statusbar .dof")).toHaveText(/serbestlik/);

  // Ölçü aracı (D): üst kenarı seç → kutu açılır → 40 yaz
  await page.keyboard.press("d");
  await clickSketch(page, [15, 20]);
  const editor = page.getByRole("group", { name: "Ölçü" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox")).toHaveValue("30");
  await page.screenshot({ path: `${S}/12-olcu-kutusu.png` });
  await editor.getByRole("textbox").fill("40");
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
  await expect(page.locator(".sketch-notes .note.dim")).toHaveText(["40"]);
  let d = await sketchData(page);
  const top = d.curves.find((c: any) => c.kind === "line" && d.points.find((p: any) => p.id === c.p1).y === 20 && d.points.find((p: any) => p.id === c.p2).y === 20);
  expect(top).toBeTruthy();
  const w = Math.abs(d.points.find((p: any) => p.id === top.p2).x - d.points.find((p: any) => p.id === top.p1).x);
  expect(w).toBeCloseTo(40, 3);

  // Sağ kenar: uzunluk 25 (çözücü şekli kaydırmış olabilir; konum veriden okunur)
  let bb = await bounds(page);
  expect(bb.maxX - bb.minX).toBeCloseTo(40, 3);
  await clickSketch(page, [bb.maxX, (bb.minY + bb.maxY) / 2]);
  await editor.getByRole("textbox").fill("25");
  // Yazarken gelen yeniden çizimler (kamera, belge olayı) kutuyu ve yazılanı bozmamalı
  await page.evaluate(() => (window as any).sugarcadUi.sketcher.onDidChange.fire());
  await expect(editor.getByRole("textbox")).toHaveValue("25");
  await expect(editor.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sketch-notes .note.dim")).toHaveCount(2);

  // Sol alt köşeyi sabitle → tam tanımlı
  bb = await bounds(page);
  expect(bb.maxY - bb.minY).toBeCloseTo(25, 3);
  await page.keyboard.press("Escape"); // ölçü aracını bırak (ikinci Esc eskizden çıkardı)
  await clickSketch(page, [bb.minX, bb.minY]);
  await page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: /Kısıt: Sabit/ }).click();
  await expect(page.locator(".statusbar .dof")).toHaveText("Tam tanımlı");
  await page.screenshot({ path: `${S}/13-tam-tanimli.png` });

  // Ölçüyü etikete çift tıklayarak düzenle: 40 → 50 (sağ taraf kayar, sol alt sabit)
  await page.locator(".sketch-notes .note.dim", { hasText: "40" }).dblclick();
  await editor.getByRole("textbox").fill("50");
  await page.keyboard.press("Enter");
  await expect(page.locator(".sketch-notes .note.dim", { hasText: "50" })).toBeVisible();
  const xs = (await pts(page)).map((p: number[]) => p[0]).sort((a: number, b: number) => a - b);
  expect(xs[0]).toBeCloseTo(bb.minX, 3); // sabit köşe yerinden oynamadı
  expect(xs[3] - xs[0]).toBeCloseTo(50, 3);
  expect(xs[1]).toBeCloseTo(xs[0], 3);
  expect(xs[2]).toBeCloseTo(xs[3], 3);

  // Çelişen ölçü: aynı kenara 60 verilirse reddedilir ve hiçbir şey değişmez
  const before = (await sketchData(page)).constraints.length;
  await page.keyboard.press("d");
  await clickSketch(page, [bb.minX + 8, bb.maxY]); // ortada ölçü etiketi var, kenarın başka yerine tıkla
  await editor.getByRole("textbox").fill("60");
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast.error")).toContainText("çelişiyor");
  expect((await sketchData(page)).constraints.length).toBe(before);
  await expect(editor).toBeVisible(); // kutu açık kalır; düzeltilebilir
  await page.keyboard.press("Escape");

  // Palette listelenir ve oradan düzenlenir
  await expect(page.locator("[data-panel=sketchPalette] .palette-row[data-constraint]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("sürükleyerek düzenleme: kısıtlar korunur; kısıtlar menüden ve seçimle uygulanır", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("l");
  for (const p of [[0, 0], [20, 0], [10, 15]] as Vec2[]) await clickSketch(page, p);
  await clickSketch(page, [0, 0]); // kapat
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(3);
  expect(await constraintTypes(page)).toEqual(["horizontal"]); // sadece alt kenar eksene hizalı

  // Seçim aracında üst köşeyi sürükle: köşe imleci izler, alt kenar yatay kalır
  await page.keyboard.press("Escape");
  await dragSketch(page, [10, 15], [30, 25]);
  await expect.poll(async () => (await pts(page)).some((p: number[]) => Math.abs(p[0] - 30) < 0.6 && Math.abs(p[1] - 25) < 0.6)).toBe(true);
  let [a, b] = await page.evaluate(() => {
    const d = (window as any).sugarcad.document.all()[0].sketchData;
    const bottom = d.constraints.find((k: any) => k.type === "horizontal").refs[0];
    const line = d.curves.find((c: any) => c.id === bottom);
    return [line.p1, line.p2].map((id: string) => d.points.find((p: any) => p.id === id).y);
  });
  expect(a).toBeCloseTo(b, 3);

  // Alt kenarı sürükle: kenar yatay kalarak taşınır
  await dragSketch(page, [10, 0], [10, 6]);
  [a, b] = await page.evaluate(() => {
    const d = (window as any).sugarcad.document.all()[0].sketchData;
    const line = d.curves.find((c: any) => c.id === d.constraints.find((k: any) => k.type === "horizontal").refs[0]);
    return [line.p1, line.p2].map((id: string) => d.points.find((p: any) => p.id === id).y);
  });
  expect(a).toBeCloseTo(b, 3);
  expect(a).toBeGreaterThan(3);

  // Geri al: sürükleme tek adımdı
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await pts(page)).every((p: number[]) => p[1] < 5 || p[1] > 14)).toBe(true);

  // Seçimle kısıt: iki çizgiyi seç → Eşit; yanlış seçimde anlaşılır hata
  const lines = await page.evaluate(() => (window as any).sugarcad.document.all()[0].sketchData.curves.map((c: any) => c.id));
  await page.evaluate(([x, y]) => {
    const ui = (window as any).sugarcadUi;
    ui.sketcher.selected.clear();
    ui.sketcher.selected.add(x);
    ui.sketcher.selected.add(y);
  }, [lines[1], lines[2]]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.constraint.tangent"));
  await expect(page.locator(".toast.error")).toContainText("iki çizgi teğet olamaz");
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.constraint.equal"));
  await expect.poll(() => constraintTypes(page)).toEqual(["equal", "horizontal"]);
  await page.screenshot({ path: `${S}/14-surukleme-kisit.png` });
  expect(errors).toEqual([]);
});

test("düzenleme araçları: kırp, ofset, kopyala ve desen", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [-20, -10]);
  await clickSketch(page, [20, 10]);
  await page.keyboard.press("l");
  await clickSketch(page, [0, -20]);
  await clickSketch(page, [0, 20], { double: true });
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(5);

  // Kırp: dikdörtgenin dışında kalan uçlar silinir, çizgi iki kenar arasında kalır
  await page.keyboard.press("k");
  await expect(page.locator(".statusbar")).toContainText("Kırp:");
  await clickSketch(page, [0, 15]);
  await clickSketch(page, [0, -15]);
  await expect
    .poll(async () => {
      const d = await sketchData(page);
      const ys = d.points.map((p: any) => p.y);
      return [Math.min(...ys), Math.max(...ys)];
    })
    .toEqual([-10, 10]);

  // Ofset: dikdörtgenin dışına 5 mm; dört yeni çizgi
  await page.getByLabel("Ofset mesafesi (0: imleçle)").fill("5");
  await page.keyboard.press("Tab");
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.tool.offset"));
  await clickSketch(page, [20, 0]); // dikdörtgenin sağ kenarı
  await expect(page.locator(".statusbar")).toContainText("Yönü belirlemek için");
  await clickSketch(page, [27, 0]); // dışa doğru
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(9);
  const xs = (await sketchData(page)).points.map((p: any) => p.x);
  expect(Math.max(...xs)).toBeCloseTo(25, 3);
  await page.screenshot({ path: `${S}/15-kirp-ofset.png` });

  // Kopyala: hepsi seçili → 100 mm sağa kopya
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.evaluate(() => void (window as any).sugarcad.commands.run("sketch.copy").catch(() => {}));
  const dialog = page.getByRole("dialog", { name: "Kopyala" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("X kaydırma (mm)").fill("100");
  await dialog.getByLabel("Y kaydırma (mm)").fill("0");
  await dialog.getByRole("button", { name: "Tamam" }).click();
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(18);
  expect(Math.max(...(await sketchData(page)).points.map((p: any) => p.x))).toBeCloseTo(125, 3);

  // Geri al tek adımda kopyaları kaldırır
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(9);

  // Dikdörtgensel desen: 2×2 → 3 kopya
  await page.keyboard.press("Control+a");
  await page.evaluate(() => void (window as any).sugarcad.commands.run("sketch.patternRect").catch(() => {}));
  const pattern = page.getByRole("dialog", { name: "Dikdörtgensel Desen" });
  await pattern.getByLabel("X yönünde adet").fill("2");
  await pattern.getByLabel("Y yönünde adet").fill("2");
  await pattern.getByLabel("X aralığı (mm)").fill("100");
  await pattern.getByLabel("Y aralığı (mm)").fill("100");
  await pattern.getByRole("button", { name: "Tamam" }).click();
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(36);

  // Seçimsiz düzenleme anlaşılır hata verir
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).sugarcadUi.sketcher.selected.clear());
  await page.evaluate(() => void (window as any).sugarcad.commands.run("sketch.rotate").catch(() => {}));
  await expect(page.locator(".toast.error")).toContainText("Önce eskizde öğe seçin");
  expect(errors).toEqual([]);
});

test("Yuvarlatma ve Kabuk: kenar / yüz seç, değer gir, uygula", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });

  // Gövde seçili değilken uyarı
  await page.evaluate(() => (window as any).sugarcad.document.setSelection([]));
  await expect(toolbar.getByRole("button", { name: "Yuvarlatma", exact: true })).toBeDisabled();

  // Yuvarlatma: iki dikey kenarı gerçek fare tıklamasıyla seç
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    app.document.setSelection([app.document.all()[1].id]);
  });
  await toolbar.getByRole("button", { name: "Yuvarlatma", exact: true }).click();
  const hud = page.getByRole("dialog", { name: "Yuvarlatma" });
  await expect(hud).toBeVisible();
  await expect(hud).toContainText("OpenCascade çekirdeği hazırlanıyor");
  await expect(hud).toContainText("Yuvarlatılacak kenarlara tıklayın", { timeout: 60_000 });
  const verticals = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    return ui.brep.described.edges
      .map((e: any, i: number) => ({ i, ref: e.ref }))
      .filter((e: any) => e.ref.dir && Math.abs(e.ref.dir[2]) > 0.99)
      .map((e: any) => ({ i: e.i, screen: ui.viewport.screenOf(e.ref.mid) }));
  });
  expect(verticals).toHaveLength(4);
  for (const v of verticals.slice(0, 2)) {
    await page.mouse.move(v.screen.x, v.screen.y);
    await page.mouse.click(v.screen.x, v.screen.y);
  }
  await expect(hud).toContainText("2 kenar seçili");
  await page.screenshot({ path: `${S}/16-kenar-secimi.png` });
  await hud.getByLabel("Değer").fill("3");
  await hud.getByRole("button", { name: "Uygula" }).click();
  await expect(hud).toBeHidden();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude", "fillet"]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = (window as any).sugarcad;
        return app.meshes.get(app.document.all()[2].id)?.volume ?? 0;
      }),
    )
    .toBeCloseTo(8000 - 2 * (1 - Math.PI / 4) * 9 * 10, 1);
  await page.screenshot({ path: `${S}/17-yuvarlatma.png` });

  // Kabuk: üst yüzü seç
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    app.document.setSelection([app.document.all()[2].id]);
  });
  await toolbar.getByRole("button", { name: "Kabuk", exact: true }).click();
  const shell = page.getByRole("dialog", { name: "Kabuk" });
  await expect(shell).toContainText("Açılacak", { timeout: 60_000 });
  const top = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    const faces = ui.brep.described.faces;
    const i = faces.findIndex((f: any) => f.ref.normal && f.ref.normal[2] > 0.99);
    // Üst yüzün ağırlık merkezinden biraz içeride bir nokta (yuvarlatılmış köşelere takılmasın)
    const c = faces[i].ref.center;
    return ui.viewport.screenOf([c[0], c[1], c[2]]);
  });
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(shell).toContainText("1 yüz seçili");
  await shell.getByLabel("Değer").fill("1.5");
  await shell.getByRole("button", { name: "Uygula" }).click();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude", "fillet", "shell"]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = (window as any).sugarcad;
        return app.meshes.get(app.document.all()[3].id)?.volume ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  const v = await page.evaluate(() => {
    const app = (window as any).sugarcad;
    return [app.errors.get(app.document.all()[3].id) ?? "", app.meshes.get(app.document.all()[3].id).volume];
  });
  expect(v[0]).toBe("");
  expect(v[1]).toBeLessThan(7000);
  await page.screenshot({ path: `${S}/18-kabuk.png` });

  // Geri al kabuğu, tekrar geri al yuvarlatmayı kaldırır
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await features(page)).length).toBe(3);
  expect(errors).toEqual([]);
});

test("Delik: yüzeye tıkla, tür ve ölçü gir, uygula; özellikler panelinden düzenle", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });

  // Üstten bakış: gövdenin üst yüzü görünür
  await page.evaluate(() => (window as any).sugarcadUi.viewport.setView("top"));
  await toolbar.getByRole("button", { name: "Delik", exact: true }).click();
  const hud = page.getByRole("dialog", { name: "Delik" });
  await expect(hud).toBeVisible();
  await expect(hud).toContainText("Deliğin açılacağı yüzeye tıklayın");
  const at = await page.evaluate(() => (window as any).sugarcadUi.viewport.screenOf([20, 10, 10]));
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(hud).toContainText("1 konum seçili");
  const placed = await page.evaluate(() => (window as any).sugarcadUi.hole.placed);
  expect(placed[0].normal).toEqual([0, 0, 1]);
  expect(placed[0].at[2]).toBeCloseTo(10, 3);
  await hud.getByLabel("Delik türü").selectOption("counterbore");
  await hud.getByLabel("Çap", { exact: true }).fill("6");
  await hud.getByLabel("Derinlik (0 = boydan boya)").fill("8");
  await hud.getByLabel("Havşa çapı").fill("12");
  await hud.getByLabel("Havşa derinliği").fill("3");
  await page.screenshot({ path: `${S}/19-delik-hud.png` });
  await hud.getByRole("button", { name: "Uygula" }).click();
  await expect(hud).toBeHidden();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude", "hole"]);
  const volume = () =>
    page.evaluate(() => {
      const app = (window as any).sugarcad;
      return app.meshes.get(app.document.all()[2].id)?.volume ?? 0;
    });
  await expect.poll(volume).toBeGreaterThan(0);
  expect(await volume()).toBeCloseTo(8000 - Math.PI * (36 * 3 + 9 * 5), 0);
  await page.screenshot({ path: `${S}/20-delik.png` });

  // Özellikler panelinden havşasız basit deliğe dön ve konumu değiştir
  await page.getByLabel("Delik türü").selectOption("simple");
  await expect.poll(volume).toBeCloseTo(8000 - Math.PI * 9 * 8, 0);
  await page.getByLabel("Delik 1 X").fill("10");
  await page.getByLabel("Delik 1 X").press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as any).sugarcad.document.all()[2].holes[0].at[0]))
    .toBe(10);
  expect(errors).toEqual([]);
});

test("Yüzeye Eskiz: yüzeye tıkla, o düzlemde çiz, birleştirerek çek", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });

  // Yan yüze (x = 40) eskiz: yüz vurgulanır, tıklayınca o düzlemde eskiz açılır
  await page.evaluate(() => (window as any).sugarcadUi.viewport.setView("right"));
  await toolbar.getByRole("button", { name: "Yüzeye Eskiz" }).click();
  const hud = page.getByRole("dialog", { name: "Yüzeye Eskiz" });
  await expect(hud).toBeVisible();
  const at = await page.evaluate(() => (window as any).sugarcadUi.viewport.screenOf([40, 10, 5]));
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(hud).toBeHidden();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · Yüzey");
  const frame = await page.evaluate(() => (window as any).sugarcad.document.all()[2].frame);
  expect(frame).toEqual({ origin: [40, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] });

  // Kamera düzleme dik: u sağa, v yukarı gider
  const o = await page.evaluate(() => { const ui = (window as any).sugarcadUi; return [ui.viewport.screenPoint(ui.sketcher.plane, 0, [0, 0]), ui.viewport.screenPoint(ui.sketcher.plane, 0, [5, 0]), ui.viewport.screenPoint(ui.sketcher.plane, 0, [0, 5])]; });
  expect(o[1].x).toBeGreaterThan(o[0].x + 1);
  expect(o[2].y).toBeLessThan(o[0].y - 1);

  await page.keyboard.press("r");
  await clickSketch(page, [4, 2]);
  await clickSketch(page, [9, 7]);
  await expect.poll(async () => (await sketchData(page, 2)).curves.length).toBe(4);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));

  // Birleştirerek 4 mm dışarı çek
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    app.document.setSelection([app.document.all()[2].id]);
  });
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude", "sketch", "extrude"]);
  await page.evaluate(async () => {
    const app = (window as any).sugarcad;
    const boss = app.document.all()[3];
    await app.updateFeature(boss.id, { params: { distance: 4 } });
    await app.setOperation(boss.id, "join");
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = (window as any).sugarcad;
        return app.meshes.get(app.document.all()[3].id)?.volume ?? 0;
      }),
    )
    .toBeCloseTo(8000 + 25 * 4, 1);
  await page.screenshot({ path: `${S}/21-yuzeye-eskiz.png` });
  expect(errors).toEqual([]);
});

test("Açılı Yüzey: yan yüzlere eğim ver", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  await toolbar.getByRole("button", { name: "Açılı Yüzey", exact: true }).click();
  const hud = page.getByRole("dialog", { name: "Açılı Yüzey" });
  await expect(hud).toContainText("Eğim verilecek yüzlere tıklayın", { timeout: 60_000 });
  // Gerçek tıklamayla bir yan yüz, geri kalanı programatik
  const sides = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    return ui.brep.described.faces.map((f: any, i: number) => ({ i, n: f.ref.normal })).filter((f: any) => f.n && Math.abs(f.n[2]) < 0.1).map((f: any) => f.i);
  });
  expect(sides).toHaveLength(4);
  await page.evaluate((ids) => ids.forEach((i: number) => (window as any).sugarcadUi.brep.toggle(i)), sides);
  await expect(hud).toContainText("4 yüz seçili");
  await hud.getByLabel("Değer").fill("5");
  await hud.getByLabel("Çekme yönü").selectOption("+Z");
  await hud.getByRole("button", { name: "Uygula" }).click();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude", "draft"]);
  const volume = () =>
    page.evaluate(() => {
      const app = (window as any).sugarcad;
      return app.meshes.get(app.document.all()[2].id)?.volume ?? 0;
    });
  await expect.poll(volume).toBeGreaterThan(0);
  const v = await volume();
  expect(v).toBeGreaterThan(7000);
  expect(v).toBeLessThan(8000);
  await expect(page.getByLabel("Çekme yönü")).toHaveValue("+Z");
  await page.screenshot({ path: `${S}/22-acili-yuzey.png` });
  expect(errors).toEqual([]);
});

test("Loft ve Süpürme düğmeleri", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  // Eskizleri veri olarak kur (çizim akışı başka testlerde sınanıyor)
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    const m = (window as any).sugarcadModel;
    const circle = (plane: string, offset: number, r: number) => {
      const sk = app.createSketch(plane, offset);
      const ed = new m.SketchEdit();
      ed.circle(ed.point([0, 0]), r);
      app.document.update(sk.id, { sketchData: ed.result() });
      return sk.id;
    };
    const a = circle("XY", 0, 6);
    const b = circle("XY", 20, 3);
    (window as any).__ids = [a, b];
    app.document.setSelection([a, b]);
  });
  await expect(toolbar.getByRole("button", { name: "Loft", exact: true })).toBeEnabled();
  await toolbar.getByRole("button", { name: "Loft", exact: true }).click();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "sketch", "loft"]);
  const volume = (index: number) =>
    page.evaluate((i) => {
      const app = (window as any).sugarcad;
      return app.meshes.get(app.document.all()[i].id)?.volume ?? 0;
    }, index);
  await expect.poll(() => volume(2)).toBeGreaterThan(0);
  // Kesik koni hacmi: π h (R² + R r + r²) / 3
  expect(await volume(2)).toBeCloseTo((Math.PI * 20 * (36 + 18 + 9)) / 3, -1);
  await expect(page.locator(".properties")).toContainText("Kesitler: Eskiz 1 → Eskiz 2");
  await page.screenshot({ path: `${S}/23-loft.png` });

  // Süpürme: profil + yol
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    const m = (window as any).sugarcadModel;
    const path = app.createSketch("XZ");
    const ed = new m.SketchEdit();
    ed.line(ed.point([40, 0]), ed.point([40, 30]));
    app.document.update(path.id, { sketchData: ed.result() });
    const prof = app.createSketch("XY");
    const ed2 = new m.SketchEdit();
    ed2.circle(ed2.point([40, 0]), 4);
    app.document.update(prof.id, { sketchData: ed2.result() });
    app.document.setSelection([prof.id, path.id]);
  });
  await toolbar.getByRole("button", { name: "Süpürme", exact: true }).click();
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "sketch", "loft", "sketch", "sketch", "sweep"]);
  await expect.poll(() => volume(5)).toBeGreaterThan(0);
  expect(await volume(5)).toBeCloseTo(Math.PI * 16 * 30, -1);
  expect(errors).toEqual([]);
});

test("Açılı düzlem ve 3 noktalı düzlemde eskiz", async ({ page }) => {
  const errors = await open(page);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  // Açılı düzlem: XZ düzlemini yatay eksen etrafında 30° döndür
  await toolbar.getByRole("button", { name: "Açılı Düzlem" }).click();
  const dialog = page.getByRole("dialog", { name: "Açılı Düzlemde Eskiz" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Taban düzlem", { exact: true }).selectOption("XZ");
  await dialog.getByLabel("Açı (°)").fill("30");
  await dialog.getByRole("button", { name: "Tamam" }).click();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · Yüzey");
  const frame = await page.evaluate(() => (window as any).sugarcad.document.all()[0].frame);
  expect(frame.origin).toEqual([0, 0, 0]);
  expect(frame.u).toEqual([1, 0, 0]);
  expect(Math.hypot(...(frame.n as number[]))).toBeCloseTo(1, 6);
  expect(frame.n[0]).toBe(0);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));

  // 3 noktalı düzlem
  await toolbar.getByRole("button", { name: "3 Nokta" }).click();
  const hud = page.getByRole("dialog", { name: "3 Noktalı Düzlem" });
  await expect(hud).toBeVisible();
  await page.evaluate(() => {
    const t = (window as any).sugarcadUi.planePoints;
    t.addPoint([0, 0, 5]);
    t.addPoint([10, 0, 5]);
  });
  await expect(hud).toContainText("2. nokta");
  // Doğrusal üçüncü nokta uyarı verir, düzlem açılmaz
  await page.evaluate(() => (window as any).sugarcadUi.planePoints.addPoint([20, 0, 5]));
  await expect(page.locator(".toast.warning")).toContainText("aynı doğru üzerinde");
  await page.evaluate(() => (window as any).sugarcadUi.planePoints.addPoint([0, 10, 5]));
  await expect(hud).toBeHidden();
  const frame2 = await page.evaluate(() => (window as any).sugarcad.document.all()[1].frame);
  expect(frame2).toEqual({ origin: [0, 0, 5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });
  expect(errors).toEqual([]);
});

test("Kütle Özellikleri: hacim, ağırlık merkezi ve malzemeye göre kütle", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);
  const toolbar = page.getByRole("toolbar", { name: "Araçlar" });
  await toolbar.getByRole("button", { name: "Kütle Özellikleri" }).click();
  const hud = page.getByRole("dialog", { name: "Kütle Özellikleri" });
  await expect(hud).toBeVisible();
  await expect(hud.locator("[data-mass=volume] strong")).toContainText("8000 mm³");
  await expect(hud.locator("[data-mass=area] strong")).toContainText("2800 mm²");
  await expect(hud.locator("[data-mass=centroid] strong")).toContainText("(20, 10, 5)");
  await expect(hud.locator("[data-mass=mass] strong")).toContainText("62.8 g"); // 8 cm³ × 7,85 g/cm³
  await hud.getByLabel("Malzeme").selectOption("aluminum");
  await expect(hud.locator("[data-mass=mass] strong")).toContainText("21.6 g");
  await page.screenshot({ path: `${S}/24-kutle.png` });
  await page.keyboard.press("Escape");
  await expect(hud).toBeHidden();
  expect(errors).toEqual([]);
});

test("STEP: dışa aktar (indirme) ve geri içe aktar", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.evaluate(() => void (window as any).sugarcad.commands.run("file.exportStep")),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.step$/);
  const path = await download.path();
  const fs = await import("node:fs");
  const text = fs.readFileSync(path!, "utf8");
  expect(text.startsWith("ISO-10303-21;")).toBe(true);
  expect(text).toContain("MANIFOLD_SOLID_BREP");

  // Yeni belgede içe aktar: B-rep olarak gelir ve yuvarlatılabilir
  await page.evaluate(() => (window as any).sugarcad.document.undo()); // sade bir başlangıç için (ekstrüzyonu geri al)
  await page.evaluate((t) => (window as any).sugarcad.importStepText("parca.step", t), text);
  const types = async () => (await features(page)).map((f: any) => f.type);
  await expect.poll(types).toContain("stepBody");
  const volume = () =>
    page.evaluate(() => {
      const app = (window as any).sugarcad;
      const f = app.document.all().find((x: any) => x.type === "stepBody");
      return app.meshes.get(f.id)?.volume ?? 0;
    });
  await expect.poll(volume, { timeout: 30_000 }).toBeCloseTo(8000, 0);
  expect(errors).toEqual([]);
});

test("Parametreler: panelden ekle, ölçüde ve özellikte ifade kullan, değiştirince model güncellensin", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("body[data-solver=true]")).toBeAttached();
  // Parametre ekle: genislik = 40
  await page.evaluate(() => (window as any).sugarcad.commands.run("view.parameters"));
  const panel = page.locator(".params-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Yeni parametre adı").fill("genislik");
  await panel.getByLabel("Yeni parametre değeri").fill("40");
  await panel.getByRole("button", { name: "Ekle" }).click();
  await expect(panel.locator("[data-param=genislik] .param-value")).toHaveText("40");
  await panel.getByLabel("Yeni parametre adı").fill("yukseklik");
  await panel.getByLabel("Yeni parametre değeri").fill("genislik / 2");
  await panel.getByLabel("Yeni parametre değeri").press("Enter");
  await expect(panel.locator("[data-param=yukseklik] .param-value")).toHaveText("20");

  // Hatalı ifade anlaşılır uyarı verir
  await panel.getByLabel("Yeni parametre adı").fill("kotu");
  await panel.getByLabel("Yeni parametre değeri").fill("yok + 1");
  await panel.getByRole("button", { name: "Ekle" }).click();
  await expect(page.locator(".toast.error")).toContainText("Bilinmeyen parametre");

  // Dikdörtgen çiz; alt kenara ölçü: ifade "genislik"
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [0, 0]);
  await clickSketch(page, [40, 20]);
  await expect.poll(async () => (await sketchData(page)).curves.length).toBe(4);
  await page.keyboard.press("d");
  await clickSketch(page, [20, 0]);
  const editor = page.getByRole("group", { name: "Ölçü" });
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox").fill("genislik");
  await page.keyboard.press("Enter");
  await expect(page.locator(".sketch-notes .note.dim").first()).toContainText("ƒ 40");
  await page.evaluate(() => (window as any).sugarcad.commands.run("sketch.finish"));
  await page.keyboard.press("e");
  await expect.poll(async () => (await features(page)).map((f: any) => f.type)).toEqual(["sketch", "extrude"]);

  // Ekstrüzyon mesafesi: ƒ düğmesiyle "yukseklik / 4" (= 5)
  await page.getByLabel("İfade yaz: distance").click();
  const dlg = page.getByRole("dialog", { name: /Mesafe/ });
  await dlg.getByRole("textbox").fill("yukseklik / 4");
  await dlg.getByRole("button", { name: "Tamam" }).click();
  const volume = () =>
    page.evaluate(() => {
      const app = (window as any).sugarcad;
      return app.meshes.get(app.document.all()[1].id)?.volume ?? 0;
    });
  await expect.poll(volume).toBeCloseTo(40 * 20 * 5, 0);
  await page.screenshot({ path: `${S}/25-parametreler.png` });

  // Parametreyi değiştir: genislik 40 → 60; yukseklik 30 → mesafe 7.5. Eskiz yeniden çözülür, hacim güncellenir.
  await panel.getByLabel("genislik ifadesi").fill("60");
  await panel.getByLabel("genislik ifadesi").press("Enter");
  await expect.poll(volume, { timeout: 15_000 }).toBeCloseTo(60 * 20 * 7.5, 0);
  const sk = await sketchData(page, 0);
  const xs = sk.points.map((p: any) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 3);

  // Kullanımdaki parametre silinemez
  await panel.getByLabel("genislik parametresini sil").click();
  await expect(page.locator(".toast.error").last()).toContainText("kullanımda");

  // Tek geri alma adımı: değişikliği geri al
  await page.keyboard.press("Control+z");
  await expect.poll(volume, { timeout: 15_000 }).toBeCloseTo(40 * 20 * 5, 0);
  expect(errors).toEqual([]);
});
