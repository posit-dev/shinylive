import { Text } from "@codemirror/state";
import { inRange, offsetToPosition, positionToOffset } from "./positions";

// "abc\nde\nfghi" -- offsets 0-3 on line 0, 4-6 on line 1, 7-11 on line 2.
const doc = Text.of(["abc", "de", "fghi"]);

describe("positionToOffset()", () => {
  test.each([
    [0, 0, 0],
    [0, 3, 3],
    [1, 0, 4],
    [1, 2, 6],
    [2, 0, 7],
    [2, 4, 11],
  ])("line %i character %i is offset %i", (line, character, expected) => {
    expect(positionToOffset(doc, { line, character })).toBe(expected);
  });

  test("a line past the end of the document is undefined", () => {
    expect(positionToOffset(doc, { line: 3, character: 0 })).toBeUndefined();
    expect(positionToOffset(doc, { line: 99, character: 0 })).toBeUndefined();
  });

  test("a character past the end of the document is undefined", () => {
    expect(positionToOffset(doc, { line: 2, character: 100 })).toBeUndefined();
  });

  test("a character past the end of its line is not clamped to the line", () => {
    // The bounds check is against the whole document, not the line, so a
    // character overshoot on an early line silently lands on a later one --
    // line 0 is "abc", but character 10 gives offset 10, which is on line 2.
    // The `codeMirror/utils.ts` pair of these functions does clamp.
    expect(positionToOffset(doc, { line: 0, character: 10 })).toBe(10);
  });

  test("LSP positions are 0-based where codemirror lines are 1-based", () => {
    // Line 0 in LSP is line 1 in codemirror, whose `from` is 0. Asserting the
    // literal rather than `doc.line(1).from`, which would just restate the
    // implementation.
    expect(positionToOffset(doc, { line: 0, character: 0 })).toBe(0);
    expect(positionToOffset(doc, { line: 1, character: 0 })).toBe(4);
  });
});

describe("offsetToPosition()", () => {
  test.each([
    [0, 0, 0],
    [3, 0, 3],
    [4, 1, 0],
    [6, 1, 2],
    [7, 2, 0],
    [11, 2, 4],
  ])("offset %i is line %i character %i", (offset, line, character) => {
    expect(offsetToPosition(doc, offset)).toEqual({ line, character });
  });
});

describe("round trip", () => {
  test("every offset in the document survives both conversions", () => {
    for (let offset = 0; offset <= doc.length; offset++) {
      expect(positionToOffset(doc, offsetToPosition(doc, offset))).toBe(offset);
    }
  });
});

describe("inRange()", () => {
  const range = {
    start: { line: 1, character: 2 },
    end: { line: 3, character: 4 },
  };

  test.each([
    [{ line: 1, character: 2 }, true, "the start boundary is inclusive"],
    [{ line: 3, character: 4 }, true, "the end boundary is inclusive"],
    [{ line: 2, character: 0 }, true, "a line strictly inside is in range"],
    [{ line: 1, character: 1 }, false, "before the start character"],
    [{ line: 0, character: 99 }, false, "before the start line"],
    [{ line: 3, character: 5 }, false, "after the end character"],
    [{ line: 4, character: 0 }, false, "after the end line"],
  ])("%p is %p -- %s", (position, expected) => {
    expect(inRange(range, position)).toBe(expected);
  });

  test("an empty range contains only its own position", () => {
    const empty = {
      start: { line: 2, character: 5 },
      end: { line: 2, character: 5 },
    };
    expect(inRange(empty, { line: 2, character: 5 })).toBe(true);
    expect(inRange(empty, { line: 2, character: 4 })).toBe(false);
    expect(inRange(empty, { line: 2, character: 6 })).toBe(false);
  });
});
