import { expect, test, type Page } from "@playwright/test";

const S = "/home/user/deneme/test-results";

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  return errors;
}

test("şekil ekle, parametre değiştir, çıkarma yap, geri al", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Kutu" }).click();
  await expect(page.locator(".tree-row")).toHaveText(["Kutu 1"]);
  await page.getByRole("button", { name: "Silindir" }).click();
  await expect(page.locator(".tree-row")).toHaveCount(2);

  // Silindiri büyüt: özellik paneli
  const radius = page.getByLabel("Yarıçap");
  await radius.fill("6");
  await radius.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).sugarcad.document.all()[1].params.radius)).toBe(6);
  const height = page.getByLabel("Yükseklik", { exact: true });
  await height.fill("40");
  await height.press("Tab");
  const z = page.getByLabel("Konum Z");
  await z.fill("-10");
  await z.press("Enter");

  // İki şekli seç, çıkar
  await page.locator(".tree-row", { hasText: "Kutu 1" }).click();
  await page.locator(".tree-row", { hasText: "Silindir 1" }).click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "Çıkarma" }).first().click();
  await expect(page.locator(".tree-row").first()).toHaveText("Çıkarma 1");
  await expect(page.locator(".tree-row.consumed")).toHaveCount(2);
  await expect.poll(() =>
    page.evaluate(() => {
      const app = (window as any).sugarcad;
      return app.meshes.get(app.document.roots()[0].id)?.volume ?? 0;
    }),
  ).toBeCloseTo(20 * 20 * 20 - Math.PI * 36 * 20, -1);
  await expect(page.locator(".props")).toContainText("Hacim:");
  await page.screenshot({ path: `${S}/01-cikarma.png` });

  // Geri al → iki ayrı şekil
  await page.locator("canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tree-row")).toHaveCount(2);
  await expect(page.locator(".tree-row.consumed")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("komut paleti ve eklenti: dişli oluştur", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("Control+Shift+P");
  const input = page.getByRole("combobox", { name: "Komut ara" });
  await expect(input).toBeFocused();
  await input.fill("dişli oluş");
  await expect(page.locator(".palette li").first()).toContainText("Dişli Oluştur");
  await page.screenshot({ path: `${S}/02-palet.png` });
  await input.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Dişli Oluştur" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Diş sayısı").fill("24");
  await dialog.getByRole("button", { name: "Tamam" }).click();
  await expect(page.locator(".tree-row")).toHaveText(["Düz Dişli 1"]);
  await expect(page.locator(".toast")).toContainText("Düz Dişli 1 eklendi");
  await expect(page.getByLabel("Diş sayısı")).toHaveValue("24");
  await expect(page.locator(".props")).toContainText("Hacim:");

  // Parametreyi panelden değiştir → eklenti yeniden üretir
  const teeth = page.getByLabel("Diş sayısı");
  await teeth.fill("12");
  await teeth.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).sugarcad.document.all()[0].solid.polygons[0].length)).toBe(12 * 20);
  await page.screenshot({ path: `${S}/03-disli.png` });

  await page.getByRole("button", { name: "Eklentiler" }).click();
  await expect(page.locator('[data-plugin="gear"] .badge')).toHaveText("Çalışıyor");
  await page.screenshot({ path: `${S}/04-eklentiler.png` });
  expect(errors).toEqual([]);
});

test("3D görünümde tıklayarak seçme ve Delete ile silme", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Küre" }).click();
  await page.locator("canvas").click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveCount(0);
  // Ekranın ortasındaki küreye tıkla (ilk şekil eklenince görünüm sığdırılır)
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveText("Küre 1");
  await page.keyboard.press("Delete");
  await expect(page.locator(".tree-row")).toHaveCount(0);
});

test("form adım dışı değerleri kabul eder, aralık dışını reddeder", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("combobox", { name: "Komut ara" }).fill("dişli oluştur");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Dişli Oluştur" });
  await dialog.getByLabel("Diş sayısı").fill("3");
  await dialog.getByRole("button", { name: "Tamam" }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.getByLabel("Diş sayısı").evaluate((el: HTMLInputElement) => el.validationMessage)).toBe("En az 6 olmalı");
  await dialog.getByLabel("Diş sayısı").fill("18");
  await dialog.getByLabel("Modül").fill("1.3");
  await dialog.getByRole("button", { name: "Tamam" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".tree-row")).toHaveText(["Düz Dişli 1"]);
  await expect(page.getByLabel("Modül")).toHaveValue("1.3");
});

test("özellik panelinde sınır dışı değer kırpılır ve alana yansır", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Düz Dişli" }).click();
  const teeth = page.getByLabel("Diş sayısı");
  await teeth.fill("2");
  await teeth.press("Enter");
  await expect(teeth).toHaveValue("6");
});
