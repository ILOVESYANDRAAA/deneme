import type { Solid } from "../core/solid";
import type { MeshData } from "./evaluate";

export interface EvaluateRequest {
  type: "evaluate";
  seq: number;
  items: { id: string; solid: Solid }[];
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

export interface ReadyMessage {
  type: "ready";
}

export interface FatalMessage {
  type: "fatal";
  error: string;
}

export type WorkerMessage = EvaluateResponse | ReadyMessage | FatalMessage;
