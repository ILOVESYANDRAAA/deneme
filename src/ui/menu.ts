import { h, icon } from "./dom";
import { ICONS } from "./icons";

export interface MenuItem {
  label: string;
  icon?: string;
  /** Sağda gösterilen kısayol metni. */
  keybinding?: string;
  run?: () => void;
  disabled?: boolean;
  /** Onay kutulu öğe (görsel stil, ızgara gibi). */
  checked?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

let current: { close: () => void } | null = null;

export function closeMenus(): void {
  current?.close();
}

export function isMenuOpen(): boolean {
  return current !== null;
}

/**
 * Açılır menü (şerit gruplarının ▾ menüleri, Dosya menüsü...). Dışarı tıklayınca, Esc ile
 * ya da bir öğe seçilince kapanır. Ok tuşlarıyla gezilebilir; ▸ alt menüler sağa açılır.
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[], options: { above?: boolean } = {}): void {
  closeMenus();
  const layers: HTMLElement[] = [];
  const previousFocus = document.activeElement as HTMLElement | null;

  const close = () => {
    const hadFocus = layers.some((l) => l.contains(document.activeElement));
    layers.forEach((l) => l.remove());
    layers.length = 0;
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "false");
    if (current?.close === close) current = null;
    if (hadFocus || document.activeElement === document.body) previousFocus?.focus?.({ preventScroll: true });
  };
  const outside = (e: Event) => {
    if (layers.some((l) => l.contains(e.target as Node)) || anchor.contains(e.target as Node)) return;
    close();
  };

  const build = (list: MenuItem[], depth: number, at: { x: number; y: number; flipX?: number }): HTMLElement => {
    // Bu seviyeden derindeki açık alt menüleri kapat.
    layers.splice(depth).forEach((l) => l.remove());
    const menu = h("div", { class: "menu", attrs: { role: "menu" } });
    const buttons: HTMLButtonElement[] = [];
    for (const item of list) {
      if (item.separator) {
        menu.append(h("div", { class: "menu-sep", attrs: { role: "separator" } }));
        continue;
      }
      const btn = h(
        "button",
        {
          class: "menu-item",
          disabled: item.disabled ?? false,
          attrs: {
            role: item.checked === undefined ? "menuitem" : "menuitemcheckbox",
            ...(item.checked !== undefined ? { "aria-checked": String(item.checked) } : {}),
            ...(item.submenu ? { "aria-haspopup": "menu" } : {}),
          },
        },
        h("span", { class: "menu-icon" }, item.checked ? icon(ICONS.check) : item.icon ? icon(item.icon) : null),
        h("span", { class: "menu-label" }, item.label),
        item.keybinding ? h("span", { class: "menu-key" }, item.keybinding) : null,
        item.submenu ? h("span", { class: "menu-arrow" }, icon(ICONS.chevronRight)) : null,
      );
      const openSub = () => {
        if (!item.submenu) {
          layers.splice(depth + 1).forEach((l) => l.remove());
          return;
        }
        const r = btn.getBoundingClientRect();
        const sub = build(item.submenu, depth + 1, { x: r.right - 2, y: r.top - 4, flipX: r.left + 2 });
        return sub;
      };
      btn.addEventListener("pointerenter", () => {
        btn.focus({ preventScroll: true });
        openSub();
      });
      btn.addEventListener("click", () => {
        if (item.submenu) {
          (openSub()?.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
          return;
        }
        close();
        item.run?.();
      });
      btn.addEventListener("keydown", (e) => {
        const i = buttons.indexOf(btn);
        const enabled = (from: number, step: number) => {
          for (let k = 1; k <= buttons.length; k++) {
            const b = buttons[(from + step * k + buttons.length * k) % buttons.length];
            if (!b.disabled) return b;
          }
          return btn;
        };
        if (e.key === "ArrowDown") enabled(i, 1).focus();
        else if (e.key === "ArrowUp") enabled(i, -1).focus();
        else if (e.key === "ArrowRight" && item.submenu) (openSub()?.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
        else if ((e.key === "ArrowLeft" && depth > 0) || (e.key === "Escape" && depth > 0)) {
          layers.splice(depth).forEach((l) => l.remove());
          (layers[depth - 1]?.querySelector("button:focus-within, button") as HTMLElement | null)?.focus();
        } else if (e.key === "Escape" || e.key === "Tab") close();
        else return;
        e.preventDefault();
        e.stopPropagation();
      });
      buttons.push(btn);
      menu.append(btn);
    }
    document.body.append(menu);
    layers[depth] = menu;
    // Ekrana sığdır: sağa taşarsa sola aç, alta taşarsa yukarı kaydır.
    const w = menu.offsetWidth;
    const hgt = menu.offsetHeight;
    let x = at.x;
    if (x + w > window.innerWidth - 4) x = at.flipX !== undefined ? at.flipX - w : window.innerWidth - w - 4;
    let y = at.y;
    if (y + hgt > window.innerHeight - 4) y = Math.max(4, window.innerHeight - hgt - 4);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${y}px`;
    return menu;
  };

  const r = anchor.getBoundingClientRect();
  const root = build(items, 0, { x: r.left, y: r.bottom + 2 });
  if (options.above) root.style.top = `${Math.max(4, r.top - root.offsetHeight - 2)}px`;
  anchor.setAttribute("aria-expanded", "true");
  current = { close };
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  (root.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus({ preventScroll: true });
}
