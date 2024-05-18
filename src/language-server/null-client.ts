import {
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
} from "vscode-jsonrpc";
import { LanguageServerClient, createUri } from "./client";

let nullClient: NullLspClient | null = null;

/**
 * This returns a NullClient object. If this is called multiple times, it
 * will return the same object each time.
 */
export function ensureNullClient(): NullLspClient {
  if (!nullClient) {
    nullClient = new NullLspClient();
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
export class NullLspClient extends LanguageServerClient {
  constructor() {
    const conn = createMessageConnection(
      new NullMessageReader(),
      new NullMessageWriter(),
    );
    conn.listen();
    super(conn, "en", createUri(""));
  }
}
