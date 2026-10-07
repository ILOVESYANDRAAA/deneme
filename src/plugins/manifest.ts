import type { ParamSpec } from "../core/features";

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;
}

export interface PrimitiveContribution {
  type: string;
  label: string;
  params: Record<string, ParamSpec>;
}

/** Eklentinin `sugarcad.json` dosyası (VS Code'daki package.json'un karşılığı). */
export interface PluginManifest {
  /** Benzersiz kimlik: küçük harf, rakam ve tire. Komut ve şekil kimlikleri bununla başlar. */
  name: string;
  displayName?: string;
  version: string;
  description?: string;
  author?: string;
  /** Eklentinin giriş dosyası (CommonJS: `exports.activate = ...`). */
  main: string;
  /** "onStartup", "onCommand:<id>", "onPrimitive:<tür>". Boşsa komut/şekil kullanılınca etkinleşir. */
  activationEvents?: string[];
  contributes?: {
    commands?: CommandContribution[];
    primitives?: PrimitiveContribution[];
  };
}

export interface PluginSource {
  manifest: PluginManifest;
  code: string;
  location: "builtin" | "user";
  /** Kullanıcı eklentileri için diskteki klasör. */
  path?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(name: string, message: string): never {
  throw new Error(`Eklenti "${name}": ${message}`);
}

function checkParams(name: string, where: string, params: unknown): void {
  if (typeof params !== "object" || params === null) fail(name, `${where}.params bir nesne olmalı`);
  for (const [key, spec] of Object.entries(params as Record<string, unknown>)) {
    const s = spec as Partial<ParamSpec>;
    if (typeof s?.label !== "string" || typeof s.default !== "number" || !Number.isFinite(s.default)) {
      fail(name, `${where}.params.${key}: "label" (metin) ve "default" (sayı) gerekli`);
    }
  }
}

/** Manifesti doğrular; geçersizse ne yanlış olduğunu söyleyen bir hata fırlatır. */
export function validateManifest(value: unknown): PluginManifest {
  if (typeof value !== "object" || value === null) throw new Error("Manifest bir JSON nesnesi olmalı");
  const m = value as PluginManifest;
  const name = typeof m.name === "string" ? m.name : "?";
  if (!NAME_RE.test(name)) fail(name, '"name" küçük harf, rakam ve tire içermeli (ör. "disli-uretici")');
  if (typeof m.version !== "string" || !m.version) fail(name, '"version" gerekli');
  if (typeof m.main !== "string" || !m.main) fail(name, '"main" gerekli');

  const prefix = `${name}.`;
  const seen = new Set<string>();
  for (const [i, c] of (m.contributes?.commands ?? []).entries()) {
    if (typeof c?.id !== "string" || !c.id.startsWith(prefix)) {
      fail(name, `contributes.commands[${i}].id "${prefix}" ile başlamalı`);
    }
    if (typeof c.title !== "string" || !c.title) fail(name, `contributes.commands[${i}].title gerekli`);
    if (seen.has(c.id)) fail(name, `aynı komut iki kez tanımlanmış: ${c.id}`);
    seen.add(c.id);
  }
  for (const [i, p] of (m.contributes?.primitives ?? []).entries()) {
    if (typeof p?.type !== "string" || !p.type.startsWith(prefix)) {
      fail(name, `contributes.primitives[${i}].type "${prefix}" ile başlamalı`);
    }
    if (typeof p.label !== "string" || !p.label) fail(name, `contributes.primitives[${i}].label gerekli`);
    checkParams(name, `contributes.primitives[${i}]`, p.params);
  }
  for (const ev of m.activationEvents ?? []) {
    if (ev !== "onStartup" && !ev.startsWith("onCommand:") && !ev.startsWith("onPrimitive:")) {
      fail(name, `bilinmeyen etkinleşme olayı: ${ev}`);
    }
  }
  return m;
}
