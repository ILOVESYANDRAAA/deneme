import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { SugarApp } from "../app/controller";
import { Emitter } from "../core/events";
import { sketchDataOf } from "../core/features";
import { PLANES, frameOf, profileRegions, toWorld, type PlaneName, type PlaneRef } from "../core/sketch";
import { curvePoints, curveSegments, pointMap, sketchDataProfiles, type SketchData } from "../core/sketchmodel";
import type { Vec2, Vec3 } from "../core/solid";
import type { MeshData } from "../geometry/evaluate";
import { h } from "./dom";

export type Theme = "light" | "dark";

/** Eskiz çizgi kalınlıkları (piksel): etkin eskiz, seçili / üzerine gelinen, etkin olmayan. */
const SKETCH_LINE_PX = 2;
const SKETCH_LINE_PX_HIGHLIGHT = 3.5;
const SKETCH_LINE_PX_IDLE = 1.5;

/** Temaya göre 3D görünüm renkleri. */
const THEMES = {
  light: {
    body: "#b4bfcb",
    selected: "#1e6fd9",
    edge: "#1b2128",
    sketch: "#1d4f91",
    sketchSelected: "#0696d7",
    sketchActive: "#14427d",
    entitySelected: "#1e6fd9",
    entityHover: "#6fb0f2",
    construction: "#d07a1c",
    sketchPoint: "#1d4f91",
    fixedPoint: "#d9433b",
    profile: "#5aa9f0",
    preview: "#0696d7",
    overlay: "#0aa564",
    cap: "#d9433b",
    gridMain: 0x9aa4ae,
    gridMinor: 0xc5ccd3,
    sketchGridMain: 0x8a95a1,
    sketchGridMinor: 0xbcc4cc,
  },
  dark: {
    body: "#8fa6c6",
    selected: "#4fa8ff",
    edge: "#141821",
    sketch: "#c9d3e6",
    sketchSelected: "#7fb0ff",
    sketchActive: "#8cc4ff",
    entitySelected: "#4fa8ff",
    entityHover: "#a9d0ff",
    construction: "#c98a3a",
    sketchPoint: "#c9d3e6",
    fixedPoint: "#ff7a70",
    profile: "#4fa8ff",
    preview: "#a9d0ff",
    overlay: "#4fe0a0",
    cap: "#d9534f",
    gridMain: 0x555a66,
    gridMinor: 0x34363e,
    sketchGridMain: 0x6a7080,
    sketchGridMinor: 0x3c3f4a,
  },
};

type Palette = (typeof THEMES)["light"];
const PLANE_COLORS: Record<PlaneName, number> = { XY: 0x4a7dff, XZ: 0x3fbf6f, YZ: 0xff5a5a };
const EDGE_ANGLE = 30;

interface Item {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  /** Kesit analizinde kesilen yüzü dolu gösteren arka yüz kapağı. */
  cap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

export type ViewName = "iso" | "top" | "bottom" | "front" | "back" | "right" | "left";
export type VisualStyle = "shaded" | "shadedEdges" | "wireframe";

export const VIEW_LABELS: Record<ViewName, string> = {
  iso: "İzometrik",
  top: "Üst",
  bottom: "Alt",
  front: "Ön",
  back: "Arka",
  right: "Sağ",
  left: "Sol",
};

export const STYLE_LABELS: Record<VisualStyle, string> = {
  shaded: "Gölgeli",
  shadedEdges: "Gölgeli + Kenarlar",
  wireframe: "Tel Kafes",
};

const VIEW_DIRS: Record<ViewName, Vec3> = {
  iso: [0.55, -0.8, 0.6],
  top: [0, -0.0001, 1],
  bottom: [0, -0.0001, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

const PLANE_VIEWS: Record<PlaneName, ViewName> = { XY: "top", XZ: "front", YZ: "right" };

export interface SectionSettings {
  plane: PlaneName;
  offset: number;
  /** Ters taraf görünsün. */
  flip: boolean;
}

/** Eskiz modu ve ölçüm gibi araçların görünümdeki fare olaylarını devralması için. */
export interface PointerHandler {
  /** Sol tuş basıldığında (sürükleyerek düzenleme için); isteğe bağlı. */
  pointerDown?(e: PointerEvent): void;
  pointerUp?(e: PointerEvent): void;
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
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private items = new Map<string, Item>();
  private renderQueued = false;
  private hint: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private theme: Theme = "light";
  private c: Palette = THEMES.light;
  private edgeMaterial = new THREE.LineBasicMaterial({ color: this.c.edge });
  private ground = new THREE.Group();

  private sketchGroup = new THREE.Group();
  private sketchGrid: THREE.GridHelper;
  private preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private overlay = new THREE.Group();
  /** Seçim araçlarının (kenar / yüz seçici) çizim katmanı; içeriğini araç yönetir. */
  readonly layer = new THREE.Group();
  private activeSketch: string | null = null;
  private sketchOptions = { grid: true, profiles: true };
  /** Seçili öğeler (eğri ve nokta kimlikleri) ve imlecin üstündeki öğe. */
  private highlight: { selected: Set<string>; hovered: string | null } = { selected: new Set(), hovered: null };
  /** Sürükleme sırasında belgeye yazılmadan gösterilen eskiz verisi. */
  private liveData: SketchData | null = null;
  private interaction: PointerHandler | null = null;
  private planePicker: {
    group: THREE.Group;
    chips: HTMLElement;
    hovered: PlaneName | null;
    resolve: (plane: PlaneName | null) => void;
  } | null = null;
  private style: VisualStyle = "shadedEdges";
  private gridVisible = true;
  private clipPlane: THREE.Plane | null = null;
  private sectionSettings: SectionSettings | null = null;

  /** Kamera her değiştiğinde (ViewCube gibi bileşenler için). */
  readonly onDidChangeCamera = new Emitter<void>();
  /** Görsel stil, ızgara ya da kesit ayarı değişince. */
  readonly onDidChangeDisplay = new Emitter<void>();

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
    this.element = h("div", { class: "viewport" }, this.hint);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
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

    this.sketchGrid = new THREE.GridHelper(400, 80, this.c.sketchGridMain, this.c.sketchGridMinor);
    this.sketchGrid.visible = false;
    this.preview = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: this.c.preview, depthTest: false, transparent: true }),
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
    app.document.onDidChange.on(() => {
      this.updateColors();
      this.refreshSketches();
    });
  }

  private buildGround(): void {
    this.disposeGroup(this.ground);
    const grid = new THREE.GridHelper(400, 40, this.c.gridMain, this.c.gridMinor);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    const axes = new THREE.AxesHelper(40);
    axes.position.z = 0.01;
    axes.visible = this.originVisible;
    this.originAxes = axes;
    this.ground.add(grid, axes);
  }

  // ---- Orijin görünürlüğü (Tarayıcı'daki Orijin göz anahtarı) ----
  private originVisible = true;
  private originAxes: THREE.Object3D | null = null;

  get isOriginVisible(): boolean {
    return this.originVisible;
  }

  /** Orijin eksenlerini gösterir/gizler; ızgaradan bağımsızdır. */
  setOriginVisible(visible: boolean): void {
    this.originVisible = visible;
    if (this.originAxes) this.originAxes.visible = visible;
    this.requestRender();
  }

  get currentTheme(): Theme {
    return this.theme;
  }

  /** Açık / koyu tema: ızgara, eskiz ve gövde renkleri değişir. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.c = THEMES[theme];
    this.edgeMaterial.color.set(this.c.edge);
    this.preview.material.color.set(this.c.preview);
    this.buildGround();
    const old = this.sketchGrid;
    const grid = new THREE.GridHelper(400, 80, this.c.sketchGridMain, this.c.sketchGridMinor);
    grid.matrixAutoUpdate = false;
    grid.matrix.copy(old.matrix);
    grid.visible = old.visible;
    this.scene.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
    this.sketchGrid = grid;
    this.scene.add(grid);
    for (const item of this.items.values()) item.cap.material.color.set(this.c.cap);
    this.updateColors();
    this.refreshSketches();
  }

  private buildScene(): void {
    this.buildGround();
    this.scene.add(this.ground);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2c33, 1.6));
    // Işık kamerayla birlikte döner: her açıdan okunaklı gölgelendirme.
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.4, 0.6, 1);
    this.camera.add(key);
    this.overlay.renderOrder = 20;
    this.layer.renderOrder = 30;
    this.scene.add(this.camera, this.sketchGroup, this.sketchGrid, this.preview, this.overlay, this.layer);
  }

  // ---- fare ----

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (!this.planePicker) this.interaction?.pointerDown?.(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.planePicker) this.hoverPlane(e.clientX, e.clientY);
      else this.interaction?.pointerMove(e);
    });
    canvas.addEventListener("pointerleave", () => this.interaction?.pointerLeave());
    canvas.addEventListener("pointerup", (e) => {
      if (!this.planePicker) this.interaction?.pointerUp?.(e);
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

  get currentInteraction(): PointerHandler | null {
    return this.interaction;
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private visibleMeshes(): THREE.Mesh[] {
    return [...this.items.values()].filter((i) => !i.mesh.userData.hidden).map((i) => i.mesh);
  }

  /** Ekran koordinatındaki en yakın şeklin özellik kimliği. */
  pick(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(this.visibleMeshes(), false).find((h) => this.unclipped(h.point));
    return (hit?.object.userData.featureId as string | undefined) ?? null;
  }

  /** Gövde yüzeyindeki noktayı, yüzeyin dışa bakan normalini ve gövdenin özellik kimliğini döndürür (delik yerleştirme için). */
  pickSurface(clientX: number, clientY: number, only?: string): { point: Vec3; normal: Vec3; featureId: string; faceIndex: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const meshes = this.visibleMeshes().filter((m) => !only || m.userData.featureId === only);
    const hit = this.raycaster.intersectObjects(meshes, false).find((h) => this.unclipped(h.point));
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const r = (n: number) => Number(n.toFixed(4)) + 0;
    return {
      point: [r(hit.point.x), r(hit.point.y), r(hit.point.z)],
      normal: [r(normal.x), r(normal.y), r(normal.z)],
      featureId: hit.object.userData.featureId as string,
      faceIndex: hit.faceIndex ?? 0,
    };
  }

  /** Işını verilen nesnelere atar (kesit düzleminin gizlediği kısımlar sayılmaz). */
  raycast(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return this.raycaster.intersectObjects(objects, false).find((h) => this.unclipped(h.point)) ?? null;
  }

  private unclipped(p: THREE.Vector3): boolean {
    return !this.clipPlane || this.clipPlane.distanceToPoint(p) >= -1e-6;
  }

  /**
   * Gövde yüzeyindeki nokta (ölçüm için). İmleç bir üçgen köşesine yakınsa köşeye yapışır.
   */
  pickPoint(clientX: number, clientY: number): { point: Vec3; vertex: boolean } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(this.visibleMeshes(), false).find((h) => this.unclipped(h.point));
    if (!hit || !hit.face) return null;
    const pos = (hit.object as THREE.Mesh).geometry.getAttribute("position");
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: THREE.Vector3 | null = null;
    let bestPx = 10;
    for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, index);
      const s = v.clone().project(this.camera);
      const px = Math.hypot(rect.left + ((s.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - s.y) / 2) * rect.height - clientY);
      if (px < bestPx) {
        bestPx = px;
        best = v;
      }
    }
    const p = best ?? hit.point;
    const r = (n: number) => Number(n.toFixed(4)) + 0;
    return { point: [r(p.x), r(p.y), r(p.z)], vertex: best !== null };
  }

  /** Ekran noktasının eskiz düzlemindeki (u, v) karşılığı. */
  planePoint(clientX: number, clientY: number, plane: PlaneRef, offset: number): Vec2 | null {
    const { origin, u, v, n } = frameOf(plane);
    const normal = new THREE.Vector3(...n);
    const o = new THREE.Vector3(...origin);
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(normal, -(normal.dot(o) + offset)), new THREE.Vector3());
    if (!hit) return null;
    hit.sub(o);
    return [hit.dot(new THREE.Vector3(...u)), hit.dot(new THREE.Vector3(...v))];
  }

  /** Dünya noktasının ekran konumu. */
  screenOf(p: Vec3): { x: number; y: number } {
    const w = new THREE.Vector3(...p).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((w.x + 1) / 2) * rect.width, y: rect.top + ((1 - w.y) / 2) * rect.height };
  }

  /** Eskiz düzlemindeki noktanın ekran konumu (testler ve yakalama için). */
  screenPoint(plane: PlaneRef, offset: number, p: Vec2): { x: number; y: number } {
    return this.screenOf(toWorld(plane, offset, p));
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
    const c = item.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
    return this.screenOf([c.x, c.y, c.z]);
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
  enterSketch(id: string, plane: PlaneRef, offset: number): void {
    this.activeSketch = id;
    this.controls.enableRotate = false;
    const { origin, u, v, n } = frameOf(plane);
    // GridHelper kendi XZ düzleminde durur: X → u, Z → v, Y → n
    this.sketchGrid.matrixAutoUpdate = false;
    this.sketchGrid.matrix
      .makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...n), new THREE.Vector3(...v))
      .setPosition(new THREE.Vector3(...origin).addScaledVector(new THREE.Vector3(...n), offset));
    this.sketchGrid.visible = this.sketchOptions.grid;
    // Eskizde zemin ızgarası yerine eskiz ızgarası görünür (Fusion'daki gibi).
    this.ground.visible = false;
    if (typeof plane === "string") this.setView(PLANE_VIEWS[plane]);
    else this.lookAlong(n, v);
    this.refreshSketches();
  }

  /** Kamerayı `dir` yönünden (hedeften kameraya) düzleme dik baktırır; `up` ekranın yukarısıdır. */
  private lookAlong(dir: Vec3, up: Vec3): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.up.set(...up);
    this.camera.position.copy(this.controls.target).addScaledVector(new THREE.Vector3(...dir).normalize(), distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.fit();
  }

  exitSketch(): void {
    this.activeSketch = null;
    this.controls.enableRotate = true;
    this.camera.up.set(0, 0, 1);
    this.sketchGrid.visible = false;
    this.ground.visible = this.gridVisible;
    this.highlight = { selected: new Set(), hovered: null };
    this.liveData = null;
    this.setPreview([], "XY", 0);
    this.refreshSketches();
  }

  setSketchOptions(options: { grid: boolean; profiles: boolean }): void {
    const changed = options.grid !== this.sketchOptions.grid || options.profiles !== this.sketchOptions.profiles;
    this.sketchOptions = { ...options };
    this.sketchGrid.visible = this.activeSketch !== null && options.grid;
    if (changed) this.refreshSketches();
  }

  /** Etkin eskizde seçili ve imlecin üstündeki öğeler (eğri / nokta kimlikleri). */
  setSketchHighlight(selected: string[], hovered: string | null): void {
    const same =
      hovered === this.highlight.hovered &&
      selected.length === this.highlight.selected.size &&
      selected.every((i) => this.highlight.selected.has(i));
    if (same) return;
    this.highlight = { selected: new Set(selected), hovered };
    this.refreshSketches();
  }

  /** Sürüklerken etkin eskizi belgeye yazmadan bu veriyle çizer (null: belgedekini göster). */
  setLiveSketch(data: SketchData | null): void {
    this.liveData = data;
    this.refreshSketches();
  }

  /** Çizim sırasında geçici çizgiler ve imleç işareti. */
  setPreview(segments: [Vec2, Vec2][], plane: PlaneRef, offset: number, marker?: Vec2): void {
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

  private disposeGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      const obj = child as THREE.Mesh | THREE.LineSegments | THREE.Points;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
      group.remove(obj);
    }
  }

  /** Görünür eskizleri (kullanılmamış, seçili ya da düzenlenen) çizgi olarak çizer. */
  private refreshSketches(): void {
    const doc = this.app.document;
    this.disposeGroup(this.sketchGroup);
    const selected = new Set(doc.getSelection());
    for (const f of doc.all()) {
      if (f.type !== "sketch" || !f.plane) continue;
      const plane: PlaneRef = f.frame ?? f.plane;
      const active = f.id === this.activeSketch;
      const free = !doc.parentOf(f.id);
      if (!active && !selected.has(f.id) && (!free || f.hidden)) continue;
      const data = active && this.liveData ? this.liveData : sketchDataOf(f);
      const offset = f.params.offset ?? 0;
      const color = active ? this.c.sketchActive : selected.has(f.id) ? this.c.sketchSelected : this.c.sketch;
      const pm = pointMap(data);
      const groups = new Map<string, { color: string; width: number; dashed: boolean; segs: [Vec2, Vec2][] }>();
      for (const curve of data.curves) {
        let key = curve.construction ? "construction" : "normal";
        let c = curve.construction ? this.c.construction : color;
        // Etkin eskizde çizgiler kalın; seçili / üzerine gelinen daha da kalın. Etkin olmayanlar ince.
        let width = active ? SKETCH_LINE_PX : SKETCH_LINE_PX_IDLE;
        if (active && this.highlight.selected.has(curve.id)) {
          key = `sel-${key}`;
          c = this.c.entitySelected;
          width = SKETCH_LINE_PX_HIGHLIGHT;
        } else if (active && this.highlight.hovered === curve.id) {
          key = `hover-${key}`;
          c = this.c.entityHover;
          width = SKETCH_LINE_PX_HIGHLIGHT;
        }
        const g = groups.get(key) ?? { color: c, width, dashed: !!curve.construction, segs: [] };
        g.segs.push(...curveSegments(data, curve, pm));
        groups.set(key, g);
      }
      for (const g of groups.values()) {
        const pts: number[] = [];
        for (const [a, b] of g.segs) pts.push(...toWorld(plane, offset, a), ...toWorld(plane, offset, b));
        if (!pts.length) continue;
        // WebGL'de çizgi kalınlığı 1 pikselle sınırlı; kalın çizgi için LineSegments2 kullanılır.
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(pts);
        // Saydam geçişte çizilir ki yarı saydam zemin ızgarası çizgilerin üstüne binmesin.
        const material = new LineMaterial({
          color: g.color,
          linewidth: g.width,
          depthTest: !active,
          transparent: true,
          dashed: g.dashed,
          dashSize: this.worldPerPixel() * 6,
          gapSize: this.worldPerPixel() * 4,
        });
        material.resolution.copy(this.renderer.getSize(new THREE.Vector2()));
        const line = new LineSegments2(geometry, material);
        if (g.dashed) line.computeLineDistances();
        line.renderOrder = active ? 9 : 1;
        line.userData.featureId = f.id;
        this.sketchGroup.add(line);
      }
      if (active) this.addSketchPoints(plane, offset, data);
      // Kapalı bölgeler hafifçe boyanır: neyin katıya çevrilebileceği görünsün.
      if ((active && this.sketchOptions.profiles) || (!active && free)) this.addProfileFill(plane, offset, data, active);
    }
    this.updateHint();
    this.requestRender();
  }

  /** Etkin eskizin uç ve merkez noktaları: seçili olanlar vurgulanır, sabitler ayrı renkte. */
  private addSketchPoints(plane: PlaneRef, offset: number, data: SketchData): void {
    const used = new Set(data.curves.flatMap(curvePoints));
    const fixed = new Set(data.constraints.filter((k) => k.type === "fix").map((k) => k.refs[0]));
    const buckets = new Map<string, { color: string; size: number; pts: number[] }>();
    for (const p of data.points) {
      if (!used.has(p.id)) continue;
      const sel = this.highlight.selected.has(p.id);
      const hov = this.highlight.hovered === p.id;
      const color = sel ? this.c.entitySelected : hov ? this.c.entityHover : fixed.has(p.id) ? this.c.fixedPoint : this.c.sketchPoint;
      const size = sel || hov ? 9 : 6;
      const key = `${color}-${size}`;
      const b = buckets.get(key) ?? { color, size, pts: [] };
      b.pts.push(...toWorld(plane, offset, [p.x, p.y]));
      buckets.set(key, b);
    }
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pts, 3));
      const dots = new THREE.Points(g, new THREE.PointsMaterial({ color: b.color, size: b.size, sizeAttenuation: false, depthTest: false }));
      dots.renderOrder = 11;
      this.sketchGroup.add(dots);
    }
  }

  private addProfileFill(plane: PlaneRef, offset: number, data: SketchData, active: boolean): void {
    const regions = profileRegions(sketchDataProfiles(data));
    if (!regions.length) return;
    const shapes = regions.map(({ outer, holes }) => {
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
      return shape;
    });
    const geometry = new THREE.ShapeGeometry(shapes);
    const { origin, u, v, n } = frameOf(plane);
    const m = new THREE.Matrix4()
      .makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n))
      .setPosition(new THREE.Vector3(...origin).addScaledVector(new THREE.Vector3(...n), offset));
    geometry.applyMatrix4(m);
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: this.c.profile,
        transparent: true,
        opacity: active ? 0.16 : 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    fill.renderOrder = 2;
    this.sketchGroup.add(fill);
  }

  // ---- ölçüm katmanı ----

  /** Ölçüm çizgileri ve noktaları (her zaman üstte çizilir). */
  setOverlay(segments: [Vec3, Vec3][], points: Vec3[]): void {
    this.disposeGroup(this.overlay);
    if (segments.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(segments.flatMap(([a, b]) => [...a, ...b]), 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: this.c.overlay, depthTest: false }));
      lines.renderOrder = 20;
      this.overlay.add(lines);
    }
    if (points.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
      const dots = new THREE.Points(g, new THREE.PointsMaterial({ color: this.c.overlay, size: 8, sizeAttenuation: false, depthTest: false }));
      dots.renderOrder = 21;
      this.overlay.add(dots);
    }
    this.requestRender();
  }

  // ---- görüntü ayarları ----

  get visualStyle(): VisualStyle {
    return this.style;
  }

  setVisualStyle(style: VisualStyle): void {
    this.style = style;
    this.applyItemDisplay();
    this.onDidChangeDisplay.fire();
  }

  get isGridVisible(): boolean {
    return this.gridVisible;
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.ground.visible = visible && this.activeSketch === null;
    this.requestRender();
    this.onDidChangeDisplay.fire();
  }

  get section(): SectionSettings | null {
    return this.sectionSettings;
  }

  /** Kesit analizi: düzlemin bir tarafını keser, kesilen yüzü kırmızı kapakla gösterir. null kapatır. */
  setSection(settings: SectionSettings | null): void {
    this.sectionSettings = settings ? { ...settings } : null;
    if (settings) {
      const n = new THREE.Vector3(...PLANES[settings.plane].n);
      // distanceToPoint < 0 olan taraf kesilir: varsayılan olarak normal yönündeki taraf gizlenir.
      const sign = settings.flip ? 1 : -1;
      this.clipPlane = new THREE.Plane(n.multiplyScalar(sign), -sign * settings.offset);
    } else {
      this.clipPlane = null;
    }
    this.applyItemDisplay();
    this.onDidChangeDisplay.fire();
  }

  /** Kesit için düzlem yönündeki sınırlar (kaydırıcı aralığı). */
  extentAlong(plane: PlaneName): [number, number] {
    const box = this.bounds(false);
    if (box.isEmpty()) return [-50, 50];
    const n = new THREE.Vector3(...PLANES[plane].n);
    const corners = [box.min, box.max].flatMap((a) => [box.min, box.max].flatMap((b) => [box.min, box.max].map((c) => new THREE.Vector3(a.x, b.y, c.z))));
    const d = corners.map((p) => p.dot(n));
    return [Math.min(...d), Math.max(...d)];
  }

  private applyItemDisplay(): void {
    const planes = this.clipPlane ? [this.clipPlane] : [];
    this.edgeMaterial.clippingPlanes = planes;
    this.edgeMaterial.needsUpdate = true;
    for (const item of this.items.values()) {
      const hidden = !!item.mesh.userData.hidden;
      item.mesh.visible = !hidden && this.style !== "wireframe";
      item.edges.visible = !hidden && this.style !== "shaded";
      item.cap.visible = !hidden && !!this.clipPlane && this.style !== "wireframe";
      item.mesh.material.clippingPlanes = planes;
      item.mesh.material.needsUpdate = true;
      item.cap.material.clippingPlanes = planes;
      item.cap.material.needsUpdate = true;
    }
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
      color: this.c.body,
      metalness: 0.05,
      roughness: 0.6,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.featureId = id;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, EDGE_ANGLE), this.edgeMaterial);
    const cap = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: this.c.cap, side: THREE.BackSide }));
    this.scene.add(mesh, edges, cap);
    this.items.set(id, { mesh, edges, cap });
  }

  private removeItem(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.mesh, item.edges, item.cap);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
    item.cap.material.dispose();
    item.edges.geometry.dispose();
    this.items.delete(id);
  }

  private updateColors(): void {
    const doc = this.app.document;
    const selected = new Set(doc.getSelection());
    // Seçili bir girdi (işlenen, eskiz), sahnede onu içeren kök şekil üzerinden vurgulanır.
    for (const id of [...selected]) {
      let parent = doc.parentOf(id);
      while (parent) {
        selected.add(parent.id);
        parent = doc.parentOf(parent.id);
      }
    }
    for (const [id, item] of this.items) {
      item.mesh.material.color.set(selected.has(id) ? this.c.selected : this.c.body);
      item.mesh.userData.hidden = !!doc.get(id)?.hidden;
    }
    this.applyItemDisplay();
  }

  private bounds(includeSketches = true): THREE.Box3 {
    const box = new THREE.Box3();
    for (const { mesh } of this.items.values()) if (!mesh.userData.hidden) box.expandByObject(mesh);
    if (includeSketches) for (const line of this.sketchGroup.children) box.expandByObject(line);
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
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(new THREE.Vector3(...VIEW_DIRS[name]).normalize(), distance);
    this.controls.update();
    this.fit();
  }

  /** Görünümden kameraya doğru birim vektörlerin, kameranın ekran eksenlerindeki karşılığı (ViewCube için). */
  viewRotation(): number[] {
    this.camera.updateMatrixWorld();
    return this.camera.matrixWorldInverse.elements.slice();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.element;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    // Kalın eskiz çizgileri ekran boyutuna göre çizilir.
    this.sketchGroup.traverse((o) => {
      if (o instanceof LineSegments2) o.material.resolution.set(w, h);
    });
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
      this.onDidChangeCamera.fire();
    });
  }
}
