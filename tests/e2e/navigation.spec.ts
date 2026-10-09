import { expect, test, type Page } from "@playwright/test";

const S = "test-results/ekran";

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("body[data-ready=true]")).toBeVisible();
  return errors;
}

/** Hedeften kameraya normalleştirilmiş yön. */
const cameraDir = (page: Page) =>
  page.evaluate(() => {
    const vp = (window as any).sugarcadUi.viewport;
    const d = vp.camera.position.clone().sub(vp.controls.target).normalize();
    return [d.x, d.y, d.z] as number[];
  });

/** Kamera değiştikten sonra küpün CSS dönüşümü bir sonraki karede güncellenir; iki kare bekle. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Bir küp yüzünün (u, v ∈ -1..1 yerel koordinat) noktasının ekran konumu (küp oturduktan sonra ölçülür). */
async function cubePoint(page: Page, view: string, u: number, v: number) {
  await settle(page);
  return page.evaluate(
    ({ view, u, v }) => {
      const face = document.querySelector(`.viewcube-face[data-view=${view}]`) as HTMLElement;
      const cube = face.parentElement as HTMLElement;
      const stage = cube.parentElement as HTMLElement;
      const size = face.offsetWidth;
      const m = new DOMMatrix(getComputedStyle(cube).transform).multiply(new DOMMatrix(getComputedStyle(face).transform));
      const p = m.transformPoint(new DOMPoint((u * size) / 2, (v * size) / 2, 0));
      const r = stage.getBoundingClientRect();
      return { x: r.left + size / 2 + p.x, y: r.top + size / 2 + p.y };
    },
    { view, u, v },
  );
}

async function expectDir(page: Page, want: number[]) {
  const len = Math.hypot(...want);
  await expect
    .poll(async () => {
      const d = await cameraDir(page);
      return Math.max(...d.map((x, i) => Math.abs(x - want[i] / len)));
    })
    .toBeLessThan(0.02);
}

test("gezinme çubuğu: erişilebilir adlar, Ölç/Kesit kaldırıldı, menüler açılır", async ({ page }) => {
  const errors = await open(page);
  const nav = page.getByRole("navigation", { name: "Gezinme" });
  for (const name of ["Ana görünüm", "Yakınlaştır", "Uzaklaştır", "Görünüme sığdır (F)", "Görüntü Ayarları", "Izgara ve Yakalama"]) {
    await expect(nav.getByRole("button", { name })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: /Ölç|Kesit/ })).toHaveCount(0);
  // Ölç ve Kesit Analizi şeritte (İNCELE) durur.
  const tools = page.getByRole("toolbar", { name: "Araçlar" });
  await expect(tools.getByRole("button", { name: "Ölç", exact: true })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Kesit Analizi" })).toBeVisible();

  // Yakınlaştır / uzaklaştır mesafeyi değiştirir.
  const dist = () =>
    page.evaluate(() => {
      const vp = (window as any).sugarcadUi.viewport;
      return vp.camera.position.distanceTo(vp.controls.target) as number;
    });
  const d0 = await dist();
  await nav.getByRole("button", { name: "Yakınlaştır" }).click();
  await expect.poll(dist).toBeLessThan(d0 * 0.9);
  await nav.getByRole("button", { name: "Uzaklaştır" }).click();
  await expect.poll(dist).toBeCloseTo(d0, 1);

  // Görüntü Ayarları: görsel stil, projeksiyon, zemin ızgarası
  const display = nav.getByRole("button", { name: "Görüntü Ayarları" });
  await display.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Gölgeli + Kenarlar" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Tel Kafes" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.visualStyle)).toBe("wireframe");

  await display.click();
  await page.getByRole("menuitemcheckbox", { name: "Ortografik" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.projection)).toBe("orthographic");
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.camera.fov)).toBeLessThan(2);
  await page.screenshot({ path: `${S}/nav-ortografik.png` });
  await display.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Ortografik" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Perspektif" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.camera.fov)).toBe(45);
  expect(Math.abs((await dist()) - d0)).toBeLessThan(d0 * 0.01);

  await display.click();
  await page.getByRole("menuitemcheckbox", { name: "Zemin Izgarası" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.isGridVisible)).toBe(false);

  // Izgara ve Yakalama menüsü aynı ayarı geri açar
  await nav.getByRole("button", { name: "Izgara ve Yakalama" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Izgarayı Göster" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemcheckbox", { name: "Izgarayı Göster" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.isGridVisible)).toBe(true);
  expect(errors).toEqual([]);
});

test("ViewCube: yüz, kenar ve köşe tıklaması kamerayı beklenen yöne götürür", async ({ page }) => {
  const errors = await open(page);
  const cube = page.getByRole("group", { name: "Görünüm küpü" });
  await expect(cube).toBeVisible();
  const box = (await page.locator(".viewcube-stage").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(72);

  // İzometrik başlangıç görünümünde üst, ön ve sağ yüzler görünür.
  await page.getByRole("button", { name: "Ana görünüm" }).first().click();
  // Köşe: üst yüzün (+x, ön) köşesi → (1,-1,1)
  let p = await cubePoint(page, "top", 0.9, 0.9);
  await page.mouse.click(p.x, p.y);
  await expectDir(page, [1, -1, 1]);

  // Yüz merkezi: Üst → ~(0,0,1)
  p = await cubePoint(page, "top", 0, 0);
  await page.mouse.click(p.x, p.y);
  await expectDir(page, [0, 0, 1]);

  // Ön yüz görünür olsun diye izometriğe dön; ön yüzün üst kenarı → (0,-1,1)
  await page.getByRole("button", { name: "Ana görünüm" }).first().click();
  p = await cubePoint(page, "front", 0, -0.9);
  await page.mouse.click(p.x, p.y);
  await expectDir(page, [0, -1, 1]);

  // Yüz merkezi: Ön → (0,-1,0)
  await page.getByRole("button", { name: "Ana görünüm" }).first().click();
  p = await cubePoint(page, "front", 0, 0);
  await page.mouse.click(p.x, p.y);
  await expectDir(page, [0, -1, 0]);
  expect(errors).toEqual([]);
});

test("ViewCube menüsü: Ev'e dön, devre dışı öğe, projeksiyon eşitlenir; iki tema", async ({ page }) => {
  const errors = await open(page);
  const more = page.getByRole("button", { name: "Görünüm küpü menüsü" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Mevcut görünümü Ev yap" })).toBeDisabled();
  await page.getByRole("menuitemcheckbox", { name: "Ortografik" }).click();
  expect(await page.evaluate(() => (window as any).sugarcadUi.viewport.projection)).toBe("orthographic");
  await page.getByRole("navigation", { name: "Gezinme" }).getByRole("button", { name: "Görüntü Ayarları" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Ortografik" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  // Küpü bir köşeye getir, sonra menüden Ev'e dön
  const p = await cubePoint(page, "top", 0.9, 0.9);
  await page.mouse.click(p.x, p.y);
  await more.click();
  await page.getByRole("menuitem", { name: "Ev'e dön" }).click();
  await expectDir(page, [0.55, -0.8, 0.6]);

  await page.mouse.move(p.x, p.y);
  await page.screenshot({ path: `${S}/nav-acik.png` });
  await page.getByRole("button", { name: "Dosya menüsü" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Koyu tema" }).click();
  await page.getByRole("navigation", { name: "Gezinme" }).getByRole("button", { name: "Görüntü Ayarları" }).click();
  await page.screenshot({ path: `${S}/nav-koyu.png` });
  expect(errors).toEqual([]);
});
