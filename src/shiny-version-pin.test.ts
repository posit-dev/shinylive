import type { FileContent } from "./Components/filecontent";
import { writeShinyPin } from "./shiny-version-pin";

const text = (name: string, content: string): FileContent => ({
  name,
  content,
  type: "text",
});
const contentOf = (files: FileContent[], name: string) => {
  const f = files.find((x) => x.name === name);
  if (!f || f.type !== "text") throw new Error(`${name} missing or binary`);
  return f.content;
};

describe("writeShinyPin() for Python", () => {
  test("creates requirements.txt when there is none", () => {
    const out = writeShinyPin([text("app.py", "x = 1")], "python", "1.6.4");
    expect(out.map((f) => f.name)).toEqual(["app.py", "requirements.txt"]);
    expect(contentOf(out, "requirements.txt")).toBe("shiny==1.6.4\n");
  });

  test("replaces only the shiny line, keeping comments, other packages and extras", () => {
    const before = "# deps\nnumpy>=1.0\nshiny[theme]>=1.5  # keep me\npandas\n";
    const out = writeShinyPin(
      [text("requirements.txt", before)],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe(
      "# deps\nnumpy>=1.0\nshiny[theme]==1.6.4  # keep me\npandas\n",
    );
  });

  test("appends a shiny line when the file has none", () => {
    const out = writeShinyPin(
      [text("requirements.txt", "numpy\n")],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe("numpy\nshiny==1.6.4\n");
  });

  test("appends with a newline when the file does not end in one", () => {
    const out = writeShinyPin(
      [text("requirements.txt", "numpy")],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe("numpy\nshiny==1.6.4\n");
  });

  test("rewrites only the first of two shiny lines", () => {
    const out = writeShinyPin(
      [text("requirements.txt", "shiny==1.5.0\nshiny==1.7.0\n")],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe(
      "shiny==1.6.4\nshiny==1.7.0\n",
    );
  });

  test("keeps CRLF line endings", () => {
    const out = writeShinyPin(
      [text("requirements.txt", "numpy\r\nshiny>=1.5\r\n")],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe(
      "numpy\r\nshiny==1.6.4\r\n",
    );
  });

  test("replaces an unreadable shiny line", () => {
    const out = writeShinyPin(
      [text("requirements.txt", "shiny @ git+https://x/y\n")],
      "python",
      "1.6.4",
    );
    expect(contentOf(out, "requirements.txt")).toBe("shiny==1.6.4\n");
  });

  test("does not mutate its input", () => {
    const input = [text("requirements.txt", "shiny\n")];
    writeShinyPin(input, "python", "1.6.4");
    expect(input[0]).toEqual(text("requirements.txt", "shiny\n"));
  });
});

describe("writeShinyPin() for R", () => {
  test("creates a minimal DESCRIPTION when there is none", () => {
    const out = writeShinyPin([text("app.R", "")], "r", "1.11.1");
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Package: app\nVersion: 0.0.1\nImports:\n    shiny (== 1.11.1)\n",
    );
  });

  test("rewrites the shiny entry in Imports and leaves other fields alone", () => {
    const before =
      "Package: app\nTitle: Demo\nImports:\n    bslib,\n    shiny (>= 1.10),\n    jsonlite\nSuggests: testthat\n";
    const out = writeShinyPin([text("DESCRIPTION", before)], "r", "1.11.1");
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Package: app\nTitle: Demo\nImports:\n    bslib,\n    shiny (== 1.11.1),\n    jsonlite\nSuggests: testthat\n",
    );
  });

  test("rewrites a one-line Imports field", () => {
    const out = writeShinyPin(
      [text("DESCRIPTION", "Imports: shiny, bslib\n")],
      "r",
      "1.11.1",
    );
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Imports: shiny (== 1.11.1), bslib\n",
    );
  });

  test("rewrites shiny in Depends when that is where it is", () => {
    const out = writeShinyPin(
      [text("DESCRIPTION", "Depends: R (>= 4.1), shiny\n")],
      "r",
      "1.11.1",
    );
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Depends: R (>= 4.1), shiny (== 1.11.1)\n",
    );
  });

  test("adds shiny to an existing Imports field that lacks it", () => {
    const out = writeShinyPin(
      [text("DESCRIPTION", "Package: app\nImports:\n    bslib\n")],
      "r",
      "1.11.1",
    );
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Package: app\nImports:\n    bslib,\n    shiny (== 1.11.1)\n",
    );
  });

  test("adds an Imports field when there is none", () => {
    const out = writeShinyPin(
      [text("DESCRIPTION", "Package: app\nVersion: 1.0\n")],
      "r",
      "1.11.1",
    );
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Package: app\nVersion: 1.0\nImports:\n    shiny (== 1.11.1)\n",
    );
  });

  test("keeps a trailing comma and CRLF line endings", () => {
    const before = "Imports:\r\n    shiny,\r\nSuggests: testthat\r\n";
    const out = writeShinyPin([text("DESCRIPTION", before)], "r", "1.11.1");
    expect(contentOf(out, "DESCRIPTION")).toBe(
      "Imports:\r\n    shiny (== 1.11.1),\r\nSuggests: testthat\r\n",
    );
  });
});
