import { fuzzyScore, type CommandInfo, type CommandRegistry } from "../core/commands";
import { h } from "./dom";

/** VS Code tarzı komut paleti (Ctrl+Shift+P). */
export class CommandPalette {
  private overlay: HTMLElement | null = null;

  constructor(private readonly commands: CommandRegistry) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const input = h("input", {
      type: "text",
      placeholder: "Komut yazın…",
      attrs: { "aria-label": "Komut ara", role: "combobox", "aria-expanded": "true" },
    });
    const list = h("ul", { attrs: { role: "listbox" } });
    const box = h("div", { class: "palette" }, input, list);
    const overlay = h("div", { class: "overlay" }, box);
    this.overlay = overlay;

    let items: CommandInfo[] = [];
    let active = 0;
    const label = (c: CommandInfo) => (c.category ? `${c.category}: ${c.title}` : c.title);

    const render = () => {
      const q = input.value;
      items = this.commands
        .list()
        .map((c) => ({ c, s: fuzzyScore(q, label(c)) }))
        .filter((x): x is { c: CommandInfo; s: number } => x.s !== null)
        .sort((a, b) => a.s - b.s || label(a.c).localeCompare(label(b.c), "tr"))
        .map((x) => x.c);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.replaceChildren(
        ...(items.length
          ? items.map((c, i) =>
              h(
                "li",
                {
                  attrs: { role: "option", "aria-selected": String(i === active) },
                  onmousemove: () => {
                    if (active !== i) {
                      active = i;
                      render();
                    }
                  },
                  onclick: () => run(c),
                },
                c.category ? h("span", { class: "cat" }, `${c.category}:`) : null,
                h("span", { class: "title" }, c.title),
                c.keybinding ? h("kbd", {}, c.keybinding) : null,
              ),
            )
          : [h("li", { class: "empty" }, "Eşleşen komut yok")]),
      );
      list.children[active]?.scrollIntoView({ block: "nearest" });
    };

    const close = () => {
      overlay.remove();
      this.overlay = null;
      previousFocus?.focus?.();
    };
    const run = (c: CommandInfo) => {
      close();
      void this.commands.run(c.id);
    };

    input.addEventListener("input", () => {
      active = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") active = Math.min(items.length - 1, active + 1);
      else if (e.key === "ArrowUp") active = Math.max(0, active - 1);
      else if (e.key === "Enter" && items[active]) return run(items[active]);
      else if (e.key === "Escape") return close();
      else return;
      e.preventDefault();
      render();
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    render();
    document.body.append(overlay);
    input.focus();
  }
}
