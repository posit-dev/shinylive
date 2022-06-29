import { LanguageServerClient } from "./client";
import { pyright } from "./pyright";
import * as LSP from "vscode-languageserver-protocol";
import { PublishDiagnosticsParams } from "vscode-languageserver-protocol";

let pyrightClient: PyrightClient | null = null;

export function ensurePyrightClient(): PyrightClient {
  if (!pyrightClient) {
    pyrightClient = new PyrightClient();
  }

  return pyrightClient;
}

export class PyrightClient {
  public client: LanguageServerClient;
  public initPromise: Promise<void>;

  constructor() {
    const locale = "en";
    this.client = pyright(locale)!;
    // This promise resolves when initialization is complete. We keep it around
    // so that if someone calls  before initialization finishes, we
    // can still safely register those callbacks.
    this.initPromise = this.client.initialize();
  }

  public on(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void
  ): void {
    this.initPromise.then(() => {
      this.client.on(event, listener);
    });
  }

  public off(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void
  ): void {
    this.initPromise.then(() => {
      this.client.off(event, listener);
    });
  }

  public createFile(filename: string, content: string): void {
    (async (): Promise<void> => {
      await this.initPromise;
      const uri = `file:///src/${filename}`;
      const params: LSP.CreateFile = {
        uri,
        kind: "create",
      };
      this.client.connection.sendNotification("pyright/createFile", params);
      this.client.didOpenTextDocument({
        textDocument: {
          languageId: "python",
          text: content,
          uri,
        },
      });
    })();
  }

  public deleteFile(filename: string): void {
    (async (): Promise<void> => {
      await this.initPromise;
      const uri = `file:///src/${filename}`;
      const params: LSP.DeleteFile = {
        uri,
        kind: "delete",
      };
      this.client.connection.sendNotification("pyright/deleteFile", params);
      this.client.didCloseTextDocument({
        textDocument: {
          uri,
        },
      });
    })();
  }

  public changeFile(filename: string, content: string): void {
    (async (): Promise<void> => {
      await this.initPromise;
      const uri = `file:///src/${filename}`;
      this.client.didChangeTextDocument(uri, [
        {
          text: content,
        },
      ]);
    })();
  }
}
