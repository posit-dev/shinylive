/// <reference lib="WebWorker" />

import { dirname, sleep } from "./utils";
import { fetchASGI } from "./messageporthttp";

// When doing development, it's best to disable caching so that you don't have
// to keep manually clearing the browser's application cache.
const useCaching = false;

// Export empty type because of isolatedModules flag.
export type {};
declare const self: ServiceWorkerGlobalScope;

const cacheName = "::prismExperimentsServiceworker";
const version = "v5";

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([self.skipWaiting(), caches.open(version + cacheName)])
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async () => {
      await self.clients.claim();

      const keys = await caches.keys();

      // Remove caches whose name is no longer valid
      return Promise.all(
        keys
          .filter(function (key) {
            return key.indexOf(version + cacheName) !== 0;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })()
  );
});

self.addEventListener("fetch", function (event): void {
  const request = event.request;
  const url = new URL(request.url);

  // Don't try to handle requests that go to other hosts.
  if (self.location.origin !== url.origin) return;

  // Let the /esbuild path bypass the service worker. This path is used for the
  // server to signal the client to hot-reload, but going the service worker
  // causes problems with open requests accumulating because they don't get
  // closed properly.
  if (url.pathname == "/esbuild") return;

  // Fetches that are prepended with /app_<id>/ need to be proxied to pyodide.
  // We use fetchASGI.
  const appPathRegex = /.*\/(app_[^/]+\/)/;
  const m_appPath = appPathRegex.exec(url.pathname);
  if (m_appPath) {
    (async () => {
      // If the app URL isn't found, wait up to 250ms for it to be registered.
      let pollCount = 5;
      while (!apps[m_appPath[1]]) {
        if (pollCount == 0) {
          event.respondWith(
            new Response(`Couldn't find parent page for ${url}`, {
              status: 404,
            })
          );
          return;
        }

        console.log("App URL not registered. Waiting 50ms.");
        await sleep(50);
        pollCount--;
      }
      // Strip off the app root; the Python app doesn't know anything about it.
      url.pathname = url.pathname.replace(appPathRegex, "/");

      // If this is the app homepage, we need to mangle the returned HTML to
      // include <script src="../inject-socket.js"> in the <head>.
      const isAppRoot = url.pathname === "/";
      const filter = isAppRoot ? injectSocketFilter : identityFilter;

      const blob = await request.blob();

      event.respondWith(
        fetchASGI(
          apps[m_appPath[1]],
          new Request(url.toString(), {
            method: request.method,
            headers: request.headers,
            body:
              request.method === "GET" || request.method === "HEAD"
                ? undefined
                : blob,
            credentials: request.credentials,
            cache: request.cache,
            redirect: request.redirect,
            referrer: request.referrer,
          }),
          undefined,
          filter
        )
      );
    })();
  }

  // Always fetch non-GET requests from the network
  if (request.method !== "GET") {
    return;
  }

  if (useCaching) {
    // Try to serve the request from the cache.
    event.respondWith(
      (async (): Promise<Response> => {
        // Search for the request in the cache; if found, return the response.
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // If we got here, it wasn't in the cache. Fetch it.
        try {
          const networkResponse = await fetch(request);

          // If it's a local URL in shinylive/, cache it.
          const baseUrl =
            self.location.origin + dirname(self.location.pathname);
          if (
            request.url.startsWith(baseUrl + "/shinylive/") ||
            request.url === baseUrl + "/favicon.ico"
          ) {
            const cache = await caches.open(version + cacheName);
            cache.put(request, networkResponse.clone());
          }

          return networkResponse;
        } catch {
          return new Response("Failed to find in cache, or fetch.", {
            status: 404,
          });
        }
      })()
    );
  }
});

// =============================================================================
// Utilities for proxying requests to pyodide
// =============================================================================

const apps = {} as Record<string, MessagePort>;

// When we start up a service worker, alert all clients. This is important
// because service workers may stop at any time and then restart when needed.
// When this serviceworker stops, it loses the state of `app`, the mapping from
// URL paths to MessagePorts. When it starts again, it needs to tell all the
// clients, "I restarted!", so that they know to re-register themselves with the
// service worker. Otherwise the apps for clients will no longer be proxied, and
// will get a 404 when they try to access the app.
(async () => {
  const allClients = await self.clients.matchAll();

  for (const client of allClients) {
    client.postMessage({
      type: "serviceworkerStart",
    });
  }
})();

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "configureProxyPath") {
    const path = msg.path;
    const port = event.ports[0];
    apps[path] = port;
  }
});

function identityFilter(bodyChunk: Uint8Array, response: Response) {
  return bodyChunk;
}

function injectSocketFilter(bodyChunk: Uint8Array, response: Response) {
  const contentType = response.headers.get("content-type");
  if (contentType && /^text\/html(;|$)/.test(contentType)) {
    const bodyChunkStr = String.fromCharCode(...bodyChunk);
    const base_path = dirname(self.location.pathname);
    const newStr = bodyChunkStr.replace(
      /<\/head>/,
      `<script src="${base_path}/shinylive/inject-socket.js"></script>\n</head>`
    );
    const newChunk = Uint8Array.from(
      newStr.split("").map((s) => s.charCodeAt(0))
    );
    return newChunk;
  }
  return bodyChunk;
}
