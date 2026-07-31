// Sliders, selects, checkboxes, switches and radio buttons.
// Port of shiny/playwright/controller/_input_controls.py

import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import {
  SELF,
  UiWithLabel,
  boundingBox,
  expectAttributeToHaveValue,
  expectStyleToHaveValue,
  expectValuesInList,
} from "./_base";

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

/** How far either side of the estimated position `set()` will hunt, in pixels. */
const DEFAULT_MAX_NUDGE = 60;

/**
 * How long to let a slider's new value reach the server after the drag ends.
 *
 * Shiny debounces slider input by 250ms, so the label updates well before the
 * value is sent. py-shiny's `set()` never notices, because inching across the
 * track a pixel at a time takes far longer than that; this one has to wait.
 * Without it, an action taken straight after `set()` can be processed by the
 * server while the slider still holds its old value.
 */
const SLIDER_SETTLE_MS = 350;

class InputSliderBase extends UiWithLabel {
  /** Playwright `Locator` of the ionRangeSlider widget. */
  readonly locIrs: Locator;
  /** Playwright `Locator` of the slider tick labels. */
  readonly locIrsTicks: Locator;
  /** Playwright `Locator` of the play/pause button. */
  readonly locPlayPause: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id, `input#${id}`);
    this.locIrs = this.locContainer.locator("> .irs.irs--shiny");
    this.locIrsTicks = this.locIrs.locator("> .irs-grid > .irs-grid-text");
    this.locPlayPause = this.locContainer.locator(
      "> .slider-animate-container a",
    );
  }

  /** Expect the slider's tick labels. Pass `null` for "no ticks". */
  async expectTickLabels(
    value: string[] | null,
    options?: ActionOptions,
  ): Promise<void> {
    if (value === null) {
      await expect(this.locIrsTicks).toHaveCount(0, options);
      return;
    }
    await expect(this.locIrsTicks).toHaveText(value, options);
  }

  /** Expect the animate (play/pause) button to exist, or not. */
  async expectAnimate(exists: boolean, options?: ActionOptions): Promise<void> {
    await expect(this.locPlayPause).toHaveCount(exists ? 1 : 0, options);
  }

  /** Expect the animation options of the play/pause button. */
  async expectAnimateOptions(
    value: { loop?: boolean; interval?: number },
    options?: ActionOptions,
  ): Promise<void> {
    if (value.loop === undefined && value.interval === undefined) {
      throw new Error("Must provide at least one of `loop` or `interval`");
    }
    await this.expectAnimate(true, options);
    if (value.loop !== undefined) {
      // Python omits `data-loop` when looping is off; R writes the R literal
      // `FALSE`. Read the attribute rather than pattern-matching it so the same
      // assertion holds for both.
      await expect
        .poll(
          async () => {
            const loop = await this.locPlayPause.getAttribute("data-loop");
            return loop !== null && loop.toUpperCase() !== "FALSE";
          },
          { timeout: options?.timeout },
        )
        .toBe(value.loop);
    }
    if (value.interval !== undefined) {
      await expectAttributeToHaveValue(
        this.locPlayPause,
        "data-interval",
        String(value.interval),
        options,
      );
    }
  }

  /** Click the play button. */
  async clickPlay(options?: ActionOptions): Promise<void> {
    await this.locContainer.waitFor({ state: "visible", ...options });
    await this.locContainer.scrollIntoViewIfNeeded(options);
    await expect(this.locPlayPause).not.toHaveClass(/playing/, options);
    await this.locPlayPause.click(options);
  }

  /** Click the pause button. */
  async clickPause(options?: ActionOptions): Promise<void> {
    await this.locContainer.waitFor({ state: "visible", ...options });
    await this.locContainer.scrollIntoViewIfNeeded(options);
    await expect(this.locPlayPause).toHaveClass(/playing/, options);
    await this.locPlayPause.click(options);
  }

  /** Expect the `data-min` attribute of the slider. */
  async expectMin(value: string, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-min", value, options);
  }

  /** Expect the `data-max` attribute of the slider. */
  async expectMax(value: string, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-max", value, options);
  }

  /** Expect the `data-step` attribute of the slider. */
  async expectStep(value: string, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-step", value, options);
  }

  /** Expect the `data-grid` attribute, i.e. whether ticks are drawn. */
  async expectTicks(value: string, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-grid", value, options);
  }

  /** Expect the thousands separator of the slider. */
  async expectSep(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(
      this.loc,
      "data-prettify-separator",
      value,
      options,
    );
  }

  /** Expect the string prefixed to the slider's value. */
  async expectPre(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-prefix", value, options);
  }

  /** Expect the string appended to the slider's value. */
  async expectPost(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-postfix", value, options);
  }

  /** Expect the width the app asked for. */
  async expectWidth(value: string, options?: ActionOptions): Promise<void> {
    await expectStyleToHaveValue(this.locContainer, "width", value, options);
  }

  /**
   * Drag `handle` until `label` reads `value`.
   *
   * py-shiny walks the handle across the whole track a pixel at a time and stops
   * when the label matches. That is robust but costs a mouse move and a DOM read
   * per pixel, which is too slow to do once per test here. This aims straight at
   * the position implied by `data-min`/`data-max` and then hunts outwards from
   * it, so it does a handful of steps instead of hundreds. The stopping
   * condition is py-shiny's: the rendered label, not a computed value, so
   * prefixes, separators and non-linear scales all still work.
   */
  protected async dragTo(
    value: string,
    handle: Locator,
    label: Locator,
    options?: ActionOptions & { maxNudge?: number },
  ): Promise<void> {
    await this.locContainer.waitFor({
      state: "visible",
      timeout: options?.timeout,
    });
    await this.locContainer.scrollIntoViewIfNeeded({
      timeout: options?.timeout,
    });

    const grid = await boundingBox(
      this.locIrs.locator("> .irs > .irs-line"),
      ".irs-line",
      options,
    );
    const handleBox = await boundingBox(handle, "handle", options);
    const y = handleBox.y + handleBox.height / 2;

    const candidates = await this.candidateOffsets(
      value,
      grid,
      options?.maxNudge ?? DEFAULT_MAX_NUDGE,
    );

    const mouse = this.app.page.mouse;
    await mouse.move(handleBox.x + handleBox.width / 2, y);
    await mouse.down();
    try {
      const seen = new Set<string>();
      for (const x of candidates) {
        await mouse.move(x, y);
        const current = (await label.innerText()).trim();
        if (current === value) return;
        if (seen.size < 15) seen.add(current);
      }
      throw new Error(
        `Could not set slider #${this.id} to "${value}". ` +
          `Values seen while dragging: ${[...seen]
            .map((v) => `"${v}"`)
            .join(", ")}`,
      );
    } finally {
      await mouse.up();
      await this.app.page.waitForTimeout(SLIDER_SETTLE_MS);
    }
  }

  /**
   * The x positions to try, nearest guess first.
   *
   * Without usable `data-min`/`data-max` -- a date or string slider, say -- this
   * falls back to py-shiny's left-to-right sweep of the whole track.
   */
  private async candidateOffsets(
    value: string,
    grid: { x: number; width: number },
    maxNudge: number,
  ): Promise<number[]> {
    const sweep = () =>
      Array.from({ length: Math.ceil(grid.width) + 1 }, (_, i) => grid.x + i);

    const min = Number(await this.loc.getAttribute("data-min"));
    const max = Number(await this.loc.getAttribute("data-max"));
    // Strip whatever prefix/separator the label carries: "$2,500" -> 2500.
    const target = Number(value.replace(/[^0-9.eE+-]/g, ""));
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      !Number.isFinite(target) ||
      max === min
    ) {
      return sweep();
    }

    const fraction = Math.min(Math.max((target - min) / (max - min), 0), 1);
    const estimate = grid.x + fraction * grid.width;
    const offsets: number[] = [estimate];
    for (let d = 1; d <= maxNudge; d++) {
      offsets.push(estimate + d, estimate - d);
    }
    return offsets.filter(
      (x) => x >= grid.x - 1 && x <= grid.x + grid.width + 1,
    );
  }
}

/** Controller for `shiny.ui.input_slider()` / `sliderInput()`. */
export class InputSlider extends InputSliderBase {
  /** Playwright `Locator` of the label showing the slider's value. */
  readonly locIrsLabel: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id);
    this.locIrsLabel = this.locIrs.locator("> .irs > .irs-single");
  }

  /** Expect the slider's value, as rendered next to the handle. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locIrsLabel).toHaveText(value, options);
  }

  /** Drag the slider to `value`. */
  async set(
    value: string,
    options?: ActionOptions & { maxNudge?: number },
  ): Promise<void> {
    await this.dragTo(
      value,
      this.locIrs.locator("> .irs-handle"),
      this.locIrsLabel,
      options,
    );
  }
}

/** Controller for `shiny.ui.input_slider()` / `sliderInput()` with two handles. */
export class InputSliderRange extends InputSliderBase {
  /** Playwright `Locator` of the label for the lower handle. */
  readonly locIrsLabelFrom: Locator;
  /** Playwright `Locator` of the label for the upper handle. */
  readonly locIrsLabelTo: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id);
    this.locIrsLabelFrom = this.locIrs.locator("> .irs > .irs-from");
    this.locIrsLabelTo = this.locIrs.locator("> .irs > .irs-to");
  }

  /** Expect both ends of the range. Pass `null` to skip an end. */
  async expectValue(
    value: [PatternOrStr | null, PatternOrStr | null],
    options?: ActionOptions,
  ): Promise<void> {
    if (value[0] === null && value[1] === null) {
      throw new Error("Both `from` and `to` can not be `null`");
    }
    if (value[0] !== null) {
      await expect(this.locIrsLabelFrom).toHaveText(value[0], options);
    }
    if (value[1] !== null) {
      await expect(this.locIrsLabelTo).toHaveText(value[1], options);
    }
  }

  /** Drag either or both handles. */
  async set(
    value: [string | null, string | null],
    options?: ActionOptions & { maxNudge?: number },
  ): Promise<void> {
    if (value[0] !== null) {
      await this.dragTo(
        value[0],
        this.locIrs.locator("> .irs-handle.from"),
        this.locIrsLabelFrom,
        options,
      );
    }
    if (value[1] !== null) {
      await this.dragTo(
        value[1],
        this.locIrs.locator("> .irs-handle.to"),
        this.locIrsLabelTo,
        options,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Checkboxes and switches
// ---------------------------------------------------------------------------

class InputCheckboxBase extends UiWithLabel {
  /** Check or uncheck the box. */
  async set(value: boolean, options?: ActionOptions): Promise<void> {
    await this.loc.waitFor({ state: "visible", timeout: options?.timeout });
    await this.loc.scrollIntoViewIfNeeded({ timeout: options?.timeout });
    await this.loc.setChecked(value, options);
  }

  /** Expect the box to be checked, or not. */
  async expectChecked(value: boolean, options?: ActionOptions): Promise<void> {
    if (value) {
      await expect(this.loc).toBeChecked(options);
    } else {
      await expect(this.loc).not.toBeChecked(options);
    }
  }

  /** Expect the width the app asked for. */
  async expectWidth(value: string, options?: ActionOptions): Promise<void> {
    await expectStyleToHaveValue(this.locContainer, "width", value, options);
  }
}

/** Controller for `shiny.ui.input_checkbox()` / `checkboxInput()`. */
export class InputCheckbox extends InputCheckboxBase {
  constructor(app: ShinyApp, id: string) {
    super(
      app,
      id,
      `div.checkbox > label > input#${id}[type=checkbox].shiny-bound-input`,
      undefined,
      "label > span",
    );
  }
}

/** Controller for `shiny.ui.input_switch()`. */
export class InputSwitch extends InputCheckboxBase {
  constructor(app: ShinyApp, id: string) {
    super(
      app,
      id,
      `div.form-switch > input#${id}[type=checkbox].shiny-bound-input`,
      undefined,
      `label[for=${id}]`,
    );
  }
}

class RadioButtonCheckboxGroupBase extends UiWithLabel {
  /** Playwright `Locator` of the labels of the choices. */
  readonly locChoiceLabels: Locator;

  constructor(
    app: ShinyApp,
    id: string,
    loc: string,
    locContainer: string,
    locChoiceLabels: Locator,
  ) {
    super(app, id, loc, locContainer);
    this.locChoiceLabels = locChoiceLabels;
  }

  /** Expect the labels shown next to each choice. */
  async expectChoiceLabels(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locChoiceLabels).toHaveText(value, options);
  }

  /** Expect the choices to be laid out inline, or not. */
  async expectInline(value: boolean, options?: ActionOptions): Promise<void> {
    if (value) {
      await expect(this.locContainer).toHaveClass(
        /shiny-input-container-inline/,
        options,
      );
    } else {
      await expect(this.locContainer).not.toHaveClass(
        /shiny-input-container-inline/,
        options,
      );
    }
  }
}

/** Controller for `shiny.ui.input_radio_buttons()` / `radioButtons()`. */
export class InputRadioButtons extends RadioButtonCheckboxGroupBase {
  /** Playwright `Locator` of the selected radio button. */
  readonly locSelected: Locator;
  /** Playwright `Locator` of all the radio buttons. */
  readonly locChoices: Locator;

  constructor(app: ShinyApp, id: string) {
    // The id is on the container, so there is no inner element to point at.
    const container = `div#${id}.shiny-input-radiogroup.shiny-bound-input`;
    const inputs = `> .shiny-options-group input[type=radio][name="${id}"]`;
    super(
      app,
      id,
      SELF,
      container,
      app.root.locator(container).locator(`${inputs} + span`),
    );
    this.locSelected = this.loc.locator(`${inputs}:checked`);
    this.locChoices = this.loc.locator(inputs);
  }

  /** Select the radio button with this value. */
  async set(selected: string, options?: ActionOptions): Promise<void> {
    await this.locContainer
      .locator(`label input[type=radio][value="${selected}"]`)
      .check(options);
  }

  /** Expect the values of the available choices. */
  async expectChoices(value: string[], options?: ActionOptions): Promise<void> {
    await expectValuesInList(
      this.locContainer,
      "input[type=radio]",
      "value",
      value,
      options,
    );
  }

  /** Expect the selected value. Pass `null` for "nothing selected". */
  async expectSelected(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    if (value === null) {
      await expect(this.locSelected).toHaveCount(0, options);
      return;
    }
    await expect(this.locSelected).toHaveValue(value, options);
  }
}

/** Controller for `shiny.ui.input_checkbox_group()` / `checkboxGroupInput()`. */
export class InputCheckboxGroup extends RadioButtonCheckboxGroupBase {
  /** Playwright `Locator` of the checked boxes. */
  readonly locSelected: Locator;
  /** Playwright `Locator` of all the boxes. */
  readonly locChoices: Locator;

  constructor(app: ShinyApp, id: string) {
    const container = `div#${id}.shiny-input-checkboxgroup.shiny-bound-input`;
    const inputs = `> .shiny-options-group input[type=checkbox][name="${id}"]`;
    super(
      app,
      id,
      SELF,
      container,
      app.root.locator(container).locator(`${inputs} + span`),
    );
    this.locSelected = this.loc.locator(`${inputs}:checked`);
    this.locChoices = this.loc.locator(inputs);
  }

  /** Check exactly these values, unchecking anything else. */
  async set(selected: string[], options?: ActionOptions): Promise<void> {
    const boxes = this.locContainer.locator("label input[type=checkbox]");
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      const value = await box.getAttribute("value");
      await box.setChecked(value !== null && selected.includes(value), options);
    }
  }

  /** Expect the values of the available choices. */
  async expectChoices(value: string[], options?: ActionOptions): Promise<void> {
    await expectValuesInList(
      this.locContainer,
      "input[type=checkbox]",
      "value",
      value,
      options,
    );
  }

  /** Expect the checked values. */
  async expectSelected(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    if (value.length === 0) {
      await expect(this.locSelected).toHaveCount(0, options);
      return;
    }
    await expect(this.locSelected).toHaveCount(value.length, options);
    for (let i = 0; i < value.length; i++) {
      await expect(this.locSelected.nth(i)).toHaveValue(value[i], options);
    }
  }
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

/** Controller for `shiny.ui.input_select()`. */
export class InputSelect extends UiWithLabel {
  /** Playwright `Locator` of the selected `<option>`s. */
  readonly locSelected: Locator;
  /** Playwright `Locator` of all the `<option>`s. */
  readonly locChoices: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id, `select#${id}.shiny-bound-input.form-select`);
    this.locSelected = this.loc.locator("option:checked");
    this.locChoices = this.loc.locator("option");
  }

  /** Select these values. */
  async set(
    selected: string | string[],
    options?: ActionOptions,
  ): Promise<void> {
    const values = Array.isArray(selected) ? selected : [selected];
    await this.loc.selectOption(values, options);
  }

  /** Expect the values of the available choices. */
  async expectChoices(value: string[], options?: ActionOptions): Promise<void> {
    await expectValuesInList(this.loc, "option", "value", value, options);
  }

  /** Expect the labels of the available choices. */
  async expectChoiceLabels(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locChoices).toHaveText(value, options);
  }

  /** Expect the selected values. */
  async expectSelected(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    if (value.length === 0) {
      await expect(this.locSelected).toHaveCount(0, options);
      return;
    }
    await expectValuesInList(
      this.loc,
      "option:checked",
      "value",
      value,
      options,
    );
  }

  /** Expect whether more than one option can be selected. */
  async expectMultiple(value: boolean, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(
      this.loc,
      "multiple",
      value ? "" : null,
      options,
    );
  }
}

/**
 * Controller for `shiny.ui.input_selectize()`.
 *
 * Also the controller for R's `selectInput()`, which is selectize-backed by
 * default -- the plain `<select>` that `InputSelect` drives is what Python's
 * `ui.input_select()` renders.
 */
export class InputSelectize extends UiWithLabel {
  /** Playwright `Locator` of the `<select>` selectize hides. */
  readonly locSelect: Locator;
  /** Playwright `Locator` of the selected `<option>`s. */
  readonly locSelected: Locator;
  /** Playwright `Locator` of the dropdown items. */
  readonly locChoices: Locator;
  private readonly locDropdown: Locator;
  private readonly locEvents: Locator;
  private readonly locDropdownContent: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id, `#${id} + .selectize-control`);
    this.locDropdown = this.loc.locator("> .selectize-dropdown");
    this.locEvents = this.loc.locator("> .selectize-input");
    this.locDropdownContent = this.locDropdown.locator(
      "> .selectize-dropdown-content",
    );
    this.locSelect = this.locContainer.locator(`select#${id}`);
    this.locSelected = this.locSelect.locator("> option");
    this.locChoices = this.locDropdownContent.locator("[data-value]");
  }

  /** Pick an option from the dropdown. */
  async set(selected: string, options?: ActionOptions): Promise<void> {
    await expect(this.locEvents).toHaveCount(1, options);
    await this.locEvents.click(options);
    try {
      const item = this.locDropdownContent.locator(
        `[data-value="${selected}"]`,
      );
      await expect(item).toHaveCount(1, options);
      await item.click(options);
    } finally {
      // Clicking an item closes the dropdown already; this covers the failure
      // path, where it would otherwise stay open over the rest of the app.
      await this.locEvents.press("Escape", options);
    }
  }

  /**
   * Expect the available choices.
   *
   * Selectize builds its dropdown lazily, so this opens and closes it first --
   * `_populate_dom()` in py-shiny.
   */
  async expectChoices(value: string[], options?: ActionOptions): Promise<void> {
    await this.populateDom(options);
    await expectValuesInList(
      this.locDropdownContent,
      "[data-value]",
      "data-value",
      value,
      options,
    );
  }

  /** Expect the labels of the available choices. */
  async expectChoiceLabels(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await this.populateDom(options);
    await expect(this.locChoices).toHaveText(value, options);
  }

  /** Expect the selected values. */
  async expectSelected(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    if (value.length === 0) {
      await expect(this.locSelected).toHaveCount(0, options);
      return;
    }
    await expectValuesInList(
      this.locSelect,
      "> option",
      "value",
      value,
      options,
    );
  }

  private async populateDom(options?: ActionOptions): Promise<void> {
    await this.locEvents.click(options);
    await expect(this.locDropdown).toBeVisible(options);
    await this.locEvents.press("Escape", options);
    await expect(this.locDropdown).toBeHidden(options);
  }
}
