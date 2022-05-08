import {
  loadPackagesFromImports,
  PyProxyWithGet,
  PyProxyWithSet,
  PyProxyIterable,
  Py2JsResult,
} from "../shinylive/pyodide/pyodide";

import type * as PyodideWorker from "./pyodide-worker";

import { openChannel } from "./messageportwebsocket-channel";
import { ASGIHTTPRequestScope, makeRequest } from "./messageporthttp.js";
import * as utils from "./utils";

type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

export type ProxyType = "webworker" | "normal";

export type ResultType = "value" | "printed_value" | "to_html" | "none";

export type ToHtmlResult = {
  type: "html" | "text";
  content: string;
};

// =============================================================================
// PyodideProxy interface
// =============================================================================
export interface PyodideProxy {
  // globals: PyProxy;
  // FS: any;
  // pyodide_py: PyProxy;
  // version: string;
  // loadPackage: typeof loadPackage;
  loadPackagesFromImports: typeof loadPackagesFromImports;
  // loadedPackages: any;
  // isPyProxy: typeof isPyProxy;
  // runPython: typeof runPython;

  proxyType: () => ProxyType;

  // - returnResult: Should the function return the result from the Python code?
  //     If so, it will be translated to a JS object. This translation works for
  //     simple objects like numbers, strings, and lists and dicts consisting of
  //     numbers and strings, but it will fail for most objects which are
  //     instances of classes and don't have an straightforward translation to
  //     JS. This limitation exists because, when pyodide is run in a Web
  //     Worker, the PyProxy object which is returned by
  //     pyodide.runPythonAsync() cannot be sent back to the main thread. (Note
  //     that despite the similar names, PyProxy != PyodideProxy, and
  //     pyodide.runPythonAsync != PyodideProxy.runPythonAsync; the former in
  //     each of those pairs comes from Pyodide itself, and the latter in each
  //     pair comes from this class.)
  // - printResult: Should the result be printed using the stdout method which
  //     was passed to loadPyodide()?
  runPythonAsync: (
    code: string,
    {
      returnResult,
      printResult,
    }?: { returnResult?: ResultType; printResult?: boolean }
  ) => Promise<any>;
  tabComplete: (code: string) => Promise<string[]>;
  // registerJsModule: typeof registerJsModule;
  // unregisterJsModule: typeof unregisterJsModule;
  // setInterruptBuffer: typeof setInterruptBuffer;
  // toPy: typeof toPy;
  // registerComlink: typeof registerComlink;
  // PythonError: typeof PythonError;
  // PyBuffer: typeof PyBuffer;
  callPy: (
    fn_name: string[],
    args: any[],
    kwargs: { [x: string]: any }
  ) => Promise<void>;

  openChannel: (
    path: string,
    appName: string,
    clientPort: MessagePort
  ) => Promise<void>;
  makeRequest: (
    scope: ASGIHTTPRequestScope,
    appName: string,
    clientPort: MessagePort
  ) => Promise<void>;
}

export interface LoadPyodideConfig {
  indexURL: string;
  fullStdLib?: boolean;
  stdin?: () => string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

// =============================================================================
// NormalPyodideProxy
// =============================================================================
class NormalPyodideProxy implements PyodideProxy {
  pyodide!: Pyodide;
  // A proxy to Python's repr() function. When defined later on, it's actually a
  // PyProxyCallable object.
  repr: (x: any) => string = function (x: any) {
    return "";
  };
  declare tabComplete_: (x: string) => PyProxyIterable;

  declare toHtml: (x: any) => ToHtmlResult;

  constructor(
    private stdoutCallback: (text: string) => void,
    private stderrCallback: (text: string) => void
  ) {}

  async init(config: LoadPyodideConfig) {
    this.pyodide = await loadPyodide(config);

    this.repr = this.pyodide.globals.get("repr") as (x: any) => string;

    // Make the JS pyodide object available in Python.
    this.pyodide.globals.set("js_pyodide", this.pyodide);

    // Need these `as` casts because the type declaration of runPythonAsync in
    // pyodide is incorrect.
    const pyconsole = await (this.pyodide.runPythonAsync(`
      import pyodide.console
      import __main__
      pyodide.console.PyodideConsole(__main__.__dict__)
    `) as Promise<any>);

    this.tabComplete_ = pyconsole.complete.copy() as (
      x: string
    ) => PyProxyIterable;

    this.toHtml = await (this.pyodide.runPythonAsync(`
      def _to_html(x):
        if hasattr(x, 'to_html'):
          return { "type": "html", "content": x.to_html() }

        if "matplotlib" in sys.modules:
          import matplotlib.figure
          if isinstance(x, matplotlib.figure.Figure):
            import io
            import base64
            img = io.BytesIO()
            x.savefig(img, format='png', bbox_inches='tight')
            img.seek(0)
            img_encoded = base64.b64encode(img.getvalue())
            img_html = '<img src="data:image/png;base64, {}">'.format(img_encoded.decode('utf-8'))
            return { "type": "html", "content": img_html }

        return { "type": "text", "content": repr(x) }

      _to_html
    `) as Promise<(x: any) => ToHtmlResult>);

    this.stdoutCallback(pyconsole.BANNER);
    pyconsole.destroy();

    // Inject the callJS function into the global namespace.
    this.pyodide.globals.set("callJS", this.callJS);
  }

  loadPackagesFromImports(code: string) {
    return this.pyodide.loadPackagesFromImports(code);
  }

  proxyType(): ProxyType {
    return "normal";
  }

  async runPythonAsync(
    code: string,
    {
      returnResult = "none",
      printResult = true,
    }: { returnResult?: ResultType; printResult?: boolean } = {}
  ): Promise<any> {
    await this.pyodide.loadPackagesFromImports(code);
    let result;
    try {
      result = await (this.pyodide.runPythonAsync(
        code
      ) as Promise<Py2JsResult>);
    } catch (err) {
      this.stderrCallback((err as Error).message);
      return;
    }

    if (result !== undefined) {
      if (printResult) {
        this.stdoutCallback(this.repr(result));
      }

      if (returnResult === "value") {
        if (this.pyodide.isPyProxy(result)) {
          // If `result` is a PyProxy, we need to explicitly convert to JS.
          const value = result.toJs();
          result.destroy();
          return value;
        } else {
          // If `result` is just a simple value, return it unchanged.
          return result;
        }
      } else if (returnResult === "to_html") {
        return (this.toHtml(result) as Py2JsResult).toJs({
          dict_converter: Object.fromEntries,
        });
      } else if (returnResult === "printed_value") {
        return this.repr(result);
      }
    }
  }

  tabComplete(code: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      resolve(this.tabComplete_(code).toJs()[0]);
    });
  }

  async callPy(
    fn_name: string[],
    args: any[] = [],
    kwargs: { [x: string]: any } = {}
  ): Promise<void> {
    // fn_name is something like ["os", "path", "join"]. Get the first
    // element, then descend into it.
    let fn = this.pyodide.globals.get(fn_name[0]);
    for (const el of fn_name.slice(1)) {
      fn = fn[el];
    }

    const result = await fn.callKwargs(...args, kwargs);
    return result;
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
    fn_name: PyProxyIterable,
    args: PyProxyIterable
  ): Promise<any> {
    let fn = globalThis as any;
    for (const el of fn_name.toJs()) {
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
        for (const el of msg.fn_name) {
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

  // Asynchronously run Python code and return the value returned from Python.
  // If an error occurs, pass the error message to this.stderrCallback() and
  // return undefined.
  async runPythonAsync(
    code: string,
    {
      returnResult = "none",
      printResult = true,
    }: { returnResult?: ResultType; printResult?: boolean } = {}
  ): Promise<any> {
    const response = (await this.postMessageAsync({
      type: "runPythonAsync",
      code,
      returnResult,
      printResult,
    })) as PyodideWorker.ReplyMessageDone;

    if (response.error) {
      this.stderrCallback(response.error.message);
      return;
    }

    return response.value;
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

  async callPy(
    fn_name: string[],
    args: any[] = [],
    kwargs: { [x: string]: any } = {}
  ): Promise<void> {
    await this.postMessageAsync({
      type: "callPy",
      fn_name,
      args,
      kwargs,
    });
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
