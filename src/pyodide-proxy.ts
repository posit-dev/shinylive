import { ASGIHTTPRequestScope, makeRequest } from "./messageporthttp.js";
import { openChannel } from "./messageportwebsocket-channel";
import { postableErrorObjectToError } from "./postable-error";
import type * as PyodideWorker from "./pyodide-worker";
import { loadPyodide } from "./pyodide/pyodide";
import type { Py2JsResult, PyProxyIterable } from "./pyodide/pyodide";
import * as utils from "./utils";

type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

export type ProxyType = "webworker" | "normal";

export type ResultType = "value" | "printed_value" | "to_html" | "none";

export type ToHtmlResult = {
  type: "html" | "text";
  value: string;
};

interface ReturnMapping {
  value: any;
  printed_value: string;
  to_html: ToHtmlResult;
  none: void;
}

// =============================================================================
// PyodideProxy interface
// =============================================================================
export interface PyodideProxy {
  // globals: PyProxy;
  // FS: any;
  // pyodide_py: PyProxy;
  // version: string;
  // loadPackage: typeof loadPackage;
  loadPackagesFromImports: Pyodide["loadPackagesFromImports"];
  // loadedPackages: any;
  // isPyProxy: typeof isPyProxy;
  // runPython: typeof runPython;

  proxyType(): ProxyType;

  tabComplete(code: string): Promise<string[]>;

  // - returnResult: Should the function return the result from the Python code?
  //     Possible values are "none", "value", "printed_value", and "to_html".
  //     - If "none" (the default), then the function will not return anything.
  //     - If "value", then the function will return the value from the Python
  //       code, translated to a JS object. This translation works for simple
  //       objects like numbers, strings, and lists and dicts consisting of
  //       numbers and strings, but it will fail for most objects which are
  //       instances of classes and don't have an straightforward translation to
  //       JS. This limitation exists because, when pyodide is run in a Web
  //       Worker, the PyProxy object which is returned by pyodide.runPyAsync()
  //       cannot be sent back to the main thread.
  //     - If "printed_value", then the function will call `repr()` on the
  //       value, and return the resulting string.
  //     - If "to_html", then the function will call try to convert the value
  //       to HTML, by calling `x._repr_html_()` on it, and then it will return
  //       a ToHtmlResult object. If it succeeded in convertint to HTML, then
  //       the ToHtmlResult object's `.type` property will be "html"; otherwise
  //       it will be "text".
  // - printResult: Should the result be printed using the stdout method which
  //     was passed to loadPyodide()?
  //
  // If an error occurs in the Python code, then this function will throw a JS
  // error.
  //
  // The complicated typing here is because the return type depends on the value
  // of `returnResult`. For more info:
  // https://stackoverflow.com/questions/72166620/typescript-conditional-return-type-using-an-object-parameter-and-default-values
  runPyAsync<K extends keyof ReturnMapping = "none">(
    code: string,
    { returnResult, printResult }?: { returnResult?: K; printResult?: boolean }
  ): Promise<ReturnMapping[K]>;

  // registerJsModule: typeof registerJsModule;
  // unregisterJsModule: typeof unregisterJsModule;
  // setInterruptBuffer: typeof setInterruptBuffer;
  // toPy: typeof toPy;
  // registerComlink: typeof registerComlink;
  // PythonError: typeof PythonError;
  // PyBuffer: typeof PyBuffer;
  callPyAsync({
    fnName,
    args,
    kwargs,
    returnResult,
    printResult,
  }: {
    fnName: string[];
    args?: any[];
    kwargs?: { [x: string]: any };
    returnResult?: ResultType;
    printResult?: boolean;
  }): Promise<any>;

  openChannel(
    path: string,
    appName: string,
    clientPort: MessagePort
  ): Promise<void>;
  makeRequest(
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ): Promise<void>;
}

export interface LoadPyodideConfig {
  indexURL: string;
  fullStdLib?: boolean;
  stdin?: () => string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

// =============================================================================
// PyUtils interface
// =============================================================================

// A set of proxies for Python functions that the are called from JS.
export interface PyUtils {
  repr: (x: any) => string;
  tabComplete: (x: string) => PyProxyIterable;
  shortFormatLastTraceback: () => string;
}

export async function setupPythonEnv(
  pyodide: Pyodide,
  callJS:
    | null
    | ((fnName: PyProxyIterable, args: PyProxyIterable) => Promise<any>)
): Promise<PyUtils> {
  const repr = pyodide.globals.get("repr") as (x: any) => string;

  // Make the JS pyodide object available in Python.
  pyodide.globals.set("js_pyodide", pyodide);

  const pyconsole = await pyodide.runPythonAsync(`
  import pyodide.console
  import __main__
  pyodide.console.PyodideConsole(__main__.__dict__)
  `);

  const tabComplete = pyconsole.complete.copy() as (
    x: string
  ) => PyProxyIterable;

  pyconsole.destroy();

  // Inject the callJS function into the Python global namespace.
  if (callJS) {
    pyodide.globals.set("callJS", callJS);
  }

  // This provides a more concise formatting of the last traceback. In the
  // future we may want to move to using Pyodide's ConsoleFuture for this.
  const shortFormatLastTraceback = await pyodide.runPythonAsync(`
  def _short_format_last_traceback() -> str:
      import sys
      import traceback
      e = sys.last_value
      found_marker = False
      nframes = 0
      for (frame, _) in traceback.walk_tb(e.__traceback__):
          if frame.f_code.co_filename in ("<console>", "<exec>"):
              found_marker = True
          if found_marker:
              nframes += 1
      return "".join(traceback.format_exception(type(e), e, e.__traceback__, -nframes))

  _short_format_last_traceback
  `);
  await pyodide.runPythonAsync(`del _short_format_last_traceback`);

  return {
    repr,
    tabComplete,
    shortFormatLastTraceback,
  };
}
// =============================================================================
// NormalPyodideProxy
// =============================================================================
class NormalPyodideProxy implements PyodideProxy {
  pyodide!: Pyodide;
  pyUtils!: PyUtils;

  constructor(
    private stdoutCallback: (text: string) => void,
    private stderrCallback: (text: string) => void
  ) {}

  async init(config: LoadPyodideConfig) {
    this.pyodide = await loadPyodide(config);

    this.pyUtils = await setupPythonEnv(this.pyodide, this.callJS);
  }

  loadPackagesFromImports(code: string) {
    return this.pyodide.loadPackagesFromImports(code);
  }

  proxyType(): ProxyType {
    return "normal";
  }

  tabComplete(code: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      resolve(this.pyUtils.tabComplete(code).toJs()[0]);
    });
  }

  // https://stackoverflow.com/questions/72166620/typescript-conditional-return-type-using-an-object-parameter-and-default-values
  async runPyAsync<K extends keyof ReturnMapping = "none">(
    code: string,
    {
      returnResult = "none" as K,
      printResult = false,
    }: { returnResult?: K; printResult?: boolean } = {
      returnResult: "none" as K,
      printResult: false,
    }
  ): Promise<ReturnMapping[K]> {
    await this.pyodide.loadPackagesFromImports(code);
    let result: Py2JsResult;
    try {
      result = await (this.pyodide.runPythonAsync(
        code
      ) as Promise<Py2JsResult>);
    } catch (err) {
      if (err instanceof this.pyodide.PythonError) {
        const shortTraceback = this.pyUtils.shortFormatLastTraceback();
        err.message = shortTraceback;
      }
      this.stderrCallback((err as Error).message);
      throw err;
    }

    if (printResult && result !== undefined) {
      this.stdoutCallback(this.pyUtils.repr(result));
    }

    try {
      return processReturnValue(
        result,
        returnResult,
        this.pyodide,
        this.pyUtils.repr
      );
    } finally {
      if (this.pyodide.isPyProxy(result)) {
        result.destroy();
      }
    }
  }

  async callPyAsync<K extends keyof ReturnMapping = "none">({
    fnName,
    args = [],
    kwargs = {},
    returnResult = "none" as K,
    printResult = false,
  }: {
    fnName: string[];
    args: any[];
    kwargs: { [x: string]: any };
    returnResult: K;
    printResult: boolean;
  }): Promise<ReturnMapping[K]> {
    // fnName is something like ["os", "path", "join"]. Get the first
    // element, then descend into it.
    let fn = this.pyodide.globals.get(fnName[0]);
    for (const el of fnName.slice(1)) {
      fn = fn[el];
    }

    // If fn is an async function, this will return a Promise; if it is a normal
    // function, it will reutrn a normal value.
    const resultMaybePromise = fn.callKwargs(...args, kwargs);
    // This will convert non-Promises to Promises, and then await them.
    const result = await Promise.resolve(resultMaybePromise);

    if (printResult && result !== undefined) {
      this.stdoutCallback(this.pyUtils.repr(result));
    }

    try {
      return processReturnValue(
        result,
        returnResult,
        this.pyodide,
        this.pyUtils.repr
      );
    } finally {
      if (this.pyodide.isPyProxy(result)) {
        result.destroy();
      }
    }
  }

  async openChannel(
    path: string,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    openChannel(path, appName, clientPort, this.pyodide);
  }

  async makeRequest(
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    makeRequest(scope, appName, clientPort, this.pyodide);
  }

  public static async build(
    config: LoadPyodideConfig,
    stdoutCallback: (text: string) => void,
    stderrCallback: (text: string) => void
  ): Promise<NormalPyodideProxy> {
    const proxy = new NormalPyodideProxy(stdoutCallback, stderrCallback);

    await proxy.init({
      ...config,
      stdout: stdoutCallback,
      stderr: stderrCallback,
    });
    return proxy;
  }

  // A function for Python to invoke JS functions in the main thread by name.
  // Can be called from Python with:
  //   import js
  //   js.callJS(["foo", "bar"], ["a", 2])
  // which is equivalent to the following JS call:
  //   foo.bar("a", 2)
  // This function gets injected into the Python global namespace.
  private async callJS(
    fnName: PyProxyIterable,
    args: PyProxyIterable
  ): Promise<any> {
    let fn = globalThis as any;
    for (const el of fnName.toJs()) {
      fn = fn[el];
    }
    return fn(...args.toJs());
  }
}

// =============================================================================
// WebWorkerPyodideProxy
// =============================================================================

// Narrow the types for postMessage to just the type we'll actually send.
interface PyodideWebWorker extends Omit<Worker, "postMessage"> {
  postMessage(msg: PyodideWorker.InMessage, transfer: Transferable[]): void;
}

class WebWorkerPyodideProxy implements PyodideProxy {
  pyWorker: PyodideWebWorker;

  constructor(
    private stdoutCallback: (text: string) => void,
    private stderrCallback: (text: string) => void
  ) {
    this.pyWorker = new Worker(utils.currentScriptDir() + "/pyodide-worker.js");

    this.pyWorker.onmessage = (e) => {
      const msg = e.data as PyodideWorker.NonReplyMessage;
      if (msg.subtype === "output") {
        if (msg.stdout) this.stdoutCallback(msg.stdout);
        if (msg.stderr) this.stderrCallback(msg.stderr);
      } else if (msg.subtype === "callJS") {
        let fn = self as any;
        for (const el of msg.fnName) {
          fn = fn[el];
        }
        fn = fn as (...args: any[]) => any;
        fn(...msg.args);
      }
    };
  }

  async init(config: LoadPyodideConfig): Promise<void> {
    await this.postMessageAsync({
      type: "init",
      config,
    });
  }

  proxyType(): ProxyType {
    return "webworker";
  }

  // A wrapper for this.pyWorker.postMessage(). Unlike that function, which
  // returns void immediately, this function returns a promise, which resolves
  // when a ReplyMessage is received from the worker.
  async postMessageAsync(
    msg: PyodideWorker.InMessage
  ): Promise<PyodideWorker.ReplyMessage> {
    return new Promise((onSuccess) => {
      const channel = new MessageChannel();

      channel.port1.onmessage = (e) => {
        channel.port1.close();
        const msg = e.data as PyodideWorker.ReplyMessage;
        onSuccess(msg);
      };

      this.pyWorker.postMessage(msg, [channel.port2]);
    });
  }

  async loadPackagesFromImports(code: string): Promise<void> {
    await this.postMessageAsync({
      type: "loadPackagesFromImports",
      code,
    });
  }

  async tabComplete(code: string): Promise<string[]> {
    let msg = await this.postMessageAsync({
      type: "tabComplete",
      code,
    });

    msg = msg as PyodideWorker.ReplyMessage;
    if (msg.subtype !== "tabCompletions") {
      throw new Error(
        `Unexpected message type. Expected type 'tabCompletions', got type '${msg.subtype}'`
      );
    }
    return msg.completions;
  }

  // Asynchronously run Python code and return the value returned from Python.
  // If an error occurs, pass the error message to this.stderrCallback() and
  // return undefined.
  async runPyAsync<K extends keyof ReturnMapping = "none">(
    code: string,
    {
      returnResult = "none" as K,
      printResult = false,
    }: { returnResult?: K; printResult?: boolean } = {
      returnResult: "none" as K,
      printResult: false,
    }
  ): Promise<ReturnMapping[K]> {
    const response = (await this.postMessageAsync({
      type: "runPythonAsync",
      code,
      returnResult,
      printResult,
    })) as PyodideWorker.ReplyMessageDone;

    if (response.error) {
      const err = postableErrorObjectToError(response.error);
      this.stderrCallback(err.message);
      throw err;
    }

    return response.value;
  }

  async callPyAsync({
    fnName,
    args = [],
    kwargs = {},
    returnResult = "none",
    printResult = false,
  }: {
    fnName: string[];
    args: any[];
    kwargs: { [x: string]: any };
    returnResult: ResultType;
    printResult: boolean;
  }): Promise<any> {
    const response = (await this.postMessageAsync({
      type: "callPyAsync",
      fnName,
      args,
      kwargs,
      returnResult,
      printResult,
    })) as PyodideWorker.ReplyMessageDone;

    if (response.error) {
      const err = postableErrorObjectToError(response.error);
      this.stderrCallback(err.message);
      throw err;
    }

    return response.value;
  }

  async openChannel(
    path: string,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    return this.pyWorker.postMessage({ type: "openChannel", path, appName }, [
      clientPort,
    ]);
  }

  async makeRequest(
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ): Promise<void> {
    return this.pyWorker.postMessage({ type: "makeRequest", scope, appName }, [
      clientPort,
    ]);
  }

  // The reason we have this build() method is because the class constructor
  // can't be async, but there is some async stuff that needs to happen in the
  // initialization. The solution is to have this static async build() method,
  // which can call the synchronous constructor, then invoke the async parts of
  // initialization.
  public static async build(
    config: LoadPyodideConfig,
    stdoutCallback: (text: string) => void,
    stderrCallback: (text: string) => void
  ): Promise<WebWorkerPyodideProxy> {
    const proxy = new WebWorkerPyodideProxy(stdoutCallback, stderrCallback);
    await proxy.init(config);
    return proxy;
  }
}

// =============================================================================
//
// =============================================================================
export function loadPyodideProxy(
  config: LoadPyodideConfig & { type: "normal" | "webworker" },
  stdoutCallback: (text: string) => void = console.log,
  stderrCallback: (text: string) => void = console.error
): Promise<PyodideProxy> {
  if (config.type === "normal") {
    return NormalPyodideProxy.build(config, stdoutCallback, stderrCallback);
  } else if (config.type === "webworker") {
    return WebWorkerPyodideProxy.build(config, stdoutCallback, stderrCallback);
  } else {
    throw new Error("Unknown type");
  }
}

// =============================================================================
// Utility functions
// =============================================================================

// Given the return value from a callPyAsync or runPyAsync, process the return
// value according to the returnResult parameter.
// https://stackoverflow.com/questions/72166620/typescript-conditional-return-type-using-an-object-parameter-and-default-values
export function processReturnValue<K extends keyof ReturnMapping = "none">(
  value: Py2JsResult,
  returnResult = "none" as K,
  pyodide: Pyodide,
  repr: (x: any) => string
): ReturnMapping[K] {
  const possibleReturnValues = {
    get value() {
      if (pyodide.isPyProxy(value)) {
        // If `result` is a PyProxy, we need to explicitly convert to JS.
        return value.toJs();
      } else {
        // If `result` is just a simple value, return it unchanged.
        return value;
      }
    },
    get printed_value() {
      return repr(value);
    },
    get to_html() {
      let toHtml: (x: any) => ToHtmlResult;
      try {
        toHtml = pyodide.globals.get("_to_html") as (x: any) => ToHtmlResult;
      } catch (e) {
        console.error("Couldn't find _to_html function: ", e);
        // Placeholder
        toHtml = (x: any) => ({
          type: "text",
          value: "Couldn't finding _to_html function.",
        });
      }
      const val = (toHtml(value) as Py2JsResult).toJs({
        dict_converter: Object.fromEntries,
      });
      return val;
    },
    get none() {
      return undefined;
    },
  };

  return possibleReturnValues[returnResult];
}
