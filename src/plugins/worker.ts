/// <reference lib="webworker" />
import { startPluginRuntime } from "./runtime";

// Her eklenti kendi işçisinde çalışır: çökerse ya da takılırsa uygulama etkilenmez.
startPluginRuntime(self as unknown as DedicatedWorkerGlobalScope);
