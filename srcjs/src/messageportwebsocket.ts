/**
 * This class provides a standard WebSocket API, but is implemented using a
 * MessagePort. It can represent the server or client side of a WebSocket
 * connection. If server, then ws.accept() should be called after creation
 * in order to initialize the connection.
 */
export class MessagePortWebSocket extends EventTarget {
  readyState: number;
  _port: MessagePort;
  onopen: ((this: MessagePortWebSocket, ev: Event) => any) | undefined;
  onmessage:
    | ((this: MessagePortWebSocket, ev: MessageEvent) => any)
    | undefined;
  onerror: ((this: MessagePortWebSocket, ev: Event) => any) | undefined;
  onclose: ((this: MessagePortWebSocket, ev: CloseEvent) => any) | undefined;

  constructor(port: MessagePort) {
    super();

    this.readyState = 0;

    this.addEventListener("open", (e) => {
      if (this.onopen) {
        this.onopen(e);
      }
    });
    this.addEventListener("message", (e) => {
      if (this.onmessage) {
        this.onmessage(e as MessageEvent);
      }
    });
    this.addEventListener("error", (e) => {
      if (this.onerror) {
        this.onerror(e);
      }
    });
    this.addEventListener("close", (e) => {
      if (this.onclose) {
        this.onclose(e as CloseEvent);
      }
    });

    this._port = port;
    port.addEventListener("message", this._onMessage.bind(this));
    port.start();
  }

  // Call on the server side of the connection, to tell the client that
  // the connection has been established.
  accept() {
    if (this.readyState !== 0) {
      return;
    }

    this.readyState = 1;
    this._port.postMessage({ type: "open" });
  }

  send(data: unknown) {
    if (this.readyState === 0) {
      throw new DOMException(
        "Can't send messages while WebSocket is in CONNECTING state",
        "InvalidStateError"
      );
    }
    if (this.readyState > 1) {
      return;
    }

    this._port.postMessage({ type: "message", value: { data } });
  }

  close(code?: number, reason?: string) {
    if (this.readyState > 1) {
      return;
    }

    this.readyState = 2;
    this._port.postMessage({ type: "close", value: { code, reason } });
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  _onMessage(e: MessageEvent) {
    const event = e.data;
    switch (event.type) {
      case "open":
        if (this.readyState === 0) {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          return;
        }
        break;
      case "message":
        if (this.readyState === 1) {
          this.dispatchEvent(new MessageEvent("message", { ...event.value }));
          return;
        }
        break;
      case "close":
        if (this.readyState < 3) {
          this.readyState = 3;
          this.dispatchEvent(new CloseEvent("close", { ...event.value }));
          return;
        }
        break;
    }
    // If we got here, we didn't know how to handle this event
    this._reportError(
      `Unexpected event '${event.type}' while in readyState ${this.readyState}`,
      1002
    );
  }

  _reportError(message: string, code?: number) {
    this.dispatchEvent(new ErrorEvent("error", { message }));
    if (typeof code === "number") {
      this.close(code, message);
    }
  }
}
