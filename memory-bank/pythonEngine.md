---
title: Python Engine (Pyodide)
description: How Pyodide is started, how the main thread talks to it (PyodideProxy, the web worker, ResultType), the Python helpers that start and stop Shiny apps (_shiny_app_registry, micropip installs), how output reaches the terminal, and the shared engine load-status pieces. Read before changing pyodide-proxy.ts, pyodide-worker.ts, usePyodide.tsx, or the loading screen.
---

# Python Engine (Pyodide)

How requests reach a running app (service worker, `fetchASGI`, WebSocket shim) is in
`requestFlow.md`. This document covers the engine itself. For R, see `rEngine.md`.

## Startup chain

`src/Components/App.tsx` calls `ensurePyodideProxyHandlePromise`, which keeps one module-level
promise per page, so every component shares one Pyodide. It runs:

1. `initPyodide` (`src/hooks/usePyodide.tsx`) — checks the wasm, builds the proxy, runs the setup
   Python (`load_python_pre`), returns a `PyodideProxyHandle` with `ready: true`.
2. `initShiny` — only when the app mode needs Shiny (not `editor-terminal`). It does not import
   Shiny; it only calls `ensureOpenChannelListener` and sets `shinyReady: true`. Shiny is imported
   later, by `_start_app`.

`usePyodide` is a thin React hook that waits for that promise and stores the handle in state.
`PyodideProxyHandle.runCode` runs REPL input with `printResult: true`; `tabComplete` goes through
Pyodide's console completer.

If `load_python_pre` throws, `initPyodide` still returns `ready: true` with `initError: true`
(the error is already recorded in the load-status store). Errors thrown before that point
(unreachable wasm, failed `loadPyodide`) propagate, and `App.tsx` marks the store `failed`.

## PyodideProxy: worker vs normal

`src/pyodide-proxy.ts` defines the `PyodideProxy` interface and two classes, chosen by
`loadPyodideProxy`:

- `WebWorkerPyodideProxy` (default) — starts `pyodide-worker.js` as a module worker. Each call is
  a message sent with a fresh `MessageChannel` (`postMessageAsync`); the reply comes back on that
  port. `openChannel` and `makeRequest` instead transfer the client's `MessagePort` straight to
  the worker and do not wait for a reply.
- `NormalPyodideProxy` — runs Pyodide on the main thread. Used when the page URL has
  `?webworker=0` (`pyodideProxyType` in `App.tsx`). Handy for debugging in devtools.

Differences between the two that can bite:

- On error, the worker rewrites a `PythonError`'s message with `shortFormatLastTraceback`, sends
  it through `errorToPostableErrorObject` (`src/postable-error.ts`), and the proxy writes it to
  stderr and rethrows. `NormalPyodideProxy.runPyAsync` does the same, but
  `NormalPyodideProxy.callPyAsync` does neither: errors are thrown with the full traceback and
  nothing is written to stderr.
- `callJS` (put in Python globals by `setupPythonEnv`) returns the JS result in normal mode. In
  worker mode it posts a `callJS` non-reply message, the main thread calls the function on
  `self`, and the return value is dropped.
- `runPyAsync` calls `loadPackagesFromImports(code)` before running code, in both modes.
  `callPyAsync` does not.

A failed worker `init` resets `pyodideStatus` to `"none"`, and the proxy checks
`response.error`, so a failed boot is never reported as success.

## Messages (`src/pyodide-worker.ts`)

`InMessage` types: `init`, `loadPackagesFromImports`, `runPythonAsync`, `tabComplete`,
`callPyAsync`, `openChannel`, `makeRequest`. Replies are `ReplyMessageDone` (with `value` or
`error`) or `ReplyMessageTabCompletions`. Messages the worker sends on its own are
`NonReplyMessage`: `output` (stdout/stderr text) and `callJS`. `callPyAsync` takes a name path
(`["os", "path", "join"]`), starts from `pyodide.globals`, and awaits the result if async.

## ResultType and processReturnValue

A `PyProxy` cannot cross the worker boundary, so callers pick a `ResultType`:

- `"none"` (default) — return nothing.
- `"value"` — `toJs()` on a `PyProxy`, else the plain value. Only works for simple data.
- `"printed_value"` — `repr()` string.
- `"to_html"` — calls the Python `_to_html` helper; returns a `ToHtmlResult` (`type: "html"` or
  `"text"`). Used by `src/Components/OutputCell.tsx`.

`processReturnValue` does the conversion and is shared by both proxies; the caller destroys the
`PyProxy` afterward. `printResult: true` also writes `repr(result)` to stdout.

## setupPythonEnv

Runs once per Pyodide, in both modes. It sets `js_pyodide` (the JS Pyodide object, used by
`_load_packages_from_dir`), builds a `pyodide.console.PyodideConsole` over `__main__` and keeps
its `complete` function for tab completion, injects `callJS`, and defines
`_short_format_last_traceback` (which trims frames before `<console>`/`<exec>`). It returns these
as `PyUtils`.

## load_python_pre (in `usePyodide.tsx`)

The setup code run by `initPyodide`. Because it goes through `runPyAsync`, any `import` in its
text triggers a package load; that is why `_to_html` and `_format_py_code` use
`importlib.import_module` for matplotlib and black. It:

- Stubs `_multiprocessing` and `ipykernel`/`ipykernel.comm` in `sys.modules`.
- Sets `MPLBACKEND=AGG`, puts `""` on `sys.path`, imports `ssl`, runs `pyodide_http.patch_all()`.
- Defines `_save_files(files, destdir, rm_destdir=True)` — writes text or binary files.
- Defines `_install_requirements_from_dir` — reads `requirements.txt`, skips names already in
  `micropip.list()`, `micropip.install`s the rest (URLs are treated as wheels), and installs the
  requirements of `[extras]` by hand because micropip skips extras for installed packages. It
  prints `Installing ...` lines, so they show in the terminal.
- Defines `_load_packages_from_dir` — runs `loadPackagesFromImports` on every `.py` file.
- Defines `_to_html`, `_format_py_code` (installs `tomli` and `black` with micropip on first use;
  called by `formatCode` in `App.tsx`), `_shiny_app_registry = {}`, `ShinyExpressAppModule`,
  `_start_app`, and `_stop_app`.

## Starting and stopping an app

`src/Components/Viewer.tsx` owns this. `setupAppProxyPath` picks one `app_<random>` name per
Viewer and registers it with the service worker; reruns reuse that name. `runApp`:

1. `callPyAsync(["_save_files"], [files, "/home/pyodide/<appName>"])` (wipes the dir first).
2. `callPyAsync(["_start_app"], [appName], { dev_mode })`, which: replaces Shiny's bookmark
   save/restore with functions that raise `NotImplementedError` (if that API exists); adds the
   app dir to `sys.path`; installs `requirements.txt`; loads packages from imports;
   `importlib.invalidate_caches()`; sets `SHINY_DEV_MODE=1` during import if dev mode; imports
   `<appName>.app` or wraps an Express app with `ShinyExpressAppModule`; stores it in
   `_shiny_app_registry[appName]`; removes the app dir from `sys.path`.
3. Points the iframe at `<appName>/`.

Requests then find the app through `_shiny_app_registry["<appName>"].app.call_pyodide`
(`src/messageporthttp.ts`, `src/messageportwebsocket-channel.ts`; see `requestFlow.md`).

`stopApp` (called by `Editor.tsx` before each `runApp`) clears the iframe, then
`_stop_app(appName)` awaits `app.stop()` for a `shiny.App`, deletes the registry entry, and pops
from `sys.modules` every module whose name starts with the app name or whose `__file__` is under
`/home/pyodide`. That second rule also unloads non-app scripts saved to `/home/pyodide` by
`App.tsx`. Because the app dir is only on `sys.path` during startup, an `import` that runs later
(inside a function) can fail to find app-local modules.

## stdout and stderr

`App.tsx` passes `terminalInterface.echo` / `.error` as stdout/stderr. `Terminal.tsx` points them
at xterm (`error` in red) once it mounts; before that they log to the console. In worker mode,
Pyodide's `stdout`/`stderr` options post `output` messages that `WebWorkerPyodideProxy`'s
`onmessage` forwards to the callbacks. In worker mode, Python errors from `runPyAsync` and
`callPyAsync` also go to stderr through the proxy, so an app that fails in `_start_app` shows its
traceback both in the terminal and in the Viewer error.

## Load status (shared with R)

- `src/load-status.ts` — one observable store per engine (`loadStatusStore("python" | "r")`),
  kept at module level because loading starts before React mounts. Stages: `idle`,
  `engine-download`, `engine-start`, `ready`, `failed`. `failed` is terminal, so a later error
  cannot hide the first cause. `get()` returns a stable object (required by
  `useSyncExternalStore`).
- `src/engine-load-guard.ts` — `checkEngineAssetReachable` fetches `pyodide.asm.wasm` (or
  `R.wasm`) and checks the HTTP status and the `\0asm` magic bytes, then cancels the body. This
  exists because `loadPyodide()` and webR's `init()` hang forever on a missing wasm. A valid but
  wrong wasm still hangs; there is no timeout.
- `src/hooks/useLoadStatus.ts` — `useSyncExternalStore` wrapper.
- `src/Components/LoadingStatus.tsx` — spinner; stage text appears only after 3 s
  (`STATUS_DELAY_MS`). At `ready` it says "Loading packages and starting app…", since app
  imports and startup still remain.

For Python, `initPyodide` sets `engine-download` before the wasm check and `loadPyodideProxy`
(so it covers download and interpreter boot), `engine-start` before `load_python_pre`, then
`ready`. `Viewer.tsx` shows `ViewerError` with `kind="engine"` when the store is `failed`.
