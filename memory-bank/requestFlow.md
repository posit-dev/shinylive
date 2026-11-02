---
title: Request Flow (Service Worker, HTTP, and WebSocket)
description: How a Shinylive app's HTTP requests and WebSocket traffic reach Pyodide or webR with no real server — service worker registration, /app_<id>/ routing, the injected socket shim, MessagePort hand-offs, COOP/COEP/CORP headers, and caching. Read before touching src/shinylive-sw.ts, src/messageport*.ts, src/Components/Viewer.tsx, or when an app 404s or never connects.
---

# Request Flow

An app runs in an iframe whose URL is `<base>/app_<random>/`. Nothing serves that path. The
service worker answers HTTP requests by passing them to the engine, and the app's WebSocket is
swapped for a `MessageChannel` to the engine. Every hop is a `postMessage` with a `MessagePort`.

## Registering the service worker

`src/load-shinylive-sw.ts` runs first on every page (`site_template/*/index.html`,
`export_template/index.html`).

- If the page is not `https:` and the host is not `localhost`, `127.0.0.1`, or `[::1]`, it replaces
  the page body with an error and throws. Browsers only allow service workers on secure origins.
- The worker path is `<dir>/shinylive-sw.js`. `<dir>` comes from
  `<meta name="shinylive:serviceworker_dir">` (relative to the page) or, if absent, the parent of
  the script's own directory.
- It registers with `{ type: "module" }` and calls `registration.update()`.
- On Shift+Reload the page has no `navigator.serviceWorker.controller`, so once `ready` resolves it
  calls `window.location.reload()`. Without a controller no app request would be intercepted.

## The fetch handler (`src/shinylive-sw.ts`)

In order, for each request:

1. Other origins are ignored.
2. `/esbuild` (the dev live-reload stream) is ignored. A comment notes that open requests pile up
   if it goes through the worker.
3. `<base>/shinylive-inject-socket.js` is answered from a string built into the worker.
4. Any path matching `/.*\/(app_[^/]+\/)/` is an app request (see below).
5. Non-GET requests go to the network.
6. If `useCaching` is on, serve from cache or fetch and cache (see Caching).
7. If COI was requested, fetch and add COI headers. Otherwise the browser handles it.

`install` calls `skipWaiting()`; `activate` calls `clients.claim()` and deletes caches whose name
does not start with `version + cacheName`.

## App requests and the `apps` map

`apps` maps `"app_<id>/"` to a `MessagePort`. It is filled by `configureProxyPath` messages.

Page side, `setupAppProxyPath` in `src/Components/Viewer.tsx` makes the name
(`app_${makeRandomKey(20)}`), then `createHttpRequestChannel` posts `configureProxyPath` with
`port2` of a new `MessageChannel` to `navigator.serviceWorker.controller`. `port1` listens for
`makeRequest` and calls `proxy.makeRequest(msg.scope, appName, event.ports[0])`. The Viewer then
sets the iframe `src` to `urlPath`.

For an app request the worker:

- Polls `apps` 5 times, 50 ms apart. If still missing it returns 404 "Couldn't find parent page
  ... Try reloading the page."
- Strips the `app_<id>/` prefix, so the app sees `/`, `/session/...`, etc.
- Uses `injectSocketFilter` for the app root (`/`), `identityFilter` for everything else.
- Rebuilds the `Request` (body only for non-GET/HEAD) and calls `fetchASGI`.

### Service worker restarts

The browser can stop the worker at any time, which empties `apps`. On start the worker posts
`{ type: "serviceworkerStart" }` to all clients; `setupAppProxyPath` listens for it and calls
`createHttpRequestChannel` again. If that does not happen in time, the app gets the 404 above.

## `fetchASGI` and the engine side (`src/messageporthttp.ts`)

`fetchASGI(client, request, init, filter)`:

- Makes a new `MessageChannel`, posts `{ type: "makeRequest", scope: reqToASGI(req) }` with
  `port2` to the app's port.
- `reqToASGI` builds an ASGI 3.0 `http` scope: method, scheme, path, query string without `?`,
  `root_path: ""`, headers as `[key, value]` pairs.
- Sends the body as `http.request` messages (one empty message with `more_body: false` if there is
  no body).
- Resolves with a `Response` on `http.response.start`, then feeds `http.response.body` chunks
  through `filter` into a `ReadableStream`, closing it when `more_body` is false.

Engine side, the page's `makeRequest` lands in one of:

- **Python**: `makeRequest` looks up `_shiny_app_registry["<appName>"].app.call_pyodide` (the
  registry is defined in Python code in `src/hooks/usePyodide.tsx`, filled by `_start_app`) and
  runs it with ASGI `receive`/`send` callbacks. `call_pyodide` is used because ASGI wants dicts,
  not `JsProxy`. With the web worker proxy (`WebWorkerPyodideProxy` in `src/pyodide-proxy.ts`),
  the port is forwarded to `src/pyodide-worker.ts`, which calls the same `makeRequest`.
- **R**: `WebRProxy.makeRequest` (`src/webr-proxy.ts`) calls `makeHttpuvRequest`. It collects the
  whole body, then `evalR`s `app$call(list(PATH_INFO, REQUEST_METHOD, QUERY_STRING, rook.input))`
  on the app from `.shiny_app_registry`. If httpuv returns a `body` list with a `file`, the file
  is read from the webR FS. The reply is always one body chunk (no streaming).

Both paths add `cross-origin-embedder-policy: credentialless` and
`cross-origin-resource-policy: cross-origin` as defaults under the app's own headers.

## Injecting the socket shim

`injectSocketFilter` replaces `</head>` with
`<script src="<base>/shinylive-inject-socket.js" type="module"></script></head>` when the
response is `text/html`. It works on each body chunk separately.

The shim is bundled into the worker as a string: `shinylive-sw.ts` imports
`virtual:shinylive-inject-socket` (typed in `src/types/custom.d.ts`), and `injectSocketPlugin` in
`scripts/build.ts` resolves that to `src/shinylive-inject-socket.ts`, runs a nested unminified
esbuild, and returns the output as the module's text. This keeps `shinylive-sw.js` the only file
needed at the top level.

## WebSocket replacement

`src/shinylive-inject-socket.ts` sets `window.Shiny.createSocket`. It makes a `MessageChannel`,
posts `{ type: "openChannel", appName, path: "/websocket/" }` with `port2` to `window.parent`, and
returns `new MessagePortWebSocket(port1)`. `appName` is the last path segment of the iframe URL,
so the URL must end in `/`.

`MessagePortWebSocket` (`src/messageportwebsocket.ts`) is a WebSocket look-alike over a port. It
speaks `open`/`message`/`close` messages; the server side calls `accept()` to send `open`.
Unexpected messages fire `error` and close with code 1002.

The parent page answers in `ensureOpenChannelListener` (one in `src/hooks/usePyodide.tsx`, one in
`src/hooks/useWebR.tsx`; not in `App.tsx`). It is a `window` `message` listener, registered once
per module, that checks the app exists in the registry and then calls `proxy.openChannel`. The
service worker is not involved in WebSocket traffic.

In `src/messageportwebsocket-channel.ts`:

- **Python** `openChannel` wraps the port in a server-side `MessagePortWebSocket` and drives
  `call_pyodide` with an ASGI `websocket` scope (`headers: []`), translating
  `websocket.accept`/`send`/`close` to `accept()`/`send()`/`close()`.
- **R** `openChannelHttpuv` `evalR`s `app$onWSOpen(ws)` and keeps the `onMessage`/`onClose`
  callbacks. R sends replies through `.send_ws` (in `useWebR.tsx`), which writes a
  `_webR_httpuv_WSResponse` to the webR channel; `WebRProxy` routes it to
  `toClientCache[appName]`. Incoming frames are passed as text only. The Viewer also runs
  `.shiny_tick()` every 100 ms so R timers and reactives flush.

## COOP/COEP/CORP and caching

- `coiRequested` is true when the URL has `coi=1` or the referrer contains `coi=1`. A comment says
  this is needed for `browser()` or curl in webR.
- Non-app responses get `addCoiHeaders` (COEP `require-corp`, CORP `cross-origin`, COOP
  `same-origin`). App responses get only `addCorpHeader`, so the app can still load cross-origin
  resources.
- `useCaching` is a hard-coded `false` constant, so caching is off. When on, it caches only
  `<base>/shinylive/*` and `favicon.ico`, and adds COI headers to every network response.
- The cache name is `version + cacheName` (`"v10::shinyliveServiceworker"`) and does not change
  between builds.

## Pitfalls

- A service worker update or restart can leave an app path unregistered; the fix is a reload.
- Each `ensureOpenChannelListener` keeps the first proxy it is given, because of the module-level
  `channelListenerRegistered` flag. A `TODO` in `usePyodide.tsx` says so.
- `appName`, `scope.path`, `scope.method`, and `scope.query_string` are pasted into Python/R source
  strings, not passed as values.
- Python `websocket.accept` drops `subprotocol` and `headers` (`TODO` in `connect`).
- Since `injectSocketFilter` runs per chunk, a `</head>` split across two chunks would not be
  matched.
