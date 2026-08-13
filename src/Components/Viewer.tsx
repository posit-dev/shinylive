import * as React from "react";
import type { RObject } from "webr";
import { useLoadStatus } from "../hooks/useLoadStatus";
import type { EngineName } from "../load-status";
import { ENGINE_LABEL } from "../load-status";
import type { PyodideProxy } from "../pyodide-proxy";
import * as utils from "../utils";
import type { WebRProxy } from "../webr-proxy";
import type { ProxyHandle } from "./App";
import { LoadingStatus } from "./LoadingStatus";
import "./Viewer.css";
import type { FileContent } from "./filecontent";
import skull from "./skull.svg";

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
  urlPath: string,
): MessageChannel {
  if (!navigator.serviceWorker.controller) {
    throw new Error("ServiceWorker controller was not found!");
  }

  // Will this get GC'd on subsequent calls?
  const httpRequestChannel = new MessageChannel();

  httpRequestChannel.port1.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "makeRequest") {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      proxy.makeRequest(msg.scope, appName, event.ports[0]);
    }
  });
  httpRequestChannel.port1.start();

  navigator.serviceWorker.controller.postMessage(
    {
      type: "configureProxyPath",
      path: urlPath,
    },
    [httpRequestChannel.port2],
  );

  return httpRequestChannel;
}

// Recovery hint shown above the error log when the engine itself fails to load.
// A stale cache is a common cause, so suggest the user to try a hard refresh
function RecoveryHint() {
  return (
    <div className="error-recovery">
      <p className="error-recovery-lead">
        First, try a hard refresh: <kbd>Cmd+Shift+R</kbd> on macOS, or{" "}
        <kbd>Ctrl+Shift+R</kbd> on Windows and Linux.
      </p>
      <p>
        If that doesn’t help, clear this site’s cookies and cached data, then
        reload. Stale cached files are a common cause of loading failures.
      </p>
    </div>
  );
}

// The failure screen for both engine and app syntax failures. `kind` dictates
// if the recovery hint is shown in the engine-failure case, which isn't needed
// relevant for an application syntax error (it just shows the traceback instead)
export function ViewerError({
  kind,
  engine,
  message,
}: {
  kind: "engine" | "app";
  engine: EngineName;
  message: string | null;
}) {
  return (
    <div className="loading-wrapper loading-wrapper-error">
      <div className="error-alert">
        <div className="error-icon">
          <img src={skull} alt="skull" />
        </div>
        <div className="error-message">
          {kind === "engine"
            ? `Error loading ${ENGINE_LABEL[engine]}!`
            : "Error starting app!"}
        </div>
        {kind === "engine" ? <RecoveryHint /> : null}
        <div className="error-log">
          <pre>{message}</pre>
        </div>
      </div>
    </div>
  );
}

async function resetPyAppFrame(
  pyodide: PyodideProxy,
  appName: string,
  appFrame: HTMLIFrameElement,
): Promise<void> {
  // Reset the app iframe before shutting down the app, so that the user doesn't
  // see the flash of gray indicating a closed session.
  appFrame.src = "";

  const stoppedPreviousApp = (await pyodide.runPyAsync(
    `_stop_app('${appName}')`,
    { returnResult: "value", printResult: false },
  )) as boolean;

  // If we stopped a previously-running app, pause for a bit before continuing.
  if (stoppedPreviousApp) {
    await utils.sleep(5);
  }
}

async function resetRAppFrame(
  webRProxy: WebRProxy,
  appName: string,
  appFrame: HTMLIFrameElement,
): Promise<void> {
  // Reset the app iframe before shutting down the app, so that the user doesn't
  // see the flash of gray indicating a closed session.
  appFrame.src = "";

  await webRProxy.runRAsync(`.stop_app('${appName}')`);

  // Pause for a bit before continuing.
  await utils.sleep(200);
}

/** One named character element of webR's serialisation of an R list.
 *
 * `RObject.toJs()` returns a tagged tree, not a plain object: an R list arrives
 * as `{ type, names, values }`, and each element is itself either a
 * `{ type, names, values }` node or an already-unwrapped scalar -- webr's
 * `WebRDataJsNode.values` is typed as holding either. So both levels are
 * handled here, and the result is a `string[]` because every R character vector
 * has a length.
 *
 * An absent or unreadable field gives `[]` rather than a guess, so a reply that
 * does not match this shape fails loudly at the caller instead of reading as
 * success.
 */
function rCharacterField(
  js: Awaited<ReturnType<RObject["toJs"]>>,
  name: string,
): string[] {
  if (!("names" in js) || js.names === null || !("values" in js)) return [];
  const index = js.names.indexOf(name);
  if (index === -1) return [];
  const element: unknown = js.values[index];
  if (typeof element === "string") return [element];
  if (element === null || typeof element !== "object") return [];
  const values: unknown = (element as { values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}

// =============================================================================
// Viewer component
// =============================================================================
export function Viewer({
  proxyHandle,
  setViewerMethods,
  devMode = false,
  setWindowTitle = false,
  engine,
}: {
  proxyHandle: ProxyHandle;
  setViewerMethods: React.Dispatch<React.SetStateAction<ViewerMethods>>;
  devMode?: boolean;
  setWindowTitle?:
    | {
        prefix: string;
        defaultTitle: string;
      }
    | false;
  engine: EngineName;
}) {
  const viewerFrameRef = React.useRef<HTMLIFrameElement>(null);
  const [appRunningState, setAppRunningState] = React.useState<
    "loading" | "running" | "errored" | "empty"
  >("loading");
  const shinyIntervalRef = React.useRef<number>(0);
  const [lastErrorMessage, setLastErrorMessage] = React.useState<string | null>(
    null,
  );
  const engineStatus = useLoadStatus(engine);

  // Add effect to monitor iframe title changes
  React.useEffect(() => {
    if (!setWindowTitle || !viewerFrameRef.current) return;

    const iframe = viewerFrameRef.current;
    const observer = new MutationObserver(() => {
      if (iframe.contentDocument?.title) {
        document.title = setWindowTitle.prefix + iframe.contentDocument.title;
      } else {
        document.title = setWindowTitle.defaultTitle;
      }
    });

    // Start observing once the iframe loads
    const onLoad = () => {
      if (iframe.contentDocument) {
        observer.observe(iframe.contentDocument, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
    };

    iframe.addEventListener("load", onLoad);

    return () => {
      observer.disconnect();
      iframe.removeEventListener("load", onLoad);
    };
  }, [setWindowTitle]);

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
        // TODO: Simplify R list creation once webR accepts Uint8Array for RRaw
        const files = await new shelter.RList(
          Object.fromEntries(
            await Promise.all(
              appCode.map(async (f) => {
                if (f.type === "text") {
                  return [f.name, await new shelter.RCharacter(f.content)];
                }
                return [f.name, await new shelter.RRaw(Array.from(f.content))];
              }),
            ),
          ),
        );
        try {
          await webRProxy.runRAsync(".save_files(files, appDir)", {
            env: { files, appDir },
            captureStreams: false,
          });
          // .start_app reports failure by returning a status list rather than
          // raising, because captureConditions is off here: a raised error would
          // go to the terminal and never reach this catch, and the viewer would
          // show an app that never started. Evaluated on this shelter, rather
          // than through runRAsync, because runRAsync purges its own shelter
          // before returning -- the list has to outlive the call.
          const startResult = await shelter.evalR(
            ".start_app(appName, appDir, devMode)",
            {
              env: { appName, appDir, devMode },
              captureConditions: false,
              captureStreams: false,
            },
          );
          const start = await startResult.toJs();
          // Anything other than an explicit "ok" is a failure, including a reply
          // that did not survive the conversion above: a startup whose outcome
          // cannot be read is not one to go on and display an app for.
          if (rCharacterField(start, "status")[0] !== "ok") {
            const message =
              rCharacterField(start, "message")[0] ||
              // Distinct from .start_app's own no-message fallback, so the two
              // are told apart: that one means R raised an empty condition,
              // this one means no readable status came back at all.
              "The app failed to start, and R reported no status.";
            const call = rCharacterField(start, "call")[0];
            const error = new Error(
              call ? `Error in ${call}: ${message}` : message,
            );
            // Not branched on: a third category on the error screen would be a
            // UX change. Carried so the console says what kind of failure it
            // was.
            console.error("R startup failure", rCharacterField(start, "class"));
            throw error;
          }
        } finally {
          await shelter.purge();
        }

        // Run R Shiny housekeeping every 100ms
        if (shinyIntervalRef.current) clearTimeout(shinyIntervalRef.current);
        shinyIntervalRef.current = window.setInterval(() => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          webRProxy.runRAsync(".shiny_tick()");
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

      await resetRAppFrame(webRProxy, appInfo.appName, viewerFrameRef.current);
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
          kwargs: { dev_mode: devMode },
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
        viewerFrameRef.current,
      );
      setAppRunningState("empty");
    }

    setViewerMethods({
      ready: true,
      runApp,
      stopApp,
    });
  }, [proxyHandle.shinyReady]);

  const engineFailed = engineStatus.stage === "failed";

  return (
    <div className="shinylive-viewer">
      <iframe ref={viewerFrameRef} className="app-frame" />
      {engineFailed || appRunningState === "errored" ? (
        <ViewerError
          kind={engineFailed ? "engine" : "app"}
          engine={engine}
          message={engineFailed ? engineStatus.error : lastErrorMessage}
        />
      ) : appRunningState === "loading" ? (
        <div className="loading-wrapper">
          <LoadingStatus engine={engine} />
        </div>
      ) : null}
    </div>
  );
}
