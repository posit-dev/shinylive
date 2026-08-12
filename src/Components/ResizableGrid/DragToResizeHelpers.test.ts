import type { DragState } from "./DragToResizeHelpers";
import {
  getHasRelativeUnits,
  initDragState,
  updateDragState,
} from "./DragToResizeHelpers";

// The two exported entry points take a container and read or write its grid
// template, but nothing here needs layout: jsdom keeps inline styles verbatim.
// Only the paths that ask the browser to resolve a track to pixels need
// `getComputedStyle()`, and those get a stub.
function gridContainer(
  template: string,
  dir: "rows" | "columns" = "columns",
): HTMLDivElement {
  const el = document.createElement("div");
  if (dir === "columns") {
    el.style.gridTemplateColumns = template;
  } else {
    el.style.gridTemplateRows = template;
  }
  return el as HTMLDivElement;
}

// What the browser would report once it has resolved every track to pixels.
function stubComputed(resolved: string) {
  jest.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: () => resolved,
  } as unknown as CSSStyleDeclaration);
}

function at(clientX: number, clientY = 0) {
  return { clientX, clientY };
}

// `index` is the grid line the divider sits on, which the module documents as
// 1-based; the track before it is `index - 2`.
const DIVIDER_AFTER_FIRST_TRACK = 2;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getHasRelativeUnits()", () => {
  test.each([
    [["1fr", "200px"], true],
    [["200px", "0.5fr"], true],
    [["200px", "300px"], false],
    [["auto", "200px"], false],
    [[], false],
  ])("%p has relative units: %p", (sizes, expected) => {
    expect(getHasRelativeUnits(sizes)).toBe(expected);
  });
});

describe("initDragState()", () => {
  test("two pixel tracks give a both-pixel drag", () => {
    const container = gridContainer("100px 200px");

    const drag = initDragState({
      mousePosition: at(50),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container,
    });

    expect(drag).toMatchObject({
      type: "both-pixel",
      dir: "columns",
      beforeIndex: 0,
      afterIndex: 1,
      mouseStart: 50,
      originalSizes: ["100px", "200px"],
      beforeInfo: { type: "pixel", count: 100 },
      afterInfo: { type: "pixel", count: 200 },
    });
  });

  test("mouseStart follows the axis being dragged", () => {
    const rows = gridContainer("100px 200px", "rows");
    const drag = initDragState({
      mousePosition: at(50, 90),
      dir: "rows",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: rows,
    });

    expect(drag.mouseStart).toBe(90);
  });

  test("the last divider, with a pixel track before it, gives a before-pixel drag", () => {
    const container = gridContainer("100px 200px");

    // Divider after the second (final) track, so there is no "after".
    const drag = initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: 3,
      container,
    });

    expect(drag).toMatchObject({
      type: "before-pixel",
      beforeIndex: 1,
      beforeInfo: { count: 200 },
    });
    expect("afterInfo" in drag).toBe(false);
  });

  test("a pixel track before a relative one is still a before-pixel drag", () => {
    const drag = initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: gridContainer("100px 1fr"),
    });

    expect(drag.type).toBe("before-pixel");
  });

  test("a relative track before a pixel one gives an after-pixel drag", () => {
    const drag = initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: gridContainer("1fr 300px"),
    });

    expect(drag).toMatchObject({
      type: "after-pixel",
      afterInfo: { type: "pixel", count: 300 },
    });
  });

  test("two relative tracks give a both-relative drag with a px-to-fr ratio", () => {
    // The browser resolves "1fr 3fr" to these pixel widths, so 4fr spans 400px
    // and one pixel of drag is 4/400 = 0.01fr.
    stubComputed("100px 300px");

    const drag = initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: gridContainer("1fr 3fr"),
    });

    expect(drag.type).toBe("both-relative");
    expect(drag.pixelToFrRatio).toBeCloseTo(0.01);
  });

  test("the px-to-fr ratio is measured off the row template when dragging rows", () => {
    stubComputed("100px 300px");

    const drag = initDragState({
      mousePosition: at(0, 0),
      dir: "rows",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: gridContainer("1fr 3fr", "rows"),
    });

    expect(drag.type).toBe("both-relative");
    expect(drag.pixelToFrRatio).toBeCloseTo(0.01);
  });

  test("the px-to-fr ratio is left off for non-relative drags", () => {
    const drag = initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container: gridContainer("100px 200px"),
    });

    expect(drag.pixelToFrRatio).toBeUndefined();
  });

  test("marks the container as dragged", () => {
    const container = gridContainer("100px 200px");
    expect(container.classList.contains("been-dragged")).toBe(false);

    initDragState({
      mousePosition: at(0),
      dir: "columns",
      index: DIVIDER_AFTER_FIRST_TRACK,
      container,
    });

    expect(container.classList.contains("been-dragged")).toBe(true);
  });

  describe("auto units", () => {
    test("a grid of auto and pixel units is rewritten entirely to pixels", () => {
      stubComputed("150px 250px");
      const container = gridContainer("auto 250px");

      const drag = initDragState({
        mousePosition: at(0),
        dir: "columns",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container,
      });

      expect(drag.originalSizes).toEqual(["150px", "250px"]);
      expect(container.style.gridTemplateColumns).toBe("150px 250px");
      expect(drag.type).toBe("both-pixel");
    });

    test("the rewrite drops ghost tracks the drag handles add", () => {
      // Two declared tracks, but the browser reports four; only the first two
      // belong to the grid definition.
      stubComputed("150px 250px 10px 10px");
      const container = gridContainer("auto auto");

      const drag = initDragState({
        mousePosition: at(0),
        dir: "columns",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container,
      });

      expect(drag.originalSizes).toEqual(["150px", "250px"]);
    });

    test("the rewrite reads and writes the row template when dragging rows", () => {
      stubComputed("150px 250px");
      const container = gridContainer("auto 250px", "rows");

      const drag = initDragState({
        mousePosition: at(0, 0),
        dir: "rows",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container,
      });

      expect(drag.originalSizes).toEqual(["150px", "250px"]);
      expect(container.style.gridTemplateRows).toBe("150px 250px");
    });

    test("a single auto track is converted off the row template too", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {
        /* the module logs on the auto-to-pixel path */
      });
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {
        /* auto plus relative also warns; covered by its own test below */
      });
      stubComputed("100px 250px");

      const drag = initDragState({
        mousePosition: at(0, 0),
        dir: "rows",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container: gridContainer("1fr auto", "rows"),
      });

      expect(drag.originalSizes).toEqual(["1fr", "250px"]);
      log.mockRestore();
      warn.mockRestore();
    });

    test("an auto track after the divider is converted on its own", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {
        /* the module logs on the auto-to-pixel path */
      });
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {
        /* auto plus relative also warns; covered by its own test below */
      });
      stubComputed("100px 250px");
      // A relative track first means the scorched-earth rewrite is skipped, so
      // this takes the one-track-at-a-time path for the "after" side instead.
      const container = gridContainer("1fr auto");

      const drag = initDragState({
        mousePosition: at(0),
        dir: "columns",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container,
      });

      expect(drag.originalSizes).toEqual(["1fr", "250px"]);
      expect(drag.type).toBe("after-pixel");
      log.mockRestore();
      warn.mockRestore();
    });

    test("mixing auto and relative units warns instead of rewriting", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {
        /* silence the expected warning */
      });
      const log = jest.spyOn(console, "log").mockImplementation(() => {
        /* the module logs on the auto-to-pixel path */
      });
      stubComputed("150px 250px");

      const drag = initDragState({
        mousePosition: at(0),
        dir: "columns",
        index: DIVIDER_AFTER_FIRST_TRACK,
        container: gridContainer("auto 1fr"),
      });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("mixture of auto and relative units"),
      );
      // The auto track is still converted, one track at a time, so this ends up
      // a pixel-then-relative drag rather than the scorched-earth rewrite.
      expect(drag.type).toBe("before-pixel");
      log.mockRestore();
    });
  });

  describe("rejections", () => {
    test("a relative track at the end of the grid throws", () => {
      expect(() =>
        initDragState({
          mousePosition: at(0),
          dir: "columns",
          index: 3,
          container: gridContainer("100px 1fr"),
        }),
      ).toThrow(/final tract drag without a pixel valued tract before/);
    });

    test("an unrecognised unit throws", () => {
      expect(() =>
        initDragState({
          mousePosition: at(0),
          dir: "columns",
          index: DIVIDER_AFTER_FIRST_TRACK,
          container: gridContainer("50% 200px"),
        }),
      ).toThrow(/Unknown tract sizing unit: 50%/);
    });
  });
});

describe("updateDragState()", () => {
  // Built by hand rather than through initDragState, so each case states
  // exactly the drag it is exercising.
  function pixelDrag(overrides: Partial<DragState> = {}): DragState {
    return {
      type: "both-pixel",
      dir: "columns",
      beforeIndex: 0,
      afterIndex: 1,
      mouseStart: 100,
      originalSizes: ["100px", "200px"],
      beforeInfo: { type: "pixel", count: 100, value: "100px" },
      afterInfo: { type: "pixel", count: 200, value: "200px" },
      ...overrides,
    } as DragState;
  }

  test("both-pixel moves the shared edge, conserving total width", () => {
    const container = gridContainer("100px 200px");

    updateDragState({
      mousePosition: at(130),
      drag: pixelDrag(),
      container,
    });

    expect(container.style.gridTemplateColumns).toBe("130px 170px");
  });

  test("dragging back the other way works too", () => {
    const container = gridContainer("100px 200px");

    updateDragState({ mousePosition: at(70), drag: pixelDrag(), container });

    expect(container.style.gridTemplateColumns).toBe("70px 230px");
  });

  test("rows are written to the row template", () => {
    const container = gridContainer("100px 200px", "rows");

    updateDragState({
      mousePosition: at(0, 130),
      drag: pixelDrag({ dir: "rows" }),
      container,
    });

    expect(container.style.gridTemplateRows).toBe("130px 170px");
  });

  test.each([
    ["the before track", 39],
    ["the after track", 261],
  ])("refuses to shrink %s below the 40px minimum", (_what, clientX) => {
    const container = gridContainer("100px 200px");

    updateDragState({
      mousePosition: at(clientX),
      drag: pixelDrag(),
      container,
    });

    expect(container.style.gridTemplateColumns).toBe("100px 200px");
  });

  test("40px exactly is allowed; one pixel less is not", () => {
    const container = gridContainer("100px 200px");

    updateDragState({ mousePosition: at(40), drag: pixelDrag(), container });
    expect(container.style.gridTemplateColumns).toBe("40px 260px");

    updateDragState({ mousePosition: at(39), drag: pixelDrag(), container });
    expect(container.style.gridTemplateColumns).toBe("40px 260px");
  });

  test("before-pixel only resizes its own track", () => {
    const container = gridContainer("100px 1fr");
    const drag = pixelDrag({
      type: "before-pixel",
      originalSizes: ["100px", "1fr"],
    });
    delete (drag as { afterInfo?: unknown }).afterInfo;

    updateDragState({ mousePosition: at(150), drag, container });

    expect(container.style.gridTemplateColumns).toBe("150px 1fr");
  });

  test("before-pixel also honours the minimum", () => {
    const container = gridContainer("100px 1fr");
    const drag = pixelDrag({
      type: "before-pixel",
      originalSizes: ["100px", "1fr"],
    });

    updateDragState({ mousePosition: at(39), drag, container });

    expect(container.style.gridTemplateColumns).toBe("100px 1fr");
  });

  describe("both-relative", () => {
    function relativeDrag(overrides: Partial<DragState> = {}): DragState {
      return {
        type: "both-relative",
        dir: "columns",
        beforeIndex: 0,
        afterIndex: 1,
        mouseStart: 100,
        originalSizes: ["1fr", "3fr"],
        beforeInfo: { type: "fr", count: 1, value: "1fr" },
        afterInfo: { type: "fr", count: 3, value: "3fr" },
        pixelToFrRatio: 0.01,
        ...overrides,
      } as DragState;
    }

    test("converts the pixel delta into fr units", () => {
      const container = gridContainer("1fr 3fr");

      // 50px of drag at 0.01 fr/px is 0.5fr.
      updateDragState({
        mousePosition: at(150),
        drag: relativeDrag(),
        container,
      });

      expect(container.style.gridTemplateColumns).toBe("1.5fr 2.5fr");
    });

    test("falls back to 1 fr per pixel when no ratio was measured", () => {
      const container = gridContainer("1fr 3fr");

      updateDragState({
        mousePosition: at(101),
        drag: relativeDrag({ pixelToFrRatio: undefined }),
        container,
      });

      expect(container.style.gridTemplateColumns).toBe("2fr 2fr");
    });

    test("stops when the smaller track drops under 15% of the larger", () => {
      const container = gridContainer("1fr 3fr");

      // Dragging left to 1fr/3fr -> 0.5fr/3.5fr is a ratio of 0.143.
      updateDragState({
        mousePosition: at(50),
        drag: relativeDrag(),
        container,
      });

      expect(container.style.gridTemplateColumns).toBe("1fr 3fr");
    });

    test("the guard applies to whichever side is shrinking", () => {
      const container = gridContainer("1fr 3fr");

      // Dragging right shrinks the "after" track instead.
      updateDragState({
        mousePosition: at(360),
        drag: relativeDrag(),
        container,
      });

      expect(container.style.gridTemplateColumns).toBe("1fr 3fr");
    });
  });

  test("an after-pixel drag is not implemented and leaves the grid alone", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {
      /* the module logs the unimplemented case */
    });
    const container = gridContainer("1fr 300px");

    updateDragState({
      mousePosition: at(150),
      drag: pixelDrag({ type: "after-pixel", originalSizes: ["1fr", "300px"] }),
      container,
    });

    expect(container.style.gridTemplateColumns).toBe("1fr 300px");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Havent implemented dragging for after-pixel"),
    );
  });

  test("leaves the original sizes untouched so a drag can be replayed", () => {
    const container = gridContainer("100px 200px");
    const drag = pixelDrag();

    updateDragState({ mousePosition: at(130), drag, container });
    updateDragState({ mousePosition: at(160), drag, container });

    // Each update starts from the sizes captured at mousedown, not from the
    // result of the previous move.
    expect(drag.originalSizes).toEqual(["100px", "200px"]);
    expect(container.style.gridTemplateColumns).toBe("160px 140px");
  });
});
