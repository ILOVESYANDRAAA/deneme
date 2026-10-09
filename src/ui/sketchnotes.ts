import type { SugarApp } from "../app/controller";
import { DIMENSION_UNITS, constraintAnchor, dimensionLayout, dimensionPrefix, type DimensionLayout } from "../core/constrain";
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
  const value = `${dimensionPrefix(type)}${formatNumber(Number((k.value ?? 0).toFixed(4)))}${DIMENSION_UNITS[type] === "°" ? "°" : ""}`;
  // Parametre ifadesinden gelen ölçüler "ƒ" ile işaretlenir.
  return k.expr ? `ƒ ${value}` : value;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Ölçü çizgisinin öğelerden varsayılan uzaklığı, ok boyu ve yarım genişliği (piksel). */
const DIM_GAP_PX = 30;
const ARROW_LEN = 10;
const ARROW_HALF = 3.5;
/** Oklar arası bundan darsa oklar ölçü çizgisinin dışına çevrilir. */
const ARROW_FIT_PX = 3 * ARROW_LEN;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
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
  /** Ölçü çizgileri, uzatma çizgileri ve oklar (etiketlerin altında). */
  private readonly graphics: SVGSVGElement;
  private readonly editorSlot: HTMLElement;
  /** Boş yerde sürüklerken görünen seçim kutusu. */
  private readonly boxEl: HTMLElement;
  private editorKey = "";

  constructor(
    private readonly sketcher: Sketcher,
    private readonly viewport: Viewport,
    app: SugarApp,
  ) {
    this.chips = h("div", { class: "sketch-chips" });
    this.graphics = svgEl("svg", { class: "sketch-dims", "aria-hidden": "true" });
    this.editorSlot = h("div", { class: "sketch-editor-slot" });
    this.boxEl = h("div", { class: "sketch-box" });
    this.boxEl.hidden = true;
    this.element = h("div", { class: "sketch-notes" }, this.graphics, this.boxEl, this.chips, this.editorSlot);
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
      this.graphics.replaceChildren();
      this.editorSlot.replaceChildren();
      this.boxEl.hidden = true;
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
    const drawn: SVGElement[] = [];
    // Ölçü çizgisinin varsayılan uzaklığı ekranda sabit kalsın diye eskiz birimine yakınlaştırmaya göre çevrilir.
    const gap = DIM_GAP_PX * this.viewport.worldPerPixel();
    const screen = (p: Vec2): Vec2 => {
      const s = this.viewport.screenPoint(plane, offset, p);
      return [s.x - host.left, s.y - host.top];
    };
    const conflicting = new Set(sk.solveInfo.conflicting);
    const stacked = new Map<string, number>();
    for (const k of d.constraints) {
      const selected = sk.selected.has(k.id);
      if (isDimension(k)) {
        const layout = dimensionLayout(d, k, gap);
        if (!layout) continue;
        drawn.push(this.drawDimension(layout, screen, gap, `dim-graphic${selected ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`));
        const chip = h(
          "button",
          {
            class: `note dim${selected ? " selected" : ""}${conflicting.has(k.id) ? " conflict" : ""}`,
            title: `${CONSTRAINT_LABELS[k.type]}${k.expr ? ` = ${k.expr}` : ""} — çift tıklayarak düzenleyin`,
            dataset: { constraint: k.id },
            attrs: { "aria-label": `${CONSTRAINT_LABELS[k.type]} ${dimensionText(k)}` },
            onpointerdown: (e: PointerEvent) => this.dragLabel(e, k.id),
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
        place(chip, layout.label);
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
    // Yeni ölçünün önizlemesi: kutu açıkken ölçü çizgisi imleçle gezer.
    const dr = sk.draft;
    const choice = dr && !dr.editing ? dr.choices[dr.index] : null;
    const preview = choice ? dimensionLayout(d, { type: choice.type, refs: choice.refs, offset: dr?.offset }, gap) : null;
    if (preview) drawn.push(this.drawDimension(preview, screen, gap, "dim-graphic draft"));
    drawn.push(...this.drawSnap(screen));
    this.syncBox(host);
    this.graphics.replaceChildren(...drawn);
    this.chips.replaceChildren(...kids);
    this.syncEditor(place, gap);
  }

  /** Yakalama göstergesi (köşe, merkez, orta nokta) ve hizalama kılavuzları. */
  private drawSnap(screen: (p: Vec2) => Vec2): SVGElement[] {
    const sk = this.sketcher;
    const out: SVGElement[] = [];
    if (!sk.tool || sk.tool === "dimension") return out;
    for (const [from, to] of sk.guides) {
      const [a, b] = [screen(from), screen(to)];
      out.push(svgEl("path", { class: "snap-guide", d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}` }));
      out.push(svgEl("circle", { class: "snap-guide-end", cx: a[0].toFixed(1), cy: a[1].toFixed(1), r: "3" }));
    }
    if (sk.cursor && sk.snapKind) {
      const [x, y] = screen(sk.cursor);
      const g = svgEl("g", { class: "snap-glyph" });
      const R = 6;
      if (sk.snapKind === "merkez") {
        g.append(svgEl("circle", { cx: String(x), cy: String(y), r: String(R) }), svgEl("circle", { class: "dot", cx: String(x), cy: String(y), r: "1.5" }));
      } else if (sk.snapKind === "orta nokta") {
        g.append(svgEl("path", { d: `M${x} ${y - R}L${x + R} ${y + R}L${x - R} ${y + R}Z` }));
      } else {
        g.append(svgEl("rect", { x: String(x - R), y: String(y - R), width: String(2 * R), height: String(2 * R) }));
      }
      const label = svgEl("text", { class: "snap-label", x: String(x + R + 5), y: String(y - R - 3) });
      label.textContent = sk.snapKind;
      g.append(label);
      out.push(g);
    }
    return out;
  }

  private syncBox(host: DOMRect): void {
    const box = this.sketcher.box;
    if (!box?.active) {
      this.boxEl.hidden = true;
      return;
    }
    this.boxEl.hidden = false;
    this.boxEl.classList.toggle("crossing", box.x1 < box.x0);
    Object.assign(this.boxEl.style, {
      left: `${Math.min(box.x0, box.x1) - host.left}px`,
      top: `${Math.min(box.y0, box.y1) - host.top}px`,
      width: `${Math.abs(box.x1 - box.x0)}px`,
      height: `${Math.abs(box.y1 - box.y0)}px`,
    });
  }

  /** Ölçüyü ekran uzayında çizer: uzatma / ölçü çizgileri ve oklar. Dar aralıkta oklar dışarıdan bakar. */
  private drawDimension(layout: DimensionLayout, screen: (p: Vec2) => Vec2, gap: number, cls: string): SVGElement {
    const g = svgEl("g", { class: cls });
    const path = (pts: Vec2[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
    const tangent = (at: Vec2, dir: Vec2): Vec2 => {
      const eps = gap / DIM_GAP_PX; // bir piksel
      const a = screen(at);
      const b = screen([at[0] + dir[0] * eps * 4, at[1] + dir[1] * eps * 4]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    };
    const strokes = layout.lines.map((l) => l.map(screen));
    const [from, to] = layout.span ? layout.span.map(screen) : [null, null];
    const cramped = !!from && !!to && Math.hypot(to[0] - from[0], to[1] - from[1]) < ARROW_FIT_PX;
    const heads: string[] = [];
    for (const arrow of layout.arrows) {
      const tip = screen(arrow.at);
      const dir = tangent(arrow.at, arrow.dir);
      // Dar yerde ok ters çevrilir ve ucundan dışarı bir kuyruk çizgisi uzanır.
      const sign = cramped ? -1 : 1;
      const d: Vec2 = [dir[0] * sign, dir[1] * sign];
      if (cramped) strokes.push([tip, [tip[0] - d[0] * ARROW_LEN * 2, tip[1] - d[1] * ARROW_LEN * 2]]);
      const base: Vec2 = [tip[0] - d[0] * ARROW_LEN, tip[1] - d[1] * ARROW_LEN];
      const n: Vec2 = [-d[1] * ARROW_HALF, d[0] * ARROW_HALF];
      heads.push(`M${tip[0].toFixed(1)} ${tip[1].toFixed(1)}L${(base[0] + n[0]).toFixed(1)} ${(base[1] + n[1]).toFixed(1)}L${(base[0] - n[0]).toFixed(1)} ${(base[1] - n[1]).toFixed(1)}Z`);
    }
    g.append(svgEl("path", { class: "dim-line", d: strokes.map(path).join("") }));
    if (heads.length) g.append(svgEl("path", { class: "dim-arrow", d: heads.join("") }));
    return g;
  }

  /** Etiketi tutup sürükleyerek ölçü çizgisini taşır; kısa hareket tıklama sayılır. */
  private dragLabel(e: PointerEvent, id: string): void {
    const sk = this.sketcher;
    if (e.button !== 0 || (sk.tool && sk.tool !== "dimension")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      sk.moveDimensionLabel(id, ev.clientX, ev.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved) sk.endDimensionLabelDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Aynı ölçü için açık kutu yeniden kurulmaz (yalnızca konumu güncellenir); başka ölçüye geçilince yenisi açılır. */
  private syncEditor(place: (el: HTMLElement, p: Vec2, dx?: number, dy?: number) => void, gap: number): void {
    const dr = this.sketcher.draft;
    if (!dr) {
      this.editorSlot.replaceChildren();
      this.editorKey = "";
      return;
    }
    const key = `${dr.items.join("+")}:${dr.index}:${dr.editing ?? ""}`;
    const current = this.editorSlot.firstElementChild as HTMLElement | null;
    if (current && this.editorKey === key) {
      const anchor = this.editorAnchor(gap);
      if (anchor) place(current, anchor, 12, 12);
      return;
    }
    const editor = this.renderEditor(place, key, gap);
    this.editorSlot.replaceChildren(...(editor ? [editor] : []));
    this.editorKey = editor ? key : "";
    if (editor) {
      const input = editor.querySelector("input");
      input?.focus();
      input?.select();
    }
  }

  /** Açık ölçü kutusu: tür seçimi (varsa), değer girişi, Tamam / İptal. */
  private renderEditor(place: (el: HTMLElement, p: Vec2, dx?: number, dy?: number) => void, key: string, gap: number): HTMLElement | null {
    const sk = this.sketcher;
    const dr = sk.draft;
    if (!dr) return null;
    const choice = dr.choices[dr.index];
    const unit = DIMENSION_UNITS[choice.type];
    const editing = dr.editing ? sk.data().constraints.find((c) => c.id === dr.editing) : undefined;
    const input = h("input", {
      type: "text",
      value: editing?.expr ?? formatNumber(choice.value),
      attrs: { inputmode: "decimal", "aria-label": `${CONSTRAINT_LABELS[choice.type]} değeri`, spellcheck: "false" },
    });
    const submit = () => {
      sk.commitDimensionText(input.value);
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
    const anchor = this.editorAnchor(gap) ?? sk.data().points.map((p): Vec2 => [p.x, p.y])[0];
    if (anchor) place(box, anchor, 12, 12);
    return box;
  }

  /**
   * Değer kutusunun yeri: var olan ölçüde etiketin yanı; yeni ölçüde ölçü çizgisi imleçle gezerken
   * kutu yerinde kalır (fareyle ulaşılabilsin), yani ölçünün varsayılan etiket konumu.
   */
  private editorAnchor(gap: number): Vec2 | null {
    const sk = this.sketcher;
    const dr = sk.draft;
    if (!dr) return null;
    const choice = dr.choices[dr.index];
    const existing = dr.editing ? sk.data().constraints.find((c) => c.id === dr.editing) : undefined;
    return dimensionLayout(sk.data(), { type: choice.type, refs: choice.refs, offset: existing?.offset }, gap)?.label ?? null;
  }
}
