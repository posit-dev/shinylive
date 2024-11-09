import type { AppEngine } from "./Components/App";

// =======================================================================
// Utility functions
// =======================================================================
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeRandomKey(length = 5): string {
  let result = "";
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// Given a path, return the path with the last element removed. Note that
// result will not have a trailing slash.
// For example:
// "/ab/cd"  -> "/ab"
// "/ab/cd/" -> "/ab"
// "/ab/"    -> ""
// "ab/cd"   -> "ab"
// "ab/"     -> ""
// "ab"      -> ""
// "/"       -> ""
// ""        -> ""
export function dirname(path: string) {
  if (path === "/" || path === "") {
    return "";
  }
  return path.replace(/[/]?[^/]+[/]?$/, "");
}

export function basename(path: string) {
  return path.replace(/.*\//, "");
}

// Get the path to the current script, when used in a JS module. Note: for
// non-modules, something similar could be done by combining window.location.pathname
// and document.currentScript.
export function currentScriptPath(): string {
  return new URL(import.meta.url).pathname;
}

// Get the directory containing the current script, when used in a JS module.
export function currentScriptDir(): string {
  return dirname(currentScriptPath());
}

export function loudPrint(msg: string) {
  console.log("%c" + msg, "color:forestgreen");
}

/**
 * Given a filename, return the file type. These should match the language
 * identifiers used by the Langauge Server Protocol.
 * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocumentItem
 */
export function inferFiletype(filename: string): string | null {
  const extMatch = filename.match(/\.[0-9a-z]+$/i);
  if (extMatch === null) {
    return null;
  }

  // Get matched string and remove leading '.'
  const ext = extMatch[0].substring(1).toLowerCase();
  const type = FILE_EXTENSIONS[ext];
  if (!type) {
    return null;
  }

  return type;
}

// These language identifiers should match both the Language Server Protocol IDs
// and the IDs used by `getLanguageExtension()`.
const FILE_EXTENSIONS: Record<string, string> = {
  py: "python",
  js: "javascript",
  html: "html",
  css: "css",
  csv: "csv",
  r: "r",
  sql: "sql",
  sass: "sass",
  scss: "sass",
  yaml: "yaml",
  yml: "yaml",
};

export function isApplePlatform(): boolean {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
}

export function modKeySymbol(): string {
  if (isApplePlatform()) {
    return "⌘";
  } else {
    return "Ctrl";
  }
}

// Use a heuristic to guess if a string or Uint8Array contains binary data, as
// opposed to text.
export function isBinary(x: Uint8Array | string): boolean {
  if (typeof x === "string") {
    for (const b of x) {
      if (b === "\x00" || b === "\xff") {
        return true;
      }
    }
    return false;
  } else {
    for (const b of x) {
      if (b === 0 || b === 255) {
        return true;
      }
    }
    return false;
  }
}

export function arrayBufferToString(buf: ArrayBuffer): string {
  return uint8ArrayToString(new Uint8Array(buf));
}

export function stringToArrayBuffer(s: string): ArrayBuffer {
  return stringToUint8Array(s).buffer;
}

export function uint8ArrayToString(buf: Uint8Array): string {
  let result = "";
  for (let i = 0; i < buf.length; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
}

export function stringToUint8Array(s: string): Uint8Array {
  const len = s.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = s.charCodeAt(i);
  }
  return bytes;
}

export function engineSwitch<T>(
  engine: AppEngine,
  rValue: T,
  pythonValue: T,
): T {
  switch (engine) {
    case "r":
      return rValue;

    // Legacy default engine value was `python`
    case "python":
    default:
      return pythonValue;
  }
}
