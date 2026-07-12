/// <reference lib="webworker" />

import { runSimulation } from "./lib/simulator";
import type { SimulationConfig } from "./lib/types";

self.onmessage = (event: MessageEvent<SimulationConfig>) => {
  try {
    self.postMessage({ ok: true, result: runSimulation(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "计算失败，请检查输入。",
    });
  }
};

export {};
