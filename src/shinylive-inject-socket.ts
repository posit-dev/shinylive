// Note that this file gets compiled to ./shinylive-inject-socket.txt. This is a
// JavaScript file which in turn gets imported into the service worker as a
// string, and gets served to Shinylive applications when they request that
// file.
//
// The reason for doing this is so that only the shinylive-sw.js file needs to
// live at the top level, instead of both that file and shinylive-sw.js.
//
// If you change this file (or its dependencies), then you may need to run the
// build step twice: once to compile this file to the output .txt file, and then
// one more time to have it be incorporated into shinylive-sw.js.
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
