/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { EventEmitter } from "events";
import {
  CompletionRequest,
  DiagnosticSeverity,
  DiagnosticTag,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  type CompletionList,
  type CompletionParams,
  type Diagnostic,
  type DidCloseTextDocumentParams,
  type InitializeParams,
  type MessageConnection,
  type PublishDiagnosticsParams,
  type ServerCapabilities,
  type TextDocumentContentChangeEvent,
  type TextDocumentItem,
} from "vscode-languageserver-protocol";
import { inferFiletype } from "../utils";

/**
 * Create a URI for a source document under the default root of file:///src/.
 */
export const createUri = (name: string) => `file:///src/${name}`;

/**
 * Owns the connection.
 *
 * Exposes methods for the core text document notifications from
 * client to server for the app to implement.
 *
 * Tracks and exposes the diagnostics.
 */
export class LanguageServerClient extends EventEmitter {
  /**
   * The capabilities of the server we're connected to.
   * Populated after initialize.
   */
  capabilities: ServerCapabilities | undefined;
  private versions: Map<string, number> = new Map();
  private diagnostics: Map<string, Diagnostic[]> = new Map();
  private initializePromise: Promise<void> | undefined;

  public initPromise: Promise<void>;

  constructor(
    public connection: MessageConnection,
    private locale: string,
    public rootUri: string,
  ) {
    super();
    // This promise resolves when initialization is complete. We keep it around
    // so that if someone calls one of the methods before initialization
    // finishes, we can still safely register those callbacks.
    this.initPromise = this.initialize();
  }

  on(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void,
  ): this {
    this.initPromise
      .then(() => {
        super.on(event, listener);
      })
      .catch(() => {});
    return this;
  }

  off(
    event: "diagnostics",
    listener: (params: PublishDiagnosticsParams) => void,
  ): this {
    this.initPromise
      .then(() => {
        super.off(event, listener);
      })
      .catch(() => {});
    return this;
  }

  currentDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  allDiagnostics(): Diagnostic[] {
    return Array.from(this.diagnostics.values()).flat();
  }

  errorCount(): number {
    return this.allDiagnostics().filter(
      (e) => e.severity === DiagnosticSeverity.Error,
    ).length;
  }

  /**
   * Initialize or wait for in-progress initialization.
   */
  async initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = (async () => {
      // this.connection.onNotification(LogMessageNotification.type, (params) =>
      //   console.log("[LS]", params.message)
      // );

      this.connection.onNotification(
        PublishDiagnosticsNotification.type,
        (params) => {
          this.diagnostics.set(params.uri, params.diagnostics);
          // Republish as you can't listen twice.
          this.emit("diagnostics", params);
        },
      );
      this.connection.onRequest(RegistrationRequest.type, () => {
        // Ignore. I don't think we should get these at all given our
        // capabilities, but Pyright is sending one anyway.
      });

      const initializeParams: InitializeParams = {
        locale: this.locale,
        capabilities: {
          textDocument: {
            moniker: {},
            synchronization: {
              willSave: false,
              didSave: false,
              willSaveWaitUntil: false,
            },
            completion: {
              completionItem: {
                snippetSupport: false,
                commitCharactersSupport: true,
                documentationFormat: ["markdown"],
                deprecatedSupport: false,
                preselectSupport: false,
              },
              contextSupport: true,
            },
            signatureHelp: {
              signatureInformation: {
                documentationFormat: ["markdown"],
                activeParameterSupport: true,
                parameterInformation: {
                  labelOffsetSupport: true,
                },
              },
            },
            hover: {
              contentFormat: ["markdown"],
            },
            publishDiagnostics: {
              tagSupport: {
                valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated],
              },
            },
          },
          workspace: {
            workspaceFolders: true,
            didChangeConfiguration: {},
            configuration: true,
          },
        },
        initializationOptions: await this.getInitializationOptions(),
        processId: null,
        // Do we need both of these?
        rootUri: this.rootUri,
        workspaceFolders: [
          {
            name: "src",
            uri: this.rootUri,
          },
        ],
      };
      const { capabilities } = await this.connection.sendRequest(
        InitializeRequest.type,
        initializeParams,
      );
      this.capabilities = capabilities;
      await this.connection.sendNotification(InitializedNotification.type, {});
    })();
    return this.initializePromise;
  }

  async getInitializationOptions(): Promise<any> {
    // This is commented out because we have shimmed in our own version of this
    // function. When this code is run through esbuild, esbuild will include the
    // json file in the bundle. The shimmed version effectively does the same
    // thing, but it loads the json file dynamically.
    //
    // const typeshed = await retryAsyncLoad(() => {
    //   switch (this.locale) {
    //     // New languages go here.
    //     default:
    //       return import(`./typeshed.en.json`);
    //   }
    // });
    // return {
    //   files: typeshed,
    //   // Custom option in our Pyright version
    //   diagnosticStyle: "simplified",
    // };
  }

  public async createFile(filename: string, content: string): Promise<void> {
    await this.initPromise;

    const languageId = inferFiletype(filename);
    if (!languageId) {
      console.log(
        `LanguageServerClientExtended: Could not infer language for ${filename}`,
      );
      return;
    }

    await this.didOpenTextDocument({
      textDocument: {
        languageId: languageId,
        text: content,
        uri: createUri(filename),
      },
    });
  }

  public async deleteFile(filename: string): Promise<void> {
    await this.initPromise;

    await this.didCloseTextDocument({
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
    await this.didChangeTextDocument(createUri(filename), [changeEvent]);
  }

  async didOpenTextDocument(params: {
    textDocument: Omit<TextDocumentItem, "version">;
  }): Promise<void> {
    await this.connection.sendNotification(
      DidOpenTextDocumentNotification.type,
      {
        textDocument: {
          ...params.textDocument,
          version: this.nextVersion(params.textDocument.uri),
        },
      },
    );
  }

  // We close Python files that are deleted. We never write to the file system,
  // so that way they're effectively deleted.
  async didCloseTextDocument(
    params: DidCloseTextDocumentParams,
  ): Promise<void> {
    await this.connection.sendNotification(
      DidCloseTextDocumentNotification.type,
      params,
    );
  }

  async didChangeTextDocument(
    uri: string,
    contentChanges: TextDocumentContentChangeEvent[],
  ): Promise<void> {
    await this.connection.sendNotification(
      DidChangeTextDocumentNotification.type,
      {
        textDocument: {
          uri,
          version: this.nextVersion(uri),
        },
        contentChanges,
      },
    );
  }

  async completionRequest(params: CompletionParams): Promise<CompletionList> {
    const results = await this.connection.sendRequest(
      CompletionRequest.type,
      params,
    );
    if (!results) {
      // Not clear how this should be handled.
      return { items: [], isIncomplete: true };
    }
    return "items" in results
      ? results
      : { items: results, isIncomplete: true };
  }

  dispose() {
    this.connection.dispose();
  }

  private nextVersion(uri: string): number {
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    return version;
  }
}
