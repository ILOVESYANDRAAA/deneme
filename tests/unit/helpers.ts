import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Module from "manifold-3d";
import { SugarApp, type GeometryEngine, type UiBridge } from "../../src/app/controller";
import type { Solid } from "../../src/core/solid";
import type { MeshData } from "../../src/geometry/evaluate";
import { GeometrySession } from "../../src/geometry/session";
import type { PluginWorker } from "../../src/plugins/host";
import type { PluginManifest, PluginSource } from "../../src/plugins/manifest";
import { startPluginRuntime } from "../../src/plugins/runtime";
import { BrowserPlatform } from "../../src/platform/browser";

let wasm: Awaited<ReturnType<typeof Module>> | undefined;

export async function manifold() {
  if (!wasm) {
    wasm = await Module();
    wasm.setup();
  }
  return wasm;
}

/** İşçi yerine aynı iş parçacığında çalışan geometri motoru. */
export class SyncGeometry implements GeometryEngine {
  private listeners: Parameters<GeometryEngine["onUpdate"]>[0][] = [];
  constructor(private session: GeometrySession) {}
  submit(items: { id: string; solid: Solid }[]): void {
    const { response } = this.session.handle({ type: "evaluate", seq: 0, items });
    const changed = new Map<string, { mesh?: MeshData; error?: string }>(
      response.changed.map((c) => [c.id, { mesh: c.mesh, error: c.error }]),
    );
    this.listeners.forEach((l) => l({ changed, removed: response.removed, ms: response.ms }));
  }
  onUpdate(listener: Parameters<GeometryEngine["onUpdate"]>[0]): void {
    this.listeners.push(listener);
  }
}

/** Eklenti işçisi yerine MessageChannel'ın öbür ucunda çalışan çalışma ortamı. */
export function inMemoryWorker(): PluginWorker {
  const { port1, port2 } = new MessageChannel();
  startPluginRuntime(port2 as unknown as PluginWorker);
  return Object.assign(port1 as unknown as PluginWorker, {
    terminate: () => {
      port1.close();
      port2.close();
    },
    onerror: null,
  });
}

export class FakeUi implements UiBridge {
  messages: { text: string; kind: string }[] = [];
  inputs: Record<string, number | string>[] = [];
  showMessage(text: string, kind: string): void {
    this.messages.push({ text, kind });
  }
  async showInput() {
    return this.inputs.shift() ?? null;
  }
}

export async function createApp(options?: { activateTimeoutMs?: number; buildTimeoutMs?: number }) {
  const ui = new FakeUi();
  const geometry = new SyncGeometry(new GeometrySession(await manifold()));
  const app = new SugarApp(new BrowserPlatform(), ui, geometry, inMemoryWorker, options);
  return { app, ui };
}

export function pluginFromDisk(dir: string): PluginSource {
  const base = resolve(__dirname, "../../plugins", dir);
  const manifest = JSON.parse(readFileSync(resolve(base, "sugarcad.json"), "utf8")) as PluginManifest;
  return { manifest, code: readFileSync(resolve(base, manifest.main), "utf8"), location: "builtin" };
}

export function inlinePlugin(manifest: Partial<PluginManifest> & { name: string }, code: string): PluginSource {
  return { manifest: { version: "1.0.0", main: "index.js", ...manifest }, code, location: "user" };
}
