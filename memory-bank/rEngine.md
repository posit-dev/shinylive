---
title: R Engine (webR)
description: How webR is started, how the R shiny library image is mounted, the R helpers that start and stop apps (.shiny_app_registry, .start_app, .shiny_tick), how httpuv-style requests and WebSocket replies flow through WebRProxy, and how R differs from the Python engine. Read before changing webr-proxy.ts, useWebR.tsx, r-status.ts, or the R paths in Viewer.tsx.
---

# R Engine (webR)

The service worker side of requests is in `requestFlow.md`. The Python engine and the shared
load-status pieces (`load-status.ts`, `engine-load-guard.ts`, `LoadingStatus.tsx`) are in
`pythonEngine.md`.

## Startup chain

`ensureWebRProxyHandlePromise` in `src/Components/App.tsx` keeps one module-level promise, so
every component shares one webR. It runs:

1. `initWebR` (`src/hooks/useWebR.tsx`):
   - Picks `ChannelType.Automatic` if the page is `crossOriginIsolated`, else
     `ChannelType.PostMessage`. Base URL is `<script dir>/webr/`.
   - Sets the `r` store to `engine-download`, runs `checkEngineAssetReachable("r", ...)` on
     `R.wasm`, then `loadWebRProxy`.
   - Sets `engine-start`, binds `.base_url` in the global env, mounts the shiny library image,
     runs `load_r_pre`, sets `ready`.
2. `initRShiny` (when the mode needs Shiny) — `library(shiny)`, `options(expressions=1000)` for
   Shiny's deep call stacks, then `ensureOpenChannelListener`.

Like Python, a failure inside the `try` in `initWebR` sets `failed` but still returns
`ready: true` with `initError: true`. `App.tsx` then still calls `initRShiny`, whose
`library(shiny)` fails too; because `failed` is terminal, the store keeps the first cause.
`library(shiny)` runs after the store says `ready`, so it is covered by the "Loading packages and
starting app…" text.

## The shiny library image

The `webr` target in the `Makefile` copies `node_modules/webr/dist` into
`build/shinylive/webr/`, then downloads `library.data.gz` and `library.js.metadata` from the
`r-wasm/shiny` GitHub release `v$(R_SHINY_VERSION)`. To move to a new R shiny, change
`R_SHINY_VERSION` and rebuild. The target also patches `R.js` with `sed` to remove the
`if(!hasByteServing)` check, so files are downloaded whole (GitHub Pages does not cache partial
content).

At runtime `initWebR` runs `webr::mount("/shinylive/library", "<baseUrl>library.data.gz")`, and
`load_r_pre` appends `/shinylive/webr/packages` and `/shinylive/library` to `.libPaths()`.

## WebRProxy (`src/webr-proxy.ts`)

There is one class, `WebRWorkerProxy`. webR already runs R in its own worker, so there is no
"normal" mode as there is for Pyodide.

- `loadWebRProxy` creates `new WebR(config)`, awaits `init()`, and starts `#run`, an endless loop
  over `webR.read()`. It sends `stdout`/`stderr` to the callbacks, resolves the pending
  `runCode` on `prompt`, and passes `_webR_httpuv_WSResponse` messages to
  `toClientCache[appName]`.
- `runRAsync(code, options)` evaluates in one reused `Shelter`, defaults `captureStreams` and
  `captureConditions` to `false`, writes errors to stderr and rethrows, and always `purge()`s
  the shelter. Returned R objects are dead after the call returns, so code that needs a result
  later uses its own shelter (see `.start_app` below).
- `runCode` (the REPL) writes to the console with `writeConsole` and resolves with the next
  prompt string. `Terminal.tsx` prints that prompt.
- `openChannel` → `openChannelHttpuv`; `makeRequest` → `makeHttpuvRequest`.

## load_r_pre (in `useWebR.tsx`)

- Sets `TAR=internal` and `R_CONFIG_ACTIVE=shinylive`, sets up `.libPaths()`, and runs
  `webr::shim_install()` so `install.packages()` uses webR.
- `.shiny_app_registry <- new.env()`.
- `.shiny_to_httpuv(appDir)` — `as.shiny.appobj`, `onStart()` (sources `global.R`),
  `workerId("")`, resets the current app state, and builds an httpuv-style app with
  `createAppHandlers` and `HandlerManager`. These are internal `shiny:::` functions, so a new
  `R_SHINY_VERSION` can break them.
- `.shiny_tick()` — runs Shiny's timers, `flushReact()`, and `flushPendingSessions()`.
- `.send_ws(message)` — sends a message to the main thread with `webr::eval_js` writing a
  `_webR_httpuv_WSResponse` to `Module.webr.channel`.
- `.RawReader` — a Rook input stream over a raw vector.
- `.save_files`, `.start_app`, `.stop_app`, `.mount_vfs_images`, `.install_pkg_tgz`, and the
  `.webr_pkg_cache` list.

## Starting and stopping an app

`src/Components/Viewer.tsx` (the "Shiny for R" effect). `appDir` is `/home/web_user/<appName>`.
`runApp`:

1. Builds an R list of the files in a new shelter (`RCharacter` for text, `RRaw` for binary) and
   calls `.save_files(files, appDir)`.
2. Calls `.start_app(appName, appDir, devMode)` with `shelter.evalR`, not `runRAsync`, so the
   result outlives the call. `.start_app`:
   - parses every top-level `.R`/`.r` file first, so syntax errors fail fast;
   - `.mount_vfs_images()` — if `<base_url>packages/metadata.rds` exists (checked with a sync
     XHR `HEAD`), mounts each listed package image under `/shinylive/webr/packages/<name>`, falls
     back to untarring `.tgz` files, and adds `library` entries to `.libPaths()`; then marks every
     installed package in `.webr_pkg_cache`;
   - runs `renv::dependencies(appDir)` and `webr::install`s any package not installed. A failed
     install is not fatal here;
   - sets `options(shiny.client_devmode = TRUE)` in dev mode;
   - stores `.shiny_to_httpuv(appDir)` in `.shiny_app_registry`.
   It never raises. It returns `list(status = "ok")` or
   `list(status = "error", message, class, call)`. Errors raised with `captureConditions: FALSE`
   would never reach JS, so this return value is the only way the Viewer learns about a failed
   start. `call` is dropped when it starts with `..stacktrace`, since that would be the whole app.
3. Reads the list with `rCharacterField` (`src/r-status.ts`), which walks webR's
   `{ type, names, values }` tree and returns `[]` for anything unexpected. Anything other than
   `status == "ok"` becomes an `Error` shown by `ViewerError`.
4. Starts a 100 ms `setInterval` that calls `.shiny_tick()`, then points the iframe at the app.

`stopApp` clears the interval and the iframe, then `.stop_app(appName)` sends a
`websocket.close` through `.send_ws` and sets the registry entry to `NULL`. Packages, the
environment, and `options()` are not reset. The Viewer then waits 200 ms.

## How requests reach the app

Details are in `requestFlow.md`. In short: `makeHttpuvRequest` (`src/messageporthttp.ts`) joins
the request body, wraps it in `.RawReader`, and evaluates
`get(appName, env = .shiny_app_registry)$call(list(PATH_INFO, REQUEST_METHOD, QUERY_STRING,
rook.input))`. A `NULL` app (stopped) gives a non-list reply, which surfaces as
`Unexpected response type`. For WebSockets, `openChannelHttpuv`
(`src/messageportwebsocket-channel.ts`) stores a `toClient` function in
`webRProxy.toClientCache[appName]`; R replies come back as `_webR_httpuv_WSResponse` through the
`#run` loop. `ensureOpenChannelListener` checks `exists(appName, envir = .shiny_app_registry)`
before opening a channel.

## Differences from Python that matter when changing either

- **Event loop.** Python needs no tick; `Viewer.tsx` has no timer for it. R does: the
  `.shiny_tick()` call every 100 ms is what runs Shiny's timers and flushes reactivity. Removing
  or slowing it stalls R apps.
- **Errors.** Python start errors are thrown and caught by the Viewer. R start errors must be
  returned as a status list (above). Do not switch `.start_app` to raising.
- **Registry.** Python uses a dict and `del`s entries and unloads modules on stop. R sets the
  entry to `NULL` and unloads nothing.
- **Packages.** Python: `loadPackagesFromImports` plus micropip for `requirements.txt`. R:
  `renv::dependencies` plus `webr::install`, plus optional VFS images from `metadata.rds`.
- **App dir.** `/home/pyodide/<appName>` vs `/home/web_user/<appName>`.
- **REPL.** R `tabComplete` always returns `[""]`. Only R supports Ctrl-C, through
  `WebRProxyHandle.interrupt` (`webR.interrupt()`), wired in `Terminal.tsx`.
- **Proxy modes.** Python has worker and main-thread proxies with slightly different error paths;
  R has one.
- **Stop delay.** Python waits 5 ms, only if an app was stopped; R always waits 200 ms.
