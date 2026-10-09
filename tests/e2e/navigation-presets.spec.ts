import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  return errors;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const vp = (window as any).sugarcadUi.viewport;
    const d = vp.camera.position.clone().sub(vp.controls.target);
    return { target: vp.controls.target.toArray() as number[], dir: d.clone().normalize().toArray() as number[], dist: d.length() };
  });

const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mmenu = (page: Page) => page.getByRole("menu", { name: "İşaretleme menüsü" });

async function spot(page: Page) {
  const box = (await page.locator(".viewport canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 200 };
}

async function drag(page: Page, button: "left" | "middle" | "right", key?: string) {
  const p = await spot(page);
  await page.mouse.move(p.x, p.y);
  if (key) await page.keyboard.down(key);
  await page.mouse.down({ button });
  await page.mouse.move(p.x + 80, p.y + 50, { steps: 8 });
  await page.mouse.up({ button });
  if (key) await page.keyboard.up(key);
}

async function choose(page: Page, name: string) {
  await page.getByRole("button", { name: "Dosya menüsü" }).click();
  await page.getByRole("menuitem", { name: "Fare düzeni" }).click();
  await page.getByRole("menuitemcheckbox", { name }).click();
}

/** Eylemi sınıflar: pan = hedef değişir, yön aynı; orbit = yön değişir; zoom = mesafe değişir; none = hiçbiri. */
async function classify(page: Page, button: "left" | "middle" | "right", key?: string) {
  const a = await state(page);
  await drag(page, button, key);
  const b = await state(page);
  if (near(a.dir, b.dir) > 0.01) return "orbit";
  if (near(a.target, b.target) > 0.01) return "pan";
  if (Math.abs(a.dist - b.dist) > 0.01) return "zoom";
  return "none";
}

test("varsayılan sugarCAD: sol orbit, orta zoom, sağ pan", async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.navigationPreset)).toBe("sugarCAD");
  expect(await classify(page, "left")).toBe("orbit");
  expect(await classify(page, "middle")).toBe("zoom");
  expect(await classify(page, "right")).toBe("pan");
  expect(errors).toEqual([]);
});

test("Fusion 360: orta pan, Shift+orta orbit, sol hiçbir şey, sağ kısa tık menü, kalıcı", async ({ page }) => {
  const errors = await open(page);
  await choose(page, "Fusion 360");
  await expect(page.getByText("Fare düzeni: Fusion 360 — orta tuş: kaydır, Shift+orta: döndür")).toBeVisible();
  expect(await classify(page, "left")).toBe("none");
  expect(await classify(page, "middle")).toBe("pan");
  expect(await classify(page, "middle", "Shift")).toBe("orbit");
  expect(await classify(page, "right")).toBe("none");
  await expect(mmenu(page)).toHaveCount(0);

  const p = await spot(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(mmenu(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // orta çift tık: görünüme sığdır
  await page.evaluate(() => (window as any).sugarcadUi.viewport.controls.target.set(500, 500, 500));
  const before = await state(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.dblclick(p.x, p.y, { button: "middle" });
  const after = await state(page);
  expect(near(before.target, after.target)).toBeGreaterThan(1);

  // yenilemeden sonra korunur
  await page.reload();
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.navigationPreset)).toBe("Fusion 360");
  await page.getByRole("button", { name: "Dosya menüsü" }).click();
  await page.getByRole("menuitem", { name: "Fare düzeni" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Fusion 360" })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("SolidWorks: orta orbit, Ctrl+orta pan", async ({ page }) => {
  const errors = await open(page);
  await choose(page, "SolidWorks");
  expect(await classify(page, "middle")).toBe("orbit");
  expect(await classify(page, "middle", "Control")).toBe("pan");
  expect(await classify(page, "left")).toBe("none");
  expect(errors).toEqual([]);
});

test("Tinkercad: sağ orbit, orta pan, kısa sağ tık menü", async ({ page }) => {
  const errors = await open(page);
  await choose(page, "Tinkercad");
  expect(await classify(page, "right")).toBe("orbit");
  await expect(mmenu(page)).toHaveCount(0);
  expect(await classify(page, "middle")).toBe("pan");
  const p = await spot(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(mmenu(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("komut paleti komutu düzeni değiştirir; geçersiz kayıt sugarCAD olur", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).sugarcad.commands.execute("view.navigation.tinkercad"));
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.navigationPreset)).toBe("Tinkercad");
  await page.evaluate(() => localStorage.setItem("sugarcad.navigation", "bozuk"));
  await page.reload();
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.navigationPreset)).toBe("sugarCAD");
});
