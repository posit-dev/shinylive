import { loadStatusStore, resetLoadStatusStores } from "./load-status";

beforeEach(() => {
  resetLoadStatusStores();
});

describe("initial state", () => {
  test("starts idle with no error", () => {
    const store = loadStatusStore("python");
    expect(store.get()).toEqual({ stage: "idle", error: null });
  });
});

describe("set()", () => {
  test("set() advances the stage", () => {
    const store = loadStatusStore("python");
    store.set("engine-download");
    expect(store.get().stage).toBe("engine-download");
  });

  test("set() records an error message", () => {
    const store = loadStatusStore("python");
    store.set("failed", "boom");
    expect(store.get()).toEqual({ stage: "failed", error: "boom" });
  });

  test("set() without an error clears any previous error", () => {
    const store = loadStatusStore("python");
    // "failed" is terminal (see below), so use a non-terminal stage here to
    // exercise the unrelated error-clearing behavior of set().
    store.set("engine-download", "transient message");
    store.set("engine-start");
    expect(store.get().error).toBeNull();
  });

  test("set('failed') with no message records a null error, not undefined", () => {
    // Viewer renders this straight into a <pre>; undefined would print nothing
    // while null at least keeps the element empty and predictable.
    const store = loadStatusStore("python");
    store.set("failed");
    expect(store.get()).toEqual({ stage: "failed", error: null });
  });
});

describe("subscription", () => {
  test("subscribers are notified on change", () => {
    const store = loadStatusStore("python");
    const seen = jest.fn();
    store.subscribe(seen);
    store.set("engine-download");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe stops notifications", () => {
    const store = loadStatusStore("python");
    const seen = jest.fn();
    const unsubscribe = store.subscribe(seen);
    unsubscribe();
    store.set("engine-download");
    expect(seen).not.toHaveBeenCalled();
  });

  test("setting the same state does not notify (useSyncExternalStore safety)", () => {
    // useSyncExternalStore re-renders on every notification, so an unchanged
    // state must not notify at all.
    const store = loadStatusStore("python");
    store.set("engine-download");
    const seen = jest.fn();
    store.subscribe(seen);
    store.set("engine-download");
    expect(seen).not.toHaveBeenCalled();
  });

  test("get() returns a stable reference until state changes (useSyncExternalStore safety)", () => {
    // Stable reference: useSyncExternalStore loops forever if get() returns a
    // fresh object on every call while the state is unchanged.
    const store = loadStatusStore("python");
    const first = store.get();
    expect(store.get()).toBe(first);
    store.set("engine-start");
    expect(store.get()).not.toBe(first);
  });
});

describe("per-engine stores", () => {
  test("the same engine returns the same store instance", () => {
    expect(loadStatusStore("python")).toBe(loadStatusStore("python"));
  });

  test("engines are isolated: python updates do not notify r", () => {
    const python = loadStatusStore("python");
    const r = loadStatusStore("r");
    const rSeen = jest.fn();
    r.subscribe(rSeen);
    python.set("engine-download");
    expect(rSeen).not.toHaveBeenCalled();
    expect(r.get().stage).toBe("idle");
  });

  test("engines fail independently, each keeping its own error", () => {
    const python = loadStatusStore("python");
    const r = loadStatusStore("r");
    python.set("failed", "pyodide is gone");
    r.set("failed", "webR is gone");
    expect(python.get().error).toBe("pyodide is gone");
    expect(r.get().error).toBe("webR is gone");
  });

  test("one engine failing leaves the other free to reach ready", () => {
    const python = loadStatusStore("python");
    const r = loadStatusStore("r");
    python.set("failed", "boom");
    r.set("ready");
    expect(python.get().stage).toBe("failed");
    expect(r.get().stage).toBe("ready");
  });
});

describe("failed is terminal", () => {
  test("a later set() does not change stage or error", () => {
    const store = loadStatusStore("python");
    store.set("failed", "root cause");
    store.set("failed", "secondary failure");
    expect(store.get()).toEqual({ stage: "failed", error: "root cause" });
  });

  test("even a set() to a non-failed stage is ignored", () => {
    const store = loadStatusStore("python");
    store.set("failed", "root cause");
    store.set("ready");
    expect(store.get()).toEqual({ stage: "failed", error: "root cause" });
  });

  test("a non-failed set() followed by a second failed() both leave the first error in place", () => {
    // Regression test for Fix 1: on the R path, initRShiny's `library(shiny)`
    // failure used to overwrite the real root-cause error because a spurious
    // "ready" transition slipped through in between the two set("failed", ...)
    // calls. Exercise that exact sequence: failed -> ready -> failed(second).
    const store = loadStatusStore("python");
    store.set("failed", "first");
    store.set("ready");
    expect(store.get()).toEqual({ stage: "failed", error: "first" });
    store.set("failed", "second");
    expect(store.get()).toEqual({ stage: "failed", error: "first" });
  });
});

describe("realistic sequences", () => {
  test("a realistic engine-load failure: idle -> engine-download -> failed", () => {
    const store = loadStatusStore("python");
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get().stage));
    store.set("engine-download");
    store.set("failed", "Failed to fetch pyodide.asm.wasm");
    expect(seen).toEqual(["engine-download", "failed"]);
    expect(store.get()).toEqual({
      stage: "failed",
      error: "Failed to fetch pyodide.asm.wasm",
    });
  });

  test("failing after ready is still recorded (app-start failures come later)", () => {
    // The engine reaching "ready" does not mean the app will start: requirements
    // installation and app import both happen afterwards. A failure then must
    // still register, or Viewer would never show the error alert.
    const store = loadStatusStore("python");
    store.set("engine-download");
    store.set("engine-start");
    store.set("ready");
    store.set("failed", "ModuleNotFoundError");
    expect(store.get()).toEqual({
      stage: "failed",
      error: "ModuleNotFoundError",
    });
  });

  test("a multi-line traceback is preserved verbatim", () => {
    // Viewer renders store.error inside a <pre>, so newlines and indentation are
    // load-bearing and must not be normalized on the way through.
    const traceback =
      'Traceback (most recent call last):\n  File "app.py", line 4\n    ui.p("x")\n    ^^\nSyntaxError: invalid syntax';
    const store = loadStatusStore("python");
    store.set("failed", traceback);
    expect(store.get().error).toBe(traceback);
  });
});

describe("resetLoadStatusStores()", () => {
  test("discards existing stores", () => {
    const before = loadStatusStore("python");
    before.set("ready");
    resetLoadStatusStores();
    const after = loadStatusStore("python");
    expect(after).not.toBe(before);
    expect(after.get().stage).toBe("idle");
  });
});
