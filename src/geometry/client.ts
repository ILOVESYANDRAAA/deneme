import type { Solid } from "../core/solid";
import type { MeshData } from "./evaluate";
import type { EvaluateResponse, WorkerMessage } from "./protocol";

export interface GeometryUpdate {
  changed: Map<string, { mesh?: MeshData; error?: string }>;
  removed: string[];
  ms: number;
}

/**
 * Geometri işçisinin ana iş parçacığındaki ucu. Arka arkaya gelen istekleri
 * birleştirir: işçi meşgulken gelen ara istekler atlanır, sadece en sonuncusu gönderilir.
 */
export class GeometryClient {
  private worker: Worker;
  private seq = 0;
  private busy = false;
  private pending: { id: string; solid: Solid }[] | null = null;
  private ready: Promise<void>;
  private listeners = new Set<(u: GeometryUpdate) => void>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === "ready") resolve();
        if (e.data.type === "fatal") reject(new Error(e.data.error));
      };
      this.worker.addEventListener("message", onMessage);
    });
    this.worker.addEventListener("message", (e: MessageEvent<WorkerMessage>) => {
      if (e.data.type === "result") this.onResult(e.data);
    });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  onUpdate(listener: (u: GeometryUpdate) => void): void {
    this.listeners.add(listener);
  }

  /** Sahnedeki tüm kök özelliklerin güncel tarifini gönderir. */
  submit(items: { id: string; solid: Solid }[]): void {
    this.pending = items;
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.busy || !this.pending) return;
    await this.ready;
    if (this.busy || !this.pending) return;
    const items = this.pending;
    this.pending = null;
    this.busy = true;
    this.worker.postMessage({ type: "evaluate", seq: ++this.seq, items });
  }

  private onResult(res: EvaluateResponse): void {
    this.busy = false;
    const changed = new Map(res.changed.map((c) => [c.id, { mesh: c.mesh, error: c.error }]));
    const update: GeometryUpdate = { changed, removed: res.removed, ms: res.ms };
    this.listeners.forEach((l) => l(update));
    void this.flush();
  }
}
