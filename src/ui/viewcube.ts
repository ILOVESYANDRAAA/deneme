import { h, icon } from "./dom";
import { ICONS } from "./icons";
import { openMenu } from "./menu";
import type { ViewName, Viewport } from "./viewport";

const SIZE = 72;
/** Yüz yerel koordinatında (−1..1) bu eşiğin ötesi kenar / köşe bölgesidir. */
const EDGE = 0.6;

/**
 * Yüzlerin dünya eksenlerindeki yerleşimi: dışarıdan bakan birinin sağı (r), aşağısı (d)
 * ve dışa bakan normal (n). Yazılar her yüzde düz okunur.
 */
const FACES: { view: ViewName; label: string; r: number[]; d: number[]; n: number[] }[] = [
  { view: "top", label: "ÜST", r: [1, 0, 0], d: [0, -1, 0], n: [0, 0, 1] },
  { view: "bottom", label: "ALT", r: [1, 0, 0], d: [0, 1, 0], n: [0, 0, -1] },
  { view: "front", label: "ÖN", r: [1, 0, 0], d: [0, 0, -1], n: [0, -1, 0] },
  { view: "back", label: "ARKA", r: [-1, 0, 0], d: [0, 0, -1], n: [0, 1, 0] },
  { view: "right", label: "SAĞ", r: [0, 1, 0], d: [0, 0, -1], n: [1, 0, 0] },
  { view: "left", label: "SOL", r: [0, -1, 0], d: [0, 0, -1], n: [-1, 0, 0] },
];

type Face = (typeof FACES)[number];

/** Yüz üzerindeki normalleştirilmiş (−1..1) noktadan bölgeyi bulur: yüz, kenar ya da köşe. */
export function zoneOf(x: number, y: number): { sx: number; sy: number; kind: "face" | "edge" | "corner" } {
  const sx = Math.abs(x) > EDGE ? Math.sign(x) : 0;
  const sy = Math.abs(y) > EDGE ? Math.sign(y) : 0;
  return { sx, sy, kind: sx && sy ? "corner" : sx || sy ? "edge" : "face" };
}

/** Bölgenin küp merkezinden dışa doğru yön vektörü (yüz normali + kenar/köşe bileşenleri). */
export function zoneDirection(f: Pick<Face, "r" | "d" | "n">, sx: number, sy: number): [number, number, number] {
  return [0, 1, 2].map((i) => f.n[i] + sx * f.r[i] + sy * f.d[i]) as [number, number, number];
}

/** Fusion 360'taki gibi görünüm küpü: kamerayla döner; yüz, kenar ya da köşeye tıklayınca o görünüme geçer. */
export class ViewCube {
  readonly element: HTMLElement;
  private cube: HTMLElement;
  private last = "";

  constructor(private readonly viewport: Viewport) {
    const faceButton = (f: Face) => {
      const half = SIZE / 2;
      const m = [...f.r, 0, ...f.d, 0, ...f.n, 0, f.n[0] * half, f.n[1] * half, f.n[2] * half, 1];
      const zone = h("span", { class: "viewcube-zone", attrs: { "aria-hidden": "true" } });
      const btn = h(
        "button",
        {
          class: "viewcube-face",
          style: `transform: matrix3d(${m.join(",")})`,
          title: `${f.label[0]}${f.label.slice(1).toLocaleLowerCase("tr")} görünüm`,
          attrs: { "aria-label": `${f.label} görünümü` },
          dataset: { view: f.view },
        },
        zone,
        f.label,
      );
      // Tıklanan noktanın yüz yerel koordinatı (offsetX/Y dönüştürülmüş öğede yereldir).
      const local = (e: MouseEvent) => zoneOf((e.offsetX / SIZE) * 2 - 1, (e.offsetY / SIZE) * 2 - 1);
      btn.addEventListener("click", (e) => {
        const { sx, sy } = local(e);
        viewport.setViewDirection(zoneDirection(f, sx, sy));
      });
      btn.addEventListener("pointermove", (e) => {
        const { sx, sy } = local(e);
        const x0 = sx < 0 ? 0 : sx > 0 ? 80 : 20;
        const x1 = sx < 0 ? 20 : sx > 0 ? 100 : 80;
        const y0 = sy < 0 ? 0 : sy > 0 ? 80 : 20;
        const y1 = sy < 0 ? 20 : sy > 0 ? 100 : 80;
        zone.style.cssText = `left:${x0}%;top:${y0}%;width:${x1 - x0}%;height:${y1 - y0}%`;
      });
      btn.addEventListener("pointerleave", () => zone.removeAttribute("style"));
      return btn;
    };
    this.cube = h("div", { class: "viewcube-cube" }, ...FACES.map(faceButton));

    const goHome = () => viewport.setView("iso");
    const home = h(
      "button",
      { class: "viewcube-home", title: "Ana görünüm (izometrik)", attrs: { "aria-label": "Ana görünüm" }, onclick: goHome },
      icon(ICONS.home),
    );
    const more = h(
      "button",
      { class: "viewcube-more", title: "Görünüm küpü ayarları", attrs: { "aria-label": "Görünüm küpü menüsü", "aria-haspopup": "menu", "aria-expanded": "false" } },
      icon(ICONS.chevronDown),
    );
    more.addEventListener("click", () =>
      openMenu(more, [
        { label: "Ev'e dön", icon: ICONS.home, run: goHome },
        { label: "Mevcut görünümü Ev yap", disabled: true },
        { separator: true, label: "" },
        { label: "Perspektif", checked: viewport.projection === "perspective", run: () => viewport.setProjection("perspective") },
        { label: "Ortografik", checked: viewport.projection === "orthographic", run: () => viewport.setProjection("orthographic") },
      ]),
    );
    this.element = h(
      "div",
      { class: "viewcube", attrs: { role: "group", "aria-label": "Görünüm küpü" } },
      h("div", { class: "viewcube-stage" }, this.cube),
      home,
      more,
    );
    viewport.onDidChangeCamera.on(() => this.update());
  }

  private update(): void {
    // Görünüm matrisinin dönme kısmı; CSS'te y aşağı baktığı için ikinci satır ters çevrilir.
    const e = this.viewport.viewRotation();
    const m = [e[0], -e[1], e[2], 0, e[4], -e[5], e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
    const key = m.map((v) => v.toFixed(4)).join(",");
    if (key === this.last) return;
    this.last = key;
    this.cube.style.transform = `matrix3d(${key})`;
  }
}
