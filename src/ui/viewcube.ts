import { h, icon } from "./dom";
import { ICONS } from "./icons";
import type { ViewName, Viewport } from "./viewport";

const SIZE = 64;

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

/** Fusion 360'taki gibi görünüm küpü: kamerayla döner, yüzüne tıklayınca o görünüme geçer. */
export class ViewCube {
  readonly element: HTMLElement;
  private cube: HTMLElement;
  private last = "";

  constructor(private readonly viewport: Viewport) {
    this.cube = h(
      "div",
      { class: "viewcube-cube" },
      ...FACES.map((f) => {
        const half = SIZE / 2;
        const m = [...f.r, 0, ...f.d, 0, ...f.n, 0, f.n[0] * half, f.n[1] * half, f.n[2] * half, 1];
        return h(
          "button",
          {
            class: "viewcube-face",
            style: `transform: matrix3d(${m.join(",")})`,
            title: `${f.label[0]}${f.label.slice(1).toLocaleLowerCase("tr")} görünüm`,
            attrs: { "aria-label": `${f.label} görünümü` },
            dataset: { view: f.view },
            onclick: () => viewport.setView(f.view),
          },
          f.label,
        );
      }),
    );
    const home = h(
      "button",
      { class: "viewcube-home", title: "Ana görünüm (izometrik)", attrs: { "aria-label": "Ana görünüm" }, onclick: () => viewport.setView("iso") },
      icon(ICONS.home),
    );
    this.element = h(
      "div",
      { class: "viewcube", attrs: { role: "group", "aria-label": "Görünüm küpü" } },
      h("div", { class: "viewcube-stage" }, this.cube),
      home,
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
