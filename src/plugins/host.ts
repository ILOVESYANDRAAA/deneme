import type { FeatureInfo, InputField } from "../../packages/api/sugarcad";
import type { CommandRegistry } from "../core/commands";
import type { FeaturePatch, SugarDocument } from "../core/document";
import { Emitter, type Disposable } from "../core/events";
import type { Feature, ParamValues, PrimitiveRegistry } from "../core/features";
import { validateSolid, type BooleanOp, type Solid, type Vec3 } from "../core/solid";
import { validateManifest, type PluginManifest, type PluginSource } from "./manifest";
import { RpcChannel, type Endpoint } from "./rpc";

/** Eklenti sunucusunun uygulamadan beklediği işlemler. */
export interface HostServices {
  commands: CommandRegistry;
  primitives: PrimitiveRegistry;
  document: SugarDocument;
  addPrimitive(type: string, params?: ParamValues, options?: { name?: string; position?: Vec3; rotation?: Vec3 }): Promise<Feature>;
  addBoolean(op: BooleanOp, a: string, b: string): Feature;
  updateFeature(id: string, patch: FeaturePatch): Promise<void>;
  showMessage(text: string, kind: "info" | "warning" | "error"): void;
  showInput(options: { title: string; fields: InputField[] }): Promise<Record<string, number | string> | null>;
}

export interface PluginWorker extends Endpoint {
  terminate(): void;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type PluginState = "inactive" | "activating" | "active" | "failed" | "stopped";

export interface PluginInfo {
  manifest: PluginManifest;
  location: PluginSource["location"];
  path?: string;
  state: PluginState;
  error?: string;
}

interface Loaded extends PluginInfo {
  code: string;
  worker?: PluginWorker;
  rpc?: RpcChannel;
  activation?: Promise<RpcChannel>;
  disposables: Disposable[];
}

export interface HostOptions {
  /** Eklentinin activate() süresi sınırı. */
  activateTimeoutMs?: number;
  /** Bir şekil tarifinin üretilme süresi sınırı. */
  buildTimeoutMs?: number;
}

function toInfo(f: Feature): FeatureInfo {
  const { solid: _solid, ...rest } = f;
  return structuredClone(rest);
}

function cloneable(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

/**
 * Eklentileri yükler, manifestteki katkıları (komutlar, şekiller) kaydeder
 * ve eklentiyi ancak ilk ihtiyaç duyulduğunda kendi işçisinde başlatır (tembel etkinleşme).
 */
export class PluginHost {
  private plugins = new Map<string, Loaded>();
  /** Şekil türü → eklenti adı */
  private primitiveOwners = new Map<string, string>();
  readonly onDidChange = new Emitter<void>();

  private readonly activateTimeoutMs: number;
  private readonly buildTimeoutMs: number;

  constructor(
    private readonly services: HostServices,
    private readonly createWorker: () => PluginWorker,
    options: HostOptions = {},
  ) {
    this.activateTimeoutMs = options.activateTimeoutMs ?? 10_000;
    this.buildTimeoutMs = options.buildTimeoutMs ?? 10_000;
  }

  /** Eklentileri kaydeder; hatalı olanlar atlanır ve hata mesajları döndürülür. */
  load(sources: PluginSource[]): string[] {
    const errors: string[] = [];
    for (const source of sources) {
      try {
        this.loadOne(source);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    this.onDidChange.fire();
    return errors;
  }

  private loadOne(source: PluginSource): void {
    const manifest = validateManifest(source.manifest);
    if (this.plugins.has(manifest.name)) throw new Error(`Eklenti "${manifest.name}" zaten yüklü`);
    const plugin: Loaded = {
      manifest,
      location: source.location,
      path: source.path,
      code: source.code,
      state: "inactive",
      disposables: [],
    };
    const { commands, primitives } = this.services;
    const category = manifest.displayName ?? manifest.name;
    try {
      for (const c of manifest.contributes?.commands ?? []) {
        plugin.disposables.push(
          commands.register({ ...c, category: c.category ?? category, pluginId: manifest.name }, (...args) =>
            this.executeCommand(manifest.name, c.id, args),
          ),
        );
      }
      for (const p of manifest.contributes?.primitives ?? []) {
        primitives.register({ type: p.type, label: p.label, params: p.params, pluginId: manifest.name });
        this.primitiveOwners.set(p.type, manifest.name);
      }
    } catch (e) {
      plugin.disposables.forEach((d) => d.dispose());
      primitives.unregisterPlugin(manifest.name);
      throw e;
    }
    this.plugins.set(manifest.name, plugin);
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()].map(({ manifest, location, path, state, error }) => ({
      manifest,
      location,
      path,
      state,
      error,
    }));
  }

  /** "onStartup" olayı olan eklentileri başlatır. */
  async activateStartup(): Promise<void> {
    const startup = [...this.plugins.values()].filter((p) => p.manifest.activationEvents?.includes("onStartup"));
    await Promise.allSettled(startup.map((p) => this.ensureActive(p.manifest.name)));
  }

  ensureActive(name: string): Promise<RpcChannel> {
    const plugin = this.plugins.get(name);
    if (!plugin) return Promise.reject(new Error(`Eklenti bulunamadı: ${name}`));
    if (!plugin.activation) {
      plugin.activation = this.activate(plugin);
      plugin.activation.catch(() => {
        // Bir sonraki denemede yeniden başlatılabilsin.
        plugin.activation = undefined;
      });
    }
    return plugin.activation;
  }

  private async activate(plugin: Loaded): Promise<RpcChannel> {
    const name = plugin.manifest.name;
    this.setState(plugin, "activating");
    const worker = this.createWorker();
    const rpc = new RpcChannel(worker);
    plugin.worker = worker;
    plugin.rpc = rpc;
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.fail(plugin, event.message || "Eklenti işçisi çöktü");
    };
    this.bindHandlers(plugin, rpc);
    try {
      await rpc.call("activate", [plugin.code, plugin.manifest], this.activateTimeoutMs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.fail(plugin, message);
      throw new Error(`Eklenti "${name}" başlatılamadı: ${message}`);
    }
    this.setState(plugin, "active");
    return rpc;
  }

  private bindHandlers(plugin: Loaded, rpc: RpcChannel): void {
    const s = this.services;
    const name = plugin.manifest.name;
    const prefix = `${name}.`;

    rpc.handle("commands.bind", (id) => {
      const cmd = id as string;
      if (!cmd.startsWith(prefix)) throw new Error(`Komut kimliği "${prefix}" ile başlamalı: ${cmd}`);
      if (!s.commands.has(cmd)) {
        plugin.disposables.push(
          s.commands.register({ id: cmd, title: cmd, category: plugin.manifest.displayName ?? name, pluginId: name }, (...args) =>
            this.executeCommand(name, cmd, args),
          ),
        );
      }
    });
    rpc.handle("primitives.bind", (type) => {
      if (this.primitiveOwners.get(type as string) !== name) {
        throw new Error(`"${type as string}" şekli manifestte contributes.primitives altında tanımlanmalı`);
      }
    });
    rpc.handle("commands.execute", async (id, args) =>
      cloneable(await s.commands.execute(id as string, ...((args as unknown[]) ?? []))),
    );
    rpc.handle("document.getFeatures", () => s.document.all().map(toInfo));
    rpc.handle("document.getSelection", () => [...s.document.getSelection()]);
    rpc.handle("document.addPrimitive", async (type, params, options) =>
      toInfo(await s.addPrimitive(type as string, params as ParamValues | undefined, options as never)),
    );
    rpc.handle("document.boolean", (op, a, b) => toInfo(s.addBoolean(op as BooleanOp, a as string, b as string)));
    rpc.handle("document.updateFeature", (id, patch) => s.updateFeature(id as string, patch as FeaturePatch));
    rpc.handle("document.removeFeature", (id) => s.document.remove(id as string));
    rpc.handle("ui.showMessage", (text, kind) => {
      s.showMessage(`${plugin.manifest.displayName ?? name}: ${text as string}`, kind as "info");
    });
    rpc.handle("ui.showInput", (options) => s.showInput(options as never));
  }

  private async executeCommand(name: string, id: string, args: unknown[]): Promise<unknown> {
    const rpc = await this.ensureActive(name);
    return rpc.call("executeCommand", [id, args.map(cloneable)]);
  }

  /** Eklenti şeklinin tarifini üretir ve doğrular. */
  async buildPrimitive(type: string, params: ParamValues): Promise<Solid> {
    const owner = this.primitiveOwners.get(type);
    if (!owner) throw new Error(`Şekil türünü sağlayan eklenti yok: ${type}`);
    const rpc = await this.ensureActive(owner);
    const solid = await rpc.call("buildPrimitive", [type, params], this.buildTimeoutMs);
    return validateSolid(solid, type);
  }

  /** Eklentiyi durdurur; komutları kayıtlı kalır, tekrar kullanılınca yeniden başlar. */
  stop(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    this.teardown(plugin);
    plugin.error = undefined;
    this.setState(plugin, "stopped");
  }

  dispose(): void {
    for (const plugin of this.plugins.values()) {
      this.teardown(plugin);
      plugin.disposables.forEach((d) => d.dispose());
      this.services.primitives.unregisterPlugin(plugin.manifest.name);
    }
    this.plugins.clear();
    this.primitiveOwners.clear();
  }

  private teardown(plugin: Loaded): void {
    plugin.rpc?.close("Eklenti durduruldu");
    plugin.worker?.terminate();
    plugin.rpc = undefined;
    plugin.worker = undefined;
    plugin.activation = undefined;
  }

  private fail(plugin: Loaded, message: string): void {
    this.teardown(plugin);
    plugin.error = message;
    this.setState(plugin, "failed");
  }

  private setState(plugin: Loaded, state: PluginState): void {
    plugin.state = state;
    if (state !== "failed") plugin.error = undefined;
    this.onDidChange.fire();
  }
}
