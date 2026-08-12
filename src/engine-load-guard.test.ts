import { checkEngineAssetReachable } from "./engine-load-guard";

// The four-byte wasm preamble: \0asm
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

// jsdom (jest-environment-jsdom) does not implement fetch, so there is no
// existing property for jest.spyOn() to replace. Give it one; every test below
// swaps in its own implementation before use.
if (typeof globalThis.fetch === "undefined") {
  (globalThis as unknown as { fetch: unknown }).fetch = () => {
    throw new Error("fetch called without a stub");
  };
}

let fetchSpy: jest.SpyInstance;

afterEach(() => {
  fetchSpy.mockRestore();
});

function stubFetch(impl: (url: string, init?: RequestInit) => unknown): void {
  fetchSpy = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(impl as typeof fetch);
}

// A minimal Response whose body yields `chunks` then closes. Only the fields
// checkEngineAssetReachable() touches are present: a fake is clearer here than
// a real Response, whose body cannot be built from parts in jsdom.
function response(status: number, chunks: Uint8Array[]) {
  let i = 0;
  let cancelled = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
    // Exposed so the cancel assertion can read it back.
    get cancelled() {
      return cancelled;
    },
  };
}

function toBytes(body: string | number[]): Uint8Array {
  return typeof body === "string"
    ? new TextEncoder().encode(body)
    : new Uint8Array(body);
}

test("reachable asset returns null", async () => {
  stubFetch(() => response(200, [WASM]));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});

test("checks the engine's core wasm at the given base URL", async () => {
  stubFetch(() => response(200, [WASM]));
  await checkEngineAssetReachable("python", "/shinylive/pyodide/");
  await checkEngineAssetReachable("r", "/shinylive/webr/");
  expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
    "/shinylive/pyodide/pyodide.asm.wasm",
    "/shinylive/webr/R.wasm",
  ]);
});

test("uses a plain GET, never HEAD", async () => {
  // A HEAD would silently break offline-but-cached loads.
  stubFetch(() => response(200, [WASM]));
  await checkEngineAssetReachable("python", "/shinylive/pyodide/");
  const [url, init] = fetchSpy.mock.calls[0];
  expect(url).toContain("/shinylive/pyodide/pyodide.asm.wasm");
  expect((init as RequestInit | undefined)?.method?.toUpperCase()).not.toBe(
    "HEAD",
  );
});

test("a 404 is reported with the URL and the status", async () => {
  stubFetch(() => response(404, []));
  const msg = await checkEngineAssetReachable("python", "/shinylive/pyodide/");
  expect(msg).toMatch(/Python engine could not be downloaded/);
  expect(msg).toMatch(/pyodide\.asm\.wasm/);
  expect(msg).toMatch(/HTTP 404/);
});

test("a 5xx is treated as a failure too", async () => {
  // No body at all here (unlike the 404 case above), so both shapes of a
  // failed response's body are exercised.
  stubFetch(() => ({ ok: false, status: 503, body: null }));
  const msg = await checkEngineAssetReachable("r", "/shinylive/webr/");
  expect(msg).toMatch(/R engine could not be downloaded/);
  expect(msg).toMatch(/HTTP 503/);
});

test("a network error is reported without a status", async () => {
  stubFetch(() => Promise.reject(new Error("Failed to fetch")));
  const msg = await checkEngineAssetReachable("r", "/shinylive/webr/");
  expect(msg).toMatch(/unreachable/);
  expect(msg).toMatch(/Failed to fetch/);
  expect(msg).not.toMatch(/HTTP/);

  // fetch() can also reject with something that isn't an Error (a string
  // thrown by an odd polyfill, say); the message must still surface.
  fetchSpy.mockRestore();
  stubFetch(() => Promise.reject("offline"));
  const msg2 = await checkEngineAssetReachable("r", "/shinylive/webr/");
  expect(msg2).toMatch(/offline/);
});

test("the body is cancelled rather than downloaded", async () => {
  // The core wasm is ~10-18 MB. Only the first few bytes are wanted, so the
  // transfer must be stopped rather than run to completion.
  const res = response(200, [WASM]);
  stubFetch(() => res);
  await checkEngineAssetReachable("python", "/shinylive/pyodide/");
  expect(res.cancelled).toBe(true);
});

test("only the leading bytes are read, not the whole body", async () => {
  // One chunk carries the magic number; the reader must not ask for the rest.
  let reads = 0;
  stubFetch(() => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          reads++;
          return { done: false, value: WASM };
        },
        cancel: async () => undefined,
      }),
    },
  }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
  expect(reads).toBe(1);
});

// A captive portal or an SPA index.html fallback answers with 200. Handing
// either to the engine hangs it, so the check has to look past the status.
describe.each([
  ["an HTML page", "<!doctype html>\n<html><body>Sign in</body></html>"],
  ["other non-wasm bytes", [0xde, 0xad, 0xbe, 0xef]],
  ["an empty body", []],
  ["a body truncated inside the magic number", [0x00, 0x61]],
])("a 200 carrying %s is rejected", (_name, body) => {
  test("reports corruption", async () => {
    stubFetch(() => response(200, [toBytes(body)]));
    await expect(
      checkEngineAssetReachable("python", "/shinylive/pyodide/"),
    ).resolves.toMatch(/appears to be corrupted/);
  });
});

test("the magic number may arrive split across chunks", async () => {
  // A stream is free to deliver one byte at a time; that is not a failure.
  // An empty read (no value) can also happen mid-stream and must be skipped
  // rather than counted as bytes.
  let i = 0;
  const chunks: (Uint8Array | undefined)[] = [
    toBytes([0x00]),
    undefined,
    toBytes([0x61, 0x73]),
    toBytes([0x6d, 0x01]),
  ];
  stubFetch(() => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => undefined,
      }),
    },
  }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});

test("a body that cannot be cancelled does not fail the check", async () => {
  stubFetch(() => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: WASM }),
        cancel: async () => {
          throw new Error("locked");
        },
      }),
    },
  }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});

test("a bodyless response does not fail the check", async () => {
  stubFetch(() => ({ ok: true, status: 200, body: null }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});

test("a body with no getReader does not fail the check", async () => {
  // Guards against an environment where body is present but not a stream: the
  // check must decline to judge rather than throw and break the load.
  stubFetch(() => ({
    ok: true,
    status: 200,
    body: { cancel: async () => undefined },
  }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});

test("a body that throws mid-read does not fail the check", async () => {
  stubFetch(() => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          throw new Error("network reset");
        },
        cancel: async () => undefined,
      }),
    },
  }));
  await expect(
    checkEngineAssetReachable("python", "/shinylive/pyodide/"),
  ).resolves.toBeNull();
});
