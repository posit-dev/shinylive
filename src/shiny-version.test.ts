import cases from "../shiny_version_cases.json";
import {
  findShinySpec,
  newestBundled,
  parseRequirementsLine,
  resolveShinyVersion,
  shinyVersionMessage,
  type AvailableVersions,
  type Engine,
} from "./shiny-version";

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

  test("CRLF line endings are not part of the clause", () => {
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

type Case = {
  name: string;
  engine: Engine;
  files: Record<string, string>;
  expect: {
    minor: string;
    exact: string;
    requested: string | null;
    note: string | null;
  };
};

describe("resolveShinyVersion() against shiny_version_cases.json", () => {
  const available = cases.available as Record<Engine, AvailableVersions>;
  // TypeScript infers a separate object type for each JSON case, with the
  // file names of the other cases as optional undefined keys, so the cast
  // to Case[] goes through unknown.
  test.each(
    (cases.cases as unknown as Case[]).map((c) => [c.name, c] as const),
  )("%s", (_name, c) => {
    const files = Object.entries(c.files).map(([name, content]) => ({
      name,
      content,
    }));
    expect(resolveShinyVersion(files, c.engine, available[c.engine])).toEqual(
      c.expect,
    );
  });
});

describe("newestBundled()", () => {
  test("orders minors numerically", () => {
    expect(newestBundled({ "1.9": "1.9.1", "1.10": "1.10.0" })).toEqual({
      minor: "1.10",
      exact: "1.10.0",
    });
  });
});

describe("shinyVersionMessage()", () => {
  const resolved = {
    minor: "1.6",
    exact: "1.6.5",
    requested: null,
    note: null,
  };
  test("nothing when the engine runs the resolved version", () => {
    expect(shinyVersionMessage(resolved, "1.6.5")).toBeNull();
  });
  test("names the requested exact version when it differs from the running one", () => {
    expect(
      shinyVersionMessage({ ...resolved, requested: "1.6.3" }, "1.6.5"),
    ).toBe("requested shiny 1.6.3, running 1.6.5");
  });
  test("names the resolved version when the engine fell back to another", () => {
    expect(shinyVersionMessage(resolved, "1.8.0")).toBe(
      "requested shiny 1.6.5, running 1.8.0",
    );
  });
});
