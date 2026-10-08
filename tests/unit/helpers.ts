import { init_planegcs_module } from "@salusoft89/planegcs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Module from "manifold-3d";
import { SketchSolver } from "../../src/core/solver";
import { SugarApp, type GeometryEngine, type UiBridge } from "../../src/app/controller";
import type { Solid } from "../../src/core/solid";
import type { MeshData } from "../../src/geometry/evaluate";
import opencascade from "replicad-opencascadejs";
import type { BrepInfo } from "../../src/geometry/brep";
import { installKernel } from "../../src/geometry/occ/build";
import { OccSession } from "../../src/geometry/occ/session";
import { splitItems } from "../../src/geometry/route";
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

let kernelReady = false;

/** OpenCascade çekirdeğini bir kez kurar; her çağrıda yeni (bağımsız) bir oturum döner. */
export async function occ(): Promise<OccSession> {
  if (!kernelReady) {
    installKernel(await opencascade({}));
    kernelReady = true;
  }
  return new OccSession();
}

/** İşçi yerine aynı iş parçacığında çalışan geometri motoru (B-rep için `withOcc` ile OpenCascade da). */
export class SyncGeometry implements GeometryEngine {
  private listeners: Parameters<GeometryEngine["onUpdate"]>[0][] = [];
  constructor(
    private session: GeometrySession,
    private brep?: OccSession,
  ) {}
  async exportStep(items: { id: string; name: string; solid: Solid }[], assets?: Record<string, string>): Promise<Uint8Array> {
    if (!this.brep) throw new Error("OpenCascade yok");
    return this.brep.exportStep(items, assets);
  }
  submit(items: { id: string; solid: Solid }[], assets?: Record<string, string>): void {
    const parts = splitItems(items);
    const responses = [this.session.handle({ type: "evaluate", seq: 0, items: parts.manifold }).response];
    if (this.brep) responses.push(this.brep.handle({ type: "evaluate", seq: 0, items: parts.brep, assets }).response);
    else if (parts.brep.length) throw new Error("Bu test OpenCascade gerektiriyor: SyncGeometry'ye OccSession verin");
    const live = new Set(items.map((i) => i.id));
    for (const response of responses) {
      const changed = new Map<string, { mesh?: MeshData; error?: string }>(
        response.changed.map((c) => [c.id, { mesh: c.mesh, error: c.error }]),
      );
      const removed = response.removed.filter((id) => !live.has(id));
      this.listeners.forEach((l) => l({ changed, removed, ms: response.ms }));
    }
  }
  async describe(solid: Solid): Promise<BrepInfo> {
    if (!this.brep) throw new Error("OpenCascade yok");
    return this.brep.describe(solid).info;
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

export async function createApp(options?: { activateTimeoutMs?: number; buildTimeoutMs?: number; brep?: boolean }) {
  const ui = new FakeUi();
  const geometry = new SyncGeometry(new GeometrySession(await manifold()), options?.brep ? await occ() : undefined);
  const app = new SugarApp(new BrowserPlatform(), ui, geometry, inMemoryWorker, options);
  return { app, ui };
}

export function pluginFromDisk(dir: string): PluginSource {
  const base = resolve(__dirname, "../../examples/plugins", dir);
  const manifest = JSON.parse(readFileSync(resolve(base, "sugarcad.json"), "utf8")) as PluginManifest;
  return { manifest, code: readFileSync(resolve(base, manifest.main), "utf8"), location: "builtin" };
}

export function inlinePlugin(manifest: Partial<PluginManifest> & { name: string }, code: string): PluginSource {
  return { manifest: { version: "1.0.0", main: "index.js", ...manifest }, code, location: "user" };
}

/** Testlerde eskiz kısıt çözücüsü. */
export function webSolverForTests(): Promise<SketchSolver> {
  return SketchSolver.create(() => init_planegcs_module({ print: () => {}, printErr: () => {} } as never));
}
