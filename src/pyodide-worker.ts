import { ASGIHTTPRequestScope, makeRequest } from "./messageporthttp";
import { openChannel } from "./messageportwebsocket-channel";
import { errorToPostableErrorObject } from "./postable-error";
import type { LoadPyodideConfig, PyUtils, ResultType } from "./pyodide-proxy";
import { processReturnValue, setupPythonEnv } from "./pyodide-proxy";
import type { Py2JsResult, PyProxyIterable } from "./pyodide/pyodide";
import { loadPyodide } from "./pyodide/pyodide";

type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

let pyodideStatus: "none" | "loading" | "loaded" = "none";
let pyodide: Pyodide;

// This top-level Web Worker object (viewed from the inside).
interface PyodideWebWorkerInside
  extends Omit<DedicatedWorkerGlobalScope, "postMessage"> {
  postMessage(msg: NonReplyMessage): void;
  stdout_callback: (s: string) => void;
  stderr_callback: (s: string) => void;
}
declare let self: PyodideWebWorkerInside;

// =============================================================================
// Input message types
// =============================================================================
interface InMessageInit {
  type: "init";
  config: LoadPyodideConfig;
}

// Incoming message that contains Python code as text.
export interface InMessageLoadPackagesFromImports {
  type: "loadPackagesFromImports";
  code: string;
}

// Incoming message that contains Python code as text.
export interface InMessageRunPythonAsync {
  type: "runPythonAsync";
  code: string;
  returnResult: ResultType;
  printResult: boolean;
}

export interface InMessageTabComplete {
  type: "tabComplete";
  code: string;
}

// Incoming message that contains the name of a python object, and an argument
// to pass to it. For example, if the data component looks like:
//    data: {fnName: ["foo", "bar"], args: ["a", 2], kwargs: {x: 3}}
// This translates to the following Python call:
//    foo.bar("a", 2, x=3)
export interface InMessageCallPyAsync {
  type: "callPyAsync";
  fnName: string[];
  args: any[];
  kwargs: { [x: string]: any };
  returnResult: ResultType;
  printResult: boolean;
}

export interface InMessageOpenChannel {
  type: "openChannel";
  path: string;
  appName: string;
}

export interface InMessageMakeRequest {
  type: "makeRequest";
  scope: ASGIHTTPRequestScope;
  appName: string;
}

export type InMessage =
  | InMessageInit
  | InMessageLoadPackagesFromImports
  | InMessageRunPythonAsync
  | InMessageTabComplete
  | InMessageCallPyAsync
  | InMessageOpenChannel
  | InMessageMakeRequest;

// =============================================================================
self.stdout_callback = function (s: string) {
  self.postMessage({ type: "nonreply", subtype: "output", stdout: s });
};
self.stderr_callback = function (s: string) {
  self.postMessage({ type: "nonreply", subtype: "output", stderr: s });
};

// =============================================================================
// A function for Python to invoke JS functions in the main thread by name.
// =============================================================================
// Can be called from Python with:
//   import js
//   js.callJS(["foo", "bar"], ["a", 2])
// which is equivalent to the following JS call:
//   foo.bar("a", 2)
// This function gets injected into the Python global namespace.
async function callJS(fnName: PyProxyIterable, args: PyProxyIterable) {
  self.postMessage({
    type: "nonreply",
    subtype: "callJS",
    fnName: fnName.toJs() as string[],
    args: args.toJs() as any[],
  });
}

let pyUtils: PyUtils;

self.onmessage = async function (e: MessageEvent): Promise<void> {
  const msg = e.data as InMessage;

  if (msg.type === "openChannel") {
    const clientPort = e.ports[0];
    await openChannel(msg.path, msg.appName, clientPort, pyodide);
    return;
  } else if (msg.type === "makeRequest") {
    const clientPort = e.ports[0];
    await makeRequest(msg.scope, msg.appName, clientPort, pyodide);
    return;
  }

  const messagePort: ReplyMesssagePort = e.ports[0];
  try {
    if (msg.type === "init") {
      // Ensure we only try to load pyodide once.
      if (pyodideStatus === "none") {
        pyodideStatus = "loading";

        pyodide = await loadPyodide({
          ...msg.config,
          stdout: self.stdout_callback,
          stderr: self.stderr_callback,
        });

        pyUtils = await setupPythonEnv(pyodide, callJS);

        pyodideStatus = "loaded";
      }

      messagePort.postMessage({ type: "reply", subtype: "done" });
    }
    //
    else if (msg.type === "loadPackagesFromImports") {
      await pyodide.loadPackagesFromImports(msg.code);
    }
    //
    else if (msg.type === "runPythonAsync") {
      await pyodide.loadPackagesFromImports(msg.code);

      const result = await (pyodide.runPythonAsync(
        msg.code
      ) as Promise<Py2JsResult>);

      if (msg.printResult && result !== undefined) {
        self.stdout_callback(pyUtils.repr(result));
      }

      try {
        const processedResult = processReturnValue(
          result,
          msg.returnResult,
          pyodide,
          pyUtils.repr
        );

        messagePort.postMessage({
          type: "reply",
          subtype: "done",
          value: processedResult,
        });
      } finally {
        if (pyodide.isPyProxy(result)) {
          result.destroy();
        }
      }
    }
    //
    else if (msg.type === "tabComplete") {
      const completions: string[] = pyUtils.tabComplete(msg.code).toJs()[0];
      messagePort.postMessage({
        type: "reply",
        subtype: "tabCompletions",
        completions,
      });
    }
    //
    else if (msg.type === "callPyAsync") {
      const { fnName: fnName, args, kwargs } = msg;
      // fnName is something like ["os", "path", "join"]. Get the first
      // element with pyodide.globals.get(), then descend into it with [].
      let fn = pyodide.globals.get(fnName[0]);
      for (const el of fnName.slice(1)) {
        fn = fn[el];
      }

      // If fn is an async function, this will return a Promise; if it is a normal
      // function, it will reutrn a normal value.
      const resultMaybePromise = fn.callKwargs(...args, kwargs);
      // This will convert non-Promises to Promises, and then await them.
      const result = await Promise.resolve(resultMaybePromise);

      if (msg.printResult && result !== undefined) {
        self.stdout_callback(pyUtils.repr(result));
      }

      try {
        const processedResult = processReturnValue(
          result,
          msg.returnResult,
          pyodide,
          pyUtils.repr
        );

        messagePort.postMessage({
          type: "reply",
          subtype: "done",
          value: processedResult,
        });
      } finally {
        if (pyodide.isPyProxy(result)) {
          result.destroy();
        }
      }
    }
    //
    else {
      messagePort.postMessage({
        type: "reply",
        subtype: "done",
        error: new Error(`Unknown message type: ${(msg as any).toString()}`),
      });
    }
  } catch (e) {
    if (e instanceof pyodide.PythonError) {
      e.message = pyUtils.shortFormatLastTraceback();
    }

    messagePort.postMessage({
      type: "reply",
      subtype: "done",
      error: errorToPostableErrorObject(e),
    });
  }
};

interface ReplyMesssagePort extends Omit<MessagePort, "postMessage"> {
  postMessage(msg: ReplyMessage): void;
}

// A ReplyMessage is one that's sent back to the main thread in response to an
// InMessage. When the main thread receives the ReplyMessage, it knows that
// whatever task it requested (by sending the InMessage) has finished.
export type ReplyMessage = ReplyMessageDone | ReplyMessageTabCompletions;

// A message sent to the main thread which indicates that the worker has
// finished its work. It may also contain a value and/or an error message.
export interface ReplyMessageDone {
  type: "reply";
  subtype: "done";
  value?: any;
  error?: any;
}

export interface ReplyMessageTabCompletions {
  type: "reply";
  subtype: "tabCompletions";
  completions: string[];
  error?: any;
}

// A NonReplyMessage is one that's sent to the main thread, but not (directly)
// in response to an InMessage. For example, if Python is running async code in
// a background task and it prints an error message, then this message can be
// sent to the main thread via a NonReplyMessage.
export type NonReplyMessage = NonReplyMessageOutput | NonReplyMessageCallJS;

export interface NonReplyMessageOutput {
  type: "nonreply";
  subtype: "output";
  stdout?: string;
  stderr?: string;
}

export interface NonReplyMessageCallJS {
  type: "nonreply";
  subtype: "callJS";
  fnName: string[];
  args: any[];
}
