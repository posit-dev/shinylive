/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";
import { positionToOffset } from "./positions";

/// An action associated with a diagnostic.
export interface Action {
  /// The label to show to the user. Should be relatively short.
  name: string;
  /// The function to call when the user activates this action. Is
  /// given the diagnostic's _current_ position, which may have
  /// changed since the creation of the diagnostic due to editing.
  apply: (view: EditorView, from: number, to: number) => void;
}

const severityMapping = {
  [LSP.DiagnosticSeverity.Error]: "error",
  [LSP.DiagnosticSeverity.Warning]: "warning",
  [LSP.DiagnosticSeverity.Information]: "info",
  //   [LSP.DiagnosticSeverity.Hint]: "hint",
  [LSP.DiagnosticSeverity.Hint]: "info",
} as const;

export const diagnosticsMapping = (
  document: Text,
  lspDiagnostics: LSP.Diagnostic[],
): Diagnostic[] =>
  lspDiagnostics
    .map(({ range, message, severity, tags }): Diagnostic | undefined => {
      const from = positionToOffset(document, range.start);
      const to = positionToOffset(document, range.end);
      // Skip if we can't map to the current document.
      if (from !== undefined && to !== undefined) {
        return {
          from,
          to,
          // Missing severity is client defined. Warn for now.
          severity: severityMapping[severity ?? LSP.DiagnosticSeverity.Warning],
          message,
        };
      }
      return undefined;
    })
    .filter((x): x is Diagnostic => Boolean(x));

/**
 * Given an EditorState object and a LSP.Diagnostic[] for that state's
 * document, generate and return a Transaction for that EditorState that
 * that has diagnostics added to it.
 */
export function diagnosticToTransaction(
  editorState: EditorState,
  lspDiagnostics: LSP.Diagnostic[],
): Transaction {
  const diagnostics = diagnosticsMapping(editorState.doc, lspDiagnostics);

  const diagnosticsTransaction = editorState.update(
    setDiagnostics(editorState, diagnostics),
  );

  return diagnosticsTransaction;
}
