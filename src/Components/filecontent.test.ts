import type { FileContent, FileContentJson } from "./filecontent";
import { FCJSONtoFC, FCorFCJSONtoFC, FCtoFCJSON } from "./filecontent";

// "hi\x00" -- includes a NUL so it is unambiguously binary.
const BINARY_BYTES = new Uint8Array([104, 105, 0]);
const BINARY_BASE64 = "aGkA";

describe("FCJSONtoFC()", () => {
  test("text passes through, with the type filled in", () => {
    const json: FileContentJson = { name: "app.py", content: "x = 1" };
    expect(FCJSONtoFC(json)).toEqual({
      name: "app.py",
      content: "x = 1",
      type: "text",
    });
  });

  test("an explicit text type is preserved", () => {
    expect(FCJSONtoFC({ name: "a.py", content: "x", type: "text" })).toEqual({
      name: "a.py",
      content: "x",
      type: "text",
    });
  });

  test("binary content is base64-decoded into a Uint8Array", () => {
    const result = FCJSONtoFC({
      name: "logo.png",
      content: BINARY_BASE64,
      type: "binary",
    });
    expect(result.type).toBe("binary");
    expect(result.content).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.content as Uint8Array)).toEqual(
      Array.from(BINARY_BYTES),
    );
  });
});

describe("FCtoFCJSON()", () => {
  test("text drops the type field to save space", () => {
    const fc: FileContent = { name: "app.py", content: "x = 1", type: "text" };
    const json = FCtoFCJSON(fc);
    expect(json).toEqual({ name: "app.py", content: "x = 1" });
    expect("type" in json).toBe(false);
  });

  test("binary content is base64-encoded and keeps its type", () => {
    const fc: FileContent = {
      name: "logo.png",
      content: BINARY_BYTES,
      type: "binary",
    };
    expect(FCtoFCJSON(fc)).toEqual({
      name: "logo.png",
      content: BINARY_BASE64,
      type: "binary",
    });
  });
});

describe("round trips", () => {
  test("text survives FC -> JSON -> FC", () => {
    const fc: FileContent = {
      name: "app.py",
      content: "x = 1\ny = 2",
      type: "text",
    };
    expect(FCJSONtoFC(FCtoFCJSON(fc))).toEqual(fc);
  });

  test("binary survives FC -> JSON -> FC", () => {
    const fc: FileContent = {
      name: "logo.png",
      content: new Uint8Array([0, 1, 127, 128, 255]),
      type: "binary",
    };
    const restored = FCJSONtoFC(FCtoFCJSON(fc));
    expect(restored.name).toBe(fc.name);
    expect(restored.type).toBe("binary");
    expect(Array.from(restored.content as Uint8Array)).toEqual(
      Array.from(fc.content as Uint8Array),
    );
  });
});

describe("FCorFCJSONtoFC()", () => {
  test("a binary FileContentJson (string content) is decoded", () => {
    const result = FCorFCJSONtoFC({
      name: "logo.png",
      content: BINARY_BASE64,
      type: "binary",
    });
    expect(result.content).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.content as Uint8Array)).toEqual(
      Array.from(BINARY_BYTES),
    );
  });

  test("a binary FileContent (Uint8Array content) is returned as-is", () => {
    const fc: FileContent = {
      name: "logo.png",
      content: BINARY_BYTES,
      type: "binary",
    };
    const result = FCorFCJSONtoFC(fc);
    expect(result).toBe(fc);
  });

  test("text is normalized to type 'text' either way", () => {
    expect(FCorFCJSONtoFC({ name: "a.py", content: "x" })).toEqual({
      name: "a.py",
      content: "x",
      type: "text",
    });
    expect(
      FCorFCJSONtoFC({ name: "a.py", content: "x", type: "text" }),
    ).toEqual({ name: "a.py", content: "x", type: "text" });
  });
});
