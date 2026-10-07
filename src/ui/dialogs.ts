import type { InputField } from "../../packages/api/sugarcad";
import type { MessageKind } from "../app/controller";
import { h } from "./dom";

/** Sağ alttaki bildirimler. */
export class Notifications {
  private container = h("div", { class: "toasts", attrs: { role: "status", "aria-live": "polite" } });

  constructor() {
    document.body.append(this.container);
  }

  show(text: string, kind: MessageKind = "info"): void {
    const toast = h("div", { class: `toast ${kind}`, onclick: () => toast.remove() }, text);
    this.container.append(toast);
    while (this.container.children.length > 5) this.container.firstElementChild?.remove();
    setTimeout(() => toast.remove(), kind === "error" ? 9000 : 4500);
  }
}

function rangeError(f: InputField, raw: string): string {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return "Bir sayı girin";
  if (f.min !== undefined && n < f.min) return `En az ${f.min} olmalı`;
  if (f.max !== undefined && n > f.max) return `En fazla ${f.max} olmalı`;
  return "";
}

/** Eklentilerin ve komutların kullandığı basit form penceresi. İptalde null döner. */
export function showInputDialog(options: { title: string; fields: InputField[] }): Promise<Record<string, number | string> | null> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const inputs = options.fields.map((f) => {
      const input = h("input", {
        type: f.type === "text" ? "text" : "number",
        value: f.value === undefined ? "" : String(f.value),
        name: f.name,
        id: `dlg-${f.name}`,
      });
      // min/max HTML'e yazılmaz: tarayıcı adımı min'den saydığı için (min 0.1, adım 0.5 → 2 geçersiz) sınırları biz denetleriz.
      if (f.type !== "text") input.step = String(f.step ?? "any");
      input.addEventListener("input", () => input.setCustomValidity(""));
      return { f, input };
    });

    const finish = (value: Record<string, number | string> | null) => {
      overlay.remove();
      previousFocus?.focus?.();
      resolve(value);
    };

    const form = h(
      "form",
      { class: "dialog", noValidate: true, attrs: { role: "dialog", "aria-modal": "true", "aria-label": options.title } },
      h("h2", {}, options.title),
      h(
        "div",
        { class: "form" },
        ...inputs.map(({ f, input }) =>
          h("div", { class: "field" }, h("label", { htmlFor: input.id }, f.label), input),
        ),
      ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { type: "button", class: "btn", onclick: () => finish(null) }, "İptal"),
        h("button", { type: "submit", class: "btn primary" }, "Tamam"),
      ),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // Sadece kendi aralık denetimimiz engeller; adım (step) uyuşmazlığı engellemez.
      for (const { f, input } of inputs) input.setCustomValidity(f.type === "text" ? "" : rangeError(f, input.value));
      const invalid = inputs.find(({ input }) => input.validity.customError);
      if (invalid) {
        invalid.input.reportValidity();
        return;
      }
      const out: Record<string, number | string> = {};
      for (const { f, input } of inputs) out[f.name] = f.type === "text" ? input.value : Number(input.value);
      finish(out);
    });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(null);
      e.stopPropagation();
    });
    const overlay = h("div", { class: "overlay" }, form);
    document.body.append(overlay);
    inputs[0]?.input.select();
  });
}
