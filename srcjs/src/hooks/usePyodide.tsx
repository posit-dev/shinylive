import React, { useEffect } from "react";
import { loadPyodideProxy, ProxyType, PyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";

export type PyodideProxyHandle =
  | { ready: false; shiny_ready: false }
  | {
      ready: true;
      pyodide: PyodideProxy;
      shiny_ready: boolean;
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

  const pyodideProxy = await loadPyodideProxy(
    {
      type: proxyType,
      indexURL: utils.dirname(utils.currentScriptDir()) + "/pyodide/",
    },
    stdout,
    stderr
  );

  // Public functions
  async function runCode(command: string) {
    try {
      await pyodideProxy.runPythonAsync(command);
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
    shiny_ready: false,
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
    await pyodideProxy.runPythonAsync(load_pyshiny_code());
  } catch (e) {
    if (e instanceof Error) {
      console.error(e);
      // outputCallbacks.stderr(e.message);
    } else {
      console.error(e);
    }
  }

  if (pyodideProxy.proxyType() === "webworker") {
    // With a WebWorker, matplotlib needs to use the AGG backend instead of the
    // default Canvas one.
    await pyodideProxy.runPythonAsync(`
      print("Initializing AGG backend for plotting...")
      import os
      os.environ['MPLBACKEND'] = 'AGG'
  `);
  }

  await pyodideProxy.runPythonAsync(load_python_modules);

  return { ...pyodideProxyHandle, shiny_ready: true };
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
      shiny_ready: false,
    });

  useEffect(() => {
    (async () => {
      const pyodideProxyHandle = await pyodideProxyHandlePromise;
      setPyodideProxyHandle(pyodideProxyHandle);
    })();
  }, []);

  return pyodideProxyHandle;
}

// =============================================================================
// Python code for setting up session
// =============================================================================
const load_pyshiny_code = () => {
  const base_url =
    window.location.protocol +
    "//" +
    window.location.hostname +
    ":" +
    window.location.port +
    utils.dirname(utils.currentScriptDir());

  return `
# Patch ssl.py so that it is actually loadable under Pyodide.
# I've stubbed in just enough to allow the packages we need to be importable
# (mostly anyio, via starlette), it's possible we will need to stub in more
# later.
import os
import sys
__PYTHON_VERSION = f"{sys.version_info[0]}.{sys.version_info[1]}"

os.remove(f"/lib/python{__PYTHON_VERSION}/ssl.py")
with open(f"/lib/python{__PYTHON_VERSION}/ssl.py", "w") as f:
    f.write("""class SSLContext:
    pass
class SSLObject:
    pass
class MemoryBIO:
    pass
""")

None
`;
};

const load_python_modules = `
print("Loading modules...")
import js
import shutil
import asyncio
import shiny
import pyodide
import sys

# Add current directory to Python path.
sys.path.insert(0, "")

# Function for saving Shiny app files so we can load the app as a module.
def save_files(files: list[dict[str, str]], destdir: str) -> None:
    # If called from JS and passed an Object, we need to convert it to a
    # dict.
    if (isinstance(files, pyodide.JsProxy)):
        files = files.to_py()

    import os
    if os.path.exists(destdir):
      shutil.rmtree(destdir)
    os.makedirs(destdir)
    for file in files:
        with open(destdir + "/" + file['name'], 'wt') as f:
            f.write(file['content'])
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
    if (msg.type === "callPy") {
      console.error("usePyodide: callPy. I don't think we get here?");
      // pyodideproxy.callPy(msg.fn_name, msg.args, msg.kwargs);
    } else if (msg.type === "openChannel") {
      pyodideProxy.openChannel(msg.path, msg.appName, event.ports[0]);
    } else if (msg.type === "makeRequest") {
      console.error("usePyodide: makeRequest. I don't think we ever get here?");
      // pyodideproxy.makeRequest(msg.scope, event.ports[0]);
    }
  });

  channelListenerRegistered = true;
}
