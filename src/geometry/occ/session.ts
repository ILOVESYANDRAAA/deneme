import { solidKey } from "../../core/solid";
import type { BrepInfo } from "../brep";
import type { MeshData } from "../evaluate";
import type { EvaluateRequest, EvaluateResponse } from "../protocol";
import { OccEvaluator, describeShape, writeStep } from "./build";

/**
 * OpenCascade işçisinin durumlu çekirdeği (`GeometrySession`'ın B-rep karşılığı): sadece değişen
 * tarifleri yeniden hesaplar. Çekirdek (`installKernel`) önceden kurulmuş olmalı.
 */
export class OccSession {
  private evaluator = new OccEvaluator();
  private lastKeys = new Map<string, string>();

  private registerAssets(assets?: Record<string, string>): void {
    for (const [hash, text] of Object.entries(assets ?? {})) {
      if (!this.evaluator.hasAsset(hash)) this.evaluator.setAsset(hash, text);
    }
  }

  /** Gövdeleri tek STEP dosyasına yazar. Bir gövde kurulamazsa hata fırlatır. */
  async exportStep(items: { id: string; name: string; solid: Parameters<OccEvaluator["evaluate"]>[0] }[], assets?: Record<string, string>): Promise<Uint8Array> {
    this.registerAssets(assets);
    this.evaluator.beginPass();
    try {
      const shapes = items.map((i) => ({ name: i.name, shape: this.evaluator.evaluate(i.solid) }));
      return await writeStep(shapes);
    } finally {
      this.evaluator.keepAll();
    }
  }

  handle(req: EvaluateRequest): { response: EvaluateResponse; transfer: ArrayBuffer[] } {
    this.registerAssets(req.assets);
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
        const shape = this.evaluator.evaluate(solid);
        if (unchanged) continue;
        const mesh: MeshData = this.evaluator.toMesh(shape);
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

  /** Bir tarifin kenar / yüz betimi (seçim arayüzü için). */
  describe(solid: Parameters<OccEvaluator["evaluate"]>[0]): { info: BrepInfo; transfer: ArrayBuffer[] } {
    this.evaluator.beginPass();
    try {
      const info = describeShape(this.evaluator.evaluate(solid));
      return {
        info,
        transfer: [
          info.pick.positions.buffer as ArrayBuffer,
          info.pick.indices.buffer as ArrayBuffer,
          info.pick.triFace.buffer as ArrayBuffer,
          ...info.edges.map((e) => e.points.buffer as ArrayBuffer),
        ],
      };
    } finally {
      // Betim, değerlendirme ön belleğini bozmasın: son turda kullanılanlar korunur.
      this.evaluator.keepAll();
    }
  }
}
