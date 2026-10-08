import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { SugarApp } from "../app/controller";
import { BREP_LABELS, PULL_DIRECTIONS, type BrepFeatureType } from "../core/features";
import type { Vec3 } from "../core/solid";
import type { BrepInfo } from "../geometry/brep";
import { formatNumber, h } from "./dom";
import { ICONS } from "./icons";
import { hudBox } from "./inspect";
import type { PointerHandler, Viewport } from "./viewport";

const VALUE_LABELS: Record<BrepFeatureType, string> = { fillet: "Yarıçap (mm)", chamfer: "Mesafe (mm)", shell: "Et kalınlığı (mm)", draft: "Açı (°)" };
const HINTS: Record<BrepFeatureType, string> = {
  fillet: "Yuvarlatılacak kenarlara tıklayın (tekrar tıklamak seçimi kaldırır)",
  chamfer: "Pah kırılacak kenarlara tıklayın (tekrar tıklamak seçimi kaldırır)",
  shell: "Açılacak (kaldırılacak) yüzlere tıklayın; gövdenin içi oyulur",
  draft: "Eğim verilecek yüzlere tıklayın (genelde yan yüzler); nötr düzlem gövdenin altındadır",
};
const ICON_OF: Record<BrepFeatureType, string> = { fillet: ICONS.fillet, chamfer: ICONS.chamfer, shell: ICONS.shell, draft: ICONS.draft };
/** Gövde mavi olduğu için seçim turuncu, imleç altı sarı. */
const COLORS = { edge: 0x4a5878, hover: 0xffd23f, selected: 0xff5a1f } as const;
const WIDTH = { edge: 1.2, hover: 3.5, selected: 3.5 } as const;
/** Kenar seçiminde imlecin kenara olabilecek en büyük uzaklığı (piksel). */
const EDGE_PICK_PX = 9;

function segDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Yuvarlatma / Pah / Kabuk: seçili gövdenin kenarlarını (ya da yüzlerini) 3D görünümde seçtirir,
 * değeri alır ve özelliği ekler. Kenar / yüz bilgisi OpenCascade işçisinden gelir (ilk kullanımda yüklenir).
 */
export class BrepTool implements PointerHandler {
  private box: HTMLElement | null = null;
  private type: BrepFeatureType | null = null;
  private sourceId = "";
  private info: BrepInfo | null = null;
  private selected = new Set<number>();
  private hovered: number | null = null;
  private objects: THREE.Object3D[] = [];
  private hitMesh: THREE.Mesh | null = null;
  private status = h("div", { class: "meta" });
  private pull = h(
    "select",
    { attrs: { "aria-label": "Çekme yönü" } },
    ...Object.entries(PULL_DIRECTIONS).map(([key, v]) => h("option", { value: key }, v.label)),
  ) as HTMLSelectElement;
  private value = h("input", { type: "number", attrs: { "aria-label": "Değer", step: "0.5", min: "0" } }) as HTMLInputElement;
  private applyButton = h("button", { class: "btn primary", onclick: () => this.apply() }, "Uygula") as HTMLButtonElement;

  constructor(
    private readonly app: SugarApp,
    private readonly viewport: Viewport,
    private readonly onChanged: () => void,
  ) {
    // Kalın çizgilerin kalınlığı piksel cinsindendir; görünüm boyutu değişince güncellenir.
    viewport.onDidChangeCamera.on(() => this.updateResolution());
  }

  private updateResolution(): void {
    const { width, height } = this.viewport.element.getBoundingClientRect();
    for (const o of this.objects) {
      const m = (o as LineSegments2).material;
      if (m instanceof LineMaterial) m.resolution.set(width, height);
    }
  }

  get isActive(): boolean {
    return this.type !== null;
  }

  get mode(): "edges" | "faces" | null {
    return this.type ? (this.type === "shell" || this.type === "draft" ? "faces" : "edges") : null;
  }

  /** Açık araçtaki gövdenin kenar / yüz betimi (testler için). */
  get described(): BrepInfo | null {
    return this.info;
  }

  get selection(): number[] {
    return [...this.selected];
  }

  /** Seçili gövde için aracı açar; kenar / yüz bilgisi gelene kadar yükleniyor göstergesi çıkar. */
  async open(type: BrepFeatureType): Promise<void> {
    this.close();
    const source = this.app.brepSource(type);
    if (!source) return;
    this.type = type;
    this.sourceId = source.id;
    this.selected.clear();
    this.hovered = null;
    this.value.value = formatNumber(this.app.paramSpecs(type)![Object.keys(this.app.paramSpecs(type)!)[0]].default);
    this.status.textContent = "OpenCascade çekirdeği hazırlanıyor…";
    this.applyButton.disabled = true;
    this.box = hudBox(
      BREP_LABELS[type],
      ICON_OF[type],
      () => this.close(),
      h("div", { class: "inspect-body" }, this.status, h("label", { class: "field" }, h("span", {}, VALUE_LABELS[type]), this.value), ...(type === "draft" ? [h("label", { class: "field" }, h("span", {}, "Çekme yönü"), this.pull)] : []), h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => this.close() }, "İptal"), this.applyButton)),
    );
    this.value.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.apply();
      } else if (e.key === "Escape") this.close();
    });
    this.viewport.element.append(this.box);
    this.viewport.setInteraction(this);
    this.onChanged();
    try {
      const info = await this.app.describeBody(source.id);
      if (this.type !== type || this.sourceId !== source.id) return; // bu arada kapatıldı
      this.info = info;
      this.build();
      this.refresh();
    } catch (e) {
      this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
      this.close();
    }
  }

  close(): void {
    if (!this.type && !this.box) return;
    this.box?.remove();
    this.box = null;
    this.type = null;
    this.info = null;
    this.selected.clear();
    this.clearObjects();
    if (this.viewport.currentInteraction === this) this.viewport.setInteraction(null);
    this.viewport.requestRender();
    this.onChanged();
  }

  /** Testler ve klavye için: kenar / yüz indeksini seçer ya da seçimden çıkarır. */
  toggle(index: number): void {
    if (!this.info) return;
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    this.refresh();
  }

  apply(): void {
    const type = this.type;
    const info = this.info;
    if (!type || !info) return;
    if (!this.selected.size) {
      this.app.showMessage(this.mode === "faces" ? "Önce en az bir yüz seçin" : "Önce en az bir kenar seçin", "warning");
      return;
    }
    const value = Number(this.value.value.replace(",", "."));
    if (type === "draft" ? !value || !Number.isFinite(value) : !(value > 0)) {
      this.app.showMessage(type === "draft" ? "Açı sıfır olamaz" : `${VALUE_LABELS[type].replace(" (mm)", "")} sıfırdan büyük olmalı`, "warning");
      return;
    }
    const chosen = [...this.selected].sort((a, b) => a - b);
    try {
      this.app.addBrepFeature(
        type,
        this.sourceId,
        this.mode === "faces" ? { faces: chosen.map((i) => info.faces[i].ref) } : { edges: chosen.map((i) => info.edges[i].ref) },
        value,
        type === "draft" ? { pull: PULL_DIRECTIONS[this.pull.value].dir } : {},
      );
    } catch (e) {
      this.app.showMessage(e instanceof Error ? e.message : String(e), "error");
      return;
    }
    this.close();
  }

  // ---- fare ----

  pointerMove(e: PointerEvent): void {
    if (!this.info) return;
    const hit = this.pick(e);
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.refresh();
    }
  }

  pointerLeave(): void {
    if (this.hovered !== null) {
      this.hovered = null;
      this.refresh();
    }
  }

  click(e: PointerEvent): void {
    if (!this.info) return;
    const hit = this.pick(e);
    if (hit !== null) this.toggle(hit);
  }

  doubleClick(): void {}

  private pick(e: PointerEvent): number | null {
    const info = this.info;
    if (!info) return null;
    if (this.mode === "faces") {
      const hit = this.hitMesh ? this.viewport.raycast(e.clientX, e.clientY, [this.hitMesh]) : null;
      return hit?.faceIndex === undefined || hit?.faceIndex === null ? null : info.pick.triFace[hit.faceIndex];
    }
    const mouse = { x: e.clientX, y: e.clientY };
    let best: { index: number; d: number } | null = null;
    info.edges.forEach((edge, index) => {
      const pts = edge.points;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i < pts.length; i += 3) {
        const cur = this.viewport.screenOf([pts[i], pts[i + 1], pts[i + 2]] as Vec3);
        if (prev) {
          const d = segDistance(mouse, prev, cur);
          if (d < EDGE_PICK_PX && (!best || d < best.d)) best = { index, d };
        }
        prev = cur;
      }
    });
    return (best as { index: number } | null)?.index ?? null;
  }

  // ---- çizim ----

  private clearObjects(): void {
    for (const o of this.objects) {
      this.viewport.layer.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose();
    }
    this.objects = [];
    this.hitMesh = null;
  }

  private build(): void {
    this.clearObjects();
    const info = this.info;
    if (!info) return;
    if (this.mode === "faces") {
      // Işın atmak için görünmez ağ: üçgen indeksi → yüz.
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(info.pick.positions, 3));
      g.setIndex(new THREE.BufferAttribute(info.pick.indices, 1));
      this.hitMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      this.viewport.layer.add(this.hitMesh);
      this.objects.push(this.hitMesh);
    }
  }

  /** Vurguları (imleç altı, seçili) yeniden çizer ve alt kutuyu günceller. */
  private refresh(): void {
    const info = this.info;
    const type = this.type;
    if (!info || !type) return;
    // Hit mesh dışındaki her şey yeniden kurulur.
    for (const o of this.objects.filter((x) => x !== this.hitMesh)) {
      this.viewport.layer.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.objects = this.hitMesh ? [this.hitMesh] : [];
    const add = (o: THREE.Object3D) => {
      o.renderOrder = 31;
      this.viewport.layer.add(o);
      this.objects.push(o);
    };
    if (this.mode === "edges") {
      const lines = (indices: number[], color: number, width: number, opacity = 1) => {
        const pos: number[] = [];
        for (const i of indices) {
          const p = info.edges[i].points;
          for (let k = 0; k + 5 < p.length; k += 3) pos.push(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5]);
        }
        if (!pos.length) return;
        const g = new LineSegmentsGeometry();
        g.setPositions(pos);
        const m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, depthTest: false });
        add(new LineSegments2(g, m));
      };
      lines(info.edges.map((_, i) => i), COLORS.edge, WIDTH.edge, 0.7);
      lines([...this.selected], COLORS.selected, WIDTH.selected);
      if (this.hovered !== null) lines([this.hovered], COLORS.hover, WIDTH.hover);
      // Seçili kenarların ortasına işaret: ince çizgide bile seçim belli olsun.
      const mids = [...this.selected].flatMap((i) => info.edges[i].ref.mid);
      if (mids.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(mids, 3));
        add(new THREE.Points(g, new THREE.PointsMaterial({ color: COLORS.selected, size: 10, sizeAttenuation: false, depthTest: false })));
      }
    } else {
      const faceMesh = (face: number, color: number, opacity: number) => {
        const idx: number[] = [];
        info.pick.triFace.forEach((f, t) => {
          if (f === face) idx.push(info.pick.indices[t * 3], info.pick.indices[t * 3 + 1], info.pick.indices[t * 3 + 2]);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(info.pick.positions, 3));
        g.setIndex(idx);
        add(
          new THREE.Mesh(
            g,
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
          ),
        );
      };
      for (const f of this.selected) faceMesh(f, COLORS.selected, 0.55);
      if (this.hovered !== null && !this.selected.has(this.hovered)) faceMesh(this.hovered, COLORS.hover, 0.35);
    }
    const n = this.selected.size;
    const noun = this.mode === "faces" ? "yüz" : "kenar";
    this.updateResolution();
    this.status.textContent = n ? `${n} ${noun} seçili — istediğiniz kadar ekleyin, sonra değeri girip Uygula'ya basın` : HINTS[type];
    this.applyButton.disabled = n === 0;
    this.viewport.requestRender();
  }
}
