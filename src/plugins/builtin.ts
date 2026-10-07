import type { PluginManifest, PluginSource } from "./manifest";

// Uygulamayla birlikte gelen eklentiler derleme sırasında pakete gömülür.
const manifests = import.meta.glob<PluginManifest>("../../plugins/*/sugarcad.json", {
  eager: true,
  import: "default",
});
const sources = import.meta.glob<string>("../../plugins/*/*.js", { eager: true, query: "?raw", import: "default" });

export function builtinPlugins(): PluginSource[] {
  return Object.entries(manifests).map(([manifestPath, manifest]) => {
    const dir = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
    const code = sources[`${dir}/${manifest.main}`];
    if (code === undefined) throw new Error(`${dir}: "${manifest.main}" bulunamadı`);
    return { manifest, code, location: "builtin" as const };
  });
}
