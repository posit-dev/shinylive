// Subscribes a component to one engine's load status, re-rendering on each stage.
import { useSyncExternalStore } from "react";
import type { EngineName, LoadStatus } from "../load-status";
import { loadStatusStore } from "../load-status";

export function useLoadStatus(engine: EngineName): LoadStatus {
  const store = loadStatusStore(engine);
  // get() doubles as getServerSnapshot; it has no browser-only dependencies.
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
