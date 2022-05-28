import React, { useEffect } from "react";
import { loadPyodideProxy, ProxyType, PyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";

export type PyodideProxyHandle =
  | {
      ready: false;
      shinyReady: false;
      initError: false;
    }
  | {
      ready: true;
      pyodide: PyodideProxy;
      shinyReady: boolean;
      initError: boolean;
      // Run code directly with Pyodide. (Output will print in the terminal.)
      runCode: (command: string) => Promise<void>;
      tabComplete: (command: string) => Promise<string[]>;
    };

// =============================================================================
// initPyodide
// =============================================================================
export async function initPyodide({
  proxyType = "webworker",
  stdout,
  stderr,
}: {
  proxyType?: ProxyType;
  stdout?: (msg: string) => Promise<void>;
  stderr?: (msg: string) => void;
}): Promise<PyodideProxyHandle> {
  // Defaults for stdout and stderr if not provided: log to console
  if (!stdout) stdout = async (x: string) => console.log("pyodide echo:" + x);
  if (!stderr) stderr = (x: string) => console.error("pyodide error:" + x);

  if (proxyType === "normal") {
    // This dynamic import has the same effect as having this tag in the html,
    // except that it is conditional on being in normal (non-webworker) mode:
    // <script src="./pyodide/pyodide.js"></script>
    // It will make loadPyodide available at the top level. The reason it's here
    // is because loading it is unnecessary in webworker mode.
    const pyodide_js_path = "./pyodide/pyodide.js";
    await import(pyodide_js_path);
  }

  const pyodideProxy = await loadPyodideProxy(
    {
      type: proxyType,
      indexURL: utils.currentScriptDir() + "/pyodide/",
    },
    stdout,
    stderr
  );

  // Public functions
  async function runCode(command: string) {
    try {
      await pyodideProxy.runPyAsync(command);
    } catch (e) {
      if (e instanceof Error) {
        // outputCallbacks.stderr(e.message);
        console.error(e.message);
      } else {
        console.error(e);
      }
    }
  }

  async function tabComplete(code: string): Promise<string[]> {
    return await pyodideProxy.tabComplete(code);
  }

  return {
    ready: true,
    pyodide: pyodideProxy,
    shinyReady: false,
    initError: false,
    runCode,
    tabComplete,
  };
}

// =============================================================================
// initShiny
// =============================================================================
// This is to be called after initPyodide(), as in:
//   pyodideProxyHandle = await initPyodide({ ... })
//   pyodideProxyHandle = await initShiny({ pyodideProxyHandle })
export async function initShiny({
  pyodideProxyHandle,
}: {
  pyodideProxyHandle: PyodideProxyHandle;
}): Promise<PyodideProxyHandle> {
  if (!pyodideProxyHandle.ready) {
    throw new Error("pyodideProxyHandle is not ready");
  }

  const pyodideProxy = pyodideProxyHandle.pyodide;
  ensureOpenChannelListener(pyodideProxy);

  try {
    // One-time initialization of Python session
    await pyodideProxy.runPyAsync(load_python_pre);

    if (pyodideProxy.proxyType() === "webworker") {
      // With a WebWorker, matplotlib needs to use the AGG backend instead of
      // the default Canvas one.
      await pyodideProxy.runPyAsync(`
        print("Initializing AGG backend for plotting...")
        import os
        os.environ['MPLBACKEND'] = 'AGG'
    `);
    }

    await pyodideProxy.runPyAsync(load_python_modules);
  } catch (e) {
    console.error(e);
    return {
      ...pyodideProxyHandle,
      initError: true,
    };
  }

  return {
    ...pyodideProxyHandle,
    shinyReady: true,
  };
}

// =============================================================================
// usePyodide
// =============================================================================
export function usePyodide({
  pyodideProxyHandlePromise,
}: {
  pyodideProxyHandlePromise: Promise<PyodideProxyHandle>;
}) {
  const [pyodideProxyHandle, setPyodideProxyHandle] =
    React.useState<PyodideProxyHandle>({
      ready: false,
      shinyReady: false,
      initError: false,
    });

  useEffect(() => {
    (async () => {
      const pyodideProxyHandle = await pyodideProxyHandlePromise;
      setPyodideProxyHandle(pyodideProxyHandle);
    })();
  }, [pyodideProxyHandlePromise]);

  return pyodideProxyHandle;
}

// =============================================================================
// Python code for setting up session
// =============================================================================
const load_python_pre = `
def mock_ssl():
    import sys
    import types

    class SSLContext:
        pass
    class SSLObject:
        pass
    class MemoryBIO:
        pass

    m = types.ModuleType("ssl")
    m.SSLContext = SSLContext
    m.SSLObject = SSLObject
    m.MemoryBIO = MemoryBIO
    sys.modules["ssl"] = m

mock_ssl()


def mock_ipykernel():
    import sys
    import types

    mods = sys.modules

    class MockKernel:
        def __init__(self):
            self.comm_manager = CommManager()

    class Comm:
        pass

    class CommManager:
        def register_target(self, *args):
            pass

    m = types.ModuleType("ipykernel")
    m.kernel = MockKernel()
    mods["ipykernel"] = m

    m = types.ModuleType("ipykernel.comm")
    m.Comm = Comm
    m.CommManager = CommManager
    mods["ipykernel.comm"] = m


def mock_ipython():
    import sys
    import types

    mods = sys.modules

    def get_ipython():
        import ipykernel

        return ipykernel.kernel

    m = types.ModuleType("IPython")
    m.get_ipython = get_ipython
    mods["IPython"] = m

    mods["IPython.core"] = types.ModuleType("IPython.core")

    m = types.ModuleType("IPython.core.getipython")
    m.get_ipython = get_ipython
    mods["IPython.core.getipython"] = m

    m = types.ModuleType("IPython.core.interactiveshell")
    m.InteractiveShell = "Mock"
    mods["IPython.core.interactiveshell"] = m

    m = types.ModuleType("IPython.display")
    m.display = "Mock"
    m.clear_output = "Mock"
    mods["IPython.display"] = m

    import IPython

mock_ipykernel()
mock_ipython()
`;

const load_python_modules = `
print("Loading modules...")
import asyncio
import sys

# Add current directory to Python path.
sys.path.insert(0, "")

# Function for saving Shiny app files so we can load the app as a module.
def _save_files(files: list[dict[str, str]], destdir: str) -> None:
    import shutil
    import base64
    import pyodide
    # If called from JS and passed an Object, we need to convert it to a
    # dict.
    if isinstance(files, pyodide.JsProxy):
        files = files.to_py()

    import os
    if os.path.exists(destdir):
        shutil.rmtree(destdir)
    os.makedirs(destdir)

    for file in files:
        subdir = os.path.dirname(file["name"])
        if subdir:
            os.makedirs(os.path.join(destdir, subdir), exist_ok=True)

        if "type" in file and file["type"] == "binary":
            with open(destdir + "/" + file["name"], "wb") as f:
                f.write(base64.b64decode(file["content"]))
        else:
            with open(destdir + "/" + file["name"], "w") as f:
                f.write(file["content"])

async def _load_packages_from_dir(dir: str) -> None:
    import os
    import pyodide
    files = os.listdir(dir)
    imports: list[str] = []
    for file in files:
        if file.endswith(".py"):
            with open(os.path.join(dir, file)) as f:
                await js_pyodide.loadPackagesFromImports(f.read())

`;

// =============================================================================
// Misc stuff
// =============================================================================

// TODO: Generalize this so it's not always tied to a single pyodideproxy
let channelListenerRegistered = false;
function ensureOpenChannelListener(pyodideProxy: PyodideProxy): void {
  if (channelListenerRegistered) return;

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "openChannel") {
      pyodideProxy.openChannel(msg.path, msg.appName, event.ports[0]);
    }
  });

  channelListenerRegistered = true;
}
