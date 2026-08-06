// Reports an engine asset that cannot be downloaded, so the loader can show an
// error instead of spinning.
//
// Neither Pyodide's loadPyodide() nor webR's init() settles when the engine's
// wasm cannot be instantiated — not resolved, not rejected — and neither leaves
// an error the page can catch. Checking the asset ourselves covers the common
// cause, which is that it isn't there. A file that downloads but is unusable
// still spins forever; that gap is left open on purpose.

import type { EngineName } from "./load-status";
import { ENGINE_LABEL } from "./load-status";

// wasm engine files to check
const CORE_WASM: Record<EngineName, string> = {
  python: "pyodide.asm.wasm",
  r: "R.wasm",
};

/**
 * An error message if the engine's core wasm cannot be fetched, else null.
 *
 * A GET, not a HEAD, so this makes the same request the engine will: the service
 * worker returns early for non-GET, and hosts need not answer HEAD alike.
 * fetch() resolves on headers, so reading only the status costs ~50ms even for an
 * 18 MB file, and the body is dropped rather than read.
 */
export async function checkEngineAssetReachable(
  engine: EngineName,
  baseUrl: string,
): Promise<string | null> {
  const url = baseUrl + CORE_WASM[engine];
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    // Offline or DNS failure: no status to report.
    return `The ${
      ENGINE_LABEL[engine]
    } engine could not be downloaded. ${url} is unreachable (${
      e instanceof Error ? e.message : String(e)
    }).`;
  }

  // Only the status was needed; releasing the body is best-effort.
  try {
    await response.body?.cancel();
  } catch {
    /* already released */
  }

  if (!response.ok) {
    return `The ${ENGINE_LABEL[engine]} engine could not be downloaded. ${url} returned HTTP ${response.status}.`;
  }
  return null;
}
