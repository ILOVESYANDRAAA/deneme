// İkonlar (sabit metin; kullanıcı girdisi içermez).
// İki aile var:
//  - svg(): 16'lık ızgarada tek renkli çizgi ikonları (currentColor). Uygulama çubuğu, gezinme,
//    görünüm ve kısıt ikonları bu ailede kalır.
//  - color(): 24'lük ızgarada çok renkli "nesne" ikonları (şerit araçları). Renkler styles.css'teki
//    --ico-* değişkenlerinden gelir; açık / koyu temada kendiliğinden değişir. Dil: hafif izometrik
//    (≈30°) nesne, dolgulu yüzler + kontur; üst yüz en açık, sol yüz orta, sağ yüz en koyu.
//    Gövde = mavi, işlem / vurgu = turuncu, yardımcı geometri = gri, eskiz = ince koyu mavi.
const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/** Çok renkli ikon (viewBox 0 0 24 24). Kontur kalınlığı --ico-sw ile bağlama göre ayarlanır. */
export const color = (body: string, size = 24) =>
  `<svg class="ci" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="var(--ico-line)" stroke-linejoin="round" stroke-linecap="round" style="stroke-width:var(--ico-sw,1.5)">${body}</svg>`;

// ICONS içindeki renkli ikonlar 16px basılır (menü, ağaç, iletişim kutusu başlığı); şerit CSS ile büyütür.
const ci = (body: string) => color(body, 16);

const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor" stroke="none"/>`;

// ---- renkli ikon yardımcıları ----
const TOP = "var(--ico-body-top)";
const MID = "var(--ico-body)";
const SIDE = "var(--ico-body-side)";
const ACC = "var(--ico-accent)";
const ACC_D = "var(--ico-accent-dark)";
const NEU = "var(--ico-neutral)";
const NEU_L = "var(--ico-neutral-light)";
const SK = "var(--ico-sketch)";
const PROF = "var(--ico-profile)";
const HOLE = "var(--ico-hole)";
const PAPER = "var(--ico-paper)";

type Pt = readonly [number, number];
const r2 = (v: number) => Math.round(v * 100) / 100;
const poly = (pts: readonly Pt[]) => "M" + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L") + "Z";
const ISO = 0.577; // tan 30°

/** İzometrik kutu köşeleri: (x, y) üst-arka köşe, s yatay yarı genişlik, h yükseklik. */
function iso(x: number, y: number, s: number, h: number) {
  const T: Pt = [x, y];
  const R: Pt = [x + s, y + s * ISO];
  const B: Pt = [x, y + 2 * s * ISO];
  const L: Pt = [x - s, y + s * ISO];
  const d = (p: Pt): Pt => [p[0], p[1] + h];
  return { T, R, B, L, Tb: d(T), Rb: d(R), Bb: d(B), Lb: d(L) };
}

/** Üç yüzü dolgulu izometrik kutu. */
function cube(x: number, y: number, s: number, h: number, attrs = ""): string {
  const c = iso(x, y, s, h);
  return (
    `<g${attrs ? " " + attrs : ""}>` +
    `<path d="${poly([c.L, c.B, c.Bb, c.Lb])}" fill="${MID}"/>` +
    `<path d="${poly([c.B, c.R, c.Rb, c.Bb])}" fill="${SIDE}"/>` +
    `<path d="${poly([c.T, c.R, c.B, c.L])}" fill="${TOP}"/></g>`
  );
}

/** Dolgulu turuncu ok (x1,y1 kuyruk → x2,y2 uç). */
function arrow(x1: number, y1: number, x2: number, y2: number, shaft = 1.15, head = 3.2, len = 4): string {
  const l = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / l;
  const uy = (y2 - y1) / l;
  const px = -uy;
  const py = ux;
  const bx = x2 - ux * len;
  const by = y2 - uy * len;
  const pts: Pt[] = [
    [x1 + px * shaft, y1 + py * shaft],
    [bx + px * shaft, by + py * shaft],
    [bx + px * head, by + py * head],
    [x2, y2],
    [bx - px * head, by - py * head],
    [bx - px * shaft, by - py * shaft],
    [x1 - px * shaft, y1 - py * shaft],
  ];
  return `<path d="${poly(pts)}" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>`;
}

/** Turuncu uç / kontrol noktası. */
const pt = (x: number, y: number, r = 2) =>
  `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>`;

/** İnce koyu mavi eskiz çizgisi grubu. */
const sk = (body: string, extra = "") => `<g stroke="${SK}" stroke-width="1.7"${extra ? " " + extra : ""}>${body}</g>`;

/** Gri kesikli yardımcı çizgi. */
const aux = (d: string) => `<path d="${d}" stroke="${NEU}" stroke-width="1.2" stroke-dasharray="2 1.6"/>`;

/** Gri yardımcı düzlem (izometrik paralelkenar). */
function planeIso(x: number, y: number, s: number, attrs = ""): string {
  const c = iso(x, y, s, 0);
  return `<path d="${poly([c.T, c.R, c.B, c.L])}" fill="${NEU_L}" stroke="${NEU}"${attrs ? " " + attrs : ""}/>`;
}

/** Konturlu tüp (süpürme / helis): kontur rengi geniş çizgi üstüne gövde rengi dar çizgi. */
const tube = (d: string, w = 5) =>
  `<path d="${d}" stroke="var(--ico-line)" stroke-width="${w}"/><path d="${d}" stroke="${MID}" stroke-width="${w - 2}"/>` +
  `<path d="${d}" stroke="${TOP}" stroke-width="${Math.max(0.9, w - 4.2)}" transform="translate(-.4 -.6)"/>`;

// Venn daireleri (birleşim / çıkarma / kesişim): merkezler (9,12) ve (15,12), r 6.5.
const V_TOP = "12 6.23";
const V_BOT = "12 17.77";
const vennUnion = `M${V_TOP}A6.5 6.5 0 1 0 ${V_BOT}A6.5 6.5 0 1 0 ${V_TOP}Z`;
const vennSub = `M${V_TOP}A6.5 6.5 0 1 0 ${V_BOT}A6.5 6.5 0 0 1 ${V_TOP}Z`;
const vennLens = `M${V_TOP}A6.5 6.5 0 0 1 ${V_BOT}A6.5 6.5 0 0 1 ${V_TOP}Z`;
const glint = (cx: number, cy: number, rx = 2.4, ry = 1.5) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${TOP}" stroke="none" transform="rotate(-30 ${cx} ${cy})"/>`;

// Ortak büyük kutu: üst köşe (12,3), s=8, h=9 → L(4,7.62) B(12,12.23) R(20,7.62), alt B 21.23.
const BX = iso(12, 3, 8, 9);
const roundEdge = (round: boolean) => {
  // Ön dikey kenarı yuvarlatılmış (yuvarlatma) ya da pahlanmış (pah) kutu; işlenen yüz turuncu.
  const a: Pt = [9.5, 10.79];
  const b: Pt = [14.5, 10.79];
  const top = round ? `Q12 12.23 ${a[0]} ${a[1]}` : `L${a[0]} ${a[1]}`;
  const bot = round ? `Q12 21.23 9.5 19.79` : `L9.5 19.79`;
  return (
    `<path d="${poly([BX.L, a, [9.5, 19.79], BX.Lb])}" fill="${MID}"/>` +
    `<path d="${poly([b, BX.R, BX.Rb, [14.5, 19.79]])}" fill="${SIDE}"/>` +
    `<path d="M12 3L20 7.62L14.5 10.79${top}L4 7.62Z" fill="${TOP}"/>` +
    `<path d="M9.5 10.79${round ? "Q12 12.23 14.5 10.79" : "L14.5 10.79"}V19.79${bot}Z" fill="${ACC}"/>`
  );
};

/** Kalem (eskiz): uç (x, y), 45° sağ üste uzanır. */
function pencil(x: number, y: number, len = 11, w = 1.8): string {
  const u: Pt = [Math.SQRT1_2, -Math.SQRT1_2];
  const p: Pt = [Math.SQRT1_2, Math.SQRT1_2];
  const at = (t: number, s: number): Pt => [x + u[0] * t + p[0] * s, y + u[1] * t + p[1] * s];
  const cone = 3;
  return (
    `<path d="${poly([at(cone, -w), at(len, -w), at(len, w), at(cone, w)])}" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>` +
    `<path d="${poly([[x, y], at(cone, -w), at(cone, w)])}" fill="${PAPER}" stroke="${ACC_D}" stroke-width="1"/>` +
    `<path d="M${r2(at(len - 2, -w)[0])} ${r2(at(len - 2, -w)[1])}L${r2(at(len - 2, w)[0])} ${r2(at(len - 2, w)[1])}" stroke="${ACC_D}" stroke-width="1"/>` +
    `<circle cx="${r2(at(0.6, 0)[0])}" cy="${r2(at(0.6, 0)[1])}" r=".8" fill="var(--ico-line)" stroke="none"/>`
  );
}

const COLOR_ICONS = {
  // ---- temel şekiller ----
  box: ci(cube(12, 3, 8, 9)),
  cylinder: ci(
    `<path d="M5 7v10a7 3 0 0 0 14 0V7Z" fill="${MID}" stroke="none"/>` +
      `<path d="M12 10v10a7 3 0 0 0 7-3V7a7 3 0 0 1-7 3Z" fill="${SIDE}" stroke="none"/>` +
      `<path d="M5 7v10a7 3 0 0 0 14 0V7"/><ellipse cx="12" cy="7" rx="7" ry="3" fill="${TOP}"/>`,
  ),
  sphere: ci(
    `<circle cx="12" cy="12" r="8.5" fill="${MID}"/>` +
      `<path d="M20.5 12a8.5 8.5 0 0 1-15 5.5 8.5 8.5 0 0 0 11.5-11.9A8.5 8.5 0 0 1 20.5 12Z" fill="${SIDE}" stroke="none"/>` +
      `<circle cx="12" cy="12" r="8.5"/>${glint(9, 8.5, 3.2, 2)}`,
  ),
  torus: ci(
    `<ellipse cx="12" cy="12.5" rx="9.5" ry="5.5" fill="${MID}"/>` +
      `<path d="M21.5 12.5a9.5 5.5 0 0 1-17 3.4 9.5 5 0 0 0 16.5-5.6 9.5 5.5 0 0 1 .5 2.2Z" fill="${SIDE}" stroke="none"/>` +
      `<ellipse cx="12" cy="12.5" rx="9.5" ry="5.5"/>` +
      `<ellipse cx="11.6" cy="11" rx="6.6" ry="3" fill="${TOP}" stroke="none"/>` +
      `<ellipse cx="12" cy="11.8" rx="3.6" ry="1.6" fill="${HOLE}"/>`,
  ),
  pipe: ci(
    `<path d="M5 7v10a7 3 0 0 0 14 0V7Z" fill="${MID}" stroke="none"/>` +
      `<path d="M12 10v10a7 3 0 0 0 7-3V7a7 3 0 0 1-7 3Z" fill="${SIDE}" stroke="none"/>` +
      `<path d="M5 7v10a7 3 0 0 0 14 0V7"/><ellipse cx="12" cy="7" rx="7" ry="3" fill="${TOP}"/>` +
      `<ellipse cx="12" cy="7" rx="4" ry="1.7" fill="${HOLE}"/>`,
  ),
  coil: ci(tube("M6 5.5C10 3 19 4 18 6.5S6 9 6 11.5 18 12.5 18 14.5 6 17 6 19.5", 4.4)),

  // ---- eskiz oluşturma ----
  sketch: ci(planeIso(12, 8.5, 10) + sk(`<ellipse cx="9.5" cy="14.4" rx="4.2" ry="2.4" fill="${PROF}"/>`) + pencil(12.4, 14)),
  sketchOnFace: ci(
    cube(12, 4.5, 8, 8.5) + sk(`<ellipse cx="12" cy="9.12" rx="4.4" ry="2.5" fill="${PROF}"/>`) + pt(12, 9.12, 1.6),
  ),
  sketchOffset: ci(planeIso(12, 11.5, 9) + planeIso(12, 2.5, 9, `stroke-dasharray="2 1.4" opacity=".9"`) + arrow(12, 18, 12, 6.5)),
  planeAngled: ci(
    `<path d="M3 15.2 12 20.4 21 15.2 12 10Z" stroke="${NEU}" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
      `<path d="M3 15.2 12 20.4 17.5 8.8 8.5 3.6Z" fill="${NEU_L}" stroke="${NEU}"/>` +
      `<path d="M3 15.2 12 20.4" stroke="${ACC}" stroke-width="2"/>` +
      `<path d="M18.2 17.2Q19.8 14.6 17.4 12.4" stroke="${ACC}" stroke-width="1.8"/>`,
  ),
  plane3pt: ci(
    planeIso(12, 6.5, 10) + sk(`<path d="M12 9.3 18.4 12.6 8 15.2Z"/>`) + pt(12, 9.3) + pt(18.4, 12.6) + pt(8, 15.2),
  ),

  // ---- katı oluşturma ----
  extrude: ci(
    cube(12, 9.5, 7.5, 5) + arrow(12, 14.2, 12, 1.6, 1.2, 3.6, 4.4),
  ),
  revolve: ci(
    aux("M10 1.5v21") +
      `<path d="M10 3h6v4h-2.5v6H18v4h-8Z" fill="${MID}"/>` +
      `<path d="M2 18.5A8 3 0 0 0 18 18.5" stroke="${ACC}" stroke-width="2.2"/>` +
      `<path d="M15.4 19 18 14.8 20.6 19Z" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>`,
  ),
  rib: ci(
    cube(12, 9, 9, 3.5) +
      `<path d="M7.5 11.6 16.5 16.79 16.5 8.79 7.5 3.6Z" fill="${MID}"/>` +
      `<path d="M16.5 16.79 18.1 15.87 18.1 7.87 16.5 8.79Z" fill="${SIDE}"/>` +
      `<path d="M7.5 3.6 16.5 8.79 18.1 7.87 9.1 2.68Z" fill="${ACC}" stroke="var(--ico-line)"/>`,
  ),
  loft: ci(
    `<path d="M4 18 8 5.5A4 1.6 0 0 0 16 5.5L20 18A8 3 0 0 1 4 18Z" fill="${MID}" stroke="none"/>` +
      `<path d="M12 7.1V21A8 3 0 0 0 20 18L16 5.5A4 1.6 0 0 1 12 7.1Z" fill="${SIDE}" stroke="none"/>` +
      `<path d="M4 18 8 5.5M16 5.5 20 18A8 3 0 0 1 4 18"/>` +
      `<ellipse cx="12" cy="5.5" rx="4" ry="1.6" fill="${TOP}" stroke="${ACC_D}"/>` +
      `<path d="M4 18A8 3 0 0 0 20 18" stroke="${ACC}" stroke-width="1.8"/>` +
      `<path d="M4 18A8 3 0 0 1 20 18" stroke="${ACC}" stroke-width="1.2" stroke-dasharray="1.8 1.5"/>`,
  ),
  sweep: ci(
    aux("M4.5 19.5C9 19.5 8 9 19 6") +
      tube("M4.5 19.5C9 19.5 8 9 18.5 6.2", 5.6) +
      `<ellipse cx="19" cy="6.1" rx="1.6" ry="2.8" fill="${TOP}" transform="rotate(-15 19 6.1)"/>` +
      `<ellipse cx="4.5" cy="19.5" rx="1.5" ry="2.8" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>`,
  ),

  // ---- desen / ayna / dönüşüm ----
  linearPattern: ci(cube(12, 5.5, 3.8, 4.2) + cube(6.4, 8.73, 3.8, 4.2) + cube(17.6, 8.73, 3.8, 4.2) + cube(12, 11.96, 3.8, 4.2)),
  circularPattern: ci(
    `<ellipse cx="12" cy="13" rx="7" ry="4" stroke="${ACC}" stroke-width="1.5" stroke-dasharray="2 1.6"/>` +
      cube(12, 5.6, 3, 3.4) +
      cube(5, 9.6, 3, 3.4) +
      cube(19, 9.6, 3, 3.4) +
      cube(12, 13.6, 3, 3.4),
  ),
  mirror: ci(
    cube(5.5, 7, 4.5, 6) +
      `<path d="M10.5 2.5 13.5 4.2V21.5L10.5 19.8Z" fill="${NEU_L}" stroke="${NEU}"/>` +
      cube(18.5, 7, 4.5, 6, `opacity=".55"`),
  ),
  scale: ci(
    `<g stroke="${NEU}" stroke-width="1.2" stroke-dasharray="2 1.6"><path d="${poly([BX.T, BX.R, BX.Rb, BX.Bb, BX.Lb, BX.L])}"/><path d="M4 7.62 12 12.23 20 7.62M12 12.23v9"/></g>` +
      cube(8.5, 9.02, 4.5, 5) +
      arrow(10.5, 10.5, 19, 4.2, 1.1, 3, 3.8),
  ),
  move: ci(
    cube(12, 8, 5.5, 6) +
      arrow(12, 10, 12, 1.4, 1.1, 3, 3.6) +
      arrow(17, 15.5, 22.6, 18.7, 1.1, 3, 3.6) +
      arrow(7, 15.5, 1.4, 18.7, 1.1, 3, 3.6),
  ),
  split: ci(
    cube(12, 10.8, 7.5, 3.6) +
      `<path d="${poly([[12, 6.6], [22.6, 12.72], [12, 18.84], [1.4, 12.72]])}" fill="${ACC}" fill-opacity=".35" stroke="${ACC}" stroke-width="1.5"/>` +
      cube(12, 1.6, 7.5, 3.6),
  ),

  // ---- boolean ----
  union: ci(`<path d="${vennUnion}" fill="${MID}"/>${glint(7.4, 9.4)}${glint(15.6, 9.4)}`),
  subtract: ci(
    `<path d="${vennSub}" fill="${MID}"/>${glint(7, 9.4)}` +
      `<path d="M12 17.77A6.5 6.5 0 0 1 12 6.23" stroke="${ACC}" stroke-width="2"/>` +
      `<path d="M12 6.23A6.5 6.5 0 1 1 12 17.77" stroke="${ACC}" stroke-width="1.3" stroke-dasharray="2 1.6"/>`,
  ),
  intersect: ci(
    `<circle cx="9" cy="12" r="6.5" stroke="${NEU}" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
      `<circle cx="15" cy="12" r="6.5" stroke="${NEU}" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
      `<path d="${vennLens}" fill="${MID}" stroke="${ACC_D}"/>${glint(11, 10, 1.1, 1.6)}`,
  ),

  // ---- değiştir ----
  fillet: ci(roundEdge(true)),
  chamfer: ci(roundEdge(false)),
  hole: ci(
    cube(12, 3, 8, 9) +
      `<ellipse cx="12" cy="7.62" rx="3.8" ry="2.2" fill="${SIDE}" stroke="${ACC}" stroke-width="1.6"/>` +
      `<ellipse cx="12" cy="8.5" rx="2.8" ry="1.35" fill="${HOLE}" stroke="none"/>`,
  ),
  shell: ci(
    cube(12, 3, 8, 9) +
      `<path d="M7.04 7.62 12 4.76 12 7.96 9.82 9.22Z" fill="${SIDE}" stroke="none"/>` +
      `<path d="M12 4.76 16.96 7.62 14.18 9.22 12 7.96Z" fill="${MID}" stroke="none"/>` +
      `<path d="M9.82 9.22 12 7.96 14.18 9.22 12 10.48Z" fill="${TOP}" stroke="none"/>` +
      `<path d="M12 4.76V7.96M9.82 9.22 12 7.96 14.18 9.22" stroke-width="1"/>` +
      `<path d="M12 4.76 16.96 7.62 12 10.48 7.04 7.62Z" stroke="${ACC}" stroke-width="1.6"/>`,
  ),
  draft: ci(
    `<path d="M4.5 7.04 11.5 11.08 13.7 21.35 4.5 16.04Z" fill="${MID}"/>` +
      `<path d="M11.5 11.08 18.5 7.04 20.7 17.31 13.7 21.35Z" fill="${ACC}"/>` +
      `<path d="M11.5 3 18.5 7.04 11.5 11.08 4.5 7.04Z" fill="${TOP}"/>` +
      `<path d="M18.5 7.04V16.5" stroke="${NEU}" stroke-width="1.2" stroke-dasharray="1.8 1.4"/>` +
      `<path d="M18.5 13.6Q19.4 13.9 19.9 13.2" stroke="${ACC_D}" stroke-width="1.2"/>`,
  ),

  // ---- incele ----
  measure: ci(
    `<path d="M3 15.5 15 4.5 21 8 9 19Z" fill="${ACC}"/>` +
      `<path d="M9 19 21 8V10.4L9 21.4Z" fill="${ACC_D}"/>` +
      `<path d="M3 15.5V17.9L9 21.4V19Z" fill="${ACC_D}"/>` +
      `<path d="M3 15.5 15 4.5 21 8 9 19ZM9 19V21.4L21 10.4V8M3 15.5V17.9L9 21.4"/>` +
      `<path d="M11.4 16.8 9.9 15.8M13.8 14.6 11.6 13.2M16.2 12.4 14.7 11.4M18.6 10.2 16.4 8.8" stroke-width="1.1"/>`,
  ),
  mass: ci(
    `<path d="M12 3.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2Z" stroke-width="3"/>` +
      `<path d="M12 3.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2Z" stroke="${NEU_L}" stroke-width="1.2"/>` +
      `<path d="M5.5 20.5 7.5 9H16.5L18.5 20.5Z" fill="${MID}"/>` +
      `<path d="M12 9H16.5L18.5 20.5H12Z" fill="${SIDE}" stroke="none"/>` +
      `<path d="M5.5 20.5 7.5 9H16.5L18.5 20.5Z"/>` +
      `<circle cx="12" cy="15" r="3.1" fill="${PAPER}" stroke="${ACC_D}" stroke-width="1"/>` +
      `<path d="M12 15V11.9A3.1 3.1 0 0 1 15.1 15ZM12 15V18.1A3.1 3.1 0 0 1 8.9 15Z" fill="${ACC}" stroke="none"/>`,
  ),
  section: ci(
    `<path d="M6 8.6 18 1.66V15.66L6 22.6Z" fill="${NEU_L}" stroke="${NEU}" opacity=".85"/>` +
      `<g stroke="${NEU}" stroke-width="1.1" stroke-dasharray="1.6 1.3"><path d="M8 9.93 12 12.23 20 7.62 16 5.31M12 12.23V21.23L8 18.93M20 7.62V16.62L12 21.23"/></g>` +
      `<path d="M4 7.62 8 9.93 8 18.93 4 16.62Z" fill="${MID}"/>` +
      `<path d="M4 7.62 12 3 16 5.31 8 9.93Z" fill="${TOP}"/>` +
      `<path d="M8 9.93 16 5.31 16 14.31 8 18.93Z" fill="${ACC}"/>` +
      `<path d="M8 13.53 11.2 8.08M8 17.13 14.4 6.23M9.6 18 16 7.11M12.8 16.16 16 10.71" stroke="${ACC_D}" stroke-width=".9"/>`,
  ),

  // ---- eskiz araçları ----
  line: ci(sk(`<path d="M4 19 20 5"/>`) + pt(4, 19) + pt(20, 5)),
  rect: ci(sk(`<rect x="4" y="6" width="16" height="12" fill="${PROF}"/>`) + pt(4, 18) + pt(20, 6)),
  rectCenter: ci(sk(`<rect x="4" y="6" width="16" height="12" fill="${PROF}"/>`) + aux("M12 12 20 6") + pt(12, 12) + pt(20, 6)),
  rect3: ci(sk(`<path d="M3 15 13.5 4.5 21 12 10.5 22.5Z" fill="${PROF}"/>`) + pt(3, 15) + pt(13.5, 4.5) + pt(21, 12)),
  circle: ci(sk(`<circle cx="12" cy="12" r="8" fill="${PROF}"/>`) + aux("M12 12 17.7 6.3") + pt(12, 12)),
  circle2: ci(sk(`<circle cx="12" cy="12" r="8" fill="${PROF}"/>`) + aux("M4 12h16") + pt(4, 12) + pt(20, 12)),
  circle3: ci(sk(`<circle cx="12" cy="12" r="8" fill="${PROF}"/>`) + pt(4, 12) + pt(16, 5.07) + pt(16, 18.93)),
  arc3: ci(sk(`<path d="M3.5 18A9 9 0 0 1 20.5 18"/>`) + pt(3.5, 18) + pt(12, 6.04) + pt(20.5, 18)),
  arcCenter: ci(sk(`<path d="M20 12A8 8 0 0 1 4 12"/>`) + aux("M4 12h16") + pt(12, 12) + pt(20, 12) + pt(4, 12)),
  polygon: ci(
    sk(`<path d="M12 3.5 19.36 7.75V16.25L12 20.5 4.64 16.25V7.75Z" fill="${PROF}"/>`) + aux("M12 12V3.5") + pt(12, 12) + pt(12, 3.5),
  ),
  slot: ci(sk(`<path d="M7.5 8h9a4 4 0 0 1 0 8h-9a4 4 0 0 1 0-8Z" fill="${PROF}"/>`) + aux("M7.5 12h9") + pt(7.5, 12) + pt(16.5, 12)),
  ellipse: ci(sk(`<ellipse cx="12" cy="12" rx="9" ry="5.4" fill="${PROF}" transform="rotate(-20 12 12)"/>`) + pt(12, 12)),
  spline: ci(sk(`<path d="M3 18C6 3 10.5 4.5 12 12s6 9 9-6"/>`) + pt(3, 18) + pt(12, 12) + pt(21, 6)),
  point: ci(aux("M12 3v18M3 12h18") + pt(12, 12, 2.6)),
  sketchFillet: ci(aux("M4 11V4h7") + sk(`<path d="M4 20V11A7 7 0 0 1 11 4H20"/>`) + pt(4, 11) + pt(11, 4)),
  trim: ci(
    sk(`<path d="M8 3v18M16 3v18M3 12h5M16 12h5"/>`) +
      `<path d="M8 12h8" stroke="${ACC}" stroke-width="2" stroke-dasharray="1.6 1.6"/>` +
      `<path d="m10.6 8.6 2.8 2.8M13.4 8.6l-2.8 2.8" stroke="${ACC_D}" stroke-width="1.4"/>`,
  ),
  extend: ci(
    sk(`<path d="M3 12h8M20 3v18"/>`) +
      `<path d="M11 12h6.5" stroke="${ACC}" stroke-width="2" stroke-dasharray="1.8 1.5"/>` +
      `<path d="M15.6 9.2 19 12 15.6 14.8" stroke="${ACC}" stroke-width="2"/>` +
      pt(3, 12),
  ),
  offset: ci(sk(`<path d="M4 20V12a8 8 0 0 1 8-8h8"/>`) + `<path d="M9 20v-8a3 3 0 0 1 3-3h8" stroke="${ACC}" stroke-width="1.8"/>`),
  dimension: ci(
    `<path d="M4 18V7M20 18V7" stroke="${NEU}" stroke-width="1.2"/>` +
      `<path d="M7 10h10" stroke="${ACC}" stroke-width="1.5"/>` +
      `<path d="M4.3 10 8.2 7.8V12.2ZM19.7 10 15.8 7.8V12.2Z" fill="${ACC}" stroke="${ACC_D}" stroke-width="1"/>` +
      sk(`<path d="M4 18h16"/>`) +
      pt(4, 18) +
      pt(20, 18),
  ),
  sketchMove: ci(
    sk(`<rect x="3" y="10" width="9" height="9" fill="${PROF}"/>`) +
      arrow(15.5, 8.5, 22, 8.5, 0.9, 2.5, 3) +
      arrow(15.5, 8.5, 15.5, 2, 0.9, 2.5, 3) +
      arrow(15.5, 8.5, 9, 8.5, 0.9, 2.5, 3) +
      arrow(15.5, 8.5, 15.5, 15, 0.9, 2.5, 3),
  ),
  sketchRotate: ci(
    sk(`<path d="M4.2 12.5 13.6 9.1 15.7 14.7 6.3 18.1Z" fill="${PROF}"/>`) +
      `<path d="M14.5 3.6A9 9 0 0 1 20 15.6" stroke="${ACC}" stroke-width="2.2"/>` +
      arrow(20.4, 14.4, 18.6, 19.6, 0.9, 2.8, 3.6),
  ),
  sketchPatternRect: ci(
    sk(`<rect x="3" y="3" width="7" height="7" fill="${PROF}"/>`) +
      sk(`<rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>`, `stroke-dasharray="2 1.5" opacity=".75"`) +
      pt(6.5, 6.5, 1.6),
  ),
  sketchPatternCircular: ci(
    aux("M12 12m-6.5 0a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0") +
      sk(`<circle cx="12" cy="5.5" r="2.6" fill="${PROF}"/>`) +
      sk(`<circle cx="18.2" cy="15.2" r="2.6"/><circle cx="5.8" cy="15.2" r="2.6"/>`, `stroke-dasharray="1.8 1.3" opacity=".75"`) +
      pt(12, 12, 1.6),
  ),
  sketchMirror: ci(
    aux("M12 2v20") +
      sk(`<path d="M3 18 9 6V18Z" fill="${PROF}"/>`) +
      `<path d="M21 18 15 6V18Z" fill="${ACC}" fill-opacity=".22" stroke="${ACC}" stroke-width="1.7"/>`,
  ),
  construction: ci(
    `<g stroke="${ACC}" stroke-width="1.7" stroke-dasharray="2.6 1.8"><path d="M3 21 21 3"/><circle cx="12" cy="12" r="6.5"/></g>`,
  ),
  select: ci(`<path d="M6 3 18 13.5 12.6 14.2 15.6 20.4 13 21.6 10 15.3 6 19Z" fill="${PAPER}"/>`),
  trash: ci(
    `<path d="M6.5 8 7.5 21H16.5L17.5 8Z" fill="${NEU_L}"/>` +
      `<path d="M10 3.5h4V5.5h-4Z" fill="${NEU}"/><path d="M4.5 5.5h15V8h-15Z" fill="${NEU}"/>` +
      `<path d="M10 10.5v8M14 10.5v8" stroke="${NEU}" stroke-width="1.4"/>`,
  ),
  finishSketch: ci(
    `<circle cx="12" cy="12" r="9.5" fill="var(--ok)" stroke="var(--ico-ok-line)"/>` +
      `<path d="m7.2 12.4 3.3 3.3 6.4-7.2" stroke="var(--ico-ok-mark)" stroke-width="2.6"/>`,
  ),
} as const;

export const ICONS = {
  ...COLOR_ICONS,
  plugin: svg('<path d="M3 5h3V3.5a1.5 1.5 0 0 1 3 0V5h3v3h-1.5a1.5 1.5 0 0 0 0 3H12v3H3Z"/>'),
  undo: svg('<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
  redo: svg('<path d="m10.5 3 3 3-3 3"/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
  fit: svg('<path d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5"/><rect x="5.5" y="5.5" width="5" height="5"/>'),
  tree: svg('<path d="M3 2.5h4M5 2.5v11M5 7.5h4.5M5 13h4.5"/><rect x="9.5" y="5.5" width="4" height="4" rx=".5"/><rect x="9.5" y="11" width="4" height="4" rx=".5"/>'),
  parameters: svg('<path d="M3 3.5h10M3 8h10M3 12.5h10"/><path d="M5.5 2v3M10.5 6.5v3M7 11v3" /><circle cx="5.5" cy="3.5" r="1" fill="currentColor"/><circle cx="10.5" cy="8" r="1" fill="currentColor"/><circle cx="7" cy="12.5" r="1" fill="currentColor"/>'),
  extensions: svg('<rect x="2" y="2" width="5" height="5" rx=".5"/><rect x="2" y="9" width="5" height="5" rx=".5"/><rect x="9" y="9" width="5" height="5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="5" rx=".5" transform="rotate(12 12 4)"/>'),
  palette: svg('<path d="M4 6l3 2-3 2M8.5 11H12"/><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>'),
  properties: svg('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4"/>'),
  save: svg('<path d="M2.5 2.5h9l2 2v9h-11Z"/><path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4"/>'),
  open: svg('<path d="M1.5 4V13h11l2-6H4l-2.5 6"/><path d="M1.5 4V2.5h4l1.5 1.5h5V7"/>'),
  newFile: svg('<path d="M3.5 1.5h6l3 3v10h-9Z"/><path d="M9.5 1.5v3h3M8 7.5v4M6 9.5h4"/>'),
  export: svg('<path d="M3.5 9.5v4h9v-4"/><path d="M8 2v8M5 5l3-3 3 3"/>'),
  cCoincident: svg(`<circle cx="8" cy="8" r="2.4"/><path d="M2 8h3.6M10.4 8H14"/>`),
  cHorizontal: svg('<path d="M2 8h12"/><path d="M5 5.5v5M11 5.5v5" opacity=".0"/><path d="M4 11h8" stroke-dasharray="1.2 1.4"/>'),
  cVertical: svg('<path d="M8 2v12"/><path d="M11 4v8" stroke-dasharray="1.2 1.4"/>'),
  cParallel: svg('<path d="M4 13 8 3M9 13l4-10"/>'),
  cPerpendicular: svg('<path d="M3 13h10M8 13V3"/><path d="M8 10.5h2.5V13"/>'),
  cTangent: svg('<circle cx="8" cy="9" r="4"/><path d="M1.5 5h13"/>'),
  cEqual: svg('<path d="M3 6h10M3 10h10"/>'),
  cFix: svg('<circle cx="8" cy="5" r="2"/><path d="M8 7v7M5 11l3 3 3-3"/>'),
  cMidpoint: svg(`<path d="M2 12 14 4"/>${dot(8, 8)}<path d="M8 6.2v3.6" opacity=".0"/>`),
  cConcentric: svg('<circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r="5.5"/>'),
  cOnCurve: svg(`<circle cx="8" cy="8" r="5.5"/>${dot(13.5, 8)}`),
  cSymmetric: svg('<path d="M8 1.5v13" stroke-dasharray="1.6 1.4"/><circle cx="4.5" cy="8" r="1.6"/><circle cx="11.5" cy="8" r="1.6"/>'),
  home: svg('<path d="M2 7.5 8 2.5l6 5"/><path d="M3.5 6.5v7h3.5v-4h2v4h3.5v-7"/>'),
  eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" opacity=".45"/><path d="m2.5 13.5 11-11"/>'),
  zoomIn: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5M5 7h4M7 5v4"/>'),
  zoomOut: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5M5 7h4"/>'),
  display: svg('<rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1"/><path d="M5.5 14h5M8 11.2V14"/>'),
  chevronDown: svg('<path d="m4 6 4 4 4-4"/>'),
  chevronRight: svg('<path d="m6 4 4 4-4 4"/>'),
  grip: svg(`${dot(6, 4)}${dot(10, 4)}${dot(6, 8)}${dot(10, 8)}${dot(6, 12)}${dot(10, 12)}`),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  minimize: svg('<path d="M3.5 8h9"/>'),
  grid: svg('<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/><rect x="2" y="2" width="12" height="12"/>'),
  styleShaded: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" fill="currentColor" fill-opacity=".35"/>'),
  styleEdges: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" fill="currentColor" fill-opacity=".35"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6"/>'),
  styleWire: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6M2.2 11 8 7.8l5.8 3.2M8 1.8v6" stroke-dasharray="1.3 1.1"/>'),
  plane: svg('<path d="M1.5 10.5 6 6.5h8.5L10 10.5Z"/>'),
  folder: svg('<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13Z"/>'),
  origin: svg('<path d="M3 13V3M3 13h10M3 13l5-4"/>'),
  check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>'),
  error: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8v4M8 11v.2"/>'),
  menu: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function iconForType(type: string, op?: string): string {
  if (type === "boolean") return ICONS[(op as "union" | "subtract" | "intersect") ?? "union"] ?? ICONS.union;
  if (type in ICONS) return ICONS[type as IconName];
  return ICONS.plugin;
}
