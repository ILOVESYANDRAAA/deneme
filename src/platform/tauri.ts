import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { PluginManifest, PluginSource } from "../plugins/manifest";
import type { AvailableUpdate, Platform } from "./adapter";

const SUGAR_FILTER = [{ name: "sugarCAD çizimi", extensions: ["sugar"] }];

interface RawPlugin {
  path: string;
  manifest: string;
  code: string;
}

/** Masaüstü (Tauri) platformu: dosya işlemleri Rust tarafındaki komutlarla yapılır. */
export class TauriPlatform implements Platform {
  readonly name = "tauri" as const;

  async openTextFile(): Promise<{ path: string; text: string } | null> {
    const path = await open({ multiple: false, directory: false, filters: SUGAR_FILTER });
    if (typeof path !== "string") return null;
    const text = await invoke<string>("read_text_file", { path });
    return { path, text };
  }

  async saveTextFile(text: string, path?: string): Promise<string | null> {
    const target = path ?? (await save({ filters: SUGAR_FILTER, defaultPath: "cizim.sugar" }));
    if (!target) return null;
    await invoke("write_file", { path: target, contents: Array.from(new TextEncoder().encode(text)) });
    return target;
  }

  async saveBinaryFile(data: Uint8Array, defaultName: string): Promise<string | null> {
    const ext = defaultName.split(".").pop() ?? "";
    const target = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!target) return null;
    await invoke("write_file", { path: target, contents: Array.from(data) });
    return target;
  }

  async listUserPlugins(): Promise<PluginSource[]> {
    const raw = await invoke<RawPlugin[]>("list_plugins");
    const out: PluginSource[] = [];
    for (const p of raw) {
      try {
        out.push({ manifest: JSON.parse(p.manifest) as PluginManifest, code: p.code, location: "user", path: p.path });
      } catch (e) {
        console.error(`Eklenti manifesti okunamadı (${p.path}):`, e);
      }
    }
    return out;
  }

  userPluginsDir(): Promise<string | null> {
    return invoke<string>("plugins_dir");
  }

  setTitle(title: string): void {
    void getCurrentWindow().setTitle(title);
  }

  appVersion(): Promise<string> {
    return getVersion();
  }

  async checkForUpdate(): Promise<AvailableUpdate | null> {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body,
      install: async (progress) => {
        let total = 0;
        let done = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            done += event.data.chunkLength;
            progress?.(total ? done / total : null);
          }
        });
        await relaunch();
      },
    };
  }
}
