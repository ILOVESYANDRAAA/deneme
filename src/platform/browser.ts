import type { PluginSource } from "../plugins/manifest";
import type { AvailableUpdate, FileFilter, Platform } from "./adapter";

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tarayıcıda çalışırken (geliştirme ve testler) kullanılan platform. */
export class BrowserPlatform implements Platform {
  readonly name = "browser" as const;

  openTextFile(filter?: FileFilter): Promise<{ path: string; text: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = filter ? filter.extensions.map((e) => `.${e}`).join(",") : ".sugar,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        resolve(file ? { path: file.name, text: await file.text() } : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  async saveTextFile(text: string, path?: string): Promise<string | null> {
    const name = path ?? "cizim.sugar";
    download(new Blob([text], { type: "application/json" }), name);
    return name;
  }

  async saveBinaryFile(data: Uint8Array, defaultName: string): Promise<string | null> {
    download(new Blob([data as BlobPart], { type: "application/octet-stream" }), defaultName);
    return defaultName;
  }

  async listUserPlugins(): Promise<PluginSource[]> {
    return [];
  }

  async userPluginsDir(): Promise<string | null> {
    return null;
  }

  setTitle(title: string): void {
    document.title = title;
  }

  async appVersion(): Promise<string> {
    return __APP_VERSION__;
  }

  /** Tarayıcıda sayfayı yenilemek yeterli; güncelleme denetimi yok. */
  async checkForUpdate(): Promise<AvailableUpdate | null> {
    return null;
  }
}
