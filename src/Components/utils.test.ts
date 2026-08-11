import { asCssLengthUnit, minCssLengthUnit } from "./utils";

describe("asCssLengthUnit()", () => {
  test("numbers become px", () => {
    expect(asCssLengthUnit(0)).toBe("0px");
    expect(asCssLengthUnit(300)).toBe("300px");
    expect(asCssLengthUnit(12.5)).toBe("12.5px");
  });

  test("strings pass through untouched", () => {
    expect(asCssLengthUnit("50%")).toBe("50%");
    expect(asCssLengthUnit("auto")).toBe("auto");
    expect(asCssLengthUnit("10rem")).toBe("10rem");
  });

  test("undefined stays undefined", () => {
    expect(asCssLengthUnit(undefined)).toBeUndefined();
    expect(asCssLengthUnit()).toBeUndefined();
  });
});

describe("minCssLengthUnit()", () => {
  test("both present gives a min() expression", () => {
    expect(minCssLengthUnit(100, 200)).toBe("min(100px, 200px)");
    expect(minCssLengthUnit("50%", 200)).toBe("min(50%, 200px)");
  });

  test("only one present gives that one", () => {
    expect(minCssLengthUnit(100, undefined)).toBe("100px");
    expect(minCssLengthUnit(undefined, "3em")).toBe("3em");
  });

  test("neither present gives undefined", () => {
    expect(minCssLengthUnit(undefined, undefined)).toBeUndefined();
    expect(minCssLengthUnit()).toBeUndefined();
  });

  test('"auto" is dropped by default', () => {
    expect(minCssLengthUnit("auto", 200)).toBe("200px");
    expect(minCssLengthUnit(200, "auto")).toBe("200px");
    expect(minCssLengthUnit("auto", "auto")).toBeUndefined();
  });

  test('"auto" is kept when ignoreAuto is false', () => {
    expect(minCssLengthUnit("auto", 200, false)).toBe("min(auto, 200px)");
    expect(minCssLengthUnit("auto", "auto", false)).toBe("min(auto, auto)");
  });

  test("a zero length is treated as absent, not as 0px", () => {
    // `asCssLengthUnit(0)` gives the truthy string "0px", so this is really a
    // check that the falsy-string branches below don't fire for it.
    expect(minCssLengthUnit(0, 200)).toBe("min(0px, 200px)");
  });
});
