(() => {
  // src/messageporthttp.ts
  async function fetchASGI(client, resource, init, filter = (bodyChunk) => bodyChunk) {
    if (typeof resource === "string" || typeof init !== "undefined") {
      resource = new Request(resource, init);
    }
    const channel = new MessageChannel();
    const clientPort = channel.port1;
    client.postMessage({
      type: "makeRequest",
      scope: reqToASGI(resource)
    }, [channel.port2]);
    const blob = await resource.blob();
    if (!blob.size) {
      clientPort.postMessage({
        type: "http.request",
        more_body: false
      });
    } else {
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const { value: theChunk, done } = await reader.read();
          clientPort.postMessage({
            type: "http.request",
            body: theChunk,
            more_body: !done
          });
          if (done) {
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    return new Promise((resolve) => {
      let streamController;
      const readableStream = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
        cancel(reason) {
        }
      });
      let response;
      clientPort.addEventListener("message", (event) => {
        const msg = event.data;
        if (msg.type === "http.response.start") {
          response = asgiToRes(msg, readableStream);
          resolve(response);
        } else if (msg.type === "http.response.body") {
          if (msg.body) {
            streamController.enqueue(filter(msg.body, response));
          }
          if (!msg.more_body) {
            streamController.close();
            clientPort.close();
          }
        } else {
          throw new Error("Unexpected event type from clientPort: " + msg.type);
        }
      });
      clientPort.start();
    });
  }
  function headersToASGI(headers) {
    const result = [];
    for (const [key, value] of headers.entries()) {
      result.push([key, value]);
    }
    return result;
  }
  function reqToASGI(req) {
    const url = new URL(req.url);
    return {
      type: "http",
      asgi: {
        version: "3.0",
        spec_version: "2.1"
      },
      http_version: "1.1",
      method: req.method,
      scheme: url.protocol.replace(/:$/, ""),
      path: url.pathname,
      query_string: url.search.replace(/^\?/, ""),
      root_path: "",
      headers: headersToASGI(req.headers)
    };
  }
  function asgiToRes(res, body) {
    return new Response(body, {
      headers: res.headers,
      status: res.status
    });
  }

  // src/serviceworker.ts
  var useCaching = false;
  var cacheName = "::prismExperimentsServiceworker";
  var version = "v5";
  self.addEventListener("install", (event) => {
    event.waitUntil(Promise.all([self.skipWaiting(), caches.open(version + cacheName)]));
  });
  self.addEventListener("activate", function(event) {
    event.waitUntil((async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      return Promise.all(keys.filter(function(key) {
        return key.indexOf(version + cacheName) !== 0;
      }).map(function(key) {
        return caches.delete(key);
      }));
    })());
  });
  self.addEventListener("fetch", function(event) {
    const request = event.request;
    const url = new URL(request.url);
    if (self.location.origin !== url.origin)
      return;
    if (url.pathname == "/esbuild")
      return;
    if (url.pathname == "/__ping__sw__") {
      event.respondWith(new Response("OK", { status: 200 }));
      return;
    }
    const appPathRegex = /.*\/(app_[^/]+\/)/;
    const m_appPath = appPathRegex.exec(url.pathname);
    if (m_appPath) {
      if (apps[m_appPath[1]]) {
        url.pathname = url.pathname.replace(appPathRegex, "/");
        const isAppRoot = url.pathname === "/";
        const filter = isAppRoot ? injectSocketFilter : identityFilter;
        event.respondWith((async () => {
          const blob = await request.blob();
          return fetchASGI(apps[m_appPath[1]], new Request(url.toString(), {
            method: request.method,
            headers: request.headers,
            body: request.method === "GET" || request.method === "HEAD" ? void 0 : blob,
            credentials: request.credentials,
            cache: request.cache,
            redirect: request.redirect,
            referrer: request.referrer
          }), void 0, filter);
        })());
        return;
      } else {
        console.warn(`Couldn't find parent page for ${url}`);
      }
    }
    if (request.method !== "GET") {
      return;
    }
    if (useCaching) {
      event.respondWith((async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        try {
          const networkResponse = await fetch(request);
          const baseUrl = self.location.origin + dirname(self.location.pathname);
          if (request.url.startsWith(baseUrl + "/shinylive/") || request.url === baseUrl + "/favicon.ico") {
            const cache = await caches.open(version + cacheName);
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response("Failed to find in cache, or fetch.", {
            status: 404
          });
        }
      })());
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
  function dirname(path) {
    if (path === "/" || path === "") {
      throw new Error("Cannot get dirname() of root directory.");
    }
    return path.replace(/[/]?[^/]+[/]?$/, "");
  }
  var apps = {};
  function identityFilter(bodyChunk, response) {
    return bodyChunk;
  }
  function injectSocketFilter(bodyChunk, response) {
    const contentType = response.headers.get("content-type");
    if (contentType && /^text\/html(;|$)/.test(contentType)) {
      const bodyChunkStr = String.fromCharCode(...bodyChunk);
      const base_path = dirname(self.location.pathname);
      const newStr = bodyChunkStr.replace(/<\/head>/, `<script src="${base_path}/shinylive/inject-socket.js"><\/script>
</head>`);
      const newChunk = Uint8Array.from(newStr.split("").map((s) => s.charCodeAt(0)));
      return newChunk;
    }
    return bodyChunk;
  }
})();
