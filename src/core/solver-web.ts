import { init_planegcs_module } from "@salusoft89/planegcs";
import wasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { SketchSolver } from "./solver";

let solver: Promise<SketchSolver> | null = null;

/** Tarayıcıda / Tauri'de çözücüyü bir kez başlatır (wasm dosyası paketle birlikte gelir). */
export function webSolver(): Promise<SketchSolver> {
  solver ??= SketchSolver.create(() =>
    // C++ çözücünün konsol çıktısı (her çözümde "Sketcher::..." satırları) susturulur.
    init_planegcs_module({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} } as never),
  );
  return solver;
}
