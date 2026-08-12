import { escapeRegExp } from "./regexp-util";

describe("escapeRegExp()", () => {
  test("escapes every regex metacharacter it knows about", () => {
    expect(escapeRegExp("-/\\^$*+?.()|[]{}")).toBe(
      "\\-\\/\\\\\\^\\$\\*\\+\\?\\.\\(\\)\\|\\[\\]\\{\\}",
    );
  });

  test("plain text is unchanged", () => {
    expect(escapeRegExp("input_slider")).toBe("input_slider");
    expect(escapeRegExp("")).toBe("");
  });

  test("the result matches the original as a literal", () => {
    const literal = "shiny.ui.input_slider(min=1, max=$10) [beta]";
    expect(new RegExp(escapeRegExp(literal)).test(literal)).toBe(true);
  });

  test("the escaped pattern does not match a would-be wildcard", () => {
    // Unescaped, "a.c" would match "abc".
    expect(new RegExp(escapeRegExp("a.c")).test("abc")).toBe(false);
    expect(new RegExp(escapeRegExp("a.c")).test("a.c")).toBe(true);
  });
});
