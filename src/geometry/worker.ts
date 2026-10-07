/// <reference lib="webworker" />
import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import type { EvaluateRequest, WorkerMessage } from "./protocol";
import { GeometrySession } from "./session";

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

const ready = Module({ locateFile: () => wasmUrl }).then((wasm) => {
  wasm.setup();
  return new GeometrySession(wasm);
});

ready.then(
  () => post({ type: "ready" }),
  (e) => post({ type: "fatal", error: String(e) }),
);

self.onmessage = async (event: MessageEvent<EvaluateRequest>) => {
  const session = await ready;
  const { response, transfer } = session.handle(event.data);
  post(response, transfer);
};
