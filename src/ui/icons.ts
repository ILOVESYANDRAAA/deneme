// 16px çizgi ikonları (sabit metin; kullanıcı girdisi içermez).
const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS = {
  box: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6"/>'),
  cylinder: svg('<ellipse cx="8" cy="3.8" rx="5" ry="2"/><path d="M3 3.8v8.4c0 1.1 2.2 2 5 2s5-.9 5-2V3.8"/>'),
  sphere: svg('<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.2"/>'),
  union: svg('<circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4"/>'),
  subtract: svg('<circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4" stroke-dasharray="1.6 1.4"/>'),
  intersect: svg('<circle cx="6" cy="8" r="4" stroke-dasharray="1.6 1.4"/><circle cx="10" cy="8" r="4" stroke-dasharray="1.6 1.4"/><path d="M8 4.6a4 4 0 0 1 0 6.8 4 4 0 0 1 0-6.8Z" fill="currentColor" stroke="none"/>'),
  plugin: svg('<path d="M3 5h3V3.5a1.5 1.5 0 0 1 3 0V5h3v3h-1.5a1.5 1.5 0 0 0 0 3H12v3H3Z"/>'),
  undo: svg('<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
  redo: svg('<path d="m10.5 3 3 3-3 3"/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
  fit: svg('<path d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5"/><rect x="5.5" y="5.5" width="5" height="5"/>'),
  tree: svg('<path d="M3 2.5h4M5 2.5v11M5 7.5h4.5M5 13h4.5"/><rect x="9.5" y="5.5" width="4" height="4" rx=".5"/><rect x="9.5" y="11" width="4" height="4" rx=".5"/>', 22),
  extensions: svg('<rect x="2" y="2" width="5" height="5" rx=".5"/><rect x="2" y="9" width="5" height="5" rx=".5"/><rect x="9" y="9" width="5" height="5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="5" rx=".5" transform="rotate(12 12 4)"/>', 22),
  palette: svg('<path d="M4 6l3 2-3 2M8.5 11H12"/><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>', 22),
  save: svg('<path d="M2.5 2.5h9l2 2v9h-11Z"/><path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4"/>'),
  open: svg('<path d="M1.5 4V13h11l2-6H4l-2.5 6"/><path d="M1.5 4V2.5h4l1.5 1.5h5V7"/>'),
  sketch: svg('<path d="M2 14h12M2 14V2"/><path d="m5 11 6.5-6.5 1.5 1.5L6.5 12.5H5Z"/>'),
  extrude: svg('<path d="M3 11.5 8 14l5-2.5M3 11.5 8 9l5 2.5"/><path d="M8 9V2M5.5 4.5 8 2l2.5 2.5"/>'),
  revolve: svg('<path d="M8 2v12" stroke-dasharray="1.5 1.5"/><path d="M12.5 6.5a4.5 2 0 1 1-9 0"/><path d="m11 5 1.5 1.5L14 5"/>'),
  line: svg('<path d="M3 13 13 3"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><circle cx="13" cy="3" r="1.2" fill="currentColor"/>'),
  rect: svg('<rect x="2.5" y="4" width="11" height="8"/>'),
  circle: svg('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>'),
  check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>'),
  error: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8v4M8 11v.2"/>'),
} as const;

export function iconForType(type: string, op?: string): string {
  if (type === "boolean") return ICONS[(op as "union" | "subtract" | "intersect") ?? "union"] ?? ICONS.union;
  if (type === "sketch" || type === "extrude" || type === "revolve") return ICONS[type];
  if (type === "box" || type === "cylinder" || type === "sphere") return ICONS[type];
  return ICONS.plugin;
}
