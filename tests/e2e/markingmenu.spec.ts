import { expect, test, type Page } from "@playwright/test";

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

async function clickSketch(page: Page, p: Vec2) {
  const pos = await page.evaluate((p) => {
    const ui = (window as any).sugarcadUi;
    return ui.viewport.screenPoint(ui.sketcher.plane, 0, p);
  }, p);
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.click(pos.x, pos.y);
}

/** Görünümde boş bir nokta (tuvalin üst ortası). */
async function emptySpot(page: Page) {
  const box = (await page.locator(".viewport canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 140 };
}

const menu = (page: Page) => page.getByRole("menu", { name: "İşaretleme menüsü" });
const cameraPos = (page: Page) =>
  page.evaluate(() => (window as any).sugarcadUi.viewport.camera.position.toArray().map((v: number) => Math.round(v * 100) / 100));

test("sağ tık işaretleme menüsünü açar, Esc ve dış tık kapatır", async ({ page }) => {
  const errors = await open(page);
  const p = await emptySpot(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  // Boş tuval: Eskiz Oluştur, Sığdır, Ölç; Sil devre dışı; geri al yokken devre dışı.
  await expect(menu(page).getByRole("menuitem", { name: "Eskiz Oluştur" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Sığdır" })).toBeEnabled();
  await expect(menu(page).getByRole("menuitem", { name: "Ölç" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Sil" })).toBeDisabled();
  await expect(menu(page).getByRole("menuitem", { name: "Geri Al" })).toBeDisabled();
  // 8 dilimli halka imlecin çevresinde (~110 px).
  await expect(menu(page).locator(".mm-slice")).toHaveCount(8);
  const n = (await menu(page).getByRole("menuitem", { name: "Eskiz Oluştur" }).boundingBox())!;
  expect(Math.abs(n.x + n.width / 2 - p.x)).toBeLessThan(3);
  expect(p.y - (n.y + n.height / 2)).toBeGreaterThan(100);
  await page.screenshot({ path: `${S}/mm-01-bos.png` });

  // Klavye: ilk etkin öğe odaklı, ok tuşu ilerletir, Esc kapatır.
  await expect(menu(page).getByRole("menuitem", { name: "Eskiz Oluştur" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(menu(page).getByRole("menuitem", { name: "Ölç" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);

  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(p.x - 300, p.y + 200);
  await expect(menu(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sağ sürükleme menü açmaz, kamerayı kaydırır", async ({ page }) => {
  await open(page);
  const p = await emptySpot(page);
  const before = await cameraPos(page);
  await page.mouse.move(p.x, p.y + 100);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(p.x + 60, p.y + 140, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect(menu(page)).toHaveCount(0);
  expect(await cameraPos(page)).not.toEqual(before);
});

test("menüden komut: Eskiz Oluştur → eskizde sağ tık menüsü → Eskizi Bitir", async ({ page }) => {
  const errors = await open(page);
  const p = await emptySpot(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await menu(page).getByRole("menuitem", { name: "Eskiz Oluştur" }).click();
  await expect(menu(page)).toHaveCount(0);
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · XY (Üst)");

  await page.keyboard.press("r");
  await clickSketch(page, [-20, -10]);
  await clickSketch(page, [20, 10]);
  const curves = () => page.evaluate(() => (window as any).sugarcad.document.all()[0].sketchData.curves.length);
  const count = await curves();
  expect(count).toBeGreaterThan(0);

  // Eskizde sağ tık: eğri eklemez, eskiz menüsünü açar.
  const at = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    return ui.viewport.screenPoint(ui.sketcher.plane, 0, [0, 25]);
  });
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  for (const name of ["Eskizi Bitir", "Geri Al", "Aracı Bırak", "Ölçü", "Yapı Çizgisi", "Sil"]) {
    await expect(menu(page).getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  expect(await curves()).toBe(count);
  await page.screenshot({ path: `${S}/mm-02-eskiz.png` });

  // Aracı Bırak (Esc karşılığı): Enter ile çalışır.
  await menu(page).getByRole("menuitem", { name: "Aracı Bırak" }).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).sugarcadUi.sketcher.tool)).toBeNull();
  await expect(page.locator(".statusbar")).toContainText("Eskiz · XY (Üst)");

  await page.mouse.click(at.x, at.y, { button: "right" });
  await menu(page).getByRole("menuitem", { name: "Eskizi Bitir" }).click();
  await expect(page.locator(".statusbar")).not.toContainText("Eskiz · XY");
  expect(errors).toEqual([]);
});

test("gövdeye sağ tık onu seçer; Gizle ve Sil çalışır (koyu tema)", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "XY (Üst)" }).click();
  await page.keyboard.press("r");
  await clickSketch(page, [-10, -10]);
  await clickSketch(page, [10, 10]);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("e");
  await page.getByRole("dialog", { name: "Ekstrüzyon" }).getByRole("button", { name: "Tamam" }).click();
  await expect(page.locator(".tree-row").first()).toHaveText("Ekstrüzyon 1");
  await page.evaluate(() => (window as any).sugarcad.document.setSelection([]));
  await page.evaluate(() => (window as any).sugarcad.commands.run("view.theme"));

  const center = await page.evaluate(() => {
    const ui = (window as any).sugarcadUi;
    return ui.viewport.screenPosition((window as any).sugarcad.document.all()[1].id);
  });
  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveText("Ekstrüzyon 1");
  for (const name of ["Yuvarlatma", "Delik", "Gizle", "Sil", "Özellikleri Düzenle", "Geri Al"]) {
    await expect(menu(page).getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: `${S}/mm-03-govde-koyu.png` });
  await menu(page).getByRole("menuitem", { name: "Gizle", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).sugarcad.document.all()[1].hidden)).toBe(true);

  // Gizli gövde seçili kalır: menü "Göster" önerir; sonra Sil.
  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Göster", exact: true })).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Sil", exact: true }).click();
  await expect(page.locator(".tree-row")).toHaveText(["Eskiz 1"]);
  expect(errors).toEqual([]);
});
