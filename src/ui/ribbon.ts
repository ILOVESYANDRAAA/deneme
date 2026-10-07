import { h, icon } from "./dom";
import { ICONS } from "./icons";
import { openMenu, type MenuItem } from "./menu";

export interface RibbonButton {
  label: string;
  icon: string;
  run: () => void;
  title?: string;
  disabled?: boolean;
  pressed?: boolean;
  /** Komut kimliği (testler ve ipuçları için data-command). */
  command?: string;
}

export interface RibbonGroup {
  id: string;
  label: string;
  /** Şeritte doğrudan görünen hızlı erişim düğmeleri. */
  buttons: RibbonButton[];
  /** Grup etiketine tıklayınca açılan tam liste. */
  menu: MenuItem[];
  /** Vurgulu tek büyük düğme (ör. ESKİZİ BİTİR). */
  primary?: boolean;
}

export interface RibbonTab {
  label: string;
  active: boolean;
  run?: () => void;
}

/**
 * Fusion 360 tarzı araç şeridi: üstte sekmeler, altında gruplar. Her grup birkaç hızlı
 * düğme ve altında açılır menülü bir etiket (OLUŞTUR ▾) içerir.
 */
export class Ribbon {
  readonly element: HTMLElement;
  private tabs = h("div", { class: "rtabs", attrs: { role: "tablist" } });
  private groups = h("div", { class: "rgroups" });

  constructor() {
    this.element = h("div", { class: "ribbon", attrs: { role: "toolbar", "aria-label": "Araçlar" } }, this.tabs, this.groups);
  }

  render(tabs: RibbonTab[], groups: RibbonGroup[]): void {
    this.tabs.replaceChildren(
      ...tabs.map((t) =>
        h(
          "button",
          {
            class: "rtab",
            onclick: () => t.run?.(),
            attrs: { role: "tab", "aria-selected": String(t.active) },
          },
          t.label,
        ),
      ),
    );
    this.groups.replaceChildren(...groups.map((g) => this.group(g)));
  }

  private group(g: RibbonGroup): HTMLElement {
    const buttons = g.buttons.map((b) => {
      const btn = h(
        "button",
        {
          class: g.primary ? "rtool primary" : "rtool",
          disabled: b.disabled ?? false,
          title: b.title ?? b.label,
          onclick: () => b.run(),
          attrs: { "aria-label": b.label },
          dataset: b.command ? { command: b.command } : {},
        },
        icon(b.icon),
        g.primary ? h("span", { class: "rtool-label" }, b.label) : null,
      );
      if (b.pressed !== undefined) btn.setAttribute("aria-pressed", String(b.pressed));
      return btn;
    });
    const label = h(
      "button",
      {
        class: "rgroup-label",
        attrs: { "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `${g.label} menüsü` },
        onclick: () => openMenu(label, g.menu),
      },
      g.label,
      g.menu.length ? icon(ICONS.chevronDown) : null,
    );
    if (!g.menu.length) label.disabled = true;
    return h("div", { class: `rgroup${g.primary ? " primary" : ""}`, dataset: { group: g.id } }, h("div", { class: "rgroup-tools" }, ...buttons), label);
  }
}
