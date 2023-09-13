import { createUri, LanguageServerClient } from "./client";
import { LSPClient } from "./lsp-client";
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
} from "vscode-jsonrpc";

let nullClient: NullClient | null = null;

/**
 * This returns a NullClient object. If this is called multiple times, it
 * will return the same object each time.
 */
export function ensureNullClient(): NullClient {
  if (!nullClient) {
    nullClient = new NullClient();
  }
  return nullClient;
}

export class NullMessageReader extends AbstractMessageReader {
  public listen() {
    return { dispose: () => {} };
  }
}

export class NullMessageWriter extends AbstractMessageWriter {
  public async write() {}
  public end(): void {}
}

/**
 * A "null" LSP client that listens for messages but does nothing.
 */
export class NullClient extends LSPClient {
  constructor() {
    const conn = createMessageConnection(
      new NullMessageReader(),
      new NullMessageWriter()
    );
    conn.listen();
    const client = new LanguageServerClient(conn, "en", createUri(""));
    super(client);
  }
}
