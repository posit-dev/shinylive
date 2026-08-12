import {
  arrayBufferToString,
  basename,
  currentScriptDir,
  currentScriptPath,
  dirname,
  engineSwitch,
  inferFiletype,
  isApplePlatform,
  isBinary,
  makeRandomKey,
  modKeySymbol,
  sleep,
  stringToArrayBuffer,
  stringToUint8Array,
  uint8ArrayToString,
} from "./utils";

describe("dirname()", () => {
  // These cases are the ones spelled out in the comment above `dirname()`.
  test.each([
    ["/ab/cd", "/ab"],
    ["/ab/cd/", "/ab"],
    ["/ab/", ""],
    ["ab/cd", "ab"],
    ["ab/", ""],
    ["ab", ""],
    ["/", ""],
    ["", ""],
  ])("dirname(%p) === %p", (path, expected) => {
    expect(dirname(path)).toBe(expected);
  });

  test("removes only the last path element", () => {
    expect(dirname("/a/b/c/d.py")).toBe("/a/b/c");
  });
});

describe("basename()", () => {
  test.each([
    ["/ab/cd", "cd"],
    ["ab/cd.py", "cd.py"],
    ["app.py", "app.py"],
    ["", ""],
    ["/", ""],
  ])("basename(%p) === %p", (path, expected) => {
    expect(basename(path)).toBe(expected);
  });
});

describe("currentScriptPath()/currentScriptDir()", () => {
  // Under jest, `import.meta.url` resolves to this module's own location, so
  // these assert against `src/utils.ts` itself.
  test("the path is a bare filesystem path to the module", () => {
    expect(currentScriptPath()).toMatch(/\/src\/utils\.ts$/);
    // It's `URL.pathname`, so no scheme and no query string.
    expect(currentScriptPath()).not.toMatch(/^[a-z]+:/);
  });

  test("the dir drops the filename", () => {
    expect(currentScriptDir()).toMatch(/\/src$/);
    expect(currentScriptDir()).toBe(dirname(currentScriptPath()));
  });
});

describe("inferFiletype()", () => {
  test.each([
    ["app.py", "python"],
    ["app.js", "javascript"],
    ["index.html", "html"],
    ["style.css", "css"],
    ["data.csv", "csv"],
    ["app.R", "r"],
    ["query.sql", "sql"],
    ["a.sass", "sass"],
    ["a.scss", "sass"],
    ["a.yaml", "yaml"],
    ["a.yml", "yaml"],
  ])("infers %p as %p", (filename, expected) => {
    expect(inferFiletype(filename)).toBe(expected);
  });

  test("is case insensitive on the extension", () => {
    expect(inferFiletype("APP.PY")).toBe("python");
  });

  test("uses only the last extension", () => {
    expect(inferFiletype("archive.py.gz")).toBe(null);
    expect(inferFiletype("my.app.py")).toBe("python");
  });

  test("returns null for unknown or absent extensions", () => {
    expect(inferFiletype("README")).toBe(null);
    expect(inferFiletype("app.wat")).toBe(null);
    expect(inferFiletype(".gitignore")).toBe(null);
  });
});

describe("isBinary()", () => {
  test("plain text is not binary", () => {
    expect(isBinary("hello")).toBe(false);
    expect(isBinary("")).toBe(false);
    expect(isBinary(new Uint8Array([104, 105]))).toBe(false);
    expect(isBinary(new Uint8Array(0))).toBe(false);
  });

  test("a NUL or 0xff byte means binary", () => {
    expect(isBinary("a\x00b")).toBe(true);
    expect(isBinary("a\xffb")).toBe(true);
    expect(isBinary(new Uint8Array([1, 0, 2]))).toBe(true);
    expect(isBinary(new Uint8Array([1, 255, 2]))).toBe(true);
  });

  test("high bytes other than 0xff are not binary", () => {
    expect(isBinary(new Uint8Array([254, 128]))).toBe(false);
  });
});

describe("string/byte conversions", () => {
  test("round-trip through Uint8Array", () => {
    const s = "Hello, world! \x01\x02";
    expect(uint8ArrayToString(stringToUint8Array(s))).toBe(s);
  });

  test("round-trip through ArrayBuffer", () => {
    const s = "app.py contents";
    expect(arrayBufferToString(stringToArrayBuffer(s))).toBe(s);
  });

  test("stringToUint8Array keeps one byte per code unit", () => {
    expect(Array.from(stringToUint8Array("AB"))).toEqual([65, 66]);
    expect(stringToUint8Array("abc")).toHaveLength(3);
  });

  test("stringToUint8Array truncates code points above 0xff", () => {
    // This is `charCodeAt()` narrowed to a byte, not an encoding: 0x100 wraps
    // to 0. Callers are expected to hand it latin-1-ish data (see
    // `isBinary()`), which is why nothing here goes through TextEncoder.
    expect(Array.from(stringToUint8Array("\xffĀ"))).toEqual([255, 0]);
  });

  test("uint8ArrayToString maps bytes to code points", () => {
    expect(uint8ArrayToString(new Uint8Array([65, 66, 67]))).toBe("ABC");
  });
});

describe("makeRandomKey()", () => {
  test("has the requested length, defaulting to 5", () => {
    expect(makeRandomKey()).toHaveLength(5);
    expect(makeRandomKey(12)).toHaveLength(12);
    expect(makeRandomKey(0)).toBe("");
  });

  test("uses only lowercase alphanumerics", () => {
    expect(makeRandomKey(200)).toMatch(/^[a-z0-9]+$/);
  });
});

describe("sleep()", () => {
  test("resolves after the timer fires", async () => {
    jest.useFakeTimers();
    try {
      let resolved = false;
      const p = sleep(1000).then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      // Stop one tick short first, so that a `sleep()` which ignored its
      // argument (and slept 0 ms) would not pass this.
      jest.advanceTimersByTime(999);
      await Promise.resolve();
      expect(resolved).toBe(false);
      jest.advanceTimersByTime(1);
      await p;
      expect(resolved).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("engineSwitch()", () => {
  test('"r" picks the R value and "python" picks the Python value', () => {
    expect(engineSwitch("r", "app.R", "app.py")).toBe("app.R");
    expect(engineSwitch("python", "app.R", "app.py")).toBe("app.py");
  });

  test("an unrecognized engine falls back to the Python value", () => {
    // The legacy default engine value was `python`, so anything unknown lands
    // there rather than throwing.
    expect(engineSwitch("julia" as any, "app.R", "app.py")).toBe("app.py");
  });
});

describe("isApplePlatform()/modKeySymbol()", () => {
  const realUserAgent = navigator.userAgent;

  function setUserAgent(value: string) {
    Object.defineProperty(navigator, "userAgent", {
      value,
      configurable: true,
    });
  }

  afterEach(() => setUserAgent(realUserAgent));

  test.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "iPhone",
    "iPad",
  ])("%p is an Apple platform", (ua) => {
    setUserAgent(ua);
    expect(isApplePlatform()).toBe(true);
    expect(modKeySymbol()).toBe("⌘");
  });

  test("Linux is not an Apple platform", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(isApplePlatform()).toBe(false);
    expect(modKeySymbol()).toBe("Ctrl");
  });
});
