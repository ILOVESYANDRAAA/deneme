import type { Solid } from "../core/solid";
import type { BrepInfo } from "./brep";
import type { MeshData } from "./evaluate";

export interface EvaluateRequest {
  type: "evaluate";
  seq: number;
  items: { id: string; solid: Solid }[];
  /** Tariflerde karmayla anılan büyük veriler (karma → STEP metni); işçi daha önce almadıklarını kaydeder. */
  assets?: Record<string, string>;
}

/** Gövdeleri STEP dosyasına yazdırır (yalnızca OpenCascade işçisi). */
export interface ExportRequest {
  type: "export";
  seq: number;
  items: { id: string; name: string; solid: Solid }[];
  assets?: Record<string, string>;
}

export interface ExportResponse {
  type: "exported";
  seq: number;
  data?: Uint8Array;
  error?: string;
}

export interface EvaluateResult {
  id: string;
  mesh?: MeshData;
  error?: string;
}

export interface EvaluateResponse {
  type: "result";
  seq: number;
  /** Sadece önceki sonuca göre değişen özellikler gelir. */
  changed: EvaluateResult[];
  removed: string[];
  ms: number;
}

/** Seçim arayüzü için bir gövdenin kenar / yüz betimini ister (yalnızca OpenCascade işçisi). */
export interface DescribeRequest {
  type: "describe";
  seq: number;
  solid: Solid;
}

export interface DescribeResponse {
  type: "described";
  seq: number;
  info?: BrepInfo;
  error?: string;
}

export interface ReadyMessage {
  type: "ready";
}

export interface FatalMessage {
  type: "fatal";
  error: string;
}

export type WorkerMessage = EvaluateResponse | DescribeResponse | ExportResponse | ReadyMessage | FatalMessage;
