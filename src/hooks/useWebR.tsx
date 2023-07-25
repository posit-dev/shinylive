import React, { useEffect } from "react";
import * as utils from "../utils";
import { WebRProxy, loadWebRProxy } from '../webr-proxy';

export type WebRProxyHandle =
  | {
      ready: false;
      shinyReady: false;
      initError: false;
    }
  | {
      ready: true;
      engine: "webr";
      webRProxy: WebRProxy;
      shinyReady: boolean;
      initError: boolean;
      // Run code through webR REPL. Returns a promise to the next prompt.
      runCode: (command: string) => Promise<string>;
      tabComplete: (command: string) => Promise<string[]>;
      interrupt: () => void;
  };

export async function initWebR({
  stdout,
  stderr,
}: {
  stdout?: (msg: string) => any;
  stderr?: (msg: string) => any;
}): Promise<WebRProxyHandle> {
  // Defaults for stdout and stderr if not provided: log to console
  if (!stdout) stdout = (x: string) => console.log("webR echo:" + x);
  if (!stderr) stderr = (x: string) => console.error("webR error:" + x);

  const webRProxy = await loadWebRProxy(
    { baseUrl: utils.currentScriptDir() + "/webr/" },
    stdout,
    stderr
  );

  let initError = false;
  try {
    await webRProxy.runRAsync('webr::install("codetools")')
    await webRProxy.runRAsync(load_r_pre);
  } catch (e) {
    initError = true;
    console.error(e);
  }

  async function runCode(command: string) {
    return await webRProxy.runCode(command);
  }

  async function tabComplete(code: string): Promise<string[]> {
    return [''];
  }

  function interrupt() {
    webRProxy.webR.interrupt();
  }

  return {
    ready: true,
    engine: "webr",
    webRProxy,
    shinyReady: false,
    initError: initError,
    runCode,
    tabComplete,
    interrupt,
  };
}

export async function initRShiny({
  webRProxyHandle,
}: {
  webRProxyHandle: WebRProxyHandle;
}): Promise<WebRProxyHandle> {
  if (!webRProxyHandle.ready) {
    throw new Error("webRProxyHandle is not ready");
  }

  await webRProxyHandle.webRProxy.runRAsync('webr::install("shiny")')
  await webRProxyHandle.webRProxy.runRAsync('library(shiny)')
  // Increase webR expressions limit for deep call stack required for Shiny
  await webRProxyHandle.webRProxy.runRAsync('options(expressions=1000)')
  ensureOpenChannelListener(webRProxyHandle.webRProxy);

  return {
    ...webRProxyHandle,
    shinyReady: true,
  };
}

export function useWebR({
  webRProxyHandlePromise,
}: {
  webRProxyHandlePromise: Promise<WebRProxyHandle>;
}) {
  const [webRProxyHandle, setwebRProxyHandle] = React.useState<WebRProxyHandle>({
    ready: false,
    shinyReady: false,
    initError: false,
  });

  useEffect(() => {
    (async () => {
      const webRProxyHandle = await webRProxyHandlePromise;
      setwebRProxyHandle(webRProxyHandle);
    })();
  }, [webRProxyHandlePromise]);

  return webRProxyHandle;
}

let channelListenerRegistered = false;
function ensureOpenChannelListener(webRProxy: WebRProxy): void {
  if (channelListenerRegistered) return;

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "openChannel") {
      webRProxy.openChannel(msg.path, msg.appName, event.ports[0]);
    }
  });

  channelListenerRegistered = true;
}

const load_r_pre =
`
.RawReader <- setRefClass("RawReader", fields = c("con", "length"), methods = list(
  init = function(bytes) {
    con <<- rawConnection(bytes, "rb")
    length <<- length(bytes)
  },
  read = function(l = -1L) {
    if (l < 0) l <- length
    readBin(con, "raw", size = 1, n = l)
  },
  read_lines = function(l = -1L) {
    readLines(con, n = l)
  },
  rewind = function() {
    seek(con, 0)
  },
  destroy = function() {
    close(con)
  }
))

.stop_app <- function() {
  webr::eval_js("
    chan.write({
      type: '_webR_httpuv_WSResponse',
      data: { handle: '1', binary: false, type: 'websocket.close', message: 'stopped' }
    });
  ")
  shiny::stopApp()
}

.start_app <- function (appDir) {
  shiny::runApp(appDir, port=0, host=NULL)
  invisible(0)
}

invisible(0)
`
