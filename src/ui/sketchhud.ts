import { h } from "./dom";
import type { FieldKey, Sketcher } from "./sketcher";
import type { Viewport } from "./viewport";

/**
 * Çizerken imlecin yanında görünen ölçü kutucukları (Fusion 360'taki gibi).
 * Rakam yazmaya başlayınca ilk kutucuk düzenlenir; Tab sonrakine geçer, Enter noktayı
 * yazılan ölçülerle koyar, Esc yazılanları bırakır.
 */
export class SketchHud {
  readonly element: HTMLElement;
  private inputs = new Map<FieldKey, HTMLInputElement>();
  private shape = "";

  constructor(
    private readonly sketcher: Sketcher,
    private readonly viewport: Viewport,
  ) {
    this.element = h("div", { class: "sketch-hud", attrs: { role: "group", "aria-label": "Ölçü girişi" } });
    this.element.hidden = true;
    viewport.element.append(this.element);
    sketcher.onDidChange.on(() => this.render());
  }

  get isTyping(): boolean {
    return this.element.contains(document.activeElement);
  }

  /** Klavyeden ilk karakter geldiğinde ilk (ya da kilitsiz ilk) kutucuğa odaklanır. */
  beginTyping(first: string): boolean {
    const fields = this.sketcher.fields();
    if (!fields.length) return false;
    this.render();
    const target = fields.find((f) => !f.locked) ?? fields[0];
    const input = this.inputs.get(target.key);
    if (!input) return false;
    input.focus();
    input.value = first;
    input.dispatchEvent(new Event("input"));
    return true;
  }

  private render(): void {
    const fields = this.sketcher.fields();
    const cursor = this.sketcher.cursor;
    if (!fields.length || !this.sketcher.isActive) {
      if (this.isTyping) this.viewport.element.querySelector("canvas")?.focus();
      this.element.hidden = true;
      this.shape = "";
      return;
    }
    const shape = fields.map((f) => f.key).join();
    if (shape !== this.shape) {
      this.shape = shape;
      this.inputs.clear();
      this.element.replaceChildren(
        ...fields.map((f, i) => {
          const input = h("input", {
            type: "text",
            value: String(f.value),
            attrs: { inputmode: "decimal", "aria-label": f.label, spellcheck: "false" },
          });
          input.addEventListener("input", () => {
            const v = Number(input.value.replace(",", "."));
            this.sketcher.lockField(f.key, input.value.trim() === "" || !Number.isFinite(v) ? undefined : v);
          });
          input.addEventListener("focus", () => input.select());
          input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Tab") {
              e.preventDefault();
              const keys = [...this.inputs.keys()];
              const next = this.inputs.get(keys[(i + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]);
              next?.focus();
            } else if (e.key === "Enter") {
              e.preventDefault();
              this.viewport.element.querySelector("canvas")?.focus();
              this.sketcher.commitTyped();
            } else if (e.key === "Escape") {
              e.preventDefault();
              for (const k of this.inputs.keys()) this.sketcher.lockField(k, undefined);
              this.viewport.element.querySelector("canvas")?.focus();
            }
          });
          this.inputs.set(f.key, input);
          return h("label", { class: "hud-field" }, h("span", {}, f.label), input, h("span", { class: "unit" }, f.unit));
        }),
      );
    }
    for (const f of fields) {
      const input = this.inputs.get(f.key)!;
      input.classList.toggle("locked", f.locked);
      if (document.activeElement !== input) input.value = String(f.value);
    }
    this.element.hidden = false;
    // İmlecin sağ altında dursun; görünüm kenarından taşmasın.
    if (cursor) {
      const p = this.viewport.screenPoint(this.sketcher.plane, this.sketcher.sketch()?.params.offset ?? 0, cursor);
      const host = this.viewport.element.getBoundingClientRect();
      const x = Math.min(p.x - host.left + 18, host.width - this.element.offsetWidth - 8);
      const y = Math.min(p.y - host.top + 18, host.height - this.element.offsetHeight - 8);
      this.element.style.left = `${Math.max(8, x)}px`;
      this.element.style.top = `${Math.max(8, y)}px`;
    }
  }
}
