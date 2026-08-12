import { AwaitableQueue } from "./awaitable-queue";

describe("AwaitableQueue", () => {
  test("dequeue returns already-enqueued items in FIFO order", async () => {
    const q = new AwaitableQueue<number>();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);

    expect(await q.dequeue()).toBe(1);
    expect(await q.dequeue()).toBe(2);
    expect(await q.dequeue()).toBe(3);
  });

  test("dequeue on an empty queue waits for an enqueue", async () => {
    const q = new AwaitableQueue<string>();

    let settled = false;
    const pending = q.dequeue().then((x) => {
      settled = true;
      return x;
    });

    // Give the pending dequeue a chance to settle if it were going to.
    await Promise.resolve();
    expect(settled).toBe(false);

    q.enqueue("hello");
    expect(await pending).toBe("hello");
  });

  test("multiple simultaneous waiters each get one distinct item", async () => {
    const q = new AwaitableQueue<number>();

    const waiters = [q.dequeue(), q.dequeue(), q.dequeue()];

    q.enqueue(10);
    q.enqueue(20);
    q.enqueue(30);

    // Every waiter resolves, and no item is handed out twice. The order in
    // which the waiters wake up is not part of the contract, so sort.
    const results = await Promise.all(waiters);
    expect([...results].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  test("a waiter woken with the queue still empty goes back to waiting", async () => {
    const q = new AwaitableQueue<number>();

    const first = q.dequeue();
    const second = q.dequeue();

    // Only one item for two waiters: one resolves, the other keeps waiting.
    q.enqueue(1);
    expect(await first).toBe(1);

    let secondSettled = false;
    void second.then(() => (secondSettled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    q.enqueue(2);
    expect(await second).toBe(2);
  });

  test("the queue is drained as items are taken", async () => {
    const q = new AwaitableQueue<number>();
    q.enqueue(1);
    q.enqueue(2);
    expect(q._buffer).toEqual([1, 2]);

    await q.dequeue();
    expect(q._buffer).toEqual([2]);

    await q.dequeue();
    expect(q._buffer).toEqual([]);
  });
});
