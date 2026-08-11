import {
  parseCodeBlock,
  parseFileContents,
  processQuartoArgs,
} from "./parse-codeblock";

describe("processQuartoArgs()", () => {
  test("no args leaves the lines alone", () => {
    const lines = ["def foo(x):", "  return x + 1"];
    const result = processQuartoArgs(lines);
    expect(result.lines).toEqual(lines);
    // js-yaml returns undefined for an empty document; that's normalized to an
    // empty object so callers can apply their defaults to it.
    expect(result.quartoArgs).toEqual({});
  });

  test.each([
    ["#| ", "#| standalone: true"],
    ["# | ", "# | standalone: true"],
    ["##| ", "##| standalone: true"],
  ])("recognizes the %p comment prefix", (_prefix, line) => {
    const result = processQuartoArgs([line, "app = 1"]);
    expect(result.quartoArgs).toEqual({ standalone: true });
    expect(result.lines).toEqual(["app = 1"]);
  });

  test("parses several args as YAML", () => {
    const result = processQuartoArgs([
      "#| standalone: true",
      "#| components: [editor, viewer]",
      "#| layout: vertical",
      "app = 1",
    ]);
    expect(result.quartoArgs).toEqual({
      standalone: true,
      components: ["editor", "viewer"],
      layout: "vertical",
    });
    expect(result.lines).toEqual(["app = 1"]);
  });

  test("swallows up to one blank line after the args", () => {
    const result = processQuartoArgs([
      "#| standalone: true",
      "",
      "",
      "app = 1",
    ]);
    expect(result.lines).toEqual(["", "app = 1"]);
  });

  test("stops at the first non-arg line", () => {
    const result = processQuartoArgs([
      "#| standalone: true",
      "app = 1",
      "#| layout: vertical",
    ]);
    expect(result.quartoArgs).toEqual({ standalone: true });
    // The later arg comment is content, not an arg.
    expect(result.lines).toEqual(["app = 1", "#| layout: vertical"]);
  });

  test("a plain comment is not an arg", () => {
    const result = processQuartoArgs(["# not an arg", "app = 1"]);
    expect(result.quartoArgs).toEqual({});
    expect(result.lines).toEqual(["# not an arg", "app = 1"]);
  });
});

describe("parseFileContents()", () => {
  test("a bare code block becomes one file with the default name", () => {
    expect(parseFileContents(["def foo(x):", "  return x"], "app.py")).toEqual([
      { name: "app.py", content: "def foo(x):\n  return x", type: "text" },
    ]);
  });

  test("leading blank lines are dropped", () => {
    expect(parseFileContents(["", "", "x = 1"], "app.py")).toEqual([
      { name: "app.py", content: "x = 1", type: "text" },
    ]);
  });

  test("blank lines inside content are kept", () => {
    expect(parseFileContents(["a = 1", "", "b = 2"], "app.py")).toEqual([
      { name: "app.py", content: "a = 1\n\nb = 2", type: "text" },
    ]);
  });

  test("splits on '## file:' headers", () => {
    const files = parseFileContents(
      [
        "## file: app.py",
        "from util import bar",
        "",
        "## file: util.py",
        "def bar(x):",
        "  return x + 2",
      ],
      "app.py",
    );

    expect(files).toEqual([
      { name: "app.py", content: "from util import bar\n", type: "text" },
      { name: "util.py", content: "def bar(x):\n  return x + 2", type: "text" },
    ]);
  });

  test("an empty file between two headers is preserved", () => {
    const files = parseFileContents(
      ["## file: empty.txt", "## file: app.py", "x = 1"],
      "app.py",
    );
    expect(files.map((f) => f.name)).toEqual(["empty.txt", "app.py"]);
    expect(files[0].content).toBe("");
  });

  test("'## type: binary' marks the file binary", () => {
    const files = parseFileContents(
      ["## file: logo.png", "## type: binary", "iVBORw0KGgo="],
      "app.py",
    );
    expect(files).toEqual([
      { name: "logo.png", content: "iVBORw0KGgo=", type: "binary" },
    ]);
  });

  test("'## type: text' is accepted and an unknown type warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(
        parseFileContents(
          ["## file: a.py", "## type: text", "x = 1"],
          "app.py",
        ),
      ).toEqual([{ name: "a.py", content: "x = 1", type: "text" }]);
      expect(warn).not.toHaveBeenCalled();

      const files = parseFileContents(
        ["## file: a.py", "## type: sqlite", "x = 1"],
        "app.py",
      );
      expect(warn).toHaveBeenCalledWith(
        'Invalid type string: "## type: sqlite".',
      );
      // The bad type is ignored, not applied.
      expect(files[0].type).toBe("text");
    } finally {
      warn.mockRestore();
    }
  });

  test("filenames are trimmed", () => {
    const files = parseFileContents(["## file:   app.py  ", "x = 1"], "z.py");
    expect(files[0].name).toBe("app.py");
  });

  test("a '## type:' line inside file content is just content", () => {
    const files = parseFileContents(
      ["## file: a.py", "x = 1", "## type: binary"],
      "app.py",
    );
    expect(files[0].type).toBe("text");
    expect(files[0].content).toBe("x = 1\n## type: binary");
  });

  test("content before the first header uses the default name", () => {
    const files = parseFileContents(
      ["x = 1", "## file: util.py", "y = 2"],
      "app.py",
    );
    expect(files.map((f) => f.name)).toEqual(["app.py", "util.py"]);
  });
});

describe("parseCodeBlock()", () => {
  test("accepts a string as well as an array of lines", () => {
    const fromString = parseCodeBlock("#| standalone: true\nx = 1", "python");
    const fromArray = parseCodeBlock(
      ["#| standalone: true", "x = 1"],
      "python",
    );
    expect(fromString).toEqual(fromArray);
  });

  test("defaults to a standalone-required viewer component", () => {
    const { quartoArgs } = parseCodeBlock(
      ["#| standalone: true", "x = 1"],
      "python",
    );
    expect(quartoArgs).toEqual({ components: ["viewer"], standalone: true });
  });

  test("a viewer block without 'standalone: true' throws", () => {
    expect(() =>
      parseCodeBlock(["#| standalone: false", "x = 1"], "python"),
    ).toThrow(/must have a '#\| standalone: true' argument/);
  });

  test("a block with no args at all gets the same message as one with the wrong args", () => {
    // js-yaml returns `undefined` for an empty document, which is what a block
    // with no `#|` lines produces. That used to be dereferenced unguarded, so
    // the most likely authoring mistake -- forgetting the args entirely --
    // raised a bare TypeError instead of the message meant for it.
    expect(() => parseCodeBlock(["x = 1"], "python")).toThrow(
      /must have a '#\| standalone: true' argument/,
    );
  });

  test("an editor block with 'standalone: true' throws", () => {
    expect(() =>
      parseCodeBlock(
        ["#| components: [editor, terminal]", "#| standalone: true", "x = 1"],
        "python",
      ),
    ).toThrow(/not valid for editor-terminal and editor-cell code blocks/);
  });

  test.each([
    ["python", ["#| standalone: true"], "app.py"],
    ["r", ["#| standalone: true"], "app.R"],
    ["python", ["#| components: [editor, cell]"], "code.py"],
    ["r", ["#| components: [editor, cell]"], "code.R"],
  ])("the %p default filename for %p is %p", (engine, args, expectedName) => {
    const { files } = parseCodeBlock(
      [...(args as string[]), "x = 1"],
      engine as "python" | "r",
    );
    expect(files[0].name).toBe(expectedName);
  });

  test("parses a multi-file block with a binary file", () => {
    const { files, quartoArgs } = parseCodeBlock(
      [
        "#| standalone: true",
        "#| layout: vertical",
        "",
        "## file: app.py",
        "import util",
        "",
        "## file: util.py",
        "def bar(x):",
        "  return x + 2",
        "",
        "## file: logo.png",
        "## type: binary",
        "iVBORw0KGgo=",
      ],
      "python",
    );

    expect(quartoArgs).toEqual({
      components: ["viewer"],
      standalone: true,
      layout: "vertical",
    });
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ["app.py", "text"],
      ["util.py", "text"],
      ["logo.png", "binary"],
    ]);
    expect(files[2].content).toBe("iVBORw0KGgo=");
  });
});
