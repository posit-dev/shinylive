// Reports an engine asset that cannot be downloaded, so the loader can show an
// error instead of spinning endlessly.
//
// Neither Pyodide's loadPyodide() nor webR's init() settles when the engine's
// wasm cannot be instantiated and neither leaves an error the page can catch.
// Checking the asset ourselves covers the cases where the file is corrupt, missing,
// or otherwise does not appear to be valid wasm. A response that is a
// genuine wasm module but the wrong one (e.g. a stale cached build) still
// spins forever; closing that would need a timeout, which this does not attempt.

import type { EngineName } from "./load-status";
import { ENGINE_LABEL } from "./load-status";

// wasm engine files to check
const CORE_WASM: Record<EngineName, string> = {
  python: "pyodide.asm.wasm",
  r: "R.wasm",
};

// Every WebAssembly module begins with these four magic bytes ("\0asm").
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/**
 * The first `n` bytes of a response body, or null if it cannot be read.
 *
 * Reads whole chunks until it has enough and then cancels, so the transfer stops
 * early instead of running to completion. Returns fewer than `n` bytes if the
 * body ends first, which is itself a failure worth reporting.
 */
async function readHead(
  response: Response,
  n: number,
): Promise<Uint8Array | null> {
  // Nothing here may throw: this runs to decide whether loading can proceed, so
  // a body that cannot be read has to mean "no opinion", not a failed load.
  const body = response.body;
  if (!body || typeof body.getReader !== "function") return null;
  const reader = body.getReader();

  const head = new Uint8Array(n);
  let filled = 0;
  try {
    while (filled < n) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const take = Math.min(value.length, n - filled);
      head.set(value.subarray(0, take), filled);
      filled += take;
    }
  } catch {
    // A body that fails mid-read tells us nothing the caller can act on.
    return null;
  } finally {
    // Stop the transfer; the rest of the file is the engine's to download.
    await reader.cancel().catch(() => undefined);
  }
  return head.subarray(0, filled);
}

/**
 * Raise an error if the engine's core wasm cannot be fetched, else null.
 *
 * fetch() resolves on headers and the body is cancelled as soon as the first few
 * bytes are in hand, so does not trigger the whole download (just checks it's available).
 */
export async function checkEngineAssetReachable(
  engine: EngineName,
  baseUrl: string,
): Promise<string | null> {
  const url = baseUrl + CORE_WASM[engine];
  const prefix = `The ${ENGINE_LABEL[engine]} engine could not be downloaded.`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    // Offline or DNS failure: no status to report.
    return `${prefix} ${url} is unreachable (${
      e instanceof Error ? e.message : String(e)
    }).`;
  }

  if (!response.ok) {
    // Only the status was needed; releasing the body is best-effort.
    try {
      await response.body?.cancel();
    } catch {
      /* already released */
    }
    return `${prefix} ${url} returned HTTP ${response.status}.`;
  }

  // Check the head of the response for wasm magic bytes to potentially
  // detect a malformed/corrupted download and alert the user.
  const head = await readHead(response, WASM_MAGIC.length);
  if (head === null) return null; // Unreadable body; nothing to conclude.

  const isWasm =
    head.length === WASM_MAGIC.length &&
    WASM_MAGIC.every((byte, i) => head[i] === byte);
  if (!isWasm) {
    return `${prefix} The file at ${url} appears to be corrupted.`;
  }

  return null;
}
