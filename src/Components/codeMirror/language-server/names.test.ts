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

  test("a string with no '(' gives the empty string", () => {
    // `substring(0, -1)` is "". Documenting the behaviour, as above.
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

  test("a string with no '(' is passed through unchanged", () => {
    // `indexOf("(")` is -1, so `substring(0, -1)` is "" and `substring(-1)` is
    // the whole string: the qualifier is not stripped. Documenting the
    // behaviour rather than endorsing it -- callers pass real signatures.
    expect(removeFullyQualifiedName("a.b.c")).toBe("a.b.c");
  });
});
