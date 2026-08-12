// Globals that every browser shinylive supports has, but that jsdom does not
// implement. Without these, code under test fails on the polyfill rather than
// on the behaviour we're asserting.

// https://github.com/jsdom/jsdom/issues/2524
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextDecoder, TextEncoder } = require("node:util");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// https://github.com/jsdom/jsdom/issues/3363
// v8's structured serialization is the same algorithm the real
// `structuredClone()` uses, so this is a faithful stand-in for plain data.
if (typeof globalThis.structuredClone === "undefined") {
  const v8 = require("node:v8");
  globalThis.structuredClone = (value) => v8.deserialize(v8.serialize(value));
}

// jsdom implements neither MessageChannel nor MessagePort. Node's are the same
// shape for what we use -- `postMessage()`, the `onmessage` setter and
// `close()` -- so code that hands a port to a worker can be tested for real
// rather than against a mock of the thing under test.
if (typeof globalThis.MessageChannel === "undefined") {
  const { MessageChannel, MessagePort } = require("node:worker_threads");
  globalThis.MessageChannel = MessageChannel;
  globalThis.MessagePort = MessagePort;
}
