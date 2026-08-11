import { Text } from "@codemirror/state";
import { offsetToPosition, positionToOffset } from "./utils";

// "abc\nde\nfghi" -- offsets 0-3 on line 1, 4-6 on line 2, 7-11 on line 3.
const doc = Text.of(["abc", "de", "fghi"]);

describe("offsetToPosition()", () => {
  test.each([
    [0, 1, 0],
    [3, 1, 3],
    [4, 2, 0],
    [6, 2, 2],
    [7, 3, 0],
    [11, 3, 4],
  ])("offset %i is line %i col %i", (offset, line, col) => {
    expect(offsetToPosition(doc, offset)).toEqual({ line, col });
  });

  test("lines are 1-based here, unlike the LSP helpers next door", () => {
    expect(offsetToPosition(doc, 0).line).toBe(1);
  });
});

describe("positionToOffset()", () => {
  test.each([
    [1, 0, 0],
    [1, 3, 3],
    [2, 0, 4],
    [3, 4, 11],
  ])("line %i col %i is offset %i", (line, col, expected) => {
    expect(positionToOffset(doc, { line, col })).toBe(expected);
  });

  test("a column past the end of the line clamps to the line end", () => {
    // Line 2 is "de", so its end is offset 6, not 4 + 99.
    expect(positionToOffset(doc, { line: 2, col: 99 })).toBe(6);
  });

  test("a column past the end of the last line clamps to the document end", () => {
    // Note that this is the same line-end clamp as above; the extra
    // `newOffset > cmDoc.length` check in the source can't fire, because a
    // line's end is never past the end of the document.
    expect(positionToOffset(doc, { line: 3, col: 99 })).toBe(doc.length);
  });
});

describe("round trip", () => {
  test("every offset in the document survives both conversions", () => {
    for (let offset = 0; offset <= doc.length; offset++) {
      expect(positionToOffset(doc, offsetToPosition(doc, offset))).toBe(offset);
    }
  });
});
