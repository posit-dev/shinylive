import { createMessageConnection } from "vscode-jsonrpc";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from "vscode-jsonrpc/browser";
import type * as LSP from "vscode-languageserver-protocol";
import * as utils from "../utils";
import { currentScriptDir } from "../utils";
import { LanguageServerClient, createUri } from "./client";

// This is modified by bin/update-pyright.sh
const workerScriptName = "pyright.worker.js";

let pyrightClient: PyrightLspClient | null = null;

/**
 * This returns a PyrightClient object. If this is called multiple times, it
 * will return the same object each time.
 */
export function ensurePyrightClient(): PyrightLspClient {
  if (!pyrightClient) {
    pyrightClient = new PyrightLspClient();
  }
  return pyrightClient;
}

/**
 * The in-browser Pyright Language Server needs a few extra notification
 * messages over and above the standard Language Server Protocol. This class
 * sends those messages.
 */
export class PyrightLspClient extends LanguageServerClient {
  constructor() {
    const workerScript =
      utils.currentScriptDir() + `/pyright/${workerScriptName}`;

    const foreground = new Worker(workerScript, {
      name: "Pyright-foreground",
    });
    const connection = createMessageConnection(
      new BrowserMessageReader(foreground),
      new BrowserMessageWriter(foreground),
    );
    // TODO: Add a way to shut down background thread
    const workers: Worker[] = [foreground];
    connection.onDispose(() => {
      workers.forEach((w) => w.terminate());
    });

    connection.listen();

    super(connection, "en", createUri(""));
  }

  public override async createFile(
    filename: string,
    content: string,
  ): Promise<void> {
    const params: LSP.CreateFile = {
      uri: createUri(filename),
      kind: "create",
    };
    await this.connection.sendNotification("pyright/createFile", params);
    await super.createFile(filename, content);
  }

  public override async deleteFile(filename: string): Promise<void> {
    const params: LSP.DeleteFile = {
      uri: createUri(filename),
      kind: "delete",
    };
    await this.connection.sendNotification("pyright/deleteFile", params);
    await super.deleteFile(filename);
  }

  /**
   * This is a replacement for LanguageServerClient.getInitializationOptions().
   * The primary purpose of this version is so that esbuild won't include the json
   * file in .js bundle. This works because uses fetch() instead of import().
   */
  override async getInitializationOptions(): Promise<any> {
    const response = await fetch(
      currentScriptDir() + "/pyright/typeshed.en.json",
    );
    const typeshed = await response.json();

    return {
      files: typeshed,
    };
  }
}
