import { Emitter } from "../core/events";
import { h, icon } from "./dom";
import { ICONS } from "./icons";

export type DockSide = "left" | "right";

/** Bir panelin kaydedilen yerleşimi. `dock` null ise panel serbest (yüzer) durumdadır. */
export interface PanelLayout {
  dock: DockSide | null;
  /** Yanaştırılmış panellerde sıradaki yeri, yüzen panellerde sol üst köşesi. */
  order: number;
  x: number;
  y: number;
  width: number;
  collapsed: boolean;
  visible: boolean;
}

export interface PanelOptions {
  id: string;
  title: string;
  content: HTMLElement;
  defaults: Partial<PanelLayout> & { dock: DockSide | null };
  /** Başlığa eklenecek ek düğmeler (ör. "Eskizi Bitir"). */
  actions?: HTMLElement[];
}

const STORAGE_KEY = "sugarcad.panels.v1";
const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
/** Bu kadar piksel kenara yaklaşınca bırakılan panel o kenara yanaşır. */
const DOCK_ZONE = 56;
const DRAG_THRESHOLD = 4;

function loadLayouts(): Record<string, PanelLayout> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PanelLayout>) : {};
  } catch {
    return {};
  }
}

/**
 * 3D görünümün üstünde duran paneller (Fusion 360'taki Tarayıcı ve komut pencereleri gibi).
 * Paneller başlıklarından sürüklenip sola / sağa yanaştırılabilir ya da serbest bırakılabilir,
 * daraltılabilir, kapatılabilir ve kenarından genişletilebilir. Yerleşim tarayıcıda saklanır.
 */
export class PanelHost {
  readonly element: HTMLElement;
  private docks: Record<DockSide, HTMLElement>;
  private indicators: Record<DockSide, HTMLElement>;
  private panels = new Map<string, FloatingPanel>();
  private saved = loadLayouts();
  /** Panel o an kullanılabilir mi (ör. Eskiz Paleti sadece eskiz modunda)? */
  private context = new Map<string, boolean>();
  readonly onDidChange = new Emitter<void>();

  constructor() {
    this.docks = {
      left: h("div", { class: "dock left" }),
      right: h("div", { class: "dock right" }),
    };
    this.indicators = {
      left: h("div", { class: "dock-indicator left" }),
      right: h("div", { class: "dock-indicator right" }),
    };
    this.element = h(
      "div",
      { class: "panel-host" },
      this.docks.left,
      this.docks.right,
      this.indicators.left,
      this.indicators.right,
    );
    new ResizeObserver(() => this.clampFloating()).observe(this.element);
  }

  add(options: PanelOptions): FloatingPanel {
    const saved: Partial<PanelLayout> = this.saved[options.id] ?? {};
    const layout: PanelLayout = {
      order: this.panels.size,
      x: 80,
      y: 80,
      width: 280,
      collapsed: false,
      visible: true,
      ...options.defaults,
      ...saved,
    };
    const panel = new FloatingPanel(this, options, layout);
    this.panels.set(options.id, panel);
    this.place(panel);
    return panel;
  }

  get(id: string): FloatingPanel | undefined {
    return this.panels.get(id);
  }

  list(): FloatingPanel[] {
    return [...this.panels.values()];
  }

  isVisible(id: string): boolean {
    const p = this.panels.get(id);
    return !!p && p.layout.visible && this.context.get(id) !== false;
  }

  /** Paneli kullanıcı açısından gösterir / gizler (kaydedilir). */
  setVisible(id: string, visible: boolean): void {
    const p = this.panels.get(id);
    if (!p) return;
    p.layout.visible = visible;
    if (visible) p.layout.collapsed = false;
    this.refresh(p);
  }

  toggle(id: string): void {
    this.setVisible(id, !this.isVisible(id));
  }

  /** Bağlama bağlı paneller (kullanıcının seçimi korunur, sadece o an gizlenir). */
  setContext(id: string, available: boolean): void {
    if (this.context.get(id) === available) return;
    this.context.set(id, available);
    const p = this.panels.get(id);
    if (p) this.refresh(p, false);
  }

  /** Varsayılan yerleşime döner. */
  reset(): void {
    this.saved = {};
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // depolama kapalı olabilir
    }
    for (const p of this.panels.values()) {
      Object.assign(p.layout, { order: 0, x: 80, y: 80, width: 280, collapsed: false, visible: true }, p.defaults);
      this.place(p);
    }
    this.onDidChange.fire();
  }

  refresh(p: FloatingPanel, persist = true): void {
    p.render(this.context.get(p.id) !== false);
    if (persist) this.persist();
    this.onDidChange.fire();
  }

  /** Paneli yerleşimine göre yuvaya ya da serbest katmana koyar. */
  place(p: FloatingPanel): void {
    const { dock } = p.layout;
    if (dock) {
      const siblings = this.list()
        .filter((o) => o !== p && o.layout.dock === dock)
        .sort((a, b) => a.layout.order - b.layout.order);
      const before = siblings.find((o) => o.layout.order > p.layout.order);
      this.docks[dock].insertBefore(p.element, before?.element ?? null);
      this.renumber(dock);
    } else {
      this.element.append(p.element);
    }
    this.refresh(p);
  }

  private renumber(dock: DockSide): void {
    [...this.docks[dock].children].forEach((el, i) => {
      const p = this.panels.get((el as HTMLElement).dataset.panel ?? "");
      if (p) p.layout.order = i;
    });
  }

  private persist(): void {
    const out: Record<string, PanelLayout> = { ...this.saved };
    for (const p of this.panels.values()) out[p.id] = { ...p.layout };
    this.saved = out;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // gizli pencerede depolama kapalı olabilir; yerleşim sadece bu oturumda kalır
    }
  }

  // ---- sürükleme ----

  hostRect(): DOMRect {
    return this.element.getBoundingClientRect();
  }

  /** Sürüklerken imleç bir kenara yakınsa o kenarın göstergesini yakar. */
  dockZoneAt(clientX: number): DockSide | null {
    const r = this.hostRect();
    if (clientX - r.left < DOCK_ZONE) return "left";
    if (r.right - clientX < DOCK_ZONE) return "right";
    return null;
  }

  showIndicator(side: DockSide | null): void {
    for (const s of ["left", "right"] as DockSide[]) this.indicators[s].classList.toggle("active", s === side);
  }

  /** Paneli bırakılan yere yerleştirir: kenara yakınsa yanaştırır, değilse serbest bırakır. */
  drop(p: FloatingPanel, clientX: number, clientY: number): void {
    this.showIndicator(null);
    const side = this.dockZoneAt(clientX);
    if (side) {
      // Yuvadaki panellerin ortalarına göre sıra bul.
      const others = [...this.docks[side].children].filter((el) => el !== p.element) as HTMLElement[];
      const index = others.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return clientY < r.top + r.height / 2;
      });
      p.layout.dock = side;
      p.layout.order = index < 0 ? others.length - 0.5 : index - 0.5;
      p.element.style.left = "";
      p.element.style.top = "";
    } else {
      p.layout.dock = null;
    }
    this.place(p);
  }

  /** Paneli yuvasından çıkarıp ekrandaki yerinde serbest bırakır (sürükleme başlarken). */
  undock(p: FloatingPanel): void {
    const host = this.hostRect();
    const r = p.element.getBoundingClientRect();
    const from = p.layout.dock;
    p.layout.dock = null;
    p.layout.x = r.left - host.left;
    p.layout.y = r.top - host.top;
    this.element.append(p.element);
    if (from) this.renumber(from);
    p.render(true);
  }

  moveTo(p: FloatingPanel, x: number, y: number): void {
    const host = this.hostRect();
    const w = p.element.offsetWidth;
    p.layout.x = Math.round(Math.min(Math.max(0, x), Math.max(0, host.width - w)));
    p.layout.y = Math.round(Math.min(Math.max(0, y), Math.max(0, host.height - 32)));
    p.element.style.left = `${p.layout.x}px`;
    p.element.style.top = `${p.layout.y}px`;
  }

  /** Pencere küçülünce yüzen paneller görünür alanda kalsın. */
  private clampFloating(): void {
    for (const p of this.panels.values()) if (!p.layout.dock && p.element.isConnected) this.moveTo(p, p.layout.x, p.layout.y);
  }
}

export class FloatingPanel {
  readonly id: string;
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  readonly defaults: PanelOptions["defaults"];
  private collapseButton: HTMLButtonElement;
  private resizer: HTMLElement;

  constructor(
    private readonly host: PanelHost,
    options: PanelOptions,
    readonly layout: PanelLayout,
  ) {
    this.id = options.id;
    this.defaults = options.defaults;
    this.collapseButton = h("button", {
      class: "fpanel-btn",
      title: "Daralt / genişlet",
      attrs: { "aria-label": `${options.title} panelini daralt` },
      onclick: () => this.setCollapsed(!this.layout.collapsed),
    });
    const close = h(
      "button",
      {
        class: "fpanel-btn",
        title: "Kapat (üst çubuktan yeniden açılır)",
        attrs: { "aria-label": `${options.title} panelini kapat` },
        onclick: () => host.setVisible(this.id, false),
      },
      icon(ICONS.close),
    );
    const title = h("span", { class: "fpanel-title" }, options.title);
    const header = h(
      "div",
      { class: "fpanel-head", title: "Sürükleyerek taşıyın · kenara bırakınca yanaşır · çift tık daraltır" },
      h("span", { class: "fpanel-grip" }, icon(ICONS.grip)),
      title,
      ...(options.actions ?? []),
      this.collapseButton,
      close,
    );
    this.body = h("div", { class: "fpanel-body" }, options.content);
    this.resizer = h("div", { class: "fpanel-resize", title: "Genişliği ayarlayın", attrs: { "aria-hidden": "true" } });
    this.element = h(
      "section",
      { class: "fpanel", dataset: { panel: this.id }, attrs: { "aria-label": options.title } },
      header,
      this.body,
      this.resizer,
    );
    this.bindDrag(header);
    this.bindResize();
    header.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.setCollapsed(!this.layout.collapsed);
    });
  }

  setCollapsed(collapsed: boolean): void {
    this.layout.collapsed = collapsed;
    this.host.refresh(this);
  }

  /** Yerleşimi DOM'a yansıtır. */
  render(available: boolean): void {
    const { dock, collapsed, visible, width, x, y } = this.layout;
    const el = this.element;
    el.hidden = !(visible && available);
    el.classList.toggle("collapsed", collapsed);
    el.classList.toggle("floating", !dock);
    el.dataset.dock = dock ?? "float";
    el.style.width = `${width}px`;
    el.style.left = dock ? "" : `${x}px`;
    el.style.top = dock ? "" : `${y}px`;
    this.collapseButton.replaceChildren(icon(collapsed ? ICONS.chevronRight : ICONS.chevronDown));
    this.collapseButton.setAttribute("aria-expanded", String(!collapsed));
  }

  private bindDrag(header: HTMLElement): void {
    header.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let grab: { dx: number; dy: number } | null = null;
      // Panel sürüklenirken DOM'da yer değiştirdiği için (yuvadan çıkınca) işaretçi yakalama
      // kaybolur; olaylar pencereden dinlenir.
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        if (!grab) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
          const r = this.element.getBoundingClientRect();
          grab = { dx: start.x - r.left, dy: start.y - r.top };
          this.host.undock(this);
          this.element.classList.add("dragging");
        }
        const host = this.host.hostRect();
        this.host.moveTo(this, ev.clientX - host.left - grab.dx, ev.clientY - host.top - grab.dy);
        this.host.showIndicator(this.host.dockZoneAt(ev.clientX));
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!grab) return;
        this.element.classList.remove("dragging");
        this.host.drop(this, ev.clientX, ev.clientY);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }

  private bindResize(): void {
    this.resizer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = this.layout.width;
      // Sağa yanaşmış panel sol kenarından büyür.
      const dir = this.layout.dock === "right" ? -1 : 1;
      this.resizer.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        this.layout.width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + dir * (ev.clientX - startX))));
        this.element.style.width = `${this.layout.width}px`;
      };
      const up = () => {
        this.resizer.removeEventListener("pointermove", move);
        this.resizer.removeEventListener("pointerup", up);
        this.host.refresh(this);
      };
      this.resizer.addEventListener("pointermove", move);
      this.resizer.addEventListener("pointerup", up);
    });
  }
}
