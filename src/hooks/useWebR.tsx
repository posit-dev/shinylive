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

const load_r_pre =
`
invisible(0)
`
