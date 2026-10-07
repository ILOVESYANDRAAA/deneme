import type { PluginModule, SugarCadApi, Vec2 } from "../../packages/api/sugarcad";
import type { Solid } from "../core/solid";
import type { PluginManifest } from "./manifest";
import { RpcChannel, type Endpoint } from "./rpc";

export const API_VERSION = "0.1.0";

/** Tek çokgen verildiyse listeye sarar. */
function polygonList(polygons: Vec2[] | Vec2[][]): Vec2[][] {
  return (typeof polygons[0]?.[0] === "number" ? [polygons] : polygons) as Vec2[][];
}

function solidHelpers(): SugarCadApi["solids"] {
  const bool = (op: "union" | "subtract" | "intersect", children: Solid[]): Solid => ({
    kind: "boolean",
    op,
    children,
  });
  return {
    box: (size) => ({ kind: "box", size }),
    cylinder: (radius, height, segments) => ({ kind: "cylinder", radius, height, segments }),
    sphere: (radius, segments) => ({ kind: "sphere", radius, segments }),
    extrude: (polygons, height) => ({ kind: "extrude", polygons: polygonList(polygons), height }),
    revolve: (polygons, angle = 360) => ({ kind: "revolve", polygons: polygonList(polygons), angle }),
    union: (...s) => bool("union", s),
    subtract: (...s) => bool("subtract", s),
    intersect: (...s) => bool("intersect", s),
    translate: (child, translate) => ({ kind: "transform", translate, child }),
    rotate: (child, rotate) => ({ kind: "transform", rotate, child }),
  };
}

/**
 * Eklenti işçisinin içinde çalışır. Ana uygulamadan eklenti kodunu alır,
 * `activate(sugarcad)` çağırır ve komut/şekil isteklerini eklentiye iletir.
 */
export function startPluginRuntime(endpoint: Endpoint): RpcChannel {
  const rpc = new RpcChannel(endpoint);
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const builders = new Map<string, (params: Record<string, number>) => Solid>();
  let module: Partial<PluginModule> = {};
  const reportBindError = (e: Error) => void rpc.call("ui.showMessage", [e.message, "error"]).catch(() => {});

  rpc.handle("activate", async (code, manifest) => {
    const m = manifest as PluginManifest;
    const api: SugarCadApi = {
      version: API_VERSION,
      pluginId: m.name,
      commands: {
        register(id, handler) {
          if (typeof handler !== "function") throw new Error(`${id}: işleyici bir fonksiyon olmalı`);
          commands.set(id, handler);
          rpc.call("commands.bind", [id]).catch(reportBindError);
        },
        execute: (id, ...args) => rpc.call("commands.execute", [id, args]),
      },
      primitives: {
        register(type, build) {
          if (typeof build !== "function") throw new Error(`${type}: üretici bir fonksiyon olmalı`);
          builders.set(type, build as (p: Record<string, number>) => Solid);
          rpc.call("primitives.bind", [type]).catch(reportBindError);
        },
      },
      document: {
        getFeatures: () => rpc.call("document.getFeatures"),
        getSelection: () => rpc.call("document.getSelection"),
        addPrimitive: (type, params, options) => rpc.call("document.addPrimitive", [type, params, options]),
        boolean: (op, a, b) => rpc.call("document.boolean", [op, a, b]),
        updateFeature: (id, patch) => rpc.call("document.updateFeature", [id, patch]),
        removeFeature: (id) => rpc.call("document.removeFeature", [id]),
      },
      ui: {
        showMessage: (text, kind) => rpc.call("ui.showMessage", [String(text), kind ?? "info"]),
        showInput: (options) => rpc.call("ui.showInput", [options]),
      },
      solids: solidHelpers(),
    };

    // CommonJS biçimi: eklenti `exports.activate = ...` ya da `module.exports = {...}` yazar.
    const mod: { exports: Partial<PluginModule> } = { exports: {} };
    const require = (name: string) => {
      if (name === "sugarcad") return api;
      throw new Error(`"${name}" modülü yüklenemez; eklentiler tek dosya olmalı`);
    };
    const factory = new Function("exports", "module", "require", `${code as string}\n//# sourceURL=${m.name}/${m.main}`);
    factory(mod.exports, mod, require);
    module = mod.exports;
    if (typeof module.activate !== "function") throw new Error("Eklenti bir activate fonksiyonu dışa aktarmalı");
    await module.activate(api);
  });

  rpc.handle("executeCommand", async (id, args) => {
    const handler = commands.get(id as string);
    if (!handler) throw new Error(`Eklenti "${id as string}" komutunu kaydetmedi`);
    return handler(...((args as unknown[]) ?? []));
  });

  rpc.handle("buildPrimitive", async (type, params) => {
    const build = builders.get(type as string);
    if (!build) throw new Error(`Eklenti "${type as string}" şeklini kaydetmedi`);
    return build(params as Record<string, number>);
  });

  rpc.handle("deactivate", async () => {
    await module.deactivate?.();
  });

  return rpc;
}
