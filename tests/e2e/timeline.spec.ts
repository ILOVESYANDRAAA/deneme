import { expect, test } from "@playwright/test";

test("zaman çizelgesi: geri/ileri seçimi taşır, işaret seçili kareyi izler", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    const m = (window as any).sugarcadModel;
    for (const x of [0, 50]) {
      const s = app.createSketch("XY");
      const e = new m.SketchEdit();
      m.buildRect(e, [[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]]);
      app.document.update(s.id, { sketchData: e.result() });
      app.addSketchFeature("extrude", s.id);
    }
  });
  const items = page.locator(".timeline-item");
  await expect(items).toHaveCount(4);
  const ids = await page.evaluate(() => (window as any).sugarcad.document.all().map((f: any) => f.id));
  const selection = () => page.evaluate(() => (window as any).sugarcad.document.getSelection());
  const vol = () => page.evaluate(() => [...(window as any).sugarcad.meshes.values()].map((m: any) => m.volume));
  await expect.poll(async () => (await vol()).length).toBe(2);
  const volBefore = await vol();

  // Seçim yokken işaret son karede
  await page.evaluate(() => (window as any).sugarcad.document.setSelection([]));
  await expect(items.last()).toHaveClass(/marker/);
  await expect(items.first()).toHaveAttribute("title", /· sketch/);

  const btn = (n: string) => page.getByRole("button", { name: n, exact: true });
  await btn("Başa git").click();
  expect(await selection()).toEqual([ids[0]]);
  await expect(items.first()).toHaveClass(/marker/);
  await expect(btn("Bir geri")).toBeDisabled();
  await btn("Bir ileri").click();
  expect(await selection()).toEqual([ids[1]]);
  await btn("Bir ileri").click();
  expect(await selection()).toEqual([ids[2]]);
  await btn("Bir geri").click();
  expect(await selection()).toEqual([ids[1]]);
  await btn("Sona git").click();
  expect(await selection()).toEqual([ids[3]]);
  await expect(btn("Bir ileri")).toBeDisabled();

  // Model hesabı değişmez
  expect(await vol()).toEqual(volBefore);
  await btn("Bir geri").click();
  await page.screenshot({ path: "test-results/ekran/zaman-cizelgesi.png" });
  expect(errors).toEqual([]);
});

test("zaman çizelgesi: çok karede yatay kaydırma ve seçili kare görünür", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).sugarcad;
    for (let i = 0; i < 60; i++) app.createSketch("XY");
  });
  const track = page.locator(".timeline-track");
  await expect(page.locator(".timeline-item")).toHaveCount(60);
  expect(await track.evaluate((t) => t.scrollWidth > t.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Başa git", exact: true }).click();
  await page.getByRole("button", { name: "Sona git", exact: true }).click();
  const inView = () =>
    page.evaluate(() => {
      const t = document.querySelector(".timeline-track")!.getBoundingClientRect();
      const r = document.querySelector('.timeline-item[aria-selected="true"]')!.getBoundingClientRect();
      return r.left >= t.left - 1 && r.right <= t.right + 1;
    });
  await expect.poll(inView).toBe(true);
  await page.getByRole("button", { name: "Başa git", exact: true }).click();
  await expect.poll(inView).toBe(true);
});
