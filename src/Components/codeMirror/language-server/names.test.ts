import { nameFromSignature, removeFullyQualifiedName } from "./names";

describe("nameFromSignature()", () => {
  test("keeps everything before the first '('", () => {
    expect(nameFromSignature("shiny.ui.input_slider(id, label)")).toBe(
      "shiny.ui.input_slider",
    );
    expect(nameFromSignature("foo()")).toBe("foo");
  });

  test("stops at the first '(' even when there are nested calls", () => {
    expect(nameFromSignature("foo(bar(1), 2)")).toBe("foo");
  });

  test("a string with no '(' is unspecified, and today gives \"\"", () => {
    // `indexOf("(")` is -1, so `substring(0, -1)` is "". Documenting the
    // behaviour rather than endorsing it: the only caller
    // (`signatureHelp.ts`) always passes a real signature, so this input
    // doesn't occur, and a future fix here would not be a regression.
    expect(nameFromSignature("foo")).toBe("");
  });
});

describe("removeFullyQualifiedName()", () => {
  test("keeps only the last dotted segment", () => {
    expect(
      removeFullyQualifiedName("shiny.ui.input_slider(id, label, min, max)"),
    ).toBe("input_slider(id, label, min, max)");
  });

  test("an unqualified name is unchanged", () => {
    expect(removeFullyQualifiedName("print(x)")).toBe("print(x)");
  });

  test("the argument list is preserved verbatim, dots and all", () => {
    expect(removeFullyQualifiedName("a.b.c(x=os.path.sep)")).toBe(
      "c(x=os.path.sep)",
    );
  });

  test("a string with no '(' is unspecified, and today passes through", () => {
    // Same -1 as in `nameFromSignature()`: `substring(0, -1)` is "" and
    // `substring(-1)` is the whole string, so the qualifier is *not* stripped
    // even though stripping it is what the function is for. Again an input
    // that callers don't produce, so this pins current behaviour rather than a
    // contract.
    expect(removeFullyQualifiedName("a.b.c")).toBe("a.b.c");
  });
});
