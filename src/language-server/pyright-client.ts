import { createUri } from "./client";
import { LSPClient } from "./lsp-client";
import { pyright } from "./pyright";
import * as LSP from "vscode-languageserver-protocol";

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

  public override createFile(filename: string, content: string): void {
    const params: LSP.CreateFile = {
      uri: createUri(filename),
      kind: "create",
    };
    this.client.connection.sendNotification("pyright/createFile", params);
    super.createFile(filename, content);
  }

  public override deleteFile(filename: string): void {
    const params: LSP.DeleteFile = {
      uri: createUri(filename),
      kind: "delete",
    };
    this.client.connection.sendNotification("pyright/deleteFile", params);
    super.deleteFile(filename);
  }
}

/**
 * This is a replacement for LanguageServerClient.getInitializationOptions().
 * The primary purpose of this version is so that esbuild won't include the json
 * file in .js bundle. This works because uses fetch() instead of import().
 */
async function getInitializationOptions(): Promise<any> {
  const response = await fetch("../shinylive/pyright/typeshed.en.json");
  const typeshed = await response.json();

  return {
    files: typeshed,
  };
}
