// Location of pyodide.js relative to the output directory for the generated .js
// file.
importScripts("./pyodide/pyodide.js");

import type { LoadPyodideConfig, ResultType } from "./pyodide-proxy";
import {
  PyProxyIterable,
  PyProxyWithGet,
  PyProxyWithSet,
  loadPyodide as loadPyodide_orig,
  Py2JsResult,
} from "../shinylive/pyodide/pyodide";
import { openChannel } from "./messageportwebsocket-channel";
import { ASGIHTTPRequestScope, makeRequest } from "./messageporthttp";

// This is needed in TypeScipt 4.4 and below; with 4.5 and up, it can be removed
// because Awaited is built into TypeScript.
type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

declare global {
  // Note: the original pyodide.d.ts file seems to be incorrect; loadPyodide is
  // globally available, but not exported.
  // eslint-disable-next-line no-var
  var loadPyodide: typeof loadPyodide_orig;
}

let pyodideStatus: "none" | "loading" | "loaded" = "none";
let pyodide: Pyodide;

// For run-time type checking. These are the results from a Python call that can
// be converted to a JS value, but only the basic types (no proxies). This is
// equivalent to the following TS type, except that we we use it at run time:
//    Exclude<Py2JsResult, PyProxy>
const Py2JsResultBasicTypenames = [
  "string",
  "number",
  "bigint",
  "boolean",
  "undefined",
];

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
//    data: {fn_name: ["foo", "bar"], args: ["a", 2], kwargs: {x: 3}}
// This translates to the following Python call:
//    foo.bar("a", 2, x=3)
export interface InMessageCallPy {
  type: "callPy";
  fn_name: string[];
  args: any[];
  kwargs: { [x: string]: any };
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
  | InMessageCallPy
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
function callJS(fn_name: PyProxyIterable, args: PyProxyIterable) {
  self.postMessage({
    type: "nonreply",
    subtype: "callJS",
    fn_name: fn_name.toJs() as string[],
    args: args.toJs() as any[],
  });
}

// =============================================================================
// A proxy to Python repr() function. This definition is just a placeholder.
// When defined later on, it's actually a PyProxyCallable object.
let repr: (x: any) => string = function (x: any) {
  return "";
};
// Placeholder Python pyodide.console.Console().complete() function
let tabComplete: (x: string) => PyProxyIterable;

self.onmessage = async function (e: MessageEvent): Promise<void> {
  const msg = e.data as InMessage;

  if (msg.type === "openChannel") {
    const clientPort = e.ports[0];
    openChannel(msg.path, msg.appName, clientPort, pyodide);
    return;
  } else if (msg.type === "makeRequest") {
    const clientPort = e.ports[0];
    makeRequest(msg.scope, msg.appName, clientPort, pyodide);
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

        repr = (pyodide.globals as PyProxyWithGet).get("repr") as unknown as (
          x: any
        ) => string;

        // Make the JS pyodide object available in Python.
        (pyodide.globals as PyProxyWithSet).set("js_pyodide", pyodide);

        const pyconsole = await (pyodide.runPythonAsync(`
          import pyodide.console
          import __main__
          pyodide.console.PyodideConsole(__main__.__dict__)
        `) as unknown as Promise<any>);

        tabComplete = pyconsole.complete.copy() as unknown as (
          x: string
        ) => PyProxyIterable;

        self.stdout_callback(pyconsole.BANNER);
        pyconsole.destroy();

        // Inject the callJS function into the global namespace.
        (pyodide.globals as PyProxyWithSet).set("callJS", callJS);

        pyodideStatus = "loaded";
      }

      messagePort.postMessage({ type: "reply", subtype: "done" });
    } else if (msg.type === "loadPackagesFromImports") {
      await pyodide.loadPackagesFromImports(msg.code);
    } else if (msg.type === "runPythonAsync") {
      await pyodide.loadPackagesFromImports(msg.code);

      // Need these `as` casts because the type declaration of runPythonAsync in
      // pyodide is incorrect.
      const result = await (pyodide.runPythonAsync(
        msg.code
      ) as unknown as Promise<Py2JsResult>);

      if (msg.printResult && result !== undefined) {
        self.stdout_callback(repr(result));
      }

      if (msg.returnResult === "value") {
        if (pyodide.isPyProxy(result)) {
          messagePort.postMessage({
            type: "reply",
            subtype: "done",
            value: result.toJs(),
          });
          result.destroy();
        } else if (Py2JsResultBasicTypenames.includes(typeof result)) {
          messagePort.postMessage({
            type: "reply",
            subtype: "done",
            value: result,
          });
        } else {
          // Shouldn't get here, but log it just in case.
          console.error("Don't know how to ");
          messagePort.postMessage({ type: "reply", subtype: "done" });
        }
      } else if (msg.returnResult === "printed_value") {
        messagePort.postMessage({
          type: "reply",
          subtype: "done",
          value: repr(result),
        });
      } else {
        messagePort.postMessage({ type: "reply", subtype: "done" });
      }
    } else if (msg.type === "tabComplete") {
      const completions: string[] = tabComplete(msg.code).toJs()[0];
      messagePort.postMessage({
        type: "reply",
        subtype: "tabCompletions",
        completions,
      });
    } else if (msg.type === "callPy") {
      const { fn_name, args, kwargs } = msg;
      // fn_name is something like ["os", "path", "join"]. Get the first
      // element with pyodide.globals.get(), then descend into it with [].
      let fn = (pyodide.globals as PyProxyWithGet).get(fn_name[0]) as any;
      for (const el of fn_name.slice(1)) {
        fn = fn[el];
      }

      fn.callKwargs(...args, kwargs);

      messagePort.postMessage({ type: "reply", subtype: "done" });
    } else {
      messagePort.postMessage({
        type: "reply",
        subtype: "done",
        error: new Error(`Unknown message type: ${(msg as any).toString()}`),
      });
    }
  } catch (e) {
    messagePort.postMessage({
      type: "reply",
      subtype: "done",
      error: e,
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
  fn_name: string[];
  args: any[];
}
