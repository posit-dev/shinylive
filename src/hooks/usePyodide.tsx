import { loadPyodideProxy, ProxyType, PyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";
import React, { useEffect } from "react";

export type PyodideProxyHandle =
  | {
      ready: false;
      shinyReady: false;
      initError: false;
    }
  | {
      ready: true;
      engine: "pyodide";
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

  const pyodideProxy = await loadPyodideProxy(
    {
      type: proxyType,
      indexURL: utils.currentScriptDir() + "/pyodide/",
    },
    stdout,
    stderr
  );

  let initError = false;
  try {
    // One-time initialization of Python session
    await pyodideProxy.runPyAsync(load_python_pre);
  } catch (e) {
    initError = true;
    console.error(e);
  }

  // Public functions
  async function runCode(command: string) {
    try {
      await pyodideProxy.runPyAsync(command, { printResult: true });
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
    engine: "pyodide",
    pyodide: pyodideProxy,
    shinyReady: false,
    initError: initError,
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
const load_python_pre =
  `
def _mock_multiprocessing():
    import sys
    sys.modules['_multiprocessing'] = object


def _mock_ipykernel():
    import sys
    import types
    mods = sys.modules

    class MockKernel:
        class Events:
            def register(self, *args):
                pass
        def __init__(self):
            self.comm_manager = CommManager()
            self.events = MockKernel.Events()
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


def _mock_ipython():
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

    # Needed for matplotlib - if IPython is present, it'll look for this.
    m = types.ModuleType("IPython.core.pylabtools")
    m.backend2gui = {}
    mods["IPython.core.pylabtools"] = m

_mock_multiprocessing()
_mock_ipykernel()
_mock_ipython()

def _pyodide_env_init():
    import os
    import sys

    # We don't use ssl in this function, but this is needed for Shiny to load.
    import ssl

    # With a WebWorker, matplotlib needs to use the AGG backend instead of
    # the default Canvas one.
    os.environ["MPLBACKEND"] = "AGG"

    # Add current directory to Python path.
    sys.path.insert(0, "")

_pyodide_env_init()

# Function for saving a set of files so we can load them as a module.
def _save_files(files: list[dict[str, str]], destdir: str, rm_destdir: bool = True) -> None:
    import shutil
    import pyodide
    # If called from JS and passed an Object, we need to convert it to a
    # dict.
    if isinstance(files, pyodide.ffi.JsProxy):
        files = files.to_py()

    import os
    if rm_destdir and os.path.exists(destdir):
        shutil.rmtree(destdir)
    os.makedirs(destdir, exist_ok=True)

    for file in files:
        subdir = os.path.dirname(file["name"])
        if subdir:
            os.makedirs(os.path.join(destdir, subdir), exist_ok=True)

        if "type" in file and file["type"] == "binary":
            with open(destdir + "/" + file["name"], "wb") as f:
                f.write(file["content"])
        else:
            with open(destdir + "/" + file["name"], "w") as f:
                f.write(file["content"])

async def _install_requirements_from_dir(dir: str) -> None:
    import os
    import re
    import micropip
    import sys

    files = os.listdir(dir)
    if "requirements.txt" not in files:
        return
    with open(os.path.join(dir, "requirements.txt"), "r") as f:
        reqs = f.readlines()

    for req in reqs:
        req = req.strip()
        if req == "" or req.startswith("#"):
            continue
        # If it's a URL, then it must be a wheel file.
        if req.startswith("http://") or req.startswith("https://"):
            pkg_name = re.sub(r"^.+/(.*)-\\d.*$", r"\\1", req)
        else:
            # If we got here, it's a package specification.
            # Remove any trailing version info: "my-package (>= 1.0.0)" -> "my-package"
            pkg_name = re.sub(r"([a-zA-Z0-9._-]+)(.*)", r"\\1", req).strip()

        if pkg_name in micropip.list():
            continue
        print(f"Installing {req} ...")
        await micropip.install(req)


async def _load_packages_from_dir(dir: str) -> None:
    import os
    import pyodide
    files = os.listdir(dir)
    imports: list[str] = []
    for file in files:
        if file.endswith(".py"):
            with open(os.path.join(dir, file)) as f:
                await js_pyodide.loadPackagesFromImports(f.read())
` +
  // In the function below, the odd importlib step for matplotlib is to work
  // around Pyodide's automatic import detection via
  // `loadPackagesFromImports()`. When this code is initially evaluated (but
  // before the _to_html() function is executed), Pyodide will scan the text and
  // install packages which are in `import xx` statements. So if we have `import
  // matplotlib.figure`, even the conditional branch, Pyodide will _always_ load
  // it when initially evaluating this code, because the code is first passed to
  // `loadPackagesFromImports()`.
  `
def _to_html(x):
    import sys
    if hasattr(x, 'to_html'):
      return { "type": "html", "value": x.to_html() }

    if "matplotlib" in sys.modules:
      import importlib
      figure = importlib.import_module('matplotlib.figure')

      if isinstance(x, figure.Figure):
        import io
        import base64
        img = io.BytesIO()
        x.savefig(img, format='png', bbox_inches='tight')
        img.seek(0)
        img_encoded = base64.b64encode(img.getvalue())
        img_html = '<img src="data:image/png;base64, {}">'.format(img_encoded.decode('utf-8'))
        return { "type": "html", "value": img_html }

    return { "type": "text", "value": repr(x) }
` +
  // Reformat Python code using black. The odd importlib stuff is so that we
  // only load black (and dependencies) when we actually need it. Otherwise
  // Pyodide will load it automatically as soon as as it's loaded.
  `
async def _format_py_code(x: str):
    import sys
    import importlib
    if "black" not in sys.modules:
        import micropip
        await micropip.install("tomli")
        await micropip.install("black")
    black = importlib.import_module("black")
    result = black.format_str(x, mode=black.Mode())
    return result
` +
  // When we start the app, add the app's directory to the sys.path so that it
  // can import other files in the dir with "import foo". We'll remove it from
  // the path as soon as the app has started, to reduce the risk of interfering
  // with other apps that are running using the same pyodide instance. (For
  // example, if two apps both have "import utils", but their respective
  // utils.py files are different, then depending on the order that things
  // happen, it's possible for one app to load the other's utils.py.) This could
  // cause problems if an app has an import that occurs after startup (like in a
  // function).
  `
_shiny_app_registry = {}

async def _start_app(app_name, scope = _shiny_app_registry):
    import sys
    import importlib

    app_path = f"/home/pyodide/{app_name}"
    sys.path.insert(0, app_path)

    await _install_requirements_from_dir(app_path)

    await _load_packages_from_dir(app_path)

    # This prevents random occurrences of ModuleNotFoundError.
    importlib.invalidate_caches()

    app_obj = importlib.import_module(f"{app_name}.app")
    scope[app_name] = app_obj

    sys.path.remove(app_path)


async def _stop_app(app_name, scope = _shiny_app_registry):
    import sys
    _res = False

    if app_name in list(scope):
        app_obj = scope[app_name]
        import shiny

        if "app" in dir(app_obj) and isinstance(app_obj.app, shiny.App):
            await app_obj.app.stop()
            _res = True

        del scope[app_name]
        # Unload app module and submodules
        for name, module in list(sys.modules.items()):
            if name == app_name or name.startswith(app_name):
                sys.modules.pop(name)
            elif (
                hasattr(module, "__file__")
                and module.__file__ is not None
                and module.__file__.startswith("/home/pyodide")
            ):
                # This will find submodules of the app if they are from files
                # loaded with 'import foo', as opposed to 'from . import foo'.
                sys.modules.pop(name)
    return _res
  `;

// =============================================================================
// Misc stuff
// =============================================================================

// TODO: Generalize this so it's not always tied to a single pyodideproxy
let channelListenerRegistered = false;
function ensureOpenChannelListener(pyodideProxy: PyodideProxy): void {
  if (channelListenerRegistered) return;

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (msg.type === "openChannel") {
      const appExists = await pyodideProxy.runPyAsync(`
        "${msg.appName}" in _shiny_app_registry
      `, { returnResult: "value" });
      if (appExists) {
        pyodideProxy.openChannel(msg.path, msg.appName, event.ports[0]);
      }
    }
  });

  channelListenerRegistered = true;
}
