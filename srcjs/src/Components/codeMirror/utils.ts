import { Text } from "@codemirror/text";
import { EditorView } from "@codemirror/view";

export type CursorPosition = { line: number; col: number };

export function offsetToPosition(cmDoc: Text, offset: number): CursorPosition {
  const line = cmDoc.lineAt(offset);
  return { line: line.number, col: offset - line.from };
}

export function positionToOffset(cmDoc: Text, pos: CursorPosition): number {
  const newOffset = cmDoc.line(pos.line).from + pos.col;

  // If the new offset is beyond the end of the document, just go to the end.
  if (newOffset > cmDoc.length) {
    return cmDoc.length;
  }
  return newOffset;
}

export function getSelectedText(cmView: EditorView): string {
  const cmState = cmView.state;
  return cmState.sliceDoc(
    cmState.selection.main.from,
    cmState.selection.main.to
  );
}

export function getCurrentLineText(cmView: EditorView): string {
  const cmState = cmView.state;
  const offset = cmState.selection.main.head;
  const pos = offsetToPosition(cmState.doc, offset);
  const lineText = cmState.doc.line(pos.line).text;
  return lineText;
}

export function moveCursorToNextLine(cmView: EditorView): void {
  const cmState = cmView.state;
  const offset = cmState.selection.main.head;
  const pos = offsetToPosition(cmState.doc, offset);
  pos.line += 1;

  // Don't go past the bottom
  if (pos.line > cmState.doc.lines) {
    return;
  }

  const nextLineOffset = positionToOffset(cmState.doc, pos);
  cmView.dispatch({ selection: { anchor: nextLineOffset } });
}
