import { LSPClient } from "../../../language-server/lsp-client";
import { autocompletion } from "./autocompletion";
import { offsetToPosition } from "./positions";
import { signatureHelp } from "./signatureHelp";
import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";

export function languageServerExtensions(
  lspClient: LSPClient,
  filename: string
): Extension[] {
  return [
    EditorView.updateListener.of((u: ViewUpdate) => {
      if (u.docChanged) {
        // Send content updates to the language server. The easy but slow way to
        // do this is to send the entire document each time. However, we do an
        // optimization, where we send just changes. We collect them in
        // `allChanges` when we call `.iterChanges()`.
        let changeEvent: TextDocumentContentChangeEvent | null = null;
        let nChanges = 0; // Will either be 1 or 2 at the end

        u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          if (nChanges >= 2) return;
          nChanges += 1;

          changeEvent = {
            range: {
              start: offsetToPosition(u.startState.doc, fromA),
              end: offsetToPosition(u.startState.doc, toA),
            },
            text: inserted.sliceString(0),
          };
        });

        // If we got here, then changeEvent must be non-null.
        changeEvent = changeEvent as unknown as TextDocumentContentChangeEvent;

        if (nChanges === 1) {
          // If we had exactly one change, send it to the Language Server.
          lspClient.changeFile(filename, changeEvent);
        } else {
          // If we had more than one change (because of multiple cursors), don't
          // send the changes; send the entire document. This is a bit slower,
          // but necessary. The issue is that in CodeMirror, the changes events
          // are recorded simultaneously, so the start position of each change
          // is the position of each cursor at t0. However, the Language Server
          // expects the changes to be recordered in order, which means that it
          // expects the cursor positions at t0, t1, t2, etc. These two schemes
          // aren't compatible, so we'll just send the entire document.
          lspClient.changeFile(filename, { text: u.view.state.doc.toString() });
        }
      }
    }),
    autocompletion(lspClient, filename),
    signatureHelp(lspClient, filename, true),
  ];
}
