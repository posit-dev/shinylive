/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { createMessageConnection } from "vscode-jsonrpc";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from "vscode-jsonrpc/browser";
import * as utils from "../utils";
import { LanguageServerClient, createUri } from "./client";

// This is modified by bin/update-pyright.sh
const workerScriptName = "pyright.worker.js";

/**
 * Creates Pyright workers and corresponding client.
 *
 * These have the same lifetime as the app.
 */
export const pyright = (language: string): LanguageServerClient | undefined => {
  // For jest.
  if (!window.Worker) {
    return undefined;
  }
  // Needed to support review branches that use a path location.
  // const { origin, pathname } = window.location;
  // const base = `${origin}${pathname}${pathname.endsWith("/") ? "" : "/"}`;
  // const workerScript = `${base}workers/${workerScriptName}`;
  const workerScript =
    utils.currentScriptDir() + `/pyright/${workerScriptName}`;
  const foreground = new Worker(workerScript, {
    name: "Pyright-foreground",
  });
  const connection = createMessageConnection(
    new BrowserMessageReader(foreground),
    new BrowserMessageWriter(foreground),
  );
  const workers: Worker[] = [foreground];
  connection.onDispose(() => {
    workers.forEach((w) => w.terminate());
  });

  connection.listen();

  return new LanguageServerClient(connection, language, createUri(""));
};
