import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SugarApp } from "../app/controller";
import { PLANES, sketchSegments, toWorld, type PlaneName } from "../core/sketch";
import type { Vec2 } from "../core/solid";
import type { MeshData } from "../geometry/evaluate";
import { h } from "./dom";

const COLOR_BODY = new THREE.Color("#8fa6c6");
const COLOR_SELECTED = new THREE.Color("#f2a541");
const COLOR_EDGE = new THREE.Color("#141821");
const COLOR_SKETCH = new THREE.Color("#c9d3e6");
const COLOR_SKETCH_SELECTED = new THREE.Color("#7fb0ff");
const COLOR_SKETCH_ACTIVE = new THREE.Color("#f2a541");
const COLOR_PREVIEW = new THREE.Color("#ffe1a8");
const PLANE_COLORS: Record<PlaneName, number> = { XY: 0x4a7dff, XZ: 0x3fbf6f, YZ: 0xff5a5a };
const EDGE_ANGLE = 30;

interface Item {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments;
}

export type ViewName = "iso" | "top" | "front" | "right";

const PLANE_VIEWS: Record<PlaneName, ViewName> = { XY: "top", XZ: "front", YZ: "right" };

/** Eskiz modu gibi araçların görünümdeki fare olaylarını devralması için. */
export interface PointerHandler {
  pointerMove(e: PointerEvent): void;
  click(e: PointerEvent): void;
  doubleClick(e: MouseEvent): void;
  pointerLeave(): void;
}

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

  private sketchGroup = new THREE.Group();
  private sketchGrid: THREE.GridHelper;
  private preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private activeSketch: string | null = null;
  private interaction: PointerHandler | null = null;
  private planePicker: {
    group: THREE.Group;
    chips: HTMLElement;
    hovered: PlaneName | null;
    resolve: (plane: PlaneName | null) => void;
  } | null = null;

  constructor(private readonly app: SugarApp) {
    this.hint = h(
      "div",
      { class: "hint" },
      "Başlamak için ",
      h("kbd", {}, "Eskiz"),
      " ile bir düzlem seçip çizin, sonra ",
      h("kbd", {}, "Ekstrüzyon"),
      " ile 3D'ye çevirin",
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

    this.sketchGrid = new THREE.GridHelper(400, 80, 0x6a7080, 0x3c3f4a);
    this.sketchGrid.visible = false;
    this.preview = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLOR_PREVIEW, depthTest: false }),
    );
    this.preview.renderOrder = 10;

    this.buildScene();
    this.bindPointer();

    new ResizeObserver(() => this.resize()).observe(this.element);

    app.onDidChangeMeshes.on((e) => this.sync(e.changed, e.removed));
    app.document.onDidChangeSelection.on(() => {
      this.updateColors();
      this.refreshSketches();
    });
    app.document.onDidChange.on(() => this.refreshSketches());
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
    this.scene.add(this.camera, this.sketchGroup, this.sketchGrid, this.preview);
  }

  // ---- fare ----

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.planePicker) this.hoverPlane(e.clientX, e.clientY);
      else this.interaction?.pointerMove(e);
    });
    canvas.addEventListener("pointerleave", () => this.interaction?.pointerLeave());
    canvas.addEventListener("pointerup", (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return; // sürükleme = kamera hareketi
      if (this.planePicker) {
        const plane = this.planeAt(e.clientX, e.clientY);
        if (plane) this.finishPlanePick(plane);
        return;
      }
      if (this.interaction) {
        this.interaction.click(e);
        return;
      }
      this.selectAt(e);
    });
    canvas.addEventListener("dblclick", (e) => {
      if (this.interaction) this.interaction.doubleClick(e);
      else if (!this.planePicker) this.fit();
    });
  }

  private selectAt(e: PointerEvent): void {
    const id = this.pick(e.clientX, e.clientY);
    const doc = this.app.document;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      if (!id) return;
      const sel = doc.getSelection();
      doc.setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
    } else {
      doc.setSelection(id ? [id] : []);
    }
  }

  setInteraction(handler: PointerHandler | null): void {
    this.interaction = handler;
    this.renderer.domElement.style.cursor = handler ? "crosshair" : "";
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Ekran koordinatındaki en yakın şeklin özellik kimliği. */
  pick(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const meshes = [...this.items.values()].map((i) => i.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return (hit?.object.userData.featureId as string | undefined) ?? null;
  }

  /** Ekran noktasının eskiz düzlemindeki (u, v) karşılığı. */
  planePoint(clientX: number, clientY: number, plane: PlaneName, offset: number): Vec2 | null {
    const { u, v, n } = PLANES[plane];
    const normal = new THREE.Vector3(...n);
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(normal, -offset), new THREE.Vector3());
    if (!hit) return null;
    return [hit.dot(new THREE.Vector3(...u)), hit.dot(new THREE.Vector3(...v))];
  }

  /** Eskiz düzlemindeki noktanın ekran konumu (testler ve yakalama için). */
  screenPoint(plane: PlaneName, offset: number, p: Vec2): { x: number; y: number } {
    const w = new THREE.Vector3(...toWorld(plane, offset, p)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((w.x + 1) / 2) * rect.width, y: rect.top + ((1 - w.y) / 2) * rect.height };
  }

  /** Hedef noktasında bir pikselin dünya birimi karşılığı (yakalama mesafesi, ızgara adımı için). */
  worldPerPixel(): number {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const height = this.renderer.domElement.clientHeight || 1;
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / height;
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

  // ---- düzlem seçme ----

  /** Başlangıç düzlemlerini gösterir; kullanıcı birine tıklayınca (ya da düğmeden seçince) döner. İptalde null. */
  pickPlane(): Promise<PlaneName | null> {
    this.cancelPlanePick();
    const size = 50;
    const group = new THREE.Group();
    for (const name of Object.keys(PLANES) as PlaneName[]) {
      const { u, v, n } = PLANES[name];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size).translate(size / 2, size / 2, 0),
        new THREE.MeshBasicMaterial({
          color: PLANE_COLORS[name],
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
      mesh.userData.plane = name;
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: PLANE_COLORS[name] }),
      );
      mesh.add(border);
      group.add(mesh);
    }
    this.scene.add(group);
    group.updateMatrixWorld(true); // ışın testi ilk çizimden önce de doğru konumu görsün

    const chips = h(
      "div",
      { class: "plane-chips", attrs: { role: "group", "aria-label": "Eskiz düzlemi" } },
      h("span", {}, "Eskiz düzlemi seçin:"),
      ...(Object.keys(PLANES) as PlaneName[]).map((name) =>
        h(
          "button",
          { class: `chip plane-${name}`, onclick: () => this.finishPlanePick(name), dataset: { plane: name } },
          PLANES[name].label,
        ),
      ),
      h("button", { class: "chip", onclick: () => this.cancelPlanePick() }, "İptal"),
    );
    this.element.append(chips);
    this.setView("iso");

    return new Promise((resolve) => {
      this.planePicker = { group, chips, hovered: null, resolve };
      this.requestRender();
    });
  }

  get isPickingPlane(): boolean {
    return this.planePicker !== null;
  }

  cancelPlanePick(): void {
    this.finishPlanePick(null);
  }

  private finishPlanePick(plane: PlaneName | null): void {
    const p = this.planePicker;
    if (!p) return;
    this.planePicker = null;
    this.scene.remove(p.group);
    p.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    p.chips.remove();
    this.renderer.domElement.style.cursor = this.interaction ? "crosshair" : "";
    this.requestRender();
    p.resolve(plane);
  }

  private planeAt(clientX: number, clientY: number): PlaneName | null {
    if (!this.planePicker) return null;
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(this.planePicker.group.children, false)[0];
    return (hit?.object.userData.plane as PlaneName | undefined) ?? null;
  }

  private hoverPlane(clientX: number, clientY: number): void {
    const p = this.planePicker!;
    const plane = this.planeAt(clientX, clientY);
    if (plane === p.hovered) return;
    p.hovered = plane;
    for (const child of p.group.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = child.userData.plane === plane ? 0.42 : 0.18;
    }
    this.renderer.domElement.style.cursor = plane ? "pointer" : "";
    this.requestRender();
  }

  // ---- eskiz modu ----

  /** Eskiz moduna geçer: kamera düzleme dik bakar, sol tık döndürmek yerine çizer. */
  enterSketch(id: string, plane: PlaneName, offset: number): void {
    this.activeSketch = id;
    this.controls.enableRotate = false;
    const { u, v, n } = PLANES[plane];
    // GridHelper kendi XZ düzleminde durur: X → u, Z → v, Y → n
    this.sketchGrid.matrixAutoUpdate = false;
    this.sketchGrid.matrix
      .makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...n), new THREE.Vector3(...v))
      .setPosition(new THREE.Vector3(...n).multiplyScalar(offset));
    this.sketchGrid.visible = true;
    this.setView(PLANE_VIEWS[plane]);
    this.refreshSketches();
  }

  exitSketch(): void {
    this.activeSketch = null;
    this.controls.enableRotate = true;
    this.sketchGrid.visible = false;
    this.setPreview([], "XY", 0);
    this.refreshSketches();
  }

  /** Çizim sırasında geçici çizgiler ve imleç işareti. */
  setPreview(segments: [Vec2, Vec2][], plane: PlaneName, offset: number, marker?: Vec2): void {
    const pts: number[] = [];
    const push = (p: Vec2) => pts.push(...toWorld(plane, offset, p));
    for (const [a, b] of segments) {
      push(a);
      push(b);
    }
    if (marker) {
      const s = this.worldPerPixel() * 6;
      push([marker[0] - s, marker[1]]);
      push([marker[0] + s, marker[1]]);
      push([marker[0], marker[1] - s]);
      push([marker[0], marker[1] + s]);
    }
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry();
    this.preview.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.requestRender();
  }

  /** Görünür eskizleri (kullanılmamış, seçili ya da düzenlenen) çizgi olarak çizer. */
  private refreshSketches(): void {
    const doc = this.app.document;
    for (const child of [...this.sketchGroup.children]) {
      const line = child as THREE.LineSegments;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.sketchGroup.remove(line);
    }
    const selected = new Set(doc.getSelection());
    for (const f of doc.all()) {
      if (f.type !== "sketch" || !f.plane) continue;
      const active = f.id === this.activeSketch;
      if (!active && !selected.has(f.id) && doc.parentOf(f.id)) continue;
      const pts: number[] = [];
      for (const [a, b] of sketchSegments(f.entities ?? [])) {
        pts.push(...toWorld(f.plane, f.params.offset ?? 0, a), ...toWorld(f.plane, f.params.offset ?? 0, b));
      }
      if (pts.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const color = active ? COLOR_SKETCH_ACTIVE : selected.has(f.id) ? COLOR_SKETCH_SELECTED : COLOR_SKETCH;
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: !active }));
      line.renderOrder = active ? 9 : 1;
      line.userData.featureId = f.id;
      this.sketchGroup.add(line);
    }
    this.updateHint();
    this.requestRender();
  }

  // ---- katılar ----

  private sync(changed: string[], removed: string[]): void {
    const firstContent = this.items.size === 0;
    for (const id of [...changed, ...removed]) this.removeItem(id);
    for (const id of changed) {
      const data = this.app.meshes.get(id);
      if (data) this.addItem(id, data);
    }
    // Kök olmaktan çıkanları (boolean'a işlenen olanları) da temizle.
    for (const id of this.items.keys()) if (!this.app.meshes.has(id)) this.removeItem(id);
    this.updateHint();
    this.updateColors();
    if (firstContent && this.items.size > 0 && !this.activeSketch) this.fit();
    this.requestRender();
  }

  private updateHint(): void {
    this.hint.hidden = this.items.size > 0 || this.sketchGroup.children.length > 0 || this.activeSketch !== null;
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
    // Seçili bir girdi (işlenen, eskiz), sahnede onu içeren kök şekil üzerinden vurgulanır.
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
    for (const line of this.sketchGroup.children) box.expandByObject(line);
    return box;
  }

  /** Tüm şekilleri görünüme sığdırır. */
  fit(): void {
    const box = this.bounds();
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(60, 60, 60));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius, 20); // küçük eskizlerde aşırı yakınlaşmasın
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.15;
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
