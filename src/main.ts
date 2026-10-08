import { SugarApp } from "./app/controller";
import * as sketchModel from "./core/sketchmodel";
import { webSolver } from "./core/solver-web";
import { GeometryClient } from "./geometry/client";
import { detectPlatform } from "./platform/adapter";
import { builtinPlugins } from "./plugins/builtin";
import type { PluginWorker } from "./plugins/host";
import { Workbench, WorkbenchUi } from "./ui/workbench";
import "./ui/styles.css";

async function start(): Promise<void> {
  const ui = new WorkbenchUi();
  const platform = await detectPlatform();
  const geometry = new GeometryClient();
  const createPluginWorker = () =>
    new Worker(new URL("./plugins/worker.ts", import.meta.url), { type: "module", name: "sugarcad-plugin" }) as unknown as PluginWorker;

  const app = new SugarApp(platform, ui, geometry, createPluginWorker);
  const workbench = new Workbench(document.getElementById("app")!, app, ui);

  // Kısıt çözücü (WASM) arka planda yüklenir; yüklenene kadar çizim yine çalışır, kısıtlar sonra çözülür.
  webSolver().then(
    (s) => {
      app.solver = s;
      document.body.dataset.solver = "true";
    },
    (e) => ui.showMessage(`Kısıt çözücü başlatılamadı: ${e}`, "error"),
  );
  geometry.whenReady().catch((e) => ui.showMessage(`Geometri motoru başlatılamadı: ${e}`, "error"));
  await app.loadPlugins(builtinPlugins());
  // Masaüstünde açılıştan biraz sonra sessizce yeni sürüm denetlenir.
  if (platform.name === "tauri") setTimeout(() => void workbench.updates.check(false), 3000);

  if (import.meta.env.DEV) {
    // Geliştirme ve uçtan uca testler için.
    Object.assign(window, { sugarcad: app, sugarcadUi: workbench, sugarcadModel: sketchModel });
  }
  document.body.dataset.ready = "true";
}

start().catch((e) => {
  console.error(e);
  document.body.textContent = `sugarCAD başlatılamadı: ${e instanceof Error ? e.message : e}`;
});
