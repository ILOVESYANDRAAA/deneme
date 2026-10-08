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
