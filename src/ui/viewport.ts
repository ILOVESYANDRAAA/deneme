import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SugarApp } from "../app/controller";
import type { MeshData } from "../geometry/evaluate";
import { h } from "./dom";

const COLOR_BODY = new THREE.Color("#8fa6c6");
const COLOR_SELECTED = new THREE.Color("#f2a541");
const COLOR_EDGE = new THREE.Color("#141821");
const EDGE_ANGLE = 30;

interface Item {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments;
}

export type ViewName = "iso" | "top" | "front" | "right";

/**
 * Three.js 3D görünümü. Sadece bir şey değiştiğinde çizer (boşta GPU/CPU harcamaz).
 * Eksen düzeni CAD alışkanlığıdır: Z yukarı.
 */
export class Viewport {
  readonly element: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private items = new Map<string, Item>();
  private renderQueued = false;
  private hint: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private edgeMaterial = new THREE.LineBasicMaterial({ color: COLOR_EDGE });

  constructor(private readonly app: SugarApp) {
    this.hint = h(
      "div",
      { class: "hint" },
      "Araç çubuğundan bir şekil ekleyin ya da ",
      h("kbd", {}, "Ctrl+Shift+P"),
      " ile komut paletini açın",
    );
    const viewButtons = h(
      "div",
      { class: "view-buttons" },
      ...(
        [
          ["iso", "İzometrik"],
          ["top", "Üst"],
          ["front", "Ön"],
          ["right", "Sağ"],
        ] as [ViewName, string][]
      ).map(([name, label]) => h("button", { title: `${label} görünüm`, onclick: () => this.setView(name) }, label)),
    );
    this.element = h("div", { class: "viewport" }, this.hint, viewButtons);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.tabIndex = 0;
    this.element.prepend(this.renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -130, 100);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => this.requestRender());

    this.buildScene();
    this.bindPicking();

    new ResizeObserver(() => this.resize()).observe(this.element);

    app.onDidChangeMeshes.on((e) => this.sync(e.changed, e.removed));
    app.document.onDidChangeSelection.on(() => this.updateColors());
  }

  private buildScene(): void {
    const grid = new THREE.GridHelper(400, 40, 0x555a66, 0x34363e);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(40);
    axes.position.z = 0.01;
    this.scene.add(axes);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2c33, 1.6));
    // Işık kamerayla birlikte döner: her açıdan okunaklı gölgelendirme.
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.4, 0.6, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
  }

  private bindPicking(): void {
    const canvas = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return; // sürükleme = kamera hareketi
      const id = this.pick(e.clientX, e.clientY);
      const doc = this.app.document;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (!id) return;
        const sel = doc.getSelection();
        doc.setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
      } else {
        doc.setSelection(id ? [id] : []);
      }
    });
    canvas.addEventListener("dblclick", () => this.fit());
  }

  /** Ekran koordinatındaki en yakın şeklin özellik kimliği. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.items.values()].map((i) => i.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return (hit?.object.userData.featureId as string | undefined) ?? null;
  }

  /** Özelliğin ekrandaki merkezi (testler ve ileride etiketler için). */
  screenPosition(id: string): { x: number; y: number } | null {
    const item = this.items.get(id);
    if (!item) return null;
    item.mesh.geometry.computeBoundingBox();
    const center = item.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((center.x + 1) / 2) * rect.width, y: rect.top + ((1 - center.y) / 2) * rect.height };
  }

  private sync(changed: string[], removed: string[]): void {
    const firstContent = this.items.size === 0;
    for (const id of [...changed, ...removed]) this.removeItem(id);
    for (const id of changed) {
      const data = this.app.meshes.get(id);
      if (data) this.addItem(id, data);
    }
    // Kök olmaktan çıkanları (boolean'a işlenen olanları) da temizle.
    for (const id of this.items.keys()) if (!this.app.meshes.has(id)) this.removeItem(id);
    this.hint.hidden = this.items.size > 0;
    this.updateColors();
    if (firstContent && this.items.size > 0) this.fit();
    this.requestRender();
  }

  private addItem(id: string, data: MeshData): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const material = new THREE.MeshStandardMaterial({
      color: COLOR_BODY,
      metalness: 0.05,
      roughness: 0.65,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.featureId = id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, EDGE_ANGLE), this.edgeMaterial);
    this.scene.add(mesh, edges);
    this.items.set(id, { mesh, edges });
  }

  private removeItem(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.mesh, item.edges);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
    item.edges.geometry.dispose();
    this.items.delete(id);
  }

  private updateColors(): void {
    const selected = new Set(this.app.document.getSelection());
    // Seçili bir işlenen, sahnede onu içeren kök şekil üzerinden vurgulanır.
    for (const id of [...selected]) {
      let parent = this.app.document.parentOf(id);
      while (parent) {
        selected.add(parent.id);
        parent = this.app.document.parentOf(parent.id);
      }
    }
    for (const [id, item] of this.items) item.mesh.material.color.copy(selected.has(id) ? COLOR_SELECTED : COLOR_BODY);
    this.requestRender();
  }

  private bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const { mesh } of this.items.values()) box.expandByObject(mesh);
    return box;
  }

  /** Tüm şekilleri görünüme sığdırır. */
  fit(): void {
    const box = this.bounds();
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(60, 60, 60));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.01, distance / 1000);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  setView(name: ViewName): void {
    const dirs: Record<ViewName, THREE.Vector3> = {
      iso: new THREE.Vector3(0.55, -0.8, 0.6),
      top: new THREE.Vector3(0, -0.0001, 1),
      front: new THREE.Vector3(0, -1, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(dirs[name].normalize(), distance);
    this.controls.update();
    this.fit();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.element;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}
