import type { FileContent } from "./Components/filecontent";
import {
  FILE_SYSTEM_API_ERROR_MESSAGE,
  assertHasFileAccessApiSupport,
  loadDirectoryRecursive,
  loadFileContent,
  saveFileContentsToDirectory,
} from "./fileio";

function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The bits of FileSystemFileHandle that fileio.ts actually reaches for. */
function fakeFileHandle(name: string, bytes: Uint8Array): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => ({
      name,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    }),
  } as unknown as FileSystemFileHandle;
}

function fakeDirHandle(
  name: string,
  entries: Array<FileSystemFileHandle | FileSystemDirectoryHandle>,
): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    values: () => entries[Symbol.iterator](),
  } as unknown as FileSystemDirectoryHandle;
}

describe("loadFileContent()", () => {
  test("decodes a text file as UTF-8", async () => {
    const handle = fakeFileHandle("app.py", bytesOf("x = 1"));
    await expect(loadFileContent(handle)).resolves.toEqual({
      name: "app.py",
      content: "x = 1",
      type: "text",
    });
  });

  test("a file with NUL bytes comes back as binary", async () => {
    const handle = fakeFileHandle("data.db", new Uint8Array([104, 0, 105]));
    const result = await loadFileContent(handle);
    expect(result.type).toBe("binary");
    expect(Array.from(result.content as Uint8Array)).toEqual([104, 0, 105]);
  });

  test("a file over the size limit throws", async () => {
    const handle = fakeFileHandle("big.py", bytesOf("0123456789"));
    await expect(loadFileContent(handle, 5)).rejects.toThrow(
      "File exceeds max size of 5 bytes.",
    );
  });

  test("a file exactly at the limit is allowed", async () => {
    const handle = fakeFileHandle("edge.py", bytesOf("12345"));
    await expect(loadFileContent(handle, 5)).resolves.toMatchObject({
      name: "edge.py",
    });
  });
});

describe("loadDirectoryRecursive()", () => {
  test("loads files and prefixes subdirectory paths", async () => {
    const dir = fakeDirHandle("proj", [
      fakeFileHandle("app.py", bytesOf("x = 1")),
      fakeDirHandle("sub", [fakeFileHandle("util.py", bytesOf("y = 2"))]),
    ]);

    const files = await loadDirectoryRecursive(dir);
    expect(files.map((f) => f.name)).toEqual(["app.py", "sub/util.py"]);
    expect(files.map((f) => f.content)).toEqual(["x = 1", "y = 2"]);
  });

  test("dotfiles and underscore-prefixed names are skipped", async () => {
    const dir = fakeDirHandle("proj", [
      fakeFileHandle(".DS_Store", bytesOf("junk")),
      fakeFileHandle("_private.py", bytesOf("junk")),
      fakeDirHandle(".git", [fakeFileHandle("HEAD", bytesOf("ref"))]),
      fakeFileHandle("app.py", bytesOf("x = 1")),
    ]);

    const files = await loadDirectoryRecursive(dir);
    expect(files.map((f) => f.name)).toEqual(["app.py"]);
  });

  test("an explicit prefix is applied to top-level files too", async () => {
    const dir = fakeDirHandle("proj", [
      fakeFileHandle("app.py", bytesOf("x = 1")),
    ]);
    const files = await loadDirectoryRecursive(dir, "outer");
    expect(files[0].name).toBe("outer/app.py");
  });

  test("too many files throws", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      fakeFileHandle(`f${i}.py`, bytesOf("x")),
    );
    await expect(
      loadDirectoryRecursive(fakeDirHandle("proj", many), "", undefined, 2),
    ).rejects.toThrow(/Too many files in directory proj; maximum is 2\./);
  });

  test("an empty directory gives no files", async () => {
    await expect(
      loadDirectoryRecursive(fakeDirHandle("proj", [])),
    ).resolves.toEqual([]);
  });
});

describe("assertHasFileAccessApiSupport()", () => {
  const alertMock = jest.fn();

  beforeEach(() => {
    alertMock.mockClear();
    window.alert = alertMock;
  });

  afterEach(() => {
    // @ts-expect-error: undo the stub installed below.
    delete window.showOpenFilePicker;
  });

  test("throws and alerts when the API is missing", () => {
    expect(() => assertHasFileAccessApiSupport()).toThrow(
      FILE_SYSTEM_API_ERROR_MESSAGE,
    );
    expect(alertMock).toHaveBeenCalledWith(FILE_SYSTEM_API_ERROR_MESSAGE);
  });

  test("is a no-op when the API is present", () => {
    // @ts-expect-error: jsdom has no File System Access API to stub over.
    window.showOpenFilePicker = () => {};
    expect(() => assertHasFileAccessApiSupport()).not.toThrow();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe("saveFileContentsToDirectory()", () => {
  /** Records what got written where, mimicking the directory handle tree. */
  function recordingDirHandle() {
    const written: Record<string, unknown> = {};
    const created: string[] = [];

    function makeDir(prefix: string): FileSystemDirectoryHandle {
      return {
        kind: "directory",
        name: prefix,
        getDirectoryHandle: async (name: string) => {
          const path = prefix === "" ? name : `${prefix}/${name}`;
          created.push(path);
          return makeDir(path);
        },
        getFileHandle: async (name: string) => ({
          kind: "file",
          name,
          createWritable: async () => ({
            write: async (content: unknown) => {
              written[prefix === "" ? name : `${prefix}/${name}`] = content;
            },
            close: async () => {},
          }),
        }),
      } as unknown as FileSystemDirectoryHandle;
    }

    return { root: makeDir(""), written, created };
  }

  test("writes a flat list of files", async () => {
    const { root, written, created } = recordingDirHandle();
    const files: FileContent[] = [
      { name: "app.py", content: "x = 1", type: "text" },
      { name: "util.py", content: "y = 2", type: "text" },
    ];

    await saveFileContentsToDirectory(files, root);

    expect(written).toEqual({ "app.py": "x = 1", "util.py": "y = 2" });
    expect(created).toEqual([]);
  });

  test("creates every level of a nested path", async () => {
    const { root, written, created } = recordingDirHandle();

    await saveFileContentsToDirectory(
      [{ name: "a/b/c.py", content: "deep", type: "text" }],
      root,
    );

    expect(created).toEqual(["a", "a/b"]);
    expect(written).toEqual({ "a/b/c.py": "deep" });
  });

  test("binary content is written as bytes", async () => {
    const { root, written } = recordingDirHandle();
    const bytes = new Uint8Array([1, 0, 2]);

    await saveFileContentsToDirectory(
      [{ name: "logo.png", content: bytes, type: "binary" }],
      root,
    );

    expect(written["logo.png"]).toBe(bytes);
  });
});
