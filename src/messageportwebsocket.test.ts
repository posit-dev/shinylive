import { MessagePortWebSocket } from "./messageportwebsocket";

// jsdom has no MessageChannel (jsdom/jsdom#2448), so here is the slice of one
// that MessagePortWebSocket uses: addEventListener("message"), start() and
// postMessage(). Delivery is deferred to a macrotask, as a real port's is.
class FakePort extends EventTarget {
  peer!: FakePort;
  private started = false;
  private pending: unknown[] = [];

  start(): void {
    this.started = true;
    const queued = this.pending;
    this.pending = [];
    for (const data of queued) this.deliver(data);
  }

  postMessage(data: unknown): void {
    setTimeout(() => this.peer.receive(data), 0);
  }

  private receive(data: unknown): void {
    if (this.started) {
      this.deliver(data);
    } else {
      this.pending.push(data);
    }
  }

  private deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function fakeChannel(): { port1: MessagePort; port2: MessagePort } {
  const port1 = new FakePort();
  const port2 = new FakePort();
  port1.peer = port2;
  port2.peer = port1;
  return {
    port1: port1 as unknown as MessagePort,
    port2: port2 as unknown as MessagePort,
  };
}

// Messages cross the channel on a macrotask, so tests wait for a timer rather
// than a microtask after anything that has to reach the other side.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A client and server pair joined by a channel, as in real use. */
function connectedPair() {
  const channel = fakeChannel();
  const server = new MessagePortWebSocket(channel.port1);
  const client = new MessagePortWebSocket(channel.port2);
  return { server, client };
}

describe("readyState", () => {
  test("starts in CONNECTING", () => {
    const { server, client } = connectedPair();
    expect(server.readyState).toBe(0);
    expect(client.readyState).toBe(0);
  });

  test("accept() opens the server side and then the client side", async () => {
    const { server, client } = connectedPair();

    server.accept();
    expect(server.readyState).toBe(1);

    await flush();
    expect(client.readyState).toBe(1);
  });

  test("accept() is a no-op once past CONNECTING", async () => {
    const { server, client } = connectedPair();
    server.accept();
    await flush();

    server.accept();
    expect(server.readyState).toBe(1);
    await flush();
    expect(client.readyState).toBe(1);
  });
});

describe("open event", () => {
  test("fires the listener and the onopen handler", async () => {
    const { server, client } = connectedPair();
    const listener = jest.fn();
    const onopen = jest.fn();
    client.addEventListener("open", listener);
    client.onopen = onopen;

    server.accept();
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(onopen).toHaveBeenCalledTimes(1);
  });
});

describe("send()", () => {
  test("throws while still CONNECTING", () => {
    const { server } = connectedPair();
    expect(() => server.send("hello")).toThrow(
      "Can't send messages while WebSocket is in CONNECTING state",
    );
    expect(() => server.send("hello")).toThrow(DOMException);
  });

  test("delivers a message to the other side once open", async () => {
    const { server, client } = connectedPair();
    const onmessage = jest.fn();
    client.onmessage = onmessage;

    server.accept();
    await flush();
    server.send("hello");
    await flush();

    expect(onmessage).toHaveBeenCalledTimes(1);
    expect(onmessage.mock.calls[0][0].data).toBe("hello");
  });

  test("messages arrive in order", async () => {
    const { server, client } = connectedPair();
    const received: unknown[] = [];
    client.onmessage = (e) => received.push(e.data);

    server.accept();
    await flush();
    server.send("one");
    server.send("two");
    server.send("three");
    await flush();

    expect(received).toEqual(["one", "two", "three"]);
  });

  test("is silently dropped after close", async () => {
    const { server, client } = connectedPair();
    const onmessage = jest.fn();
    client.onmessage = onmessage;

    server.accept();
    await flush();
    server.close();
    expect(() => server.send("too late")).not.toThrow();
    await flush();

    expect(onmessage).not.toHaveBeenCalled();
  });
});

describe("close()", () => {
  test("closes both sides and reports the code and reason", async () => {
    const { server, client } = connectedPair();
    const serverClose = jest.fn();
    const clientClose = jest.fn();
    server.onclose = serverClose;
    client.onclose = clientClose;

    server.accept();
    await flush();
    server.close(1000, "done");

    expect(server.readyState).toBe(3);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(serverClose.mock.calls[0][0].code).toBe(1000);
    expect(serverClose.mock.calls[0][0].reason).toBe("done");

    await flush();
    expect(client.readyState).toBe(3);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(clientClose.mock.calls[0][0].code).toBe(1000);
    expect(clientClose.mock.calls[0][0].reason).toBe("done");
  });

  test("a second close() does nothing", async () => {
    const { server } = connectedPair();
    const onclose = jest.fn();
    server.onclose = onclose;

    server.accept();
    await flush();
    server.close(1000, "done");
    server.close(1001, "again");

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(server.readyState).toBe(3);
  });
});

describe("protocol errors", () => {
  test("a message received while CONNECTING errors and closes", async () => {
    const { server, client } = connectedPair();
    const onerror = jest.fn();
    const onclose = jest.fn();
    client.onerror = onerror;
    client.onclose = onclose;

    // Send without accept()ing first: the client is still in readyState 0.
    // Reach past send()'s own guard by posting on the raw port.
    server._port.postMessage({ type: "message", value: { data: "early" } });
    await flush();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onerror.mock.calls[0][0].message).toBe(
      "Unexpected event 'message' while in readyState 0",
    );
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose.mock.calls[0][0].code).toBe(1002);
    expect(client.readyState).toBe(3);
  });

  test("an unrecognized event type errors and closes", async () => {
    const { server, client } = connectedPair();
    const onerror = jest.fn();
    client.onerror = onerror;

    server.accept();
    await flush();
    server._port.postMessage({ type: "bogus" });
    await flush();

    expect(onerror.mock.calls[0][0].message).toBe(
      "Unexpected event 'bogus' while in readyState 1",
    );
    expect(client.readyState).toBe(3);
  });

  test("a duplicate open errors rather than re-opening", async () => {
    const { server, client } = connectedPair();
    const onerror = jest.fn();
    client.onerror = onerror;

    server.accept();
    await flush();
    server._port.postMessage({ type: "open" });
    await flush();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onerror.mock.calls[0][0].message).toBe(
      "Unexpected event 'open' while in readyState 1",
    );
  });
});
