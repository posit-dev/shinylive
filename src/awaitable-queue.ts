// A queue with an async dequeue operation
export class AwaitableQueue<T> {
  _buffer: Array<T> = [];
  _promise: Promise<void>;
  _resolve: () => void;

  constructor() {
    // make TS compiler happy
    this._resolve = null as any;
    this._promise = null as any;

    // Actually initialize _promise and _resolve
    this._notifyAll();
  }

  async _wait() {
    await this._promise;
  }

  _notifyAll() {
    if (this._resolve) {
      this._resolve();
    }
    this._promise = new Promise((resolve) => (this._resolve = resolve));
  }

  async dequeue(): Promise<T> {
    // Must use a while-loop here, there might be multiple callers waiting to
    // deqeueue simultaneously
    while (this._buffer.length === 0) {
      await this._wait();
    }
    return this._buffer.shift()!;
  }

  enqueue(x: T): void {
    this._buffer.push(x);
    this._notifyAll();
  }
}
