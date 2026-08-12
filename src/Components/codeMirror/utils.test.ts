import { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getCurrentLineText,
  getSelectedText,
  moveCursorToNextLine,
  offsetToPosition,
  positionToOffset,
} from "./utils";

// "abc\nde\nfghi" -- offsets 0-3 on line 1, 4-6 on line 2, 7-11 on line 3.
const doc = Text.of(["abc", "de", "fghi"]);

// The three functions below take an EditorView, but only ever read `.state` and
// call `.dispatch()` -- they never touch the DOM. So a stub is enough, and they
// don't need a real editor in a real browser.
function stubView(anchor: number, head: number = anchor) {
  const dispatched: { selection?: { anchor: number } }[] = [];
  const view = {
    state: EditorState.create({
      doc: doc.toString(),
      selection: { anchor, head },
    }),
    dispatch: (spec: { selection?: { anchor: number } }) =>
      dispatched.push(spec),
  } as unknown as EditorView;

  return { view, dispatched };
}

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

describe("getSelectedText()", () => {
  test("returns the selected range", () => {
    expect(getSelectedText(stubView(0, 3).view)).toBe("abc");
    expect(getSelectedText(stubView(4, 11).view)).toBe("de\nfghi");
  });

  test("returns an empty string for a bare cursor", () => {
    expect(getSelectedText(stubView(5).view)).toBe("");
  });

  test("reads the range in document order, whichever way it was made", () => {
    // A selection dragged upwards has head < anchor, but `main.from`/`main.to`
    // are always ordered, so the text comes back the same either way.
    expect(getSelectedText(stubView(3, 0).view)).toBe("abc");
  });
});

describe("getCurrentLineText()", () => {
  test.each([
    [0, "abc"],
    [3, "abc"],
    [4, "de"],
    [7, "fghi"],
    [11, "fghi"],
  ])("the cursor at offset %i is on line %j", (offset, expected) => {
    expect(getCurrentLineText(stubView(offset).view)).toBe(expected);
  });

  test("follows the head of a selection, not its anchor", () => {
    expect(getCurrentLineText(stubView(0, 7).view)).toBe("fghi");
  });
});

describe("moveCursorToNextLine()", () => {
  test("keeps the column when the next line is long enough", () => {
    const { view, dispatched } = stubView(1); // line 1, col 1
    moveCursorToNextLine(view);
    // Line 2 starts at offset 4, so col 1 on it is offset 5.
    expect(dispatched).toEqual([{ selection: { anchor: 5 } }]);
  });

  test("clamps to the end of the next line when it is shorter", () => {
    const { view, dispatched } = stubView(3); // line 1, col 3; line 2 is "de"
    moveCursorToNextLine(view);
    expect(dispatched).toEqual([{ selection: { anchor: 6 } }]);
  });

  test("does nothing on the last line", () => {
    const { view, dispatched } = stubView(8);
    moveCursorToNextLine(view);
    expect(dispatched).toEqual([]);
  });
});
