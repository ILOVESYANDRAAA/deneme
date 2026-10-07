type Child = Node | string | number | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style" | "dataset">> & {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
};

/** Küçük DOM oluşturucu: h("button", { class: "btn", onclick }, "Tamam") */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, style, dataset, attrs, ...rest } = props;
  if (cls) el.className = cls;
  if (style) el.setAttribute("style", style);
  if (dataset) Object.assign(el.dataset, dataset);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.assign(el, rest);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Güvenilir, sabit SVG ikon metninden düğüm üretir. */
export function icon(svg: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = svg;
  return span;
}

export function isTextInput(el: Element | null): boolean {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/** replaceChildren için boş değerleri ayıklar. */
export function compact(...children: Child[]): (Node | string)[] {
  return children.flatMap((c) => (c === null || c === undefined || c === false ? [] : [c instanceof Node ? c : String(c)]));
}
