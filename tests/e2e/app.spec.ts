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
  await expect(page.locator(".props")).toContainText("2 öğe · 2 kapalı profil");
  await page.screenshot({ path: `${S}/02-eskiz.png` });

  await toolbar.getByRole("button", { name: "Eskizi Bitir" }).click();
  await toolbar.getByRole("button", { name: "Ekstrüzyon" }).click();
  await expect(page.locator(".tree-row").first()).toHaveText("Ekstrüzyon 1");
  await expect(page.locator(".tree-row.consumed")).toHaveText(["Eskiz 1"]);

  const distance = page.getByLabel("Mesafe (− ters yön)");
  await distance.fill("8");
  await distance.press("Enter");
  await expect.poll(() => volumeOf(page, 1)).toBeCloseTo((40 * 20 - Math.PI * 25) * 8, -1);
  await page.locator(".view-buttons").getByRole("button", { name: "İzometrik" }).click();
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
  await page.locator("canvas").click({ position: { x: 5, y: 5 } });
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
