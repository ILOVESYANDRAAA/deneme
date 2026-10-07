import { Emitter, type Disposable } from "./events";

export type CommandHandler = (...args: unknown[]) => unknown;

export interface CommandInfo {
  id: string;
  title: string;
  /** Komut paletinde başlıktan önce gösterilen grup ("Dosya", "Şekil" ...). */
  category?: string;
  /** "Ctrl+Shift+P" biçiminde; Mac'te Ctrl yerine Cmd de kabul edilir. */
  keybinding?: string;
  /** Komutu sağlayan eklenti (yerleşik komutlarda boş). */
  pluginId?: string;
}

interface Entry extends CommandInfo {
  handler: CommandHandler;
}

/** VS Code'daki gibi merkezi komut kaydı: menüler, kısayollar, palet ve eklentiler hep buradan geçer. */
export class CommandRegistry {
  private commands = new Map<string, Entry>();
  readonly onDidChange = new Emitter<void>();
  /** Komut çalışırken atılan hatalar (arayüz bildirim olarak gösterir). */
  readonly onDidFail = new Emitter<{ id: string; error: unknown }>();

  register(info: CommandInfo, handler: CommandHandler): Disposable {
    if (this.commands.has(info.id)) throw new Error(`Komut zaten kayıtlı: ${info.id}`);
    this.commands.set(info.id, { ...info, handler });
    this.onDidChange.fire();
    return {
      dispose: () => {
        if (this.commands.get(info.id)?.handler === handler) {
          this.commands.delete(info.id);
          this.onDidChange.fire();
        }
      },
    };
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  get(id: string): CommandInfo | undefined {
    const entry = this.commands.get(id);
    if (!entry) return undefined;
    const { handler: _handler, ...info } = entry;
    return info;
  }

  list(): CommandInfo[] {
    return [...this.commands.keys()].map((id) => this.get(id)!);
  }

  async execute(id: string, ...args: unknown[]): Promise<unknown> {
    const entry = this.commands.get(id);
    if (!entry) throw new Error(`Komut bulunamadı: ${id}`);
    return entry.handler(...args);
  }

  /** Hataları yutmadan, ama arayüzü kırmadan çalıştırır. */
  async run(id: string, ...args: unknown[]): Promise<void> {
    try {
      await this.execute(id, ...args);
    } catch (error) {
      this.onDidFail.fire({ id, error });
    }
  }

  findByKeybinding(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string | undefined {
    const pressed = normalizeKeyEvent(event);
    for (const entry of this.commands.values()) {
      if (entry.keybinding && normalizeKeybinding(entry.keybinding) === pressed) return entry.id;
    }
    return undefined;
  }
}

/** Basit fuzzy eşleşme: sorgudaki harfler sırasıyla geçiyor mu? Düşük skor daha iyi. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLocaleLowerCase("tr").trim();
  const t = text.toLocaleLowerCase("tr");
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return direct;
  let score = 100;
  let pos = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, pos);
    if (found < 0) return null;
    score += found - pos;
    pos = found + 1;
  }
  return score;
}

function normalizeKeybinding(binding: string): string {
  const parts = binding.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((m) => (m === "cmd" || m === "meta" ? "ctrl" : m)));
  return [...["ctrl", "shift", "alt"].filter((m) => mods.has(m)), key].join("+");
}

function normalizeKeyEvent(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("ctrl");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey) mods.push("alt");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  return [...mods, key].join("+");
}
