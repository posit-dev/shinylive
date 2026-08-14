// Observable store for Wasm engine (Pyodide / webR) load progress.
//
// Module-level rather than React state because engine initialization starts
// before any component mounts, so no prop or context can carry the early stages.
//
// One store per engine rather than one global store, because a page can mix
// Python and R blocks and run both engines at once.

// Declared here rather than imported from ./Components/App, to avoid a circular
// import.
export type EngineName = "python" | "r";

export type LoadStage =
  | "idle"
  | "engine-download" // fetching and compiling the wasm runtime
  | "engine-start" // interpreter boot and base packages
  | "ready"
  | "failed";

export type LoadStatus = {
  stage: LoadStage;
  error: string | null;
};

export type LoadStatusStore = {
  get: () => LoadStatus;
  set: (stage: LoadStage, error?: string) => void;
  subscribe: (onChange: () => void) => () => void;
};

// Shared so LoadingStatus and Viewer cannot drift apart.
export const ENGINE_LABEL: Record<EngineName, string> = {
  python: "Python",
  r: "R",
};

const IDLE: LoadStatus = { stage: "idle", error: null };

function createLoadStatusStore(): LoadStatusStore {
  let status: LoadStatus = IDLE;
  const listeners = new Set<() => void>();

  return {
    // Stable reference: useSyncExternalStore loops forever if this returns a
    // fresh object on every call.
    get: () => status,

    set: (stage: LoadStage, error?: string) => {
      // Terminal, so a later failure cannot overwrite the original cause.
      if (status.stage === "failed") return;
      const nextError = error ?? null;
      if (status.stage === stage && status.error === nextError) return;
      status = { stage, error: nextError };
      listeners.forEach((listener) => listener());
    },

    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

const stores = new Map<EngineName, LoadStatusStore>();

export function loadStatusStore(engine: EngineName): LoadStatusStore {
  let store = stores.get(engine);
  if (!store) {
    store = createLoadStatusStore();
    stores.set(engine, store);
  }
  return store;
}

// Test seam; nothing in the app calls this.
export function resetLoadStatusStores(): void {
  stores.clear();
}
