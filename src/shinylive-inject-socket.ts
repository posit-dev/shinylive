// Note that this file gets bundled into the service worker as a string (see
// injectSocketPlugin in scripts/build.ts), and gets served to Shinylive
// applications when they request shinylive-inject-socket.js.
//
// The reason for doing this is so that only the shinylive-sw.js file needs to
// live at the top level, instead of both that file and
// shinylive-inject-socket.js.
import { MessagePortWebSocket } from "./messageportwebsocket";

export {};

// Create an object that looks like a WebSocket which Shiny.js will use
// to communicate to the Python backend.
(window as any).Shiny.createSocket = function () {
  const channel = new MessageChannel();
  window.parent.postMessage(
    {
      type: "openChannel",
      // Infer app name from path: "/foo/app_abc123/"" => "app_abc123"
      appName: window.location.pathname.replace(
        new RegExp(".*/([^/]+)/$"),
        "$1"
      ),
      path: "/websocket/",
    },
    "*",
    [channel.port2]
  );
  return new MessagePortWebSocket(channel.port1);
};
