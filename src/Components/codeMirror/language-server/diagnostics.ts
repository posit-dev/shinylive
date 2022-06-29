/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
// import { Diagnostic } from "../lint/lint";
import { positionToOffset } from "./positions";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";

/// Describes a problem or hint for a piece of code.
export interface Diagnostic {
  /// The start position of the relevant text.
  from: number;
  /// The end position. May be equal to `from`, though actually
  /// covering text is preferable.
  to: number;
  /// The severity of the problem. This will influence how it is
  /// displayed.
  severity: "hint" | "info" | "warning" | "error";
  /// An optional source string indicating where the diagnostic is
  /// coming from. You can put the name of your linter here, if
  /// applicable.
  source?: string;
  /// The message associated with this diagnostic.
  message: string;
  /// An optional array of actions that can be taken on this
  /// diagnostic.
  actions?: readonly Action[];
  /// Tags control alternative presentations for diagnostics.
  /// Currently supported tags are `"unnecessary"` and `"deprecated"`
  /// which are formatted with opacity and strikethrough respectively.
  tags?: string[];
}

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
  [LSP.DiagnosticSeverity.Hint]: "hint",
} as const;

export const diagnosticsMapping = (
  document: Text,
  lspDiagnostics: LSP.Diagnostic[]
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
          tags: tags ? tags.map(convertTag) : undefined,
        };
      }
      return undefined;
    })
    .filter((x): x is Diagnostic => Boolean(x));

const convertTag = (tag: LSP.DiagnosticTag): string => {
  switch (tag) {
    case LSP.DiagnosticTag.Deprecated:
      return "deprecated";
    case LSP.DiagnosticTag.Unnecessary:
      return "unnecessary";
    default:
      throw new Error("Unsupported tag.");
  }
};
