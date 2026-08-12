import type { GistApiResponse } from "./gist";
import { fetchGist, gistApiResponseToFileContents } from "./gist";

// The gist API hands back base64 for every file, binary or not.
function b64(s: string): string {
  return window.btoa(s);
}

// jsdom's Blob has no arrayBuffer(), which is all `fetch(raw_url)`'s response
// body is used for.
function blobLike(bytes: Uint8Array): Blob {
  return {
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Blob;
}

function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function gistFile(overrides: Record<string, unknown> = {}) {
  return {
    filename: "app.py",
    type: "text/plain",
    language: "Python",
    raw_url: "https://gist.githubusercontent.com/raw/app.py",
    size: 5,
    truncated: false,
    content: b64("x = 1"),
    ...overrides,
  };
}

function gistResponse(files: Record<string, any>): GistApiResponse {
  return {
    url: "https://api.github.com/gists/abc123",
    id: "abc123",
    files,
    public: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    description: "",
    comments: 1,
  } as GistApiResponse;
}

describe("fetchGist()", () => {
  afterEach(() => {
    // @ts-expect-error: removing the stub we installed below.
    delete globalThis.fetch;
  });

  test("requests base64 content from the gists API", async () => {
    const json = gistResponse({ "app.py": gistFile() });
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => json,
    });
    globalThis.fetch = fetchMock as any;

    await expect(fetchGist("abc123")).resolves.toEqual(json);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/gists/abc123",
      { headers: { Accept: "application/vnd.github.v3.base64" } },
    );
  });
});

describe("gistApiResponseToFileContents()", () => {
  afterEach(() => {
    // @ts-expect-error: removing the stub we installed below.
    delete globalThis.fetch;
  });

  test("decodes a text file", async () => {
    const files = await gistApiResponseToFileContents(
      gistResponse({ "app.py": gistFile() }),
    );
    expect(files).toEqual([{ name: "app.py", type: "text", content: "x = 1" }]);
  });

  test("uses the gist file's own filename, not the key", async () => {
    const files = await gistApiResponseToFileContents(
      gistResponse({ someKey: gistFile({ filename: "real-name.py" }) }),
    );
    expect(files[0].name).toBe("real-name.py");
  });

  test("detects binary content regardless of the reported type", async () => {
    // GitHub reports "text/plain" for plenty of binary files, so the content
    // itself is what decides.
    const files = await gistApiResponseToFileContents(
      gistResponse({
        someKey: gistFile({
          filename: "data.db",
          type: "text/plain",
          content: b64("SQLite\x00format"),
        }),
      }),
    );
    expect(files[0].type).toBe("binary");
    expect(files[0].content).toBeInstanceOf(Uint8Array);
    // The binary path builds its own object, so check it uses the filename
    // rather than the key too.
    expect(files[0].name).toBe("data.db");
  });

  test("handles several files", async () => {
    const files = await gistApiResponseToFileContents(
      gistResponse({
        "app.py": gistFile(),
        "util.py": gistFile({ filename: "util.py", content: b64("y = 2") }),
      }),
    );
    expect(files.map((f) => f.name)).toEqual(["app.py", "util.py"]);
    expect(files.map((f) => f.content)).toEqual(["x = 1", "y = 2"]);
  });

  test("truncated files are re-fetched from raw_url", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      blob: async () => blobLike(bytesOf("x = 1")),
    });
    globalThis.fetch = fetchMock as any;

    const files = await gistApiResponseToFileContents(
      gistResponse({
        "big.py": gistFile({
          filename: "big.py",
          truncated: true,
          raw_url: "https://example.invalid/big.py",
          // Deliberately wrong -- the truncated path must not use it.
          content: b64("STALE"),
        }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith("https://example.invalid/big.py");
    expect(files).toEqual([{ name: "big.py", type: "text", content: "x = 1" }]);
  });

  test("a truncated binary file comes back as bytes", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      blob: async () => blobLike(new Uint8Array([1, 0, 2])),
    }) as any;

    const files = await gistApiResponseToFileContents(
      gistResponse({
        "big.bin": gistFile({ filename: "big.bin", truncated: true }),
      }),
    );

    expect(files[0].type).toBe("binary");
    expect(Array.from(files[0].content as Uint8Array)).toEqual([1, 0, 2]);
  });

  test("a gist with no files gives no file contents", async () => {
    await expect(
      gistApiResponseToFileContents(gistResponse({})),
    ).resolves.toEqual([]);
  });
});
