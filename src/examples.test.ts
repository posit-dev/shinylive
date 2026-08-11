import type { ExampleCategory } from "./examples";
import { findExampleByTitle, sanitizeTitleForUrl } from "./examples";

describe("sanitizeTitleForUrl()", () => {
  test.each([
    ["Basic App", "basic-app"],
    ["Plot/Table", "plot-table"],
    ["Multiple   Spaces", "multiple---spaces"],
    ["Read Local File", "read-local-file"],
    ["already-fine", "already-fine"],
    ["", ""],
  ])("sanitizeTitleForUrl(%p) === %p", (title, expected) => {
    expect(sanitizeTitleForUrl(title)).toBe(expected);
  });

  test("drops characters that aren't lowercase alphanumeric or a dash", () => {
    expect(sanitizeTitleForUrl("Fancy! (v2.0) — café")).toBe("fancy-v20--caf");
  });

  test("is idempotent", () => {
    const once = sanitizeTitleForUrl("Regular Expressions & More");
    expect(sanitizeTitleForUrl(once)).toBe(once);
  });
});

describe("findExampleByTitle()", () => {
  const categories: ExampleCategory[] = [
    {
      category: "Basic",
      apps: [
        { title: "Hello Shiny", about: null, files: [] },
        { title: "Plot/Table", about: null, files: [] },
      ],
    },
    {
      category: "Advanced",
      apps: [{ title: "Regular Expressions", about: null, files: [] }],
    },
  ];

  test("finds an example by its sanitized title", () => {
    expect(findExampleByTitle("hello-shiny", categories)).toEqual({
      categoryIndex: 0,
      index: 0,
    });
    expect(findExampleByTitle("plot-table", categories)).toEqual({
      categoryIndex: 0,
      index: 1,
    });
    expect(findExampleByTitle("regular-expressions", categories)).toEqual({
      categoryIndex: 1,
      index: 0,
    });
  });

  test("the lookup is case-insensitive", () => {
    expect(findExampleByTitle("Hello-Shiny", categories)).toEqual({
      categoryIndex: 0,
      index: 0,
    });
  });

  test("the unsanitized title does not match", () => {
    expect(findExampleByTitle("Hello Shiny", categories)).toBeNull();
  });

  test("an unknown or empty title gives null", () => {
    expect(findExampleByTitle("does-not-exist", categories)).toBeNull();
    expect(findExampleByTitle("", categories)).toBeNull();
    expect(findExampleByTitle("hello-shiny", [])).toBeNull();
  });
});
