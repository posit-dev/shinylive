import { EditorState, Text } from "@codemirror/state";
import * as LSP from "vscode-languageserver-protocol";
import { diagnosticToTransaction, diagnosticsMapping } from "./diagnostics";

// "abc\nde\nfghi" -- offsets 0-3 on LSP line 0, 4-6 on line 1, 7-11 on line 2.
const doc = Text.of(["abc", "de", "fghi"]);

function lspDiagnostic(
  overrides: Partial<LSP.Diagnostic> = {},
): LSP.Diagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 3 },
    },
    message: "something is wrong",
    severity: LSP.DiagnosticSeverity.Error,
    ...overrides,
  };
}

describe("diagnosticsMapping()", () => {
  test("maps LSP ranges to document offsets", () => {
    expect(diagnosticsMapping(doc, [lspDiagnostic()])).toEqual([
      { from: 0, to: 3, severity: "error", message: "something is wrong" },
    ]);
  });

  test("maps a range that spans lines", () => {
    const mapped = diagnosticsMapping(doc, [
      lspDiagnostic({
        range: {
          start: { line: 1, character: 1 },
          end: { line: 2, character: 2 },
        },
      }),
    ]);
    expect(mapped[0].from).toBe(5);
    expect(mapped[0].to).toBe(9);
  });

  test.each([
    [LSP.DiagnosticSeverity.Error, "error"],
    [LSP.DiagnosticSeverity.Warning, "warning"],
    [LSP.DiagnosticSeverity.Information, "info"],
    // Hint is deliberately folded into "info" rather than codemirror's "hint".
    [LSP.DiagnosticSeverity.Hint, "info"],
  ])("severity %i becomes %p", (severity, expected) => {
    expect(
      diagnosticsMapping(doc, [lspDiagnostic({ severity })])[0].severity,
    ).toBe(expected);
  });

  test("a missing severity is treated as a warning", () => {
    expect(
      diagnosticsMapping(doc, [lspDiagnostic({ severity: undefined })])[0]
        .severity,
    ).toBe("warning");
  });

  test("diagnostics that don't map into the document are dropped", () => {
    const mapped = diagnosticsMapping(doc, [
      // Start line past the end of the document.
      lspDiagnostic({
        range: {
          start: { line: 9, character: 0 },
          end: { line: 9, character: 1 },
        },
      }),
      // End character past the end of the document.
      lspDiagnostic({
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 99 },
        },
      }),
      lspDiagnostic({ message: "this one is fine" }),
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0].message).toBe("this one is fine");
  });

  test("an empty list maps to an empty list", () => {
    expect(diagnosticsMapping(doc, [])).toEqual([]);
  });

  test("order is preserved", () => {
    const mapped = diagnosticsMapping(doc, [
      lspDiagnostic({ message: "first" }),
      lspDiagnostic({ message: "second" }),
    ]);
    expect(mapped.map((d) => d.message)).toEqual(["first", "second"]);
  });
});

describe("diagnosticToTransaction()", () => {
  // EditorState is pure state -- no DOM, no EditorView -- so this needs no
  // browser even though it is codemirror.
  const state = EditorState.create({ doc: doc.toString() });

  test("returns a transaction for the given state", () => {
    const tr = diagnosticToTransaction(state, [lspDiagnostic()]);

    expect(tr.startState).toBe(state);
    // The diagnostics ride in on effects, not on a document change.
    expect(tr.docChanged).toBe(false);
    expect(tr.effects.length).toBeGreaterThan(0);
  });

  test("an empty diagnostic list still gives a usable transaction", () => {
    const tr = diagnosticToTransaction(state, []);

    expect(tr.startState).toBe(state);
    expect(tr.docChanged).toBe(false);
  });

  test("the mapped positions survive into the new state", () => {
    // Range 0-3 on LSP line 0 is offsets 0-3, and applying the transaction
    // should leave the document alone while carrying that range along.
    const tr = diagnosticToTransaction(state, [lspDiagnostic()]);

    expect(tr.state.doc.toString()).toBe(doc.toString());
    expect(diagnosticsMapping(state.doc, [lspDiagnostic()])).toEqual([
      { from: 0, to: 3, severity: "error", message: "something is wrong" },
    ]);
  });
});
