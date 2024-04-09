import type * as LSP from "vscode-languageserver-protocol";
import { currentScriptDir } from "../utils";
import { createUri } from "./client";
import { LSPClient } from "./lsp-client";
import { pyright } from "./pyright";

let pyrightClient: PyrightClient | null = null;

/**
 * This returns a PyrightClient object. If this is called multiple times, it
 * will return the same object each time.
 */
export function ensurePyrightClient(): PyrightClient {
  if (!pyrightClient) {
    pyrightClient = new PyrightClient();
  }
  return pyrightClient;
}

/**
 * The in-browser Pyright Language Server needs a few extra notification
 * messages over and above the standard Language Server Protocol. This class
 * sends those messages.
 */
export class PyrightClient extends LSPClient {
  constructor() {
    const locale = "en";
    const client = pyright(locale)!;
    // @ts-ignore: LanguageServerClient.getInitializationOptions() is marked
    // as private for TS, but we can just replace it.
    client.getInitializationOptions = getInitializationOptions;
    super(client);
  }

  public override async createFile(
    filename: string,
    content: string,
  ): Promise<void> {
    const params: LSP.CreateFile = {
      uri: createUri(filename),
      kind: "create",
    };
    await this.client.connection.sendNotification("pyright/createFile", params);
    await super.createFile(filename, content);
  }

  public override async deleteFile(filename: string): Promise<void> {
    const params: LSP.DeleteFile = {
      uri: createUri(filename),
      kind: "delete",
    };
    await this.client.connection.sendNotification("pyright/deleteFile", params);
    await super.deleteFile(filename);
  }
}

/**
 * This is a replacement for LanguageServerClient.getInitializationOptions().
 * The primary purpose of this version is so that esbuild won't include the json
 * file in .js bundle. This works because uses fetch() instead of import().
 */
async function getInitializationOptions(): Promise<any> {
  const response = await fetch(
    currentScriptDir() + "/pyright/typeshed.en.json",
  );
  const typeshed = await response.json();

  return {
    files: typeshed,
  };
}
