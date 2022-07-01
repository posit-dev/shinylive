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
