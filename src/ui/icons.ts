// 16px çizgi ikonları (sabit metin; kullanıcı girdisi içermez). Şeritte CSS ile büyütülür.
const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor" stroke="none"/>`;

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
  tree: svg('<path d="M3 2.5h4M5 2.5v11M5 7.5h4.5M5 13h4.5"/><rect x="9.5" y="5.5" width="4" height="4" rx=".5"/><rect x="9.5" y="11" width="4" height="4" rx=".5"/>'),
  extensions: svg('<rect x="2" y="2" width="5" height="5" rx=".5"/><rect x="2" y="9" width="5" height="5" rx=".5"/><rect x="9" y="9" width="5" height="5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="5" rx=".5" transform="rotate(12 12 4)"/>'),
  palette: svg('<path d="M4 6l3 2-3 2M8.5 11H12"/><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>'),
  properties: svg('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4"/>'),
  save: svg('<path d="M2.5 2.5h9l2 2v9h-11Z"/><path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4"/>'),
  open: svg('<path d="M1.5 4V13h11l2-6H4l-2.5 6"/><path d="M1.5 4V2.5h4l1.5 1.5h5V7"/>'),
  newFile: svg('<path d="M3.5 1.5h6l3 3v10h-9Z"/><path d="M9.5 1.5v3h3M8 7.5v4M6 9.5h4"/>'),
  export: svg('<path d="M3.5 9.5v4h9v-4"/><path d="M8 2v8M5 5l3-3 3 3"/>'),
  sketch: svg('<path d="M2 14h12M2 14V2"/><path d="m5 11 6.5-6.5 1.5 1.5L6.5 12.5H5Z"/>'),
  sketchOffset: svg('<path d="M1.5 11.5 6 9l8.5 2.5L10 14Z"/><path d="M1.5 6.5 6 4l8.5 2.5L10 9" stroke-dasharray="1.6 1.4"/><path d="M8 11V7.5M6.8 8.6 8 7.4l1.2 1.2"/>'),
  extrude: svg('<path d="M3 11.5 8 14l5-2.5M3 11.5 8 9l5 2.5"/><path d="M8 9V2M5.5 4.5 8 2l2.5 2.5"/>'),
  revolve: svg('<path d="M8 2v12" stroke-dasharray="1.5 1.5"/><path d="M12.5 6.5a4.5 2 0 1 1-9 0"/><path d="m11 5 1.5 1.5L14 5"/>'),
  line: svg(`<path d="M3 13 13 3"/>${dot(3, 13)}${dot(13, 3)}`),
  rect: svg(`<rect x="2.5" y="4" width="11" height="8"/>${dot(2.5, 12)}${dot(13.5, 4)}`),
  rectCenter: svg(`<rect x="2.5" y="4" width="11" height="8"/>${dot(8, 8)}${dot(13.5, 4)}`),
  rect3: svg(`<path d="M2 10 9 3l5 5-7 7Z"/>${dot(2, 10)}${dot(9, 3)}${dot(14, 8)}`),
  circle: svg(`<circle cx="8" cy="8" r="5.5"/>${dot(8, 8)}`),
  circle2: svg(`<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11" stroke-dasharray="1.4 1.2"/>${dot(2.5, 8)}${dot(13.5, 8)}`),
  circle3: svg(`<circle cx="8" cy="8" r="5.5"/>${dot(2.5, 8)}${dot(10.8, 3.2)}${dot(10.8, 12.8)}`),
  arc3: svg(`<path d="M2.5 12A6 6 0 0 1 13.5 12"/>${dot(2.5, 12)}${dot(8, 6)}${dot(13.5, 12)}`),
  arcCenter: svg(`<path d="M13.5 10A5.5 5.5 0 0 1 2.5 10"/><path d="M8 10h5.5" stroke-dasharray="1.4 1.2"/>${dot(8, 10)}`),
  polygon: svg('<path d="M8 2 13.2 5v6L8 14l-5.2-3V5Z"/>'),
  slot: svg(`<path d="M5 5h6a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6Z"/>${dot(5, 8)}${dot(11, 8)}`),
  ellipse: svg(`<ellipse cx="8" cy="8" rx="6" ry="3.6" transform="rotate(-20 8 8)"/>${dot(8, 8)}`),
  spline: svg(`<path d="M2 12C4 2 7 3 8 8s4 6 6-4"/>${dot(2, 12)}${dot(8, 8)}${dot(14, 4)}`),
  fillet: svg('<path d="M2.5 13.5V8a5.5 5.5 0 0 1 5.5-5.5h5.5"/><path d="M2.5 5V2.5H5" stroke-dasharray="1.4 1.2"/>'),
  construction: svg('<path d="M2 14 14 2" stroke-dasharray="2 1.6"/><circle cx="8" cy="8" r="4.5" stroke-dasharray="2 1.6"/>'),
  sketchMirror: svg('<path d="M8 1.5v13" stroke-dasharray="1.6 1.4"/><path d="M6 4 2.5 12H6ZM10 4l3.5 8H10Z"/>'),
  select: svg('<path d="M3.5 2.5 12 8l-3.8.8L10.6 13l-1.6.9-2.3-4.2-3.2 2.4Z"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"/>'),
  mirror: svg('<path d="M8 1.5v13" stroke-dasharray="1.6 1.4"/><path d="M2 5.5 5.5 4v8L2 10.5ZM14 5.5 10.5 4v8l3.5-1.5Z"/>'),
  linearPattern: svg('<rect x="1.5" y="1.5" width="4" height="4"/><rect x="10.5" y="1.5" width="4" height="4" stroke-dasharray="1.4 1.1"/><rect x="1.5" y="10.5" width="4" height="4" stroke-dasharray="1.4 1.1"/><rect x="10.5" y="10.5" width="4" height="4" stroke-dasharray="1.4 1.1"/>'),
  circularPattern: svg('<circle cx="8" cy="8" r="1"/><rect x="6.5" y="1.2" width="3" height="3"/><rect x="11.8" y="6.5" width="3" height="3" stroke-dasharray="1.2 1"/><rect x="6.5" y="11.8" width="3" height="3" stroke-dasharray="1.2 1"/><rect x="1.2" y="6.5" width="3" height="3" stroke-dasharray="1.2 1"/>'),
  scale: svg('<rect x="1.5" y="8.5" width="6" height="6"/><path d="M7.5 2.5h6v6" stroke-dasharray="1.6 1.4"/><path d="M6 10l7-7M9.5 3H13v3.5"/>'),
  measure: svg('<path d="m1.5 10.5 9-9 4 4-9 9Z"/><path d="m4 8 1.5 1.5M6 6l2 2M8 4l1.5 1.5"/>'),
  section: svg('<path d="M8 1.5 13.8 4.7v6.6L8 14.5l-5.8-3.2V4.7Z"/><path d="M1 8.5h14" stroke="var(--accent, #f2a541)"/><path d="M2.2 8.5 8 11.3l5.8-2.8" fill="currentColor" fill-opacity=".25"/>'),
  home: svg('<path d="M2 7.5 8 2.5l6 5"/><path d="M3.5 6.5v7h3.5v-4h2v4h3.5v-7"/>'),
  eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" opacity=".45"/><path d="m2.5 13.5 11-11"/>'),
  chevronDown: svg('<path d="m4 6 4 4 4-4"/>'),
  chevronRight: svg('<path d="m6 4 4 4-4 4"/>'),
  grip: svg(`${dot(6, 4)}${dot(10, 4)}${dot(6, 8)}${dot(10, 8)}${dot(6, 12)}${dot(10, 12)}`),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  minimize: svg('<path d="M3.5 8h9"/>'),
  grid: svg('<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/><rect x="2" y="2" width="12" height="12"/>'),
  styleShaded: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" fill="currentColor" fill-opacity=".35"/>'),
  styleEdges: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" fill="currentColor" fill-opacity=".35"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6"/>'),
  styleWire: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6M2.2 11 8 7.8l5.8 3.2M8 1.8v6" stroke-dasharray="1.3 1.1"/>'),
  plane: svg('<path d="M1.5 10.5 6 6.5h8.5L10 10.5Z"/>'),
  folder: svg('<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13Z"/>'),
  origin: svg('<path d="M3 13V3M3 13h10M3 13l5-4"/>'),
  check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>'),
  error: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8v4M8 11v.2"/>'),
  menu: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function iconForType(type: string, op?: string): string {
  if (type === "boolean") return ICONS[(op as "union" | "subtract" | "intersect") ?? "union"] ?? ICONS.union;
  if (type in ICONS) return ICONS[type as IconName];
  return ICONS.plugin;
}
