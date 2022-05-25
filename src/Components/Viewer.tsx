import * as React from "react";
import { PyodideProxyHandle } from "../hooks/usePyodide";
import { PyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";
import { FileContent } from "./filecontent";
import LoadingAnimation from "./LoadingAnimation";
import "./Viewer.css";

export type ViewerMethods =
  | { ready: false }
  | {
      ready: true;
      runApp: (appCode: string | FileContent[]) => Promise<void>;
      stopApp: () => Promise<void>;
    };

// =============================================================================
// Misc stuff
// =============================================================================

// Register a unique app path with the service worker. When fetches in our
// origin match against the app path, navigation should be proxied through
// the current window (eventually making its way to pyodide).
function setupAppProxyPath(pyodide: PyodideProxy): {
  appName: string;
  urlPath: string;
} {
  const appName = `app_${utils.makeRandomKey(20)}`;
  const urlPath = appName + "/";

  if (!navigator.serviceWorker.controller) {
    throw new Error("ServiceWorker controller was not found!");
  }

  // There are two times that we need to register the app path with the service
  // worker. One time is when this Viewer component starts up. Another time is
  // when the service worker restarts: service workers can shut down at any time
  // and will restart as needed. When the service worker shuts down, it will
  // lose the state that tells it how to proxy requests for `urlPath`, so when
  // it restarts, we need to re-register with the service worker.
  createHttpRequestChannel(pyodide, appName, urlPath);

  // Listen for the service worker's restart messages and re-register.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data.type === "serviceworkerStart") {
      createHttpRequestChannel(pyodide, appName, urlPath);
    }
  });

  return { appName, urlPath };
}

// Register the app path with the service worker
function createHttpRequestChannel(
  pyodide: PyodideProxy,
  appName: string,
  urlPath: string
): MessageChannel {
  if (!navigator.serviceWorker.controller) {
    throw new Error("ServiceWorker controller was not found!");
  }

  // Will this get GC'd on subsequent calls?
  const httpRequestChannel = new MessageChannel();

  httpRequestChannel.port1.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "makeRequest") {
      pyodide.makeRequest(msg.scope, appName, event.ports[0]);
    }
  });
  httpRequestChannel.port1.start();

  navigator.serviceWorker.controller.postMessage(
    {
      type: "configureProxyPath",
      path: urlPath,
    },
    [httpRequestChannel.port2]
  );

  return httpRequestChannel;
}

async function resetAppFrame(
  pyodide: PyodideProxy,
  appName: string,
  appFrame: HTMLIFrameElement
): Promise<void> {
  // Reset the app iframe before shutting down the app, so that the user doesn't
  // see the flash of gray indicating a closed session.
  appFrame.src = "";

  // TODO: myapp{n}
  const stoppedPreviousApp = (await pyodide.runPyAsync(
    `
    _res = False
    if "${appName}" in locals():
        print("Stopping previous app ${appName}...")
        if "app" in dir(${appName}) and isinstance(${appName}.app.app, shiny.App):
            await ${appName}.app.app.stop()
            _res = True

        if "__${appName}_lifespan__" in locals():
            await __${appName}_lifespan__.__aexit__(None, None, None)
            del __${appName}_lifespan__

        del ${appName}
        # Unload app module and submodules
        for name, module in list(sys.modules.items()):
            if name == "${appName}" or name.startswith("${appName}."):
                sys.modules.pop(name)
            elif (
                hasattr(module, "__file__")
                and module.__file__ is not None
                and module.__file__.startswith("/home/pyodide")
            ):
                # This will find submodules of the app if they are from files
                # loaded with 'import foo', as opposed to 'from . import foo'.
                sys.modules.pop(name)

    _res
    `,
    { returnResult: "value", printResult: false }
  )) as boolean;

  // If we stopped a previously-running app, pause for a bit before continuing.
  if (stoppedPreviousApp) {
    await utils.sleep(5);
  }
}

// =============================================================================
// Viewer component
// =============================================================================
export default function Viewer({
  pyodideProxyHandle,
  setViewerMethods,
}: {
  pyodideProxyHandle: PyodideProxyHandle;
  setViewerMethods: React.Dispatch<React.SetStateAction<ViewerMethods>>;
}) {
  const viewerFrameRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if (!pyodideProxyHandle.shinyReady) return;

    const pyodideproxy = pyodideProxyHandle.pyodide;
    const appInfo = setupAppProxyPath(pyodideproxy);

    async function runApp(appCode: string | FileContent[]): Promise<void> {
      try {
        if (!viewerFrameRef.current)
          throw new Error("Viewer iframe is not yet initialized");

        // viewerFrameRef.current.src = utils.currentScriptDir() + "/loading.html";

        if (typeof appCode === "string") {
          appCode = [
            {
              name: "app.py",
              content: appCode,
              type: "text",
            },
          ];
        }

        const appName = appInfo.appName;

        // Save the code in /home/pyodide/{appName} so we can load it as a module
        await pyodideproxy.callPy(
          ["_save_files"],
          [appCode, "/home/pyodide/" + appName],
          {}
        );

        // The save_files() seems to need this `await` to occur before the
        // import below. Without it, when starting multiple apps concurrently,
        // the `import myapp.app` below can fail with a "ModuleNotFoundError".
        // The error seems to happen randomly.
        await pyodideproxy.runPyAsync("asyncio.sleep(0)");

        // Add this app's directory to the sys.path so that it can import other
        // files in the dir with "import foo". We'll remove it from the path as
        // soon as the app has started, to reduce the risk of interfering with
        // other apps that are running using the same pyodide instance. (For
        // example, if two apps both have "import utils", but their respective
        // utils.py files are different, then depending on the order that things
        // happen, it's possible for one app to load the other's utils.py.)
        // This could cause problems if an app has an import that occurs after
        // startup (like in a function).
        await pyodideproxy.runPyAsync(
          `
          import sys
          sys.path.insert(0, "/home/pyodide/${appName}")

          await _load_packages_from_dir("/home/pyodide/${appName}")

          import ${appName}.app
          __${appName}_lifespan__ = ${appName}.app.app._lifespan(${appName}.app.app.starlette_app)
          await __${appName}_lifespan__.__aenter__()

          sys.path.remove("/home/pyodide/${appName}")
          `
        );

        viewerFrameRef.current.src = appInfo.urlPath;
      } catch (e) {
        if (e instanceof Error) {
          console.error(e.message);
        } else {
          console.error(e);
        }
      }
    }

    async function stopApp(): Promise<void> {
      if (!viewerFrameRef.current) return;

      await resetAppFrame(
        pyodideproxy,
        appInfo.appName,
        viewerFrameRef.current
      );
    }

    setViewerMethods({
      ready: true,
      runApp,
      stopApp,
    });
  }, [pyodideProxyHandle.shinyReady]);

  if (!pyodideProxyHandle.shinyReady) {
    return (
      <div className="initializing-animation">
        <LoadingAnimation />
      </div>
    );
  } else {
    return (
      <div className="Viewer">
        <div className="Viewer--contents">
          <iframe
            ref={viewerFrameRef}
            className="app-frame"
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </div>
    );
  }
}
