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

describe("getExampleCategories()", () => {
  // The module memoizes its result in a module-level variable, so each test
  // needs its own copy of the module rather than a shared one.
  async function freshExamples() {
    let mod!: typeof import("./examples");
    jest.resetModules();
    mod = await import("./examples");
    return mod;
  }

  const indexJson = [
    {
      engine: "python",
      examples: [
        {
          category: "Basics",
          apps: [
            {
              title: "Hello",
              about: "says hello",
              files: [{ name: "app.py", content: "print(1)" }],
            },
          ],
        },
      ],
    },
    { engine: "r", examples: [] },
  ];

  function mockFetch(payload: unknown) {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => payload,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("picks the categories for the requested engine", async () => {
    mockFetch(indexJson);
    const { getExampleCategories } = await freshExamples();

    const categories = await getExampleCategories("python");

    expect(categories).toEqual([
      {
        category: "Basics",
        apps: [
          {
            title: "Hello",
            about: "says hello",
            files: [{ name: "app.py", content: "print(1)", type: "text" }],
          },
        ],
      },
    ]);
  });

  test("a missing `about` becomes null rather than undefined", async () => {
    mockFetch([
      {
        engine: "python",
        examples: [
          { category: "Basics", apps: [{ title: "Hello", files: [] }] },
        ],
      },
    ]);
    const { getExampleCategories } = await freshExamples();

    const categories = await getExampleCategories("python");
    expect(categories[0].apps[0].about).toBeNull();
  });

  test("throws when the index has nothing for the engine", async () => {
    mockFetch([{ engine: "python", examples: [] }]);
    const { getExampleCategories } = await freshExamples();

    await expect(getExampleCategories("r")).rejects.toThrow(
      /No examples found for app engine r/,
    );
  });

  test("fetches once and reuses the result", async () => {
    const fetchMock = mockFetch(indexJson);
    const { getExampleCategories } = await freshExamples();

    await getExampleCategories("python");
    await getExampleCategories("python");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("the memoized result wins even for a different engine", async () => {
    // Worth pinning: the cache is not keyed by engine, so the second call
    // returns Python's categories. Documented, not endorsed -- the only caller
    // uses one engine per page load.
    mockFetch(indexJson);
    const { getExampleCategories } = await freshExamples();

    const python = await getExampleCategories("python");
    expect(await getExampleCategories("r")).toBe(python);
  });
});
