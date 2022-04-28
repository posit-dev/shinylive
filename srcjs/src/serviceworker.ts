/// <reference lib="WebWorker" />

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

  // The client pages will periodically ping the service worker to keep it
  // alive. Otherwise, the browser will shut down the service worker after a
  // period of inactivity.
  if (url.pathname == "/__ping__sw__") {
    event.respondWith(new Response("OK", { status: 200 }));
    return;
  }

  // Fetches that are prepended with /app_<id>/ need to be proxied to pyodide.
  // We use fetchASGI.
  const appPathRegex = /.*\/(app_[^/]+\/)/;
  const m_appPath = appPathRegex.exec(url.pathname);
  if (m_appPath) {
    if (apps[m_appPath[1]]) {
      // Strip off the app root; the Python app doesn't know anything about it.
      url.pathname = url.pathname.replace(appPathRegex, "/");

      // If this is the app homepage, we need to mangle the returned HTML to
      // include <script src="../inject-socket.js"> in the <head>.
      const isAppRoot = url.pathname === "/";
      const filter = isAppRoot ? injectSocketFilter : identityFilter;

      event.respondWith(
        (async () => {
          const blob = await request.blob();
          return fetchASGI(
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
          );
        })()
      );
      return;
    } else {
      console.warn(`Couldn't find parent page for ${url}`);
    }
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

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "impendingNavigate") {
    const path = msg.path;
    const port = event.ports[0];
    apps[path] = port;
  }
});

function dirname(path: string) {
  if (path === "/" || path === "") {
    throw new Error("Cannot get dirname() of root directory.");
  }
  return path.replace(/[/]?[^/]+[/]?$/, "");
}

// =============================================================================
// Utilities for proxying requests to pyodide
// =============================================================================
const apps = {} as Record<string, MessagePort>;

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
