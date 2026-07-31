// Shared plumbing for the controllers. Port of shiny/playwright/controller/_base.py
// and the pieces of shiny/playwright/expect/_internal.py that it leans on.
//
// See ./README.md for why this is a port rather than a dependency.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A Shiny app under test.
 *
 * py-shiny's controllers take a `Page`, because there the app *is* the page.
 * Shinylive renders the app into an iframe, so element lookups have to be rooted
 * at that frame while mouse and keyboard actions still go through the page.
 */
export type ShinyApp = {
  /** The browser page. Needed for mouse, keyboard and file chooser actions. */
  page: Page;
  /** Where elements are looked up: the app iframe, or the page itself. */
  root: Page | FrameLocator;
};

/** Options accepted by every `expect*()` and action method. */
export type ActionOptions = { timeout?: number };

/** What playwright's text assertions accept for a single value. */
export type PatternOrStr = string | RegExp;

/**
 * `loc` value meaning "the container is the element", mirroring py-shiny.
 *
 * Radio button groups and checkbox groups put the id on the container itself,
 * so there is no inner element to point at.
 */
export const SELF = "xpath=.";

/** Default container for Shiny inputs. */
export const INPUT_CONTAINER = "div.shiny-input-container";

type Resolved = { element: Locator; container: Locator };

/**
 * Resolve an element and its container.
 *
 * The container is narrowed to the one that actually holds `loc`, which is what
 * makes `div.shiny-input-container` usable as a default: an app has many of
 * them, and only one contains the input with this id.
 */
function resolve(app: ShinyApp, loc: string, locContainer: string): Resolved {
  const container = app.root.locator(locContainer);
  if (loc === SELF) {
    return { element: container, container };
  }
  const narrowed = container.filter({ has: app.root.locator(loc) });
  return { element: narrowed.locator(loc), container: narrowed };
}

/** Base class for every UI element controller. */
export class UiBase {
  readonly app: ShinyApp;
  /** The browser DOM `id` of the UI element. */
  readonly id: string;
  /** Playwright `Locator` of the UI element. */
  readonly loc: Locator;

  constructor(app: ShinyApp, id: string, loc: string | Locator) {
    this.app = app;
    this.id = id;
    this.loc = typeof loc === "string" ? app.root.locator(loc) : loc;
  }

  /** Equivalent to `expect(controller.loc)`. */
  get expect() {
    return expect(this.loc);
  }
}

/** A UI element wrapped in a container element. */
export class UiWithContainer extends UiBase {
  /** Playwright `Locator` for the container of the UI element. */
  readonly locContainer: Locator;

  constructor(
    app: ShinyApp,
    id: string,
    loc: string,
    locContainer: string = INPUT_CONTAINER,
  ) {
    const { element, container } = resolve(app, loc, locContainer);
    super(app, id, element);
    this.locContainer = container;
  }
}

/** A UI element with a `<label>`. */
export class UiWithLabel extends UiWithContainer {
  /** Playwright `Locator` for the label of the UI element. */
  readonly locLabel: Locator;

  constructor(
    app: ShinyApp,
    id: string,
    loc: string,
    locContainer: string = INPUT_CONTAINER,
    locLabel: string = `label#${id}-label`,
  ) {
    super(app, id, loc, locContainer);
    this.locLabel = this.locContainer.locator(locLabel);
  }

  /** Expect the label of the input to have a specific text. */
  async expectLabel(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locLabel).toHaveText(value, options);
  }
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Expect an attribute to have a value, or -- when `value` is `null` -- to be
 * absent.
 */
export async function expectAttributeToHaveValue(
  loc: Locator,
  name: string,
  value: string | RegExp | null,
  options?: ActionOptions,
): Promise<void> {
  if (value === null) {
    await expect(loc).not.toHaveAttribute(name, /.*/, options);
    return;
  }
  await expect(loc).toHaveAttribute(name, value, options);
}

/** Escape a string for use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expect one declaration of the inline `style` attribute to have a value.
 *
 * Matches py-shiny, which pattern-matches the attribute rather than reading the
 * computed style, so `expectWidth("50%")` asserts what the app asked for and not
 * what the browser resolved it to.
 */
export async function expectStyleToHaveValue(
  loc: Locator,
  key: string,
  value: string | null,
  options?: ActionOptions,
): Promise<void> {
  if (value === null) {
    await expect(loc).not.toHaveAttribute(
      "style",
      new RegExp(`${escapeRegExp(key)}\\s*:`),
      options,
    );
    return;
  }
  await expect(loc).toHaveAttribute(
    "style",
    new RegExp(`${escapeRegExp(key)}\\s*:\\s*${escapeRegExp(value)}`),
    options,
  );
}

/**
 * Expect the elements matched inside `locContainer` to carry exactly `values`
 * for `key`, in order.
 *
 * Stands in for py-shiny's `expect_locator_values_in_list()`. That version
 * builds one big `has=` chain so a mismatch reports the whole set at once; this
 * one asserts the count and then each value, which reports the first offender
 * instead. Both fail on the same inputs.
 */
export async function expectValuesInList(
  locContainer: Locator,
  elType: string,
  key: string,
  values: string[],
  options?: ActionOptions,
): Promise<void> {
  const items = locContainer.locator(elType);
  await expect(items).toHaveCount(values.length, options);
  for (let i = 0; i < values.length; i++) {
    await expect(items.nth(i)).toHaveAttribute(key, values[i], options);
  }
}

/** A locator's bounding box, or a useful error. */
export async function boundingBox(
  loc: Locator,
  name: string,
  options?: ActionOptions,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await loc.boundingBox(options);
  if (box === null) {
    throw new Error(`Couldn't find bounding box for ${name}`);
  }
  return box;
}
