import * as THREE from "three";
import type { SugarApp } from "../app/controller";
import { coplanarRegion } from "../core/meshpick";
import { frameFromFace } from "../core/sketch";
import { h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import type { Sketcher } from "./sketcher";
import type { PointerHandler, Viewport } from "./viewport";

/**
 * Yüzeye Eskiz: gövdenin düz bir yüzeyine tıklanır, o yüzeyin düzleminde yeni eskiz açılır.
 * İmleç altındaki düz bölge vurgulanır. (Eskiz yüzeye "bağlı" değildir: gövde değişirse eskiz yerinde kalır.)
 */
export class FaceSketchTool implements PointerHandler {
  private box: HTMLElement | null = null;
  private highlight: THREE.Mesh | null = null;
  private hoverKey = "";

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly sketcher: Sketcher,
    private readonly onChanged: () => void,
  ) {}

  get isActive(): boolean {
    return this.box !== null;
  }

  open(): void {
    this.close();
    this.box = hudBox("Yüzeye Eskiz", ICONS.sketch, () => this.close(), h("div", { class: "inspect-body" }, h("div", { class: "meta" }, "Eskiz çizilecek düz yüzeye tıklayın (Esc: vazgeç)")));
    this.viewport.element.append(this.box);
    this.viewport.setInteraction(this);
    this.onChanged();
  }

  close(): void {
    if (!this.box) return;
    this.box.remove();
    this.box = null;
    this.clearHighlight();
    if (this.viewport.currentInteraction === this) this.viewport.setInteraction(null);
    this.onChanged();
  }

  /** Yüzey noktası ve normalinden eskiz açar (fare tıklaması ve testler bunu kullanır). */
  sketchOn(point: [number, number, number], normal: [number, number, number]): void {
    const feature = this.app.createSketch(frameFromFace(point, normal));
    this.close();
    this.sketcher.edit(feature.id);
  }

  pointerMove(e: PointerEvent): void {
    const hit = this.viewport.pickSurface(e.clientX, e.clientY);
    if (!hit) return this.clearHighlight();
    const mesh = this.app.meshes.get(hit.featureId);
    const region = mesh ? coplanarRegion(mesh.positions, mesh.indices, hit.faceIndex) : null;
    if (!mesh || !region) return this.clearHighlight();
    const key = `${hit.featureId}:${region.tris[0]}:${region.tris.length}`;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.clearHighlight(false);
    const idx: number[] = [];
    for (const t of region.tris) idx.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(idx);
    this.highlight = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: 0xffa81f, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.highlight.renderOrder = 31;
    this.viewport.layer.add(this.highlight);
    this.viewport.requestRender();
  }

  pointerLeave(): void {
    this.clearHighlight();
  }

  click(e: PointerEvent): void {
    const hit = this.viewport.pickSurface(e.clientX, e.clientY);
    if (!hit) return;
    const mesh = this.app.meshes.get(hit.featureId);
    const region = mesh ? coplanarRegion(mesh.positions, mesh.indices, hit.faceIndex) : null;
    // Eğri yüzeyde komşu üçgenlerin normali ayrışır: yalnız tek üçgenlik bölge eskiz için anlamsızdır.
    if (!region || (region.tris.length < 2 && mesh && mesh.indices.length / 3 > 2)) {
      this.app.showMessage("Eskiz için düz bir yüzey seçin (eğri yüzeylerde eskiz açılamaz)", "warning");
      return;
    }
    this.sketchOn(hit.point, region.normal);
  }

  doubleClick(): void {}

  private clearHighlight(resetKey = true): void {
    if (resetKey) this.hoverKey = "";
    if (!this.highlight) return;
    this.viewport.layer.remove(this.highlight);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.highlight = null;
    this.viewport.requestRender();
  }
}
