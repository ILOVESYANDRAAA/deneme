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

const features = (page: Page) =>
  page.evaluate(() => (window as any).sugarcad.document.all().map((f: any) => ({ type: f.type, entities: f.entities?.length })));
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
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 2 }]);
  await expect(page.locator(".properties")).toContainText("2 öğe · 2 kapalı profil");
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
  await expect.poll(() =>
    page.evaluate(() => (window as any).sugarcad.document.all()[0].entities[0]),
  ).toEqual({ kind: "polyline", points: [[5, 0], [15, 0], [5, 20]], closed: true });

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
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 2 }]);
  await page.keyboard.press("Delete"); // eskizi silmemeli
  await page.keyboard.press("Control+z");
  await expect.poll(() => features(page)).toEqual([{ type: "sketch", entities: 1 }]);
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

const entities = (page: Page) => page.evaluate(() => (window as any).sugarcad.document.all()[0].entities);

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
  await expect.poll(() => entities(page)).toEqual([{ kind: "rect", a: [0, 0], b: [40, 20] }]);

  // Kanal: iki merkez ve genişlik
  await page.keyboard.press("t");
  await clickSketch(page, [10, 30]);
  await clickSketch(page, [30, 30]);
  await clickSketch(page, [30, 35]);
  await expect.poll(async () => (await entities(page))[1]).toEqual({ kind: "slot", a: [10, 30], b: [30, 30], r: 5 });
  await page.screenshot({ path: `${S}/07-olcu-yazma.png` });

  // Araç bırakılınca öğeye tıklayıp seç, Delete ile sil
  await page.keyboard.press("Escape");
  await clickSketch(page, [20, 40]); // kanalın üst kenarı (merkez çizgisi 30, yarıçap 5... üst kenar 35)
  await clickSketch(page, [20, 35]);
  await expect(page.locator("[data-panel=sketchPalette]")).toContainText("1 öğe seçili");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await entities(page)).length).toBe(1);

  // Köşe yuvarlatma: şeritteki DEĞİŞTİR grubundan
  await page.getByRole("toolbar", { name: "Araçlar" }).getByRole("button", { name: "Köşe Yuvarlatma" }).click();
  await clickSketch(page, [40, 20]);
  await expect.poll(async () => (await entities(page))[0]).toMatchObject({ kind: "polyline", closed: true, radii: [0, 0, 2, 0] });

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
  await expect(page.locator(".properties")).toContainText("3 öğe · 2 kapalı profil");
  await page.screenshot({ path: `${S}/08-yay-profil.png` });
  expect(errors).toEqual([]);
});

test("Kes işlemi, ayna, ölçüm ve kesit analizi", async ({ page }) => {
  const errors = await open(page);
  // Plaka ve üstüne kesilecek daire (API ile hızlı kurulum)
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    const s1 = app.createSketch("XY");
    app.document.update(s1.id, { entities: [{ kind: "rect", a: [0, 0], b: [40, 20] }] });
    app.addSketchFeature("extrude", s1.id);
    const s2 = app.createSketch("XY");
    app.document.update(s2.id, { entities: [{ kind: "circle", c: [20, 10], r: 5 }] });
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
