import { findShinySpec, parseRequirementsLine } from "./shiny-version";

describe("parseRequirementsLine()", () => {
  test("returns null for lines that are not about shiny", () => {
    expect(parseRequirementsLine("numpy>=1.0")).toBeNull();
    expect(parseRequirementsLine("shinywidgets")).toBeNull();
    expect(parseRequirementsLine("# shiny==1.0")).toBeNull();
    expect(parseRequirementsLine("")).toBeNull();
  });

  test("a bare shiny line has no clauses", () => {
    expect(parseRequirementsLine("shiny")).toEqual({
      kind: "clauses",
      line: "shiny",
      extras: "",
      clauses: [],
    });
  });

  test.each([
    ["shiny==1.6.3", [{ op: "==", version: "1.6.3" }]],
    ["shiny == 1.6.3", [{ op: "==", version: "1.6.3" }]],
    ["Shiny==1.6.3", [{ op: "==", version: "1.6.3" }]],
    ["shiny===1.6.3", [{ op: "==", version: "1.6.3" }]],
    ["shiny==1.6.*", [{ op: "==", version: "1.6.*" }]],
    ["shiny~=1.6.0", [{ op: "~=", version: "1.6.0" }]],
    [
      "shiny>=1.5,<1.7",
      [
        { op: ">=", version: "1.5" },
        { op: "<", version: "1.7" },
      ],
    ],
    ["shiny (>=1.5)", [{ op: ">=", version: "1.5" }]],
    ["shiny==1.6.3  # pinned for the demo", [{ op: "==", version: "1.6.3" }]],
    ["shiny==1.6.3; python_version>='3.9'", [{ op: "==", version: "1.6.3" }]],
  ])("parses %p", (line, clauses) => {
    const spec = parseRequirementsLine(line);
    expect(spec).toMatchObject({ kind: "clauses", clauses });
  });

  test("keeps extras", () => {
    expect(parseRequirementsLine("shiny[theme]==1.6.3")).toMatchObject({
      kind: "clauses",
      extras: "[theme]",
      clauses: [{ op: "==", version: "1.6.3" }],
    });
    expect(parseRequirementsLine("shiny [theme, extra] >= 1.5")).toMatchObject({
      extras: "[theme, extra]",
    });
  });

  test.each([
    "shiny @ git+https://github.com/posit-dev/py-shiny",
    "shiny @ https://example.com/shiny.whl",
    "shiny==banana",
    "shiny>>1.0",
  ])("reports %p as unparseable, quoting the line", (line) => {
    expect(parseRequirementsLine(line)).toEqual({ kind: "unparseable", line });
  });
});

describe("findShinySpec() for Python", () => {
  const files = (content: string) => [{ name: "requirements.txt", content }];

  test("no requirements.txt means no pin", () => {
    expect(findShinySpec([{ name: "app.py", content: "" }], "python")).toEqual({
      kind: "none",
    });
  });

  test("a requirements.txt without a shiny line means no pin", () => {
    expect(findShinySpec(files("numpy\npandas>=2\n"), "python")).toEqual({
      kind: "none",
    });
  });

  test("finds the shiny line among others, ignoring comments and blanks", () => {
    const spec = findShinySpec(
      files("# deps\nnumpy\n\nshiny==1.6.3\npandas\n"),
      "python",
    );
    expect(spec).toMatchObject({
      kind: "clauses",
      clauses: [{ op: "==", version: "1.6.3" }],
    });
  });

  test("the first shiny line wins when there are two", () => {
    const spec = findShinySpec(files("shiny==1.5.0\nshiny==1.7.0\n"), "python");
    expect(spec).toMatchObject({ clauses: [{ op: "==", version: "1.5.0" }] });
  });

  test("CRLF line endings do not reach the clause", () => {
    const spec = findShinySpec(files("numpy\r\nshiny==1.6.3\r\n"), "python");
    expect(spec).toMatchObject({
      line: "shiny==1.6.3",
      clauses: [{ op: "==", version: "1.6.3" }],
    });
  });

  test("a binary requirements.txt is treated as no pin", () => {
    const content = new Uint8Array([0x73, 0x68, 0x69, 0x6e, 0x79]);
    expect(
      findShinySpec([{ name: "requirements.txt", content }], "python"),
    ).toEqual({ kind: "none" });
  });

  test("a DESCRIPTION file is not consulted for Python", () => {
    const spec = findShinySpec(
      [{ name: "DESCRIPTION", content: "Imports: shiny (== 1.11.1)\n" }],
      "python",
    );
    expect(spec).toEqual({ kind: "none" });
  });
});

describe("findShinySpec() for R", () => {
  const files = (content: string) => [{ name: "DESCRIPTION", content }];

  test("no DESCRIPTION means no pin", () => {
    expect(findShinySpec([{ name: "app.R", content: "" }], "r")).toEqual({
      kind: "none",
    });
  });

  test("reads an exact constraint from Imports", () => {
    const spec = findShinySpec(
      files("Package: app\nImports: shiny (== 1.11.1)\n"),
      "r",
    );
    expect(spec).toEqual({
      kind: "clauses",
      line: "shiny (== 1.11.1)",
      extras: "",
      clauses: [{ op: "==", version: "1.11.1" }],
    });
  });

  test("reads a range from Depends", () => {
    const spec = findShinySpec(
      files("Depends: R (>= 4.1), shiny (>= 1.10)\n"),
      "r",
    );
    expect(spec).toMatchObject({ clauses: [{ op: ">=", version: "1.10" }] });
  });

  test("finds shiny on a continuation line, with a trailing comma and CRLF", () => {
    const content =
      "Package: app\r\nImports:\r\n    bslib,\r\n    shiny (== 1.12.1),\r\nSuggests: testthat\r\n";
    const spec = findShinySpec(files(content), "r");
    expect(spec).toMatchObject({
      line: "shiny (== 1.12.1)",
      clauses: [{ op: "==", version: "1.12.1" }],
    });
  });

  test("shiny without a constraint has no clauses", () => {
    expect(findShinySpec(files("Imports: shiny\n"), "r")).toMatchObject({
      kind: "clauses",
      clauses: [],
    });
  });

  test("a package whose name starts with shiny is not shiny", () => {
    expect(findShinySpec(files("Imports: shinyjs (>= 2.0)\n"), "r")).toEqual({
      kind: "none",
    });
  });

  test("a requirements.txt is not consulted for R", () => {
    expect(
      findShinySpec(
        [{ name: "requirements.txt", content: "shiny==1.6.3\n" }],
        "r",
      ),
    ).toEqual({ kind: "none" });
  });
});
