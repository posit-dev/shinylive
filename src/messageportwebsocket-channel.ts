import type { RFunction } from "webr";
import { AwaitableQueue } from "./awaitable-queue";
import { MessagePortWebSocket } from "./messageportwebsocket";
import type { PyCallable } from "./pyodide/ffi";
import type { loadPyodide } from "./pyodide/pyodide";

// =============================================================================
// Pyodide
// =============================================================================
type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

/**
 * Creates a connection between a ShinyApp named `app` in a pyodide instance,
 * and a MessagePort whose other end is running a MessagePortWebSocketClient.
 * This works by creating a local MessagePortWebSocketServer, and translating
 * between that and the ASGI protocol that ShinyApp speaks.
 * @param path
 * @param clientPort
 * @param pyodide
 */
export async function openChannel(
  path: string,
  appName: string,
  clientPort: MessagePort,
  pyodide: Pyodide,
): Promise<void> {
  const conn = new MessagePortWebSocket(clientPort);
  // We could _almost_ use app(), but unfortunately pyodide's implicit proxying
  // behavior isn't compatible with ASGI (which wants dict, not JsProxy); we
  // need to explicitly convert stuff first, which is what call_pyodide does.
  const asgiFunc = pyodide.runPython(
    `_shiny_app_registry["${appName}"].app.call_pyodide`,
  ) as PyCallable;
  await connect(path, conn, asgiFunc);
}

async function connect(
  path: string,
  conn: MessagePortWebSocket,
  asgiFunc: PyCallable,
) {
  // The `scope` argument we'll pass to the ASGI app
  const scope = {
    type: "websocket",
    asgi: {
      version: "3.0",
      spec_version: "2.1",
    },
    path,
    headers: [],
  };

  // A buffer of messages from the client, that the app has not yet retrieved
  const fromClientQueue = new AwaitableQueue<Record<string, any>>();
  fromClientQueue.enqueue({ type: "websocket.connect" });

  // A function to be called by the ASGI app when it wants to see the next
  // event that the client sent to the server.
  async function fromClient(): Promise<Record<string, any>> {
    return await fromClientQueue.dequeue();
  }

  // A function to be called by the ASGI app to send a message to the client.
  async function toClient(event: Record<string, any>): Promise<void> {
    event = Object.fromEntries(event.toJs());
    if (event.type === "websocket.accept") {
      // TODO: Also pass along event.subprotocol, event.headers
      conn.accept();
    } else if (event.type === "websocket.send") {
      conn.send(event.text ?? event.bytes);
    } else if (event.type === "websocket.close") {
      conn.close(event.code, event.reason);
      fromClientQueue.enqueue({ type: "websocket.disconnect" });
    } else {
      conn.close(1002, "ASGI protocol error");
      throw new Error(`Unhandled ASGI event: ${event.type}`);
    }
  }

  // Populate the fromClientQueue using events from the client
  conn.addEventListener("message", (e) => {
    const me = e as MessageEvent;
    const event: Record<string, any> = { type: "websocket.receive" };
    if (typeof me.data === "string") {
      event.text = me.data;
    } else {
      event.bytes = me.data;
    }
    fromClientQueue.enqueue(event);
  });
  conn.addEventListener("close", (e) => {
    const ce = e as CloseEvent;
    fromClientQueue.enqueue({ type: "websocket.disconnect", code: ce.code });
  });
  conn.addEventListener("error", (e) => {
    console.error(e);
  });

  // Initiate the ASGI WebSocket connection. It's not done awaiting until the
  // connection is closed.
  await asgiFunc(scope, fromClient, toClient);
}

// =============================================================================
// webR
// =============================================================================
import type { WebRProxy } from "./webr-proxy";

export async function openChannelHttpuv(
  path: string,
  appName: string,
  clientPort: MessagePort,
  webRProxy: WebRProxy,
): Promise<void> {
  const conn = new MessagePortWebSocket(clientPort);
  const shelter = await new webRProxy.webR.Shelter();
  let connected = false;
  let onWSMessage: RFunction | undefined;
  let onWSClose: RFunction | undefined;

  async function toClient(event: Record<string, any>): Promise<void> {
    if (!connected) {
      conn.accept();
      connected = true;
    }
    if (event.type === "websocket.send") {
      conn.send(event.message);
    } else if (event.type === "websocket.close") {
      connected = false;
      conn.close(1000, event.message);
    } else {
      connected = false;
      conn.close(1002, "ASGI protocol error");
      throw new Error(`Unhandled ASGI event: ${event.type}`);
    }
  }
  webRProxy.toClientCache[appName] = toClient;

  const fromClientQueue = new AwaitableQueue<Record<string, any>>();
  fromClientQueue.enqueue({ type: "websocket.connect" });

  conn.addEventListener("message", (e) => {
    const me = e as MessageEvent;
    const event: Record<string, any> = { type: "websocket.receive" };
    event.text = me.data;
    fromClientQueue.enqueue(event);
  });

  conn.addEventListener("close", (e) => {
    const ce = e as CloseEvent;
    fromClientQueue.enqueue({ type: "websocket.disconnect", code: ce.code });
  });

  conn.addEventListener("error", (e) => {
    console.error(e);
  });

  // Infinite async loop until connection is closed.
  for (;;) {
    const msg = await fromClientQueue.dequeue();
    switch (msg.type) {
      case "websocket.connect": {
        const callbacks = await webRProxy.webR.evalR(
          `
          app <- get(appName, env = .shiny_app_registry)
          onWSMessage <- NULL
          onWSClose <- NULL
          ws <- list(
            req = list(),
            onMessage = function(func) {
              onWSMessage <<- func
            },
            onClose = function(func) {
              onWSClose <<- func
            },
            send = function(msg) {
              .send_ws(c("websocket.send", appName, msg))
            },
            close = function(msg) {
              .send_ws(c("websocket.close", appName, msg))
            }
          )
          app$onWSOpen(ws)
          list(onWSMessage = onWSMessage, onWSClose = onWSClose)
        `,
          { env: { appName } },
        );
        onWSMessage = (await callbacks.get("onWSMessage")) as RFunction;
        onWSClose = (await callbacks.get("onWSClose")) as RFunction;
        break;
      }
      case "websocket.receive": {
        const text = await new shelter.RCharacter(msg.text);
        try {
          if (typeof onWSMessage !== "undefined") {
            await onWSMessage(webRProxy.webR.objs.false, text);
          }
        } finally {
          await shelter.purge();
        }
        break;
      }
      case "websocket.disconnect":
        if (onWSClose) await onWSClose();
        return;
      default:
        console.warn(`Unhandled websocket message of type "${msg.type}".`);
        return;
    }
  }
}
