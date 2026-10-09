import type { SugarApp } from "../app/controller";
import { h, icon } from "./dom";
import { ICONS } from "./icons";
import type { PanelHost } from "./panels";
import type { Sketcher } from "./sketcher";
import type { Viewport } from "./viewport";

/** Halka yarıçapı (piksel): dilim etiketlerinin merkezden uzaklığı. */
const RADIUS = 110;
/** Bu yarıçapın içindeki imleç hiçbir dilimi vurgulamaz (merkez göbeği). */
const HUB = 26;
/** Saat yönünde, kuzeyden başlayan 8 yön. */
const SLOTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Slot = (typeof SLOTS)[number];

export interface MarkingItem {
  label: string;
  icon?: string;
  /** Kayıtlı komut kimliği; kayıtlı değilse öğe hiç gösterilmez. */
  command?: string;
  /** Komut yerine doğrudan çalışacak işlev. */
  run?: () => void;
  disabled?: boolean;
}

export interface MarkingContent {
  ring: Partial<Record<Slot, MarkingItem>>;
  list: MarkingItem[];
}

interface Host {
  readonly viewport: Viewport;
  readonly sketcher: Sketcher;
  readonly panels: PanelHost;
}

/**
 * Sağ tık işaretleme menüsü: imlecin çevresinde 8 dilimli bir halka (sık komutlar, imleç
 * yönüne göre vurgulanır) ve altında klasik liste. İçerik bağlama göre değişir: eskiz modu,
 * seçili özellik ya da boş tuval. Esc / dış tık kapatır; ok tuşları dilimleri gezer.
 */
export class MarkingMenu {
  private root: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private slotButtons = new Map<Slot, HTMLButtonElement>();
  private center = { x: 0, y: 0 };
  private previousFocus: HTMLElement | null = null;

  constructor(
    private readonly app: SugarApp,
    private readonly host: Host,
  ) {
    host.viewport.onContextClick.on((e) => this.openAt(e.clientX, e.clientY));
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Sağ tıklanan nesneyi seçer (eskiz dışında) ve menüyü açar. */
  openAt(clientX: number, clientY: number): void {
    const { viewport, sketcher } = this.host;
    if (!sketcher.isActive) {
      const id = viewport.pick(clientX, clientY);
      const doc = this.app.document;
      if (id && !doc.getSelection().includes(id)) doc.setSelection([id]);
    }
    this.open(clientX, clientY, this.content());
  }

  /** Bağlama göre halka ve liste içeriği. */
  content(): MarkingContent {
    const { sketcher, panels } = this.host;
    const doc = this.app.document;
    const cmd = (command: string, label?: string, svg?: string, disabled = false): MarkingItem => ({
      label: label ?? this.app.commands.get(command)?.title ?? command,
      command,
      icon: svg,
      disabled,
    });
    const undo = cmd("edit.undo", "Geri Al", ICONS.undo, !doc.canUndo);
    const redo = cmd("edit.redo", "Yinele", ICONS.redo, !doc.canRedo);

    if (sketcher.isActive) {
      const none = sketcher.selected.size === 0;
      return {
        ring: {
          n: cmd("sketch.finish", "Eskizi Bitir", ICONS.check),
          ne: cmd("sketch.construction", "Yapı Çizgisi", ICONS.construction, none),
          e: cmd("sketch.tool.dimension", "Ölçü", ICONS.dimension),
          se: cmd("sketch.tool.line", "Çizgi", ICONS.line),
          s: cmd("sketch.deleteSelection", "Sil", ICONS.trash, none),
          sw: redo,
          w: cmd("sketch.select", "Aracı Bırak", ICONS.select, sketcher.tool === null),
          nw: undo,
        },
        list: [
          cmd("sketch.tool.rect", "Dikdörtgen", ICONS.rect),
          cmd("sketch.tool.circle", "Daire", ICONS.circle),
          cmd("sketch.tool.trim", "Kırp", ICONS.trim),
          cmd("sketch.tool.offset", "Ofset", ICONS.offset),
          cmd("view.fit", "Görünüme Sığdır", ICONS.fit),
        ],
      };
    }

    const selected = doc.getSelection().map((id) => doc.get(id)).filter((f) => f !== undefined);
    const editProps: MarkingItem = {
      label: "Özellikleri Düzenle",
      icon: ICONS.properties,
      run: () => panels.setVisible("properties", true),
    };
    if (selected.length) {
      const first = selected[0];
      const isSketch = first.type === "sketch";
      const hasSketch = isSketch || Boolean(first.sketch);
      return {
        ring: {
          n: isSketch ? cmd("feature.extrude", "Ekstrüzyon", ICONS.extrude) : cmd("feature.fillet", "Yuvarlatma", ICONS.fillet),
          ne: isSketch ? cmd("feature.revolve", "Döndürme", ICONS.revolve) : cmd("feature.hole", "Delik", ICONS.hole),
          e: cmd("edit.toggleVisibility", first.hidden ? "Göster" : "Gizle", ICONS.eye),
          se: editProps,
          s: cmd("edit.delete", "Sil", ICONS.trash),
          sw: hasSketch ? cmd("sketch.edit", "Eskizi Düzenle", ICONS.sketch) : cmd("feature.chamfer", "Pah", ICONS.chamfer),
          w: undo,
          nw: cmd("view.fit", "Sığdır", ICONS.fit),
        },
        list: [
          cmd("edit.duplicate", "Çoğalt"),
          ...(isSketch ? [] : [cmd("feature.chamfer", "Pah", ICONS.chamfer), cmd("feature.shell", "Kabuk", ICONS.shell)]),
          cmd("inspect.measure", "Ölç", ICONS.measure),
          cmd("inspect.mass", "Kütle Özellikleri", ICONS.mass),
          redo,
        ],
      };
    }

    return {
      ring: {
        n: cmd("sketch.new", "Eskiz Oluştur", ICONS.sketch),
        ne: cmd("inspect.measure", "Ölç", ICONS.measure),
        e: redo,
        se: cmd("edit.delete", "Sil", ICONS.trash, true),
        s: cmd("view.fit", "Sığdır", ICONS.fit),
        sw: cmd("view.iso", "İzometrik", ICONS.home),
        w: undo,
        nw: cmd("view.palette", "Komut Paleti", ICONS.palette),
      },
      list: [
        cmd("edit.selectAll", "Tümünü Seç"),
        cmd("view.grid", "Izgarayı Göster / Gizle"),
        cmd("inspect.section", "Kesit Analizi", ICONS.section),
        cmd("view.theme", "Açık / Koyu Tema"),
      ],
    };
  }

  /** Olmayan komut kimliklerini ayıklar (eklentiler / farklı yapılandırmalar için). */
  private valid(item: MarkingItem | undefined): item is MarkingItem {
    return !!item && (item.run !== undefined || (item.command !== undefined && this.app.commands.has(item.command)));
  }

  open(x: number, y: number, content: MarkingContent): void {
    this.close(false);
    this.previousFocus = document.activeElement as HTMLElement | null;
    const ring = SLOTS.filter((s) => this.valid(content.ring[s]));
    const list = content.list.filter((i) => this.valid(i));

    const root = h("div", { class: "mm", attrs: { role: "menu", "aria-label": "İşaretleme menüsü" } });
    const hub = h("div", { class: "mm-hub", attrs: { "aria-hidden": "true" } });
    root.append(hub);
    this.buttons = [];
    this.slotButtons.clear();
    for (const slot of ring) {
      const btn = this.button(content.ring[slot]!, `mm-slice mm-${slot}`);
      btn.dataset.slot = slot;
      const a = (SLOTS.indexOf(slot) * Math.PI) / 4;
      btn.style.left = `${Math.round(RADIUS * Math.sin(a))}px`;
      btn.style.top = `${Math.round(-RADIUS * Math.cos(a))}px`;
      this.slotButtons.set(slot, btn);
      root.append(btn);
    }
    if (list.length) {
      const panel = h("div", { class: "mm-list", attrs: { role: "group", "aria-label": "Diğer komutlar" } });
      for (const item of list) panel.append(this.button(item, "mm-item"));
      root.append(panel);
    }
    document.body.append(root);
    this.root = root;

    // Halka ve liste ekrana sığsın.
    const listEl = root.querySelector<HTMLElement>(".mm-list");
    const listH = listEl ? listEl.offsetHeight + 12 : 0;
    const margin = RADIUS + 70;
    const cx = Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - margin));
    const cy = Math.min(Math.max(y, RADIUS + 24), Math.max(RADIUS + 24, window.innerHeight - RADIUS - 30 - listH));
    this.center = { x: cx, y: cy };
    root.style.left = `${cx}px`;
    root.style.top = `${cy}px`;

    root.addEventListener("keydown", this.onKey);
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("pointermove", this.onMove);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onBlur);
    this.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  private button(item: MarkingItem, cls: string): HTMLButtonElement {
    const info = item.command ? this.app.commands.get(item.command) : undefined;
    const btn = h(
      "button",
      {
        class: cls,
        disabled: item.disabled ?? false,
        title: info?.keybinding ? `${item.label} (${info.keybinding})` : item.label,
        attrs: { role: "menuitem", ...(item.command ? { "data-command": item.command } : {}) },
      },
      h("span", { class: "mm-icon" }, item.icon ? icon(item.icon) : null),
      h("span", { class: "mm-label" }, item.label),
      cls === "mm-item" && info?.keybinding ? h("span", { class: "mm-key" }, info.keybinding) : null,
    );
    btn.addEventListener("click", () => {
      this.close(false);
      this.host.viewport.element.querySelector("canvas")?.focus({ preventScroll: true });
      if (item.run) item.run();
      else if (item.command) void this.app.commands.run(item.command);
    });
    btn.addEventListener("pointerenter", () => {
      if (!btn.disabled) btn.focus({ preventScroll: true });
    });
    this.buttons.push(btn);
    return btn;
  }

  close(restoreFocus = true): void {
    if (!this.root) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.root.removeEventListener("keydown", this.onKey);
    this.root.remove();
    this.root = null;
    this.buttons = [];
    this.slotButtons.clear();
    document.removeEventListener("pointerdown", this.onOutside, true);
    document.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onBlur);
    if (restoreFocus && (hadFocus || document.activeElement === document.body)) this.previousFocus?.focus?.({ preventScroll: true });
  }

  private onBlur = () => this.close();

  /** Dış tık yalnızca kapatır; olay iletilir, böylece kaydırma / döndürme hemen çalışır. */
  private onOutside = (e: PointerEvent) => {
    if (this.root?.contains(e.target as Node)) return;
    this.close();
  };

  /** Yön vurgusu: imleç halkanın hangi diliminin yönündeyse o dilim odaklanır. */
  private onMove = (e: PointerEvent) => {
    if (!this.root || e.buttons) return;
    const dx = e.clientX - this.center.x;
    const dy = e.clientY - this.center.y;
    const d = Math.hypot(dx, dy);
    if (d < HUB || d > RADIUS + 60) return;
    if ((e.target as HTMLElement | null)?.closest?.(".mm-list")) return;
    const k = Math.round(((Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
    const btn = this.slotButtons.get(SLOTS[k]);
    if (btn && !btn.disabled && document.activeElement !== btn) btn.focus({ preventScroll: true });
  };

  private onKey = (e: KeyboardEvent) => {
    const enabled = this.buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = (n: number) => enabled[(i + n + enabled.length) % enabled.length]?.focus();
    if (e.key === "Escape") this.close();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) step(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "Tab") step(-1);
    else if (e.key === "Home") enabled[0]?.focus();
    else if (e.key === "End") enabled[enabled.length - 1]?.focus();
    else if (e.key === "Enter" || e.key === " ") (document.activeElement as HTMLElement | null)?.click();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
}
