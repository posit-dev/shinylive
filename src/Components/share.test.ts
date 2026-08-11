import LZString from "lz-string";
import type { FileContent, FileContentJson } from "./filecontent";
import {
  appUrlPrefix,
  editorUrlPrefix,
  fileContentsToUrlString,
  fileContentsToUrlStringInWebWorker,
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

describe("fileContentsToUrlStringInWebWorker()", () => {
  // jsdom has no Worker, but the only thing this code needs from one is
  // "receives a message and a MessagePort, replies through the port".
  // MessageChannel jsdom does implement, so a stub Worker is enough to exercise
  // the real handshake rather than mocking it away.
  let posted: { value: string }[];

  class FakeWorker {
    constructor(
      public url: string,
      public opts?: WorkerOptions,
    ) {}

    postMessage(msg: { type: string; value: string }, transfer: MessagePort[]) {
      posted.push({ value: msg.value });
      const port = transfer[0];
      // Reply asynchronously, as a real worker would.
      setTimeout(() => {
        port.postMessage({ type: msg.type, value: "ENCODED" });
        // A real worker's port goes away with the message; closing it here
        // keeps node's MessagePort from holding the event loop open.
        port.close();
      });
    }
  }

  beforeEach(() => {
    posted = [];
    (global as unknown as { Worker: unknown }).Worker = FakeWorker;
  });

  // A fresh array each time: the sort below is in-place, so a shared fixture
  // would be reordered by whichever test ran first.
  const files = (): FileContent[] => [
    { name: "b.py", content: "second", type: "text" },
    { name: "a.py", content: "first", type: "text" },
  ];

  test("returns the value the worker sends back", async () => {
    await expect(fileContentsToUrlStringInWebWorker(files())).resolves.toBe(
      "ENCODED",
    );
  });

  test("sorts the caller's array in place, like the sync version", async () => {
    const mine = files();
    await fileContentsToUrlStringInWebWorker(mine);
    expect(mine.map((f) => f.name)).toEqual(["a.py", "b.py"]);
  });

  test("sorts by name before handing the files over", async () => {
    await fileContentsToUrlStringInWebWorker(files());

    expect(
      JSON.parse(posted[0].value).map((f: FileContentJson) => f.name),
    ).toEqual(["a.py", "b.py"]);
  });

  test("leaves the order alone when sort is false", async () => {
    await fileContentsToUrlStringInWebWorker(files(), false);

    expect(
      JSON.parse(posted[0].value).map((f: FileContentJson) => f.name),
    ).toEqual(["b.py", "a.py"]);
  });

  test("reuses one worker across calls", async () => {
    await fileContentsToUrlStringInWebWorker(files());
    await fileContentsToUrlStringInWebWorker(files());

    expect(posted).toHaveLength(2);
  });
});
