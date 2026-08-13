import { rCharacterField } from "./r-status";

// webR's `toJs()` shape, built by hand. The real thing comes back from the
// worker, so these stand in for what it sends: an R list is a
// `{ type, names, values }` node, and each element is either another such node
// or an already-unwrapped scalar.
type Js = Parameters<typeof rCharacterField>[0];

function node(names: string[], values: unknown[]): Js {
  return { type: "list", names, values } as unknown as Js;
}

function chr(...values: string[]) {
  return { type: "character", names: null, values };
}

describe("reading a field", () => {
  test("a character element gives its values", () => {
    const js = node(["status"], [chr("ok")]);
    expect(rCharacterField(js, "status")).toEqual(["ok"]);
  });

  test("an already-unwrapped scalar is taken as-is", () => {
    // webr's WebRDataJsNode.values is typed as holding either, so both the
    // wrapped and the bare form have to work.
    const js = node(["status"], ["ok"]);
    expect(rCharacterField(js, "status")).toEqual(["ok"]);
  });

  test("a multi-element vector keeps every value, in order", () => {
    // class(cnd) is a character vector, not a scalar.
    const js = node(["class"], [chr("simpleError", "error", "condition")]);
    expect(rCharacterField(js, "class")).toEqual([
      "simpleError",
      "error",
      "condition",
    ]);
  });

  test("the right field is read when several are present", () => {
    const js = node(
      ["status", "message", "call"],
      [chr("error"), chr("boom"), chr("f()")],
    );
    expect(rCharacterField(js, "message")).toEqual(["boom"]);
  });

  test("non-string values in a vector are dropped", () => {
    const js = node(["message"], [chr(...([1, "kept", null] as never[]))]);
    expect(rCharacterField(js, "message")).toEqual(["kept"]);
  });
});

// Each of these is a shape webR does not currently send. They matter because
// `Viewer.tsx` reads `status` through this function: every one of them makes the
// field read as `[]`, so `status` reads as `undefined`, and a *successful* R app
// start reports itself as a failure. A webR upgrade that changed the node shape
// would land here, and nothing else in either suite would notice.
describe("an unreadable reply gives no values rather than a guess", () => {
  test("no names at all", () => {
    expect(rCharacterField({ type: "null" } as unknown as Js, "status")).toEqual(
      [],
    );
  });

  test("names is null", () => {
    const js = { type: "character", names: null, values: ["ok"] };
    expect(rCharacterField(js as unknown as Js, "status")).toEqual([]);
  });

  test("no values alongside the names", () => {
    const js = { type: "list", names: ["status"] };
    expect(rCharacterField(js as unknown as Js, "status")).toEqual([]);
  });

  test("the field is absent", () => {
    const js = node(["message"], [chr("boom")]);
    expect(rCharacterField(js, "status")).toEqual([]);
  });

  test("the element is null", () => {
    const js = node(["status"], [null]);
    expect(rCharacterField(js, "status")).toEqual([]);
  });

  test("the element is neither a string nor an object", () => {
    const js = node(["status"], [42]);
    expect(rCharacterField(js, "status")).toEqual([]);
  });

  test("the element is a node whose values is not an array", () => {
    const js = node(["status"], [{ type: "character", values: "ok" }]);
    expect(rCharacterField(js, "status")).toEqual([]);
  });

  test("the element is a node with no values at all", () => {
    const js = node(["status"], [{ type: "character" }]);
    expect(rCharacterField(js, "status")).toEqual([]);
  });
});

test("the caller's success test fails on every unreadable shape", () => {
  // The point of the block above, stated as the caller states it
  // (Viewer.tsx: `rCharacterField(start, "status")[0] !== "ok"`). If any of
  // these ever started reading as "ok", a reply that did not survive
  // conversion would be treated as a successful start.
  const unreadable: unknown[] = [
    { type: "null" },
    { type: "character", names: null, values: ["ok"] },
    { type: "list", names: ["status"] },
    node(["message"], [chr("boom")]),
    node(["status"], [null]),
    node(["status"], [42]),
    node(["status"], [{ type: "character", values: "ok" }]),
  ];
  for (const js of unreadable) {
    expect(rCharacterField(js as Js, "status")[0]).not.toBe("ok");
  }
});
