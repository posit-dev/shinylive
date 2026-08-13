import React, { useEffect } from "react";
import { ChannelType } from "webr";
import { checkEngineAssetReachable } from "../engine-load-guard";
import { loadStatusStore } from "../load-status";
import * as utils from "../utils";
import type { WebRProxy } from "../webr-proxy";
import { loadWebRProxy } from "../webr-proxy";

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

  const channelType = crossOriginIsolated
    ? ChannelType.Automatic
    : ChannelType.PostMessage;
  const baseUrl = utils.currentScriptDir() + "/webr/";

  const status = loadStatusStore("r");

  status.set("engine-download");
  // Checked because webR's init() hangs rather than failing when the wasm is
  // missing; see engine-load-guard.ts. This throw propagates to App.tsx, which
  // records it as "failed".
  const unreachable = await checkEngineAssetReachable("r", baseUrl);
  if (unreachable) throw new Error(unreachable);

  const webRProxy = await loadWebRProxy(
    { baseUrl, channelType },
    stdout,
    stderr,
  );

  let initError = false;
  try {
    status.set("engine-start");
    await webRProxy.webR.objs.globalEnv.bind(".base_url", baseUrl);
    await webRProxy.runRAsync(
      `webr::mount("/shinylive/library", "${baseUrl}library.data.gz")`,
    );
    await webRProxy.runRAsync(load_r_pre);
    status.set("ready");
  } catch (e) {
    initError = true;
    status.set("failed", e instanceof Error ? e.message : String(e));
    console.error(e);
  }

  async function runCode(command: string) {
    return await webRProxy.runCode(command);
  }

  async function tabComplete(code: string): Promise<string[]> {
    return [""];
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

  await webRProxyHandle.webRProxy.runRAsync("library(shiny)");
  // Increase webR expressions limit for deep call stack required for Shiny
  await webRProxyHandle.webRProxy.runRAsync("options(expressions=1000)");
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
  const [webRProxyHandle, setwebRProxyHandle] = React.useState<WebRProxyHandle>(
    {
      ready: false,
      shinyReady: false,
      initError: false,
    },
  );

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      const webRProxyHandle = await webRProxyHandlePromise;
      setwebRProxyHandle(webRProxyHandle);
    })().catch((e) => {
      // Already surfaced to the user via the load status store;
      // logged to the console so it isn't an unhandled rejection.
      console.error(e);
    });
  }, [webRProxyHandlePromise]);

  return webRProxyHandle;
}

let channelListenerRegistered = false;
function ensureOpenChannelListener(webRProxy: WebRProxy): void {
  if (channelListenerRegistered) return;

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (msg.type === "openChannel") {
      const appExists = await webRProxy.runRAsync(`
        exists("${msg.appName}", envir = .shiny_app_registry)
      `);
      if (await appExists.toBoolean()) {
        await webRProxy.openChannel(msg.path, msg.appName, event.ports[0]);
      }
    }
  });

  channelListenerRegistered = true;
}

const load_r_pre = `
# Force internal tar - silence renv warning
Sys.setenv(TAR = "internal")

# Set {config} envvar for shinylive
Sys.setenv(R_CONFIG_ACTIVE = "shinylive")

# Use shinylive R package libraries
dir.create("/shinylive/webr/packages", showWarnings = FALSE, recursive = TRUE)
.libPaths(c(.libPaths(), "/shinylive/webr/packages", "/shinylive/library"))

# Shim R functions with webR versions (e.g. install.packages())
webr::shim_install()

.shiny_app_registry <- new.env()

# Create a httpuv app from a Shiny app directory
.shiny_to_httpuv <- function(appDir) {
  # Create an appObj from an app directory
  appObj <- shiny::as.shiny.appobj(appDir)

  # Ensure global.R is sourced when app starts
  appObj$onStart()

  # Required so that downloadLink and registerDataObj work
  shiny:::workerId("")

  # Ensure that shiny::isRunning() returns TRUE
  shiny:::clearCurrentAppState()
  shiny:::initCurrentAppState(appObj)

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
        "Module.webr.channel.write({",
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
    if (is.character(files[[name]])) {
      writeLines(files[[name]], filename, useBytes = TRUE)
    } else {
      writeBin(files[[name]], filename)
    }
  }
}

.stop_app <- function(appName) {
  .send_ws(c("websocket.close", appName, ""))
  assign(appName, NULL, envir = .shiny_app_registry)
  invisible(0)
}

.webr_pkg_cache <- list()

.install_pkg_tgz <- function(path, lib) {
  tmp <- tempfile()
  on.exit(unlink(tmp, recursive = TRUE))

  utils::download.file(path, tmp, quiet = TRUE)
  utils::untar(
    tmp,
    exdir = lib,
    tar = "internal",
    extras = "--no-same-permissions"
  )
}

.mount_vfs_images <- function() {
  metadata_url <- glue::glue("{.base_url}packages/metadata.rds")
  metadata_path <- glue::glue("/shinylive/webr/packages/metadata.rds")

  # Attempt this download quietly, if no metadata exists we can still continue
  found <- webr::eval_js(glue::glue("
    var xhr = new XMLHttpRequest();
    xhr.open('HEAD', '{metadata_url}', false);
    xhr.send();
    (xhr.status >= 200 && xhr.status < 300)
  "))
  if (found) {
    download.file(metadata_url, metadata_path, quiet = TRUE)
  }

  if (file.exists(metadata_path)) {
    metadata <- readRDS(metadata_path)
    lapply(metadata, function(data) {
      name <- data$name
      path <- data$path
      available <- data$cached && length(data$assets) > 0
      mountpoint <- glue::glue("/shinylive/webr/packages/{name}")

      try({
        # Mount the virtual filesystem image, unless we already have done so
        if (available && !file.exists(mountpoint)) {
          tryCatch({
            webr::mount(mountpoint, glue::glue("{.base_url}{path}"))
          }, error = function(cnd) {
            # File extraction fallback for .tgz with no filesystem metadata
            if (grepl(".tgz$", path)) {
              .install_pkg_tgz(path, "/shinylive/webr/packages/")
            } else {
              stop(cnd)
            }
          })
        }

        # If this is a full library, add it to .libPaths()
        if(data$type == "library") {
          paths <- .libPaths()
          paths <- append(paths, mountpoint , after = length(paths) - 1)
          .libPaths(paths)
        }
      })
    })
  }

  # Warm package cache with installed packages
  lapply(rownames(installed.packages()), function(p) { .webr_pkg_cache[[p]] <<- TRUE })
}

# Returns list(status = "ok"), or list(status = "error", message, class, call).
#
# The caller evaluates this with captureConditions = FALSE, so an error raised
# here would go to the terminal and never reach JavaScript: the viewer would go
# on to display an app that never started. Returning the failure as a value is
# what makes a failed startup visible.
#
# The status field carries the explicit outcome rather than leaving it to be inferred: a
# condition can carry an empty message, which on its own would read as success.
# The class and call fields are what conditionMessage() would drop, and the call
# is how the dialog can name which call failed, not just what went wrong.
.start_app <- function(appName, appDir, devMode = FALSE) {
  tryCatch(
    {
      # Perform a basic parse of top-level R scripts to highlight any syntax
      # errors. Runs first so a typo fails before spending time on package installs.
      for (f in list.files(appDir, pattern = "[.][Rr]$", full.names = TRUE)) {
        # call. = FALSE because the call this condition would otherwise carry is
        # this loop's own parse(file = f), whose f names nothing an app author
        # would recognise.
        tryCatch(
          parse(file = f),
          error = function(cnd) stop(conditionMessage(cnd), call. = FALSE)
        )
      }

      # Mount VFS images provided in Shinylive app assets
      .mount_vfs_images()

      # Uniquely install packages with webr
      unique_pkgs <- unique(renv::dependencies(appDir, quiet = TRUE)$Package)
      lapply(unique_pkgs, function(pkg_name) {
        if (isTRUE(.webr_pkg_cache[[pkg_name]])) return()

        has_pkg <- nzchar(system.file(package = pkg_name))
        .webr_pkg_cache[[pkg_name]] <<- has_pkg

        if (!has_pkg) {
          # Deliberately not fatal: renv::dependencies() also reports packages
          # that are named but never actually used, and those apps run fine
          # today. A package that really is needed fails later, when the app
          # source is evaluated.
          webr::install(pkg_name)
        }
      })

      if (isTRUE(devMode)) {
        # Enable client-side dev mode features, namely the error console
        options(shiny.client_devmode = TRUE)
      }

      app <- .shiny_to_httpuv(appDir)
      assign(appName, app, envir = .shiny_app_registry)
      list(status = "ok")
    },
    error = function(cnd) {
      msg <- paste(conditionMessage(cnd), collapse = "\n")
      if (!nzchar(msg)) msg <- "The app failed to start, with no error message."
      # conditionCall() is NULL when the condition was signalled without a call,
      # and deparse() returns one element per line of source. Keep only the first
      # line, marking that there was more, so that a long but meaningful call is
      # trimmed rather than dumped.
      cnd_call <- conditionCall(cnd)
      call_txt <- ""
      if (!is.null(cnd_call)) {
        lines <- deparse(cnd_call)
        call_txt <- if (length(lines) > 1) paste0(lines[[1]], " ...") else lines[[1]]
        # shiny wraps every app body in ..stacktraceon..(), so for any top-level
        # failure the condition's call is the whole app source -- no use to anyone
        # reading the dialog. Report a call only when it names something the
        # author would recognize, and fall back to the bare message otherwise.
        #
        # A prefix rather than a list of names: the shiny shipped here exports
        # ..stacktraceon.. and ..stacktraceoff.., and the prefix covers both
        # without naming internals that may not exist in a given shiny.
        if (startsWith(call_txt, "..stacktrace")) call_txt <- ""
      }
      list(status = "error", message = msg, class = class(cnd), call = call_txt)
    }
  )
}

invisible(0)
`;
