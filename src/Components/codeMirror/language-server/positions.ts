/**
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { Text } from "@codemirror/state";
import { Position, Range } from "vscode-languageserver-protocol";

// See https://microsoft.github.io/language-server-protocol/specifications/specification-3-17/#position

export const positionToOffset = (
  document: Text,
  position: Position
): number | undefined => {
  if (position.line >= document.lines) {
    return undefined;
  }
  const offset = document.line(position.line + 1).from + position.character;
  if (offset > document.length) return;
  return offset;
};

export const offsetToPosition = (document: Text, offset: number): Position => {
  const line = document.lineAt(offset);
  return {
    line: line.number - 1,
    character: offset - line.from,
  };
};

export const inRange = (range: Range, position: Position): boolean =>
  !isBefore(position, range.start) && !isAfter(position, range.end);

const isBefore = (p1: Position, p2: Position): boolean =>
  p1.line < p2.line || (p1.line === p2.line && p1.character < p2.character);

const isAfter = (p1: Position, p2: Position): boolean =>
  p1.line > p2.line || (p1.line === p2.line && p1.character > p2.character);
