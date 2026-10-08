import type { Solid } from "../core/solid";
import type { BrepInfo } from "./brep";
import type { MeshData } from "./evaluate";
import type { DescribeResponse, EvaluateResponse, ExportResponse, WorkerMessage } from "./protocol";
import { splitItems, type Item } from "./route";

export interface GeometryUpdate {
  changed: Map<string, { mesh?: MeshData; error?: string }>;
  removed: string[];
  ms: number;
}

/**
 * Tek bir geometri işçisinin ana iş parçacığındaki ucu. Arka arkaya gelen istekleri birleştirir:
 * işçi meşgulken gelen ara istekler atlanır, sadece en sonuncusu gönderilir.
 */
class Channel {
  private worker: Worker;
  private seq = 0;
  private busy = false;
  private pending: { items: Item[]; assets?: Record<string, string> } | null = null;
  /** İşçiye daha önce gönderilen STEP verilerinin karmaları (tekrar gönderilmez). */
  private sentAssets = new Set<string>();
  private exports = new Map<number, { resolve: (d: Uint8Array) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<void>;
  private describes = new Map<number, { resolve: (i: BrepInfo) => void; reject: (e: Error) => void }>();

  constructor(
    create: () => Worker,
    private readonly onResult: (res: EvaluateResponse) => void,
  ) {
    this.worker = create();
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener("message", (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === "ready") resolve();
        if (e.data.type === "fatal") reject(new Error(e.data.error));
      });
    });
    this.ready.catch(() => undefined);
    this.worker.addEventListener("message", (e: MessageEvent<WorkerMessage>) => {
      if (e.data.type === "result") {
        this.busy = false;
        this.onResult(e.data);
        void this.flush();
      } else if (e.data.type === "described") {
        this.onDescribed(e.data);
      } else if (e.data.type === "exported") {
        this.onExported(e.data);
      }
    });
  }

  submit(items: Item[], assets?: Record<string, string>): void {
    this.pending = { items, assets };
    void this.flush();
  }

  /** Henüz gönderilmemiş verileri seçer ve gönderilmiş say. */
  private freshAssets(assets?: Record<string, string>): Record<string, string> | undefined {
    const fresh = Object.entries(assets ?? {}).filter(([hash]) => !this.sentAssets.has(hash));
    fresh.forEach(([hash]) => this.sentAssets.add(hash));
    return fresh.length ? Object.fromEntries(fresh) : undefined;
  }

  async exportStep(items: { id: string; name: string; solid: Solid }[], assets?: Record<string, string>): Promise<Uint8Array> {
    await this.ready;
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.exports.set(seq, { resolve, reject });
      // Dışa aktarma kendi başına çalışır: gereken verilerin hepsi (daha önce gönderilmiş olsa bile) eklenir.
      this.worker.postMessage({ type: "export", seq, items, assets });
    });
  }

  private onExported(res: ExportResponse): void {
    const waiter = this.exports.get(res.seq);
    if (!waiter) return;
    this.exports.delete(res.seq);
    if (res.data) waiter.resolve(res.data);
    else waiter.reject(new Error(res.error ?? "STEP dosyası yazılamadı"));
  }

  private async flush(): Promise<void> {
    if (this.busy || !this.pending) return;
    await this.ready;
    if (this.busy || !this.pending) return;
    const { items, assets } = this.pending;
    this.pending = null;
    this.busy = true;
    this.worker.postMessage({ type: "evaluate", seq: ++this.seq, items, assets: this.freshAssets(assets) });
  }

  async describe(solid: Solid): Promise<BrepInfo> {
    await this.ready;
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.describes.set(seq, { resolve, reject });
      this.worker.postMessage({ type: "describe", seq, solid });
    });
  }

  private onDescribed(res: DescribeResponse): void {
    const waiter = this.describes.get(res.seq);
    if (!waiter) return;
    this.describes.delete(res.seq);
    if (res.info) waiter.resolve(res.info);
    else waiter.reject(new Error(res.error ?? "Gövde betimlenemedi"));
  }
}

/**
 * Geometri çekirdeklerinin ana iş parçacığındaki ucu: manifold işçisi (hızlı, her zaman açık) ve
 * OpenCascade işçisi (yuvarlatma / pah / kabuk için; ~23 MB wasm, ilk gerektiğinde yüklenir).
 */
export class GeometryClient {
  private manifold: Channel;
  private occ: Channel | null = null;
  private listeners = new Set<(u: GeometryUpdate) => void>();
  /** Son gönderimdeki tüm kimlikler: bir çekirdeğin "silindi" dediği ama öbürüne geçmiş öğeler korunur. */
  private live = new Set<string>();

  constructor() {
    this.manifold = new Channel(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), (r) => this.emit(r));
  }

  whenReady(): Promise<void> {
    return this.manifold.ready;
  }

  onUpdate(listener: (u: GeometryUpdate) => void): void {
    this.listeners.add(listener);
  }

  private occChannel(): Channel {
    this.occ ??= new Channel(
      () => new Worker(new URL("./occ/worker.ts", import.meta.url), { type: "module", name: "sugarcad-occ" }),
      (r) => this.emit(r),
    );
    return this.occ;
  }

  /** Sahnedeki tüm kök özelliklerin güncel tarifini gönderir. */
  submit(items: Item[], assets?: Record<string, string>): void {
    this.live = new Set(items.map((i) => i.id));
    const { manifold, brep } = splitItems(items);
    this.manifold.submit(manifold);
    // OpenCascade yalnızca gerektiğinde (ya da zaten açıksa, eski öğelerini temizlemek için) kullanılır.
    if (brep.length || this.occ) this.occChannel().submit(brep, assets);
  }

  /** Gövdeleri STEP dosyası olarak yazar (OpenCascade işçisini gerekirse başlatır). */
  exportStep(items: { id: string; name: string; solid: Solid }[], assets?: Record<string, string>): Promise<Uint8Array> {
    return this.occChannel().exportStep(items, assets);
  }

  /** Bir gövdenin kenar / yüz betimi (seçim için). OpenCascade işçisini gerekirse başlatır. */
  describe(solid: Solid): Promise<BrepInfo> {
    return this.occChannel().describe(solid);
  }

  private emit(res: EvaluateResponse): void {
    const changed = new Map(res.changed.map((c) => [c.id, { mesh: c.mesh, error: c.error }]));
    const update: GeometryUpdate = { changed, removed: res.removed.filter((id) => !this.live.has(id)), ms: res.ms };
    this.listeners.forEach((l) => l(update));
  }
}
