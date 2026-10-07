import type { PluginSource } from "../plugins/manifest";

/** Arayüzün işletim sistemine eriştiği tek kapı (Tauri ya da tarayıcı). */
export interface Platform {
  readonly name: "tauri" | "browser";
  /** Dosya seçtirir ve okur; iptalde null. */
  openTextFile(): Promise<{ path: string; text: string } | null>;
  /** `path` verilmezse kaydetme penceresi açar. Kaydedilen yolu ya da iptalde null döner. */
  saveTextFile(text: string, path?: string): Promise<string | null>;
  saveBinaryFile(data: Uint8Array, defaultName: string): Promise<string | null>;
  /** Kullanıcının eklenti klasöründeki eklentiler. */
  listUserPlugins(): Promise<PluginSource[]>;
  /** Kullanıcı eklenti klasörünün yolu (tarayıcıda yok). */
  userPluginsDir(): Promise<string | null>;
  setTitle(title: string): void;
}

export async function detectPlatform(): Promise<Platform> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { TauriPlatform } = await import("./tauri");
    return new TauriPlatform();
  }
  const { BrowserPlatform } = await import("./browser");
  return new BrowserPlatform();
}
