import LZString from "lz-string";
import type { FileContent, FileContentJson } from "./filecontent";
import {
  appUrlPrefix,
  editorUrlPrefix,
  fileContentsToUrlString,
} from "./share";

function decode(urlString: string): FileContentJson[] {
  return JSON.parse(
    LZString.decompressFromEncodedURIComponent(urlString) as string,
  );
}

describe("URL prefixes", () => {
  test("python uses the /py/ path and R uses /r/", () => {
    expect(editorUrlPrefix("python")).toBe("https://shinylive.io/py/editor/");
    expect(editorUrlPrefix("r")).toBe("https://shinylive.io/r/editor/");
    expect(appUrlPrefix("python")).toBe("https://shinylive.io/py/app/");
    expect(appUrlPrefix("r")).toBe("https://shinylive.io/r/app/");
  });
});

describe("fileContentsToUrlString()", () => {
  const files = (): FileContent[] => [
    { name: "utils.py", content: "def bar(): ...", type: "text" },
    { name: "app.py", content: "x = 1", type: "text" },
  ];

  test("produces a URL-safe string that decodes back to the files", () => {
    const urlString = fileContentsToUrlString(files());

    expect(urlString).toMatch(/^[A-Za-z0-9+\-$]+$/);
    expect(decode(urlString)).toEqual([
      { name: "app.py", content: "x = 1" },
      { name: "utils.py", content: "def bar(): ..." },
    ]);
  });

  test("sorts by filename by default", () => {
    expect(decode(fileContentsToUrlString(files())).map((f) => f.name)).toEqual(
      ["app.py", "utils.py"],
    );
  });

  test("sorting can be turned off", () => {
    expect(
      decode(fileContentsToUrlString(files(), false)).map((f) => f.name),
    ).toEqual(["utils.py", "app.py"]);
  });

  test("sorting mutates the array it was handed", () => {
    // Worth pinning down: callers hand in their live file list.
    const input = files();
    fileContentsToUrlString(input);
    expect(input.map((f) => f.name)).toEqual(["app.py", "utils.py"]);
  });

  test("binary files are base64-encoded and keep their type", () => {
    const urlString = fileContentsToUrlString([
      {
        name: "logo.png",
        content: new Uint8Array([104, 105, 0]),
        type: "binary",
      },
    ]);
    expect(decode(urlString)).toEqual([
      { name: "logo.png", content: "aGkA", type: "binary" },
    ]);
  });

  test("the same files always give the same string", () => {
    expect(fileContentsToUrlString(files())).toBe(
      fileContentsToUrlString(files().reverse()),
    );
  });

  test("an empty file list still round-trips", () => {
    expect(decode(fileContentsToUrlString([]))).toEqual([]);
  });
});
