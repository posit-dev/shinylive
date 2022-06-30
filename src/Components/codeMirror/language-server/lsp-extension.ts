import { LSPClient } from "../../../language-server/lsp-client";
import { autocompletion } from "./autocompletion";
import { signatureHelp } from "./signatureHelp";
import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";

export function languageServerExtensions(
  lspClient: LSPClient,
  filename: string
): Extension[] {
  return [
    EditorView.updateListener.of((u: ViewUpdate) => {
      if (u.docChanged) {
        lspClient.changeFile(filename, u.view.state.doc.toString());
      }
    }),
    autocompletion(lspClient, filename),
    signatureHelp(lspClient, filename, true),
  ];
}
