import { ProxyHandle } from "./App";
import { PyodideProxy } from "../pyodide-proxy";
import { WebRProxy } from "../webr-proxy";
import * as utils from "../utils";
import { LoadingAnimation } from "./LoadingAnimation";
import "./Viewer.css";
import { FileContent } from "./filecontent";
import skull from "./skull.svg";
import * as React from "react";

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
// the current window (eventually making its way to the Wasm engine).
function setupAppProxyPath(proxy: PyodideProxy | WebRProxy): {
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
  createHttpRequestChannel(proxy, appName, urlPath);

  // Listen for the service worker's restart messages and re-register.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data.type === "serviceworkerStart") {
      createHttpRequestChannel(proxy, appName, urlPath);
    }
  });

  return { appName, urlPath };
}

// Register the app path with the service worker
function createHttpRequestChannel(
  proxy: PyodideProxy | WebRProxy,
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
      proxy.makeRequest(msg.scope, appName, event.ports[0]);
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

async function resetPyAppFrame(
  pyodide: PyodideProxy,
  appName: string,
  appFrame: HTMLIFrameElement
): Promise<void> {
  // Reset the app iframe before shutting down the app, so that the user doesn't
  // see the flash of gray indicating a closed session.
  appFrame.src = "";

  const stoppedPreviousApp = (await pyodide.runPyAsync(
    `_stop_app('${appName}')`,
    { returnResult: "value", printResult: false }
  )) as boolean;

  // If we stopped a previously-running app, pause for a bit before continuing.
  if (stoppedPreviousApp) {
    await utils.sleep(5);
  }
}

async function resetRAppFrame(
  webRProxy: WebRProxy,
  appName: string,
  appFrame: HTMLIFrameElement
): Promise<void> {
  // Reset the app iframe before shutting down the app, so that the user doesn't
  // see the flash of gray indicating a closed session.
  appFrame.src = "";

  await webRProxy.runRAsync(`.stop_app('${appName}')`);

  // Pause for a bit before continuing.
  await utils.sleep(200);
}

// =============================================================================
// Viewer component
// =============================================================================
export function Viewer({
  proxyHandle,
  setViewerMethods,
}: {
  proxyHandle: ProxyHandle;
  setViewerMethods: React.Dispatch<React.SetStateAction<ViewerMethods>>;
}) {
  const viewerFrameRef = React.useRef<HTMLIFrameElement>(null);
  const [appRunningState, setAppRunningState] = React.useState<
    "loading" | "running" | "errored" | "empty"
  >("loading");
  const shinyIntervalRef = React.useRef<number>(0);
  const [lastErrorMessage, setLastErrorMessage] = React.useState<string | null>(
    null
  );

  // Shiny for R
  React.useEffect(() => {
    if (!proxyHandle.shinyReady) return;
    if (proxyHandle.engine !== "webr") return;

    const webRProxy = proxyHandle.webRProxy;
    const appInfo = setupAppProxyPath(webRProxy);

    async function runApp(appCode: string | FileContent[]): Promise<void> {
      try {
        if (!viewerFrameRef.current)
          throw new Error("Viewer iframe is not yet initialized");

        setAppRunningState("loading");

        if (typeof appCode === "string") {
          appCode = [
            {
              name: "app.R",
              content: appCode,
              type: "text",
            },
          ];
        }

        const appName = appInfo.appName;
        const appDir = "/home/web_user/" + appName;
        const shelter = await new webRProxy.webR.Shelter();
        const files = await new shelter.RList(
          Object.fromEntries(appCode.map((file) => {
            return [file.name, file.content]
          }))
        )
        try {
          await webRProxy.runRAsync(
            '.save_files(files, appDir)',
            { env: { files, appDir }, captureStreams: false }
          );
          await webRProxy.runRAsync(
            '.start_app(appName, appDir)',
            {
              env: { appName, appDir },
              captureConditions: false,
              captureStreams: false
            }
          );
        } finally {
          shelter.purge();
        }

        // Run R Shiny housekeeping every 100ms
        if (shinyIntervalRef.current) clearTimeout(shinyIntervalRef.current);
        shinyIntervalRef.current =  window.setInterval(() => {
          webRProxy.runRAsync('.shiny_tick()')
        }, 100);

        viewerFrameRef.current.src = appInfo.urlPath;
        setAppRunningState("running");
      } catch (e) {
        setAppRunningState("errored");
        if (e instanceof Error) {
          console.error(e.message);
          setLastErrorMessage(e.message);
        } else {
          console.error(e);
        }
      }
    }

    async function stopApp(): Promise<void> {
      if (!viewerFrameRef.current) return;

      // Stop the periodic R Shiny housekeeping
      if (shinyIntervalRef.current) clearTimeout(shinyIntervalRef.current);

      await resetRAppFrame(
        webRProxy,
        appInfo.appName,
        viewerFrameRef.current
      );
      setAppRunningState("empty");
    }

    setViewerMethods({
      ready: true,
      runApp,
      stopApp,
    });
  }, [proxyHandle.shinyReady]);

  // Shiny for Python
  React.useEffect(() => {
    if (!proxyHandle.shinyReady) return;
    if (proxyHandle.engine !== "pyodide") return;

    const pyodideproxy = proxyHandle.pyodide;
    const appInfo = setupAppProxyPath(pyodideproxy);

    async function runApp(appCode: string | FileContent[]): Promise<void> {
      try {
        if (!viewerFrameRef.current)
          throw new Error("Viewer iframe is not yet initialized");

        setAppRunningState("loading");

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

        // Save the code in /home/pyodide/{appName} so we can load it as a
        // module.
        await pyodideproxy.callPyAsync({
          fnName: ["_save_files"],
          args: [appCode, "/home/pyodide/" + appName],
        });

        await pyodideproxy.callPyAsync({
          fnName: ["_start_app"],
          args: [appName],
        });

        viewerFrameRef.current.src = appInfo.urlPath;
        setAppRunningState("running");
      } catch (e) {
        setAppRunningState("errored");
        if (e instanceof Error) {
          console.error(e.message);
          setLastErrorMessage(e.message);
        } else {
          console.error(e);
        }
      }
    }

    async function stopApp(): Promise<void> {
      if (!viewerFrameRef.current) return;

      await resetPyAppFrame(
        pyodideproxy,
        appInfo.appName,
        viewerFrameRef.current
      );
      setAppRunningState("empty");
    }

    setViewerMethods({
      ready: true,
      runApp,
      stopApp,
    });
  }, [proxyHandle.shinyReady]);

  return (
    <div className="shinylive-viewer">
      <iframe ref={viewerFrameRef} className="app-frame" />
      {appRunningState === "loading" ? (
        <div className="loading-wrapper">
          <LoadingAnimation />
        </div>
      ) : appRunningState === "errored" ? (
        <div className="loading-wrapper loading-wrapper-error">
          <div className="error-alert">
            <div className="error-icon">
              <img src={skull} alt="skull" />
            </div>
            <div className="error-message">Error starting app!</div>
            <div className="error-log">
              <pre>{lastErrorMessage}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
