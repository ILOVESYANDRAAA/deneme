import type { SugarApp } from "../app/controller";
import { DIMENSION_UNITS, constraintAnchor, dimensionAnchor, dimensionPrefix } from "../core/constrain";
import {
  CONSTRAINT_GLYPHS,
  CONSTRAINT_LABELS,
  isDimension,
  type GeometricConstraintType,
  type SConstraint,
} from "../core/sketchmodel";
import type { Vec2 } from "../core/solid";
import { formatNumber, h } from "./dom";
import type { Sketcher } from "./sketcher";
import type { Viewport } from "./viewport";

/** Ölçü etiketi metni: ⌀ / R öneki, değer ve birim. */
export function dimensionText(k: SConstraint): string {
  const type = k.type as keyof typeof DIMENSION_UNITS;
  return `${dimensionPrefix(type)}${formatNumber(k.value ?? 0)}${DIMENSION_UNITS[type] === "°" ? "°" : ""}`;
}

/** İki eğriyi birbirine bağlayan kısıtların simgesi iki eğrinin üstünde de gösterilir. */
const PAIR_CONSTRAINTS = new Set(["parallel", "perpendicular", "equal", "tangent", "concentric"]);

/**
 * Eskizin üstüne biner: kalıcı ölçü etiketleri, kısıt simgeleri ve ölçü düzenleme kutusu.
 * Etiketler kamera hareketiyle birlikte yeniden konumlanır.
 */
export class SketchNotes {
  readonly element: HTMLElement;
  /** Etiketler her çizimde yeniden kurulur; ölçü kutusu ise kendi yuvasında kalır ki yazılan değer ve odak kaybolmasın. */
  private readonly chips: HTMLElement;
  private readonly editorSlot: HTMLElement;
  private editorKey = "";

  constructor(
    private readonly sketcher: Sketcher,
    private readonly viewport: Viewport,
    app: SugarApp,
  ) {
    this.chips = h("div", { class: "sketch-chips" });
    this.editorSlot = h("div", { class: "sketch-editor-slot" });
    this.element = h("div", { class: "sketch-notes" }, this.chips, this.editorSlot);
    this.element.hidden = true;
    viewport.element.append(this.element);
    const refresh = () => this.render();
    sketcher.onDidChange.on(refresh);
    viewport.onDidChangeCamera.on(refresh);
    app.document.onDidChange.on(refresh);
  }

  private render(): void {
    const sk = this.sketcher;
    if (!sk.isActive) {
      this.element.hidden = true;
      this.chips.replaceChildren();
      this.editorSlot.replaceChildren();
      this.editorKey = "";
      return;
    }
    this.element.hidden = false;
    this.element.classList.toggle("tool-active", sk.tool !== null);
    const d = sk.data();
    const plane = sk.plane;
    const offset = sk.sketch()?.params.offset ?? 0;
    const host = this.viewport.element.getBoundingClientRect();
    const place = (el: HTMLElement, p: Vec2, dx = 0, dy = 0) => {
      const s = this.viewport.screenPoint(plane, offset, p);
      el.style.left = `${s.x - host.left + dx}px`;
      el.style.top = `${s.y - host.top + dy}px`;
    };
    const kids: HTMLElement[] = [];
    const conflicting = new Set(sk.solveInfo.conflicting);
    const stacked = new Map<string, number>();
    for (const k of d.constraints) {
      const selected = sk.selected.has(k.id);
      if (isDimension(k)) {
        const a = dimensionAnchor(d, k);
        if (!a) continue;
        const chip = h(
          "button",
          {
            class: `note dim${selected ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`,
            title: `${CONSTRAINT_LABELS[k.type]} — çift tıklayarak düzenleyin`,
            dataset: { constraint: k.id },
            attrs: { "aria-label": `${CONSTRAINT_LABELS[k.type]} ${dimensionText(k)}` },
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              sk.selectItem(k.id, e.ctrlKey || e.metaKey || e.shiftKey);
            },
            ondblclick: (e: MouseEvent) => {
              e.stopPropagation();
              try {
                sk.beginEditDimension(k.id);
              } catch (err) {
                sk.reportError(err);
              }
            },
          },
          dimensionText(k),
        );
        place(chip, a);
        kids.push(chip);
      } else if (sk.options.showConstraints) {
        for (let slot = 0; slot < (PAIR_CONSTRAINTS.has(k.type) ? 2 : 1); slot++) {
          const a = constraintAnchor(d, k, slot);
          if (!a) continue;
          // Aynı yerdeki simgeler yan yana dizilir.
          const key = `${Math.round(a[0] * 100)},${Math.round(a[1] * 100)}`;
          const n = stacked.get(key) ?? 0;
          stacked.set(key, n + 1);
          const chip = h(
            "button",
            {
              class: `note glyph${selected ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`,
              title: `${CONSTRAINT_LABELS[k.type]} (silmek için seçip Delete)`,
              dataset: { constraint: k.id },
              attrs: { "aria-label": CONSTRAINT_LABELS[k.type] },
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                sk.selectItem(k.id, e.ctrlKey || e.metaKey || e.shiftKey);
              },
            },
            CONSTRAINT_GLYPHS[k.type as GeometricConstraintType] ?? "?",
          );
          place(chip, a, 8 + n * 20, -16);
          kids.push(chip);
        }
      }
    }
    this.chips.replaceChildren(...kids);
    this.syncEditor(place);
  }

  /** Aynı ölçü için açık kutu yeniden kurulmaz (yalnızca konumu güncellenir); başka ölçüye geçilince yenisi açılır. */
  private syncEditor(place: (el: HTMLElement, p: Vec2, dx?: number, dy?: number) => void): void {
    const dr = this.sketcher.draft;
    if (!dr) {
      this.editorSlot.replaceChildren();
      this.editorKey = "";
      return;
    }
    const key = `${dr.items.join("+")}:${dr.index}:${dr.editing ?? ""}`;
    const current = this.editorSlot.firstElementChild as HTMLElement | null;
    if (current && this.editorKey === key) {
      const choice = dr.choices[dr.index];
      const anchor = dimensionAnchor(this.sketcher.data(), { id: "draft", type: choice.type, refs: choice.refs });
      if (anchor) place(current, anchor, 12, 12);
      return;
    }
    const editor = this.renderEditor(place, key);
    this.editorSlot.replaceChildren(...(editor ? [editor] : []));
    this.editorKey = editor ? key : "";
    if (editor) {
      const input = editor.querySelector("input");
      input?.focus();
      input?.select();
    }
  }

  /** Açık ölçü kutusu: tür seçimi (varsa), değer girişi, Tamam / İptal. */
  private renderEditor(place: (el: HTMLElement, p: Vec2, dx?: number, dy?: number) => void, key: string): HTMLElement | null {
    const sk = this.sketcher;
    const dr = sk.draft;
    if (!dr) return null;
    const choice = dr.choices[dr.index];
    const unit = DIMENSION_UNITS[choice.type];
    const input = h("input", {
      type: "text",
      value: formatNumber(choice.value),
      attrs: { inputmode: "decimal", "aria-label": `${CONSTRAINT_LABELS[choice.type]} değeri`, spellcheck: "false" },
    });
    const submit = () => {
      const v = Number(input.value.replace(",", "."));
      sk.commitDimension(v);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        sk.cancelDimension();
        this.viewport.element.querySelector("canvas")?.focus();
      }
    });
    const select =
      dr.choices.length > 1
        ? h(
            "select",
            { attrs: { "aria-label": "Ölçü türü" } },
            ...dr.choices.map((c, i) => h("option", { value: String(i), selected: i === dr.index }, CONSTRAINT_LABELS[c.type])),
          )
        : null;
    select?.addEventListener("change", () => sk.setDimensionChoice(Number(select.value)));
    const box = h(
      "form",
      { class: "dim-editor", dataset: { key }, attrs: { role: "group", "aria-label": "Ölçü" } },
      select,
      h("span", { class: "dim-prefix" }, dimensionPrefix(choice.type)),
      input,
      h("span", { class: "unit" }, unit),
      h("button", { type: "submit", class: "btn primary", title: "Tamam (Enter)" }, "✓"),
      h("button", { type: "button", class: "btn", title: "İptal (Esc)", onclick: () => sk.cancelDimension() }, "✕"),
    );
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    const anchor =
      dimensionAnchor(sk.data(), { id: "draft", type: choice.type, refs: choice.refs }) ?? sk.data().points.map((p): Vec2 => [p.x, p.y])[0];
    if (anchor) place(box, anchor, 12, 12);
    return box;
  }
}
