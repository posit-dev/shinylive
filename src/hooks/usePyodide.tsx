import React, { useEffect } from "react";
import type { ProxyType, PyodideProxy } from "../pyodide-proxy";
import { loadPyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";

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
    stderr,
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
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

_mock_multiprocessing()
_mock_ipykernel()

def _pyodide_env_init():
    import os
    import sys
    import pyodide_http

    # We don't use ssl in this function, but this is needed for Shiny to load.
    import ssl

    # With a WebWorker, matplotlib needs to use the AGG backend instead of
    # the default Canvas one.
    os.environ["MPLBACKEND"] = "AGG"

    # Add current directory to Python path.
    sys.path.insert(0, "")

    # Patch http libraries to work with Pyodide
    pyodide_http.patch_all()

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
    import importlib.metadata

    files = os.listdir(dir)
    if "requirements.txt" not in files:
        return
    with open(os.path.join(dir, "requirements.txt"), "r") as f:
        reqs = f.readlines()

    for req in reqs:
        req = req.strip()
        extras = set()

        if req == "" or req.startswith("#"):
            continue
        # If it's a URL, then it must be a wheel file.
        if req.startswith("http://") or req.startswith("https://"):
            pkg_name = re.sub(r"^.+/(.*)-\\d.*$", r"\\1", req)
        else:
            # If we got here, it's a package specification.
            # https://peps.python.org/pep-0508/#examples
            # Remove any trailing version info: "my-package (>= 1.0.0)" -> "my-package"
            # or "shiny [theme] == 1.2.0" -> "shiny[theme]"
            pkg_name = re.sub(r" \\[", "[", req)
            pkg_name = re.sub(r"([a-zA-Z0-9._,\\[\\]-]+)(.*)", r"\\1", pkg_name).strip()

            match_extras = re.match(r"([^\\[]+)(?:\\[(.*)\\])?", pkg_name)
            if match_extras and match_extras.group(2):
                pkg_name = match_extras.group(1)
                extras.update({e.strip() for e in match_extras.group(2).split(",")})

        if pkg_name not in micropip.list():
            req = re.sub(r"#.+$", "", req).strip()
            print(f"\\nInstalling {req}...", end=" ", flush=True)
            await micropip.install(req)
            print("done.", flush=True)

        if len(extras) == 0:
            continue
        else:
            # Because micropip.install() doesn't install extras if the primary
            # package was already installed, we have to find the package
            # requirements of each extra and install them manually if needed.
            dist = importlib.metadata.distribution(pkg_name)

            provided_extras = set(dist.metadata.get_all("Provides-Extra") or [])
            valid_extras = extras & provided_extras
            invalid_extras = extras - valid_extras
            if len(invalid_extras):
                raise ValueError(
                    f"Invalid extras for package {pkg_name}: {','.join(invalid_extras)}. "
                    f"Found in '{req}' in requirements.txt."
                )

            pkg_reqs = dist.requires or []

            for extra in valid_extras:
                # Convert requires records  : 'libsass>=0.23.0; extra == "theme"'
                # into just the package name: 'libsass'
                extra_reqs = [
                    r for r in pkg_reqs
                    if f'extra == "{extra}"' in str(r)
                    or f"extra == '{extra}'" in str(r)
                ]

                for extra_req in extra_reqs:
                    extra_req_name = re.sub(r"([a-zA-Z0-9._,-]+)(.*)", r"\\1", extra_req).strip()
                    if extra_req_name not in micropip.list():
                        print(f"\\nInstalling {extra_req_name} for {pkg_name}[{extra}]...", end=" ", flush = True)
                        await micropip.install(extra_req_name)
                        print("done.", flush = True)


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

# The purpose of this class is for Shiny express apps to have the same "shape"
# as regular Shiny apps which are loaded with:
#   importlib.import_module(f"{app_name}.app")
# Essentially we are wrapping the express app in an object that looks like a
# Python (not Shiny) module. The express app has the name "app" in that module.
class ShinyExpressAppModule:
    def __init__(self, app_path):
        import shiny.express
        self.app = shiny.express.wrap_express_app(app_path)

async def _start_app(app_name, scope = _shiny_app_registry, dev_mode = False):
    import os
    import sys
    import importlib
    import shiny
    import shiny.express
    from pathlib import Path

    if (
        hasattr(shiny, "bookmark")
        and hasattr(shiny.bookmark, "set_global_save_dir_fn")
        and hasattr(shiny.bookmark, "set_global_restore_dir_fn")
    ):

        def not_configured(id):
            raise NotImplementedError(
                "shinylive is not configured to save sessions to disk."
            )

        shiny.bookmark.set_global_save_dir_fn(not_configured)
        shiny.bookmark.set_global_restore_dir_fn(not_configured)

    app_dir = f"/home/pyodide/{app_name}"
    sys.path.insert(0, app_dir)

    await _install_requirements_from_dir(app_dir)

    await _load_packages_from_dir(app_dir)

    # This prevents random occurrences of ModuleNotFoundError.
    importlib.invalidate_caches()

    class ModuleApp:
        app = None

    if dev_mode:
        # Enable shiny dev mode for error console
        os.environ["SHINY_DEV_MODE"] = "1"

    if shiny.express.is_express_app("app.py", app_dir):
        app_obj = ShinyExpressAppModule(Path(app_dir) / "app.py")
    else:
        app_obj = importlib.import_module(f"{app_name}.app")

    if dev_mode:
        os.environ.pop("SHINY_DEV_MODE")

    scope[app_name] = app_obj

    sys.path.remove(app_dir)


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
      const appExists = await pyodideProxy.runPyAsync(
        `
        "${msg.appName}" in _shiny_app_registry
      `,
        { returnResult: "value" },
      );
      if (appExists) {
        await pyodideProxy.openChannel(msg.path, msg.appName, event.ports[0]);
      }
    }
  });

  channelListenerRegistered = true;
}
