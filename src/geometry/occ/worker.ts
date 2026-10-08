/// <reference lib="webworker" />
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import type { DescribeRequest, EvaluateRequest, WorkerMessage } from "../protocol";
import { installKernel } from "./build";
import { OccSession } from "./session";

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

// OpenCascade (~23 MB wasm) sadece bu işçi başlatılınca, yani ilk B-rep işleminde yüklenir.
const ready = opencascade({ locateFile: () => wasmUrl }).then((oc) => {
  installKernel(oc);
  return new OccSession();
});

ready.then(
  () => post({ type: "ready" }),
  (e) => post({ type: "fatal", error: String(e) }),
);

self.onmessage = async (event: MessageEvent<EvaluateRequest | DescribeRequest>) => {
  const session = await ready;
  const msg = event.data;
  if (msg.type === "describe") {
    try {
      const { info, transfer } = session.describe(msg.solid);
      post({ type: "described", seq: msg.seq, info }, transfer);
    } catch (e) {
      post({ type: "described", seq: msg.seq, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  const { response, transfer } = session.handle(msg);
  post(response, transfer);
};
