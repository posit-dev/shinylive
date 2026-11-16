import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import type { ShinyVersionPicker } from "./HeaderBar";
import HeaderBar from "./HeaderBar";

// React's scheduler posts its work with setImmediate when it exists, else with
// a MessageChannel. jsdom has no setImmediate, and the MessageChannel from
// jest.setup.js is node's, whose open port stops jest from exiting. A
// setTimeout stand-in, set before the scheduler loads, avoids the port.
jest.mock("scheduler", () => {
  const g = globalThis as { setImmediate?: unknown };
  if (typeof g.setImmediate !== "function") {
    g.setImmediate = (fn: () => void) => setTimeout(fn, 0);
  }
  return jest.requireActual("scheduler");
});

const picker: ShinyVersionPicker = {
  running: "1.6.4",
  options: [
    { exact: "1.8.0", latest: true },
    { exact: "1.7.0", latest: false },
    { exact: "1.6.4", latest: false },
  ],
  busy: false,
  onSelect: () => {},
};

describe("HeaderBar shiny version picker", () => {
  test("absent without the prop", () => {
    const html = renderToStaticMarkup(
      <HeaderBar headerBarCallbacks={{}} appEngine="python" />,
    );
    expect(html).not.toContain('aria-label="Shiny version"');
  });

  test("lists the options, marks the newest as latest, and selects the running one", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={picker}
      />,
    );
    expect(html).toContain('aria-label="Shiny version"');
    expect(html).toContain('<option value="1.8.0">1.8.0 (latest)</option>');
    expect(html).toMatch(
      /<option (?=[^>]*selected="")(?=[^>]*value="1\.6\.4")[^>]*>1\.6\.4<\/option>/,
    );
  });

  test("adds the running version as an option when it is not bundled", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={{ ...picker, running: "1.9.0" }}
      />,
    );
    expect(html).toMatch(
      /<option (?=[^>]*selected="")(?=[^>]*value="1\.9\.0")[^>]*>1\.9\.0<\/option>/,
    );
  });

  test("the tooltip is on a group, and the label has no aria-label", () => {
    const html = renderToStaticMarkup(
      <HeaderBar
        headerBarCallbacks={{}}
        appEngine="python"
        shinyVersionPicker={picker}
      />,
    );
    expect(html).toMatch(
      /<span (?=[^>]*role="group")(?=[^>]*data-balloon-pos="down")(?=[^>]*aria-label="Pick the shiny version the app runs on")[^>]*>/,
    );
    expect(html).toContain("<label>");
  });
});

describe("HeaderBar shiny version picker interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(p: ShinyVersionPicker): HTMLSelectElement {
    act(() => {
      root.render(
        <HeaderBar
          headerBarCallbacks={{}}
          appEngine="python"
          shinyVersionPicker={p}
        />,
      );
    });
    return container.querySelector("select") as HTMLSelectElement;
  }

  function keyDown(select: HTMLSelectElement, key: string): void {
    select.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }

  // The browser sets the value and fires `change` in the same task as the
  // keydown that caused it.
  function arrowTo(select: HTMLSelectElement, value: string): void {
    act(() => {
      keyDown(select, "ArrowUp");
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  test("a pointer choice commits at once", () => {
    const onSelect = jest.fn();
    const select = render({ ...picker, onSelect });
    act(() => {
      select.value = "1.8.0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("1.8.0");
  });

  test("arrow keys only move a pending value, and Enter commits it", () => {
    const onSelect = jest.fn();
    const select = render({ ...picker, onSelect });
    arrowTo(select, "1.7.0");
    arrowTo(select, "1.8.0");
    expect(onSelect).not.toHaveBeenCalled();
    expect(select.value).toBe("1.8.0");

    act(() => keyDown(select, "Enter"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("1.8.0");
  });

  test("typeahead letters are navigation too", () => {
    const onSelect = jest.fn();
    const select = render({ ...picker, onSelect });
    act(() => {
      keyDown(select, "1");
      select.value = "1.7.0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("blur commits a pending value", () => {
    const onSelect = jest.fn();
    const select = render({ ...picker, onSelect });
    act(() => select.focus());
    arrowTo(select, "1.7.0");
    expect(onSelect).not.toHaveBeenCalled();
    act(() => select.blur());
    expect(onSelect).toHaveBeenCalledWith("1.7.0");
  });

  test("Escape drops a pending value", () => {
    const onSelect = jest.fn();
    const select = render({ ...picker, onSelect });
    arrowTo(select, "1.7.0");
    act(() => keyDown(select, "Escape"));
    expect(select.value).toBe("1.6.4");
    act(() => keyDown(select, "Enter"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("while busy it is aria-disabled, keeps focus, and ignores changes", () => {
    const onSelect = jest.fn();
    let select = render({ ...picker, onSelect });
    act(() => select.focus());
    select = render({ ...picker, onSelect, busy: true });

    expect(select.getAttribute("aria-disabled")).toBe("true");
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);

    act(() => {
      select.value = "1.8.0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(select.value).toBe("1.6.4");

    arrowTo(select, "1.8.0");
    act(() => keyDown(select, "Enter"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("is not aria-disabled when the engine is ready", () => {
    const select = render(picker);
    expect(select.hasAttribute("aria-disabled")).toBe(false);
  });
});
