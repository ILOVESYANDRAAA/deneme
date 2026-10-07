import type { ManifoldToplevel } from "manifold-3d";
import { solidKey } from "../core/solid";
import { SolidEvaluator, type MeshData } from "./evaluate";
import type { EvaluateRequest, EvaluateResponse } from "./protocol";

/**
 * İşçinin durumlu çekirdeği (işçiden bağımsız test edilebilsin diye ayrı).
 * Her özelliğin son tarif anahtarını hatırlar ve sadece değişenleri hesaplar.
 */
export class GeometrySession {
  private evaluator: SolidEvaluator;
  private lastKeys = new Map<string, string>();

  constructor(wasm: ManifoldToplevel) {
    this.evaluator = new SolidEvaluator(wasm);
  }

  handle(req: EvaluateRequest): { response: EvaluateResponse; transfer: ArrayBuffer[] } {
    const start = performance.now();
    const changed: EvaluateResponse["changed"] = [];
    const transfer: ArrayBuffer[] = [];
    const seen = new Set<string>();

    this.evaluator.beginPass();
    for (const { id, solid } of req.items) {
      seen.add(id);
      const key = solidKey(solid);
      const unchanged = this.lastKeys.get(id) === key;
      try {
        // Değişmeyenler de değerlendirilir ki önbellekte "kullanıldı" sayılsınlar (önbellekten anında döner).
        const manifold = this.evaluator.evaluate(solid);
        if (unchanged) continue;
        const mesh: MeshData = this.evaluator.toMesh(manifold);
        changed.push({ id, mesh });
        transfer.push(mesh.positions.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer);
      } catch (e) {
        if (unchanged) continue;
        changed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
      this.lastKeys.set(id, key);
    }
    this.evaluator.endPass();

    const removed = [...this.lastKeys.keys()].filter((id) => !seen.has(id));
    removed.forEach((id) => this.lastKeys.delete(id));

    return {
      response: { type: "result", seq: req.seq, changed, removed, ms: performance.now() - start },
      transfer,
    };
  }
}
