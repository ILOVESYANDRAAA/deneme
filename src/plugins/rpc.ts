/** postMessage konuşabilen her şey: Worker, işçinin `self`'i, MessagePort. */
export interface Endpoint {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

type RpcMessage =
  | { rpc: "call"; id: number; method: string; args: unknown[] }
  | { rpc: "reply"; id: number; ok: true; result: unknown }
  | { rpc: "reply"; id: number; ok: false; error: string };

type Handler = (...args: unknown[]) => unknown;

/** İki yönlü, Promise tabanlı mesajlaşma. Her iki uç da hem çağırabilir hem yanıtlayabilir. */
export class RpcChannel {
  private nextId = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, Handler>();
  private closed = false;

  constructor(private readonly endpoint: Endpoint) {
    endpoint.onmessage = (event) => this.receive(event.data as RpcMessage);
  }

  handle(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  /** `timeoutMs` 0 ise süresiz bekler (ör. kullanıcıdan girdi beklenirken). */
  call<T = unknown>(method: string, args: unknown[] = [], timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Bağlantı kapalı"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.waiting.delete(id);
          reject(new Error(`"${method}" ${timeoutMs} ms içinde yanıt vermedi`));
        }, timeoutMs);
      }
      this.waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.endpoint.postMessage({ rpc: "call", id, method, args } satisfies RpcMessage);
    });
  }

  /** Bekleyen tüm çağrıları hatayla sonlandırır. */
  close(reason = "Bağlantı kapandı"): void {
    this.closed = true;
    this.endpoint.onmessage = null;
    for (const w of this.waiting.values()) w.reject(new Error(reason));
    this.waiting.clear();
  }

  private async receive(msg: RpcMessage): Promise<void> {
    if (!msg || typeof msg !== "object" || !("rpc" in msg)) return;
    if (msg.rpc === "reply") {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.ok) w.resolve(msg.result);
      else w.reject(new Error(msg.error));
      return;
    }
    const handler = this.handlers.get(msg.method);
    let reply: RpcMessage;
    try {
      if (!handler) throw new Error(`Bilinmeyen çağrı: ${msg.method}`);
      const result = await handler(...msg.args);
      reply = { rpc: "reply", id: msg.id, ok: true, result };
    } catch (e) {
      reply = { rpc: "reply", id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!this.closed) this.endpoint.postMessage(reply);
  }
}
