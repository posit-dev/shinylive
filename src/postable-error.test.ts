import type { PostableErrorObject } from "./postable-error";
import {
  errorToPostableErrorObject,
  postableErrorObjectToError,
} from "./postable-error";

describe("errorToPostableErrorObject()", () => {
  test("carries message, name and stack across", () => {
    const e = new TypeError("bad thing");
    const obj = errorToPostableErrorObject(e);

    expect(obj.name).toBe("TypeError");
    expect(obj.message).toBe("bad thing");
    expect(obj.stack).toBe(e.stack);
  });

  test("omits stack when the Error has none", () => {
    const e = new Error("no stack here");
    delete e.stack;
    const obj = errorToPostableErrorObject(e);

    expect(obj.message).toBe("no stack here");
    expect("stack" in obj).toBe(false);
  });

  test("the result is a plain object, not an Error", () => {
    // The whole point of this type: Safari refuses to structuredClone() an
    // Error, so we send a plain object instead. Node and jsdom both clone an
    // Error happily, so cloning the result here can't catch a regression --
    // the plain-object shape is what has to hold.
    const obj = errorToPostableErrorObject(new Error("boom"));
    expect(obj).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
    expect(Object.keys(obj).sort()).toEqual(["message", "name", "stack"]);
  });

  test("a non-Error keeps its name but gets the generic message", () => {
    const obj = errorToPostableErrorObject({
      name: "NotReallyAnError",
      message: "ignored",
    });

    expect(obj.name).toBe("NotReallyAnError");
    expect(obj.message).toBe("An unknown error occured");
    expect(obj.stack).toBeUndefined();
  });

  test("converts a thrown value with no properties", () => {
    // The only caller is a `catch (e)`, where `e` can be any thrown value at
    // all. `e.name` used to be read before the `instanceof Error` guard, so
    // `throw null` anywhere in the worker turned into a TypeError from the
    // error reporter itself, losing the original error.
    for (const thrown of [null, undefined, "just a string", 0]) {
      const obj = errorToPostableErrorObject(thrown);
      expect(obj.message).toBe("An unknown error occured");
      expect(typeof obj.name).toBe("string");
    }
  });
});

describe("postableErrorObjectToError()", () => {
  test("rebuilds an Error from a well-formed object", () => {
    const obj: PostableErrorObject = {
      name: "RangeError",
      message: "out of range",
      stack: "RangeError: out of range\n    at somewhere",
    };
    const e = postableErrorObjectToError(obj);

    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("RangeError");
    expect(e.message).toBe("out of range");
    expect(e.stack).toBe(obj.stack);
  });

  test("leaves the stack alone when the object has none", () => {
    const e = postableErrorObjectToError({ name: "Error", message: "hi" });
    expect(e.message).toBe("hi");
    // Not asserting the exact stack -- just that we got the local one rather
    // than `undefined` written over it.
    expect(e.stack).toBeDefined();
  });

  test("an object missing message or name becomes a generic Error", () => {
    expect(postableErrorObjectToError({ name: "Error" }).message).toBe(
      "An unknown error occured",
    );
    expect(postableErrorObjectToError({ message: "hi" }).message).toBe(
      "An unknown error occured",
    );
    expect(postableErrorObjectToError({}).message).toBe(
      "An unknown error occured",
    );
  });

  test("a non-object becomes a generic Error too", () => {
    // `"message" in errObj` throws for anything that isn't an object, and this
    // is applied to whatever came across postMessage().
    for (const bad of [null, undefined, "oops", 0]) {
      expect(postableErrorObjectToError(bad).message).toBe(
        "An unknown error occured",
      );
    }
  });
});

describe("round trip", () => {
  test("an Error survives the trip through a postable object", () => {
    const original = new TypeError("round trip");
    const restored = postableErrorObjectToError(
      structuredClone(errorToPostableErrorObject(original)),
    );

    expect(restored.name).toBe(original.name);
    expect(restored.message).toBe(original.message);
    expect(restored.stack).toBe(original.stack);
  });
});
