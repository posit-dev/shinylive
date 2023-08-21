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
.shiny_app_registry <- new.env()

# Create a httpuv app from a Shiny app directory
.shiny_to_httpuv <- function(appDir) {
  # Create an appObj from an app directory
  appObj <- shiny::as.shiny.appobj(appDir)

  # Ensure global.R is sourced when app starts
  appObj$onStart()

  # Required so that downloadLink and registerDataObj work
  shiny:::workerId("")

  # Creates http and ws handlers from the app object. However, these are not
  # Rook handlers, but rather use Shiny's own middleware protocol.
  # https://github.com/rstudio/shiny/blob/main/R/middleware.R
  appHandlers <- shiny:::createAppHandlers(
    appObj$httpHandler,
    appObj$serverFuncSource
  )

  # HandlerManager turns Shiny middleware into httpuv apps
  handlerManager <- shiny:::HandlerManager$new()
  handlerManager$addHandler(appHandlers$http, "/", tail = TRUE)
  handlerManager$addWSHandler(appHandlers$ws, "/", tail = TRUE)
  handlerManager$createHttpuvApp()
}

# Run Shiny housekeeping tasks
# https://github.com/rstudio/shiny/blob/b054e45402ee31f1e58cb6e1d1f51f76f98a0aca/R/server.R#L479
.shiny_tick <- function() {
  shiny:::timerCallbacks$executeElapsed()
  shiny:::flushReact()
  shiny:::flushPendingSessions()
}

# Serialise WS response and send to main thread for handling
.send_ws <- function (message) {
  webr::eval_js(
    paste0(
        "chan.write({",
        "type: '_webR_httpuv_WSResponse', ",
        "data: ", jsonlite::serializeJSON(message),
      "});"
    )
  )
}

# Create a rook input stream object with a vector of bytes as its source
.RawReader <- setRefClass(
  "RawReader",
  fields = c("con", "length"),
  methods = list(
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
  )
)

# Save a set of Shiny app files from Shinylive to the webR VFS
.save_files <- function(files, appDir) {
  for (name in names(files)) {
    filename <- file.path(appDir, name)
    path <- dirname(filename)
    dir.create(path, recursive = TRUE, showWarnings = FALSE)
    writeLines(files[[name]], filename)
  }
}

.stop_app <- function(appName) {
  .send_ws(c("websocket.close", appName, ""))
  assign(appName, NULL, envir = .shiny_app_registry)
  invisible(0)
}

.start_app <- function(appName, appDir) {
  app <- .shiny_to_httpuv(appDir)
  assign(appName, app, envir = .shiny_app_registry)
  invisible(0)
}

invisible(0)
`
