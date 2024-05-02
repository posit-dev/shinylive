import type {
  PublishDiagnosticsParams,
  TextDocumentContentChangeEvent,
} from "vscode-languageserver-protocol";
import { inferFiletype } from "../utils";
import type { LanguageServerClient } from "./client";
import { createUri } from "./client";

/**
 * This is a wrapper around the LanguageServerClient class in client.ts. That
 * file is taken unchanged from Microbit sources. This class fits better with
 * the programming model used in shinylive.
 */
export abstract class LSPClient {
  public client: LanguageServerClient;
  public initPromise: Promise<void>;

  // The constructor for derive
  constructor(client: LanguageServerClient) {
    this.client = client;

    // This promise resolves when initialization is complete. We keep it around
    // so that if someone calls one of the methods before initialization
    // finishes, we can still safely register those callbacks.
    this.initPromise = this.client.initialize();
  }

  public on(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void,
  ): void {
    this.initPromise
      .then(() => {
        this.client.on(event, listener);
      })
      .catch(() => {});
  }

  public off(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void,
  ): void {
    this.initPromise
      .then(() => {
        this.client.off(event, listener);
      })
      .catch(() => {});
  }

  public async createFile(filename: string, content: string): Promise<void> {
    await this.initPromise;

    const languageId = inferFiletype(filename);
    if (!languageId) {
      console.log(`LSPClient: Could not infer language for ${filename}`);
      return;
    }

    await this.client.didOpenTextDocument({
      textDocument: {
        languageId: languageId,
        text: content,
        uri: createUri(filename),
      },
    });
  }

  public async deleteFile(filename: string): Promise<void> {
    await this.initPromise;

    await this.client.didCloseTextDocument({
      textDocument: {
        uri: createUri(filename),
      },
    });
  }

  public async changeFile(
    filename: string,
    changeEvent: TextDocumentContentChangeEvent,
  ): Promise<void> {
    await this.initPromise;
    await this.client.didChangeTextDocument(createUri(filename), [changeEvent]);
  }
}
