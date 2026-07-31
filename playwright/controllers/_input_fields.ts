// Text, numeric and date inputs.
// Port of shiny/playwright/controller/_input_fields.py

import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import {
  UiWithLabel,
  expectAttributeToHaveValue,
  expectStyleToHaveValue,
} from "./_base";

/** Shared behaviour of the free-text inputs. */
class TextInputBase extends UiWithLabel {
  /** Replace the contents of the field. */
  async set(value: string, options?: ActionOptions): Promise<void> {
    await this.loc.fill(value, options);
  }

  /** Expect the current value of the field. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveValue(value, options);
  }

  /** Expect the field's placeholder text. */
  async expectPlaceholder(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "placeholder", value, options);
  }

  /** Expect the width the app asked for. */
  async expectWidth(value: string, options?: ActionOptions): Promise<void> {
    await expectStyleToHaveValue(this.locContainer, "width", value, options);
  }
}

/** Controller for `shiny.ui.input_text()` / `textInput()`. */
export class InputText extends TextInputBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `input#${id}[type=text].shiny-bound-input`);
  }
}

/** Controller for `shiny.ui.input_password()` / `passwordInput()`. */
export class InputPassword extends TextInputBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `input#${id}[type=password].shiny-bound-input`);
  }
}

/** Controller for `shiny.ui.input_text_area()` / `textAreaInput()`. */
export class InputTextArea extends TextInputBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `textarea#${id}.shiny-bound-input`);
  }

  /** Expect the `rows` attribute of the textarea. */
  async expectRows(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "rows", value, options);
  }
}

/** Controller for `shiny.ui.input_numeric()` / `numericInput()`. */
export class InputNumeric extends TextInputBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `input#${id}[type=number].shiny-bound-input`);
  }

  /** Expect the `min` attribute of the input. */
  async expectMin(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "min", value, options);
  }

  /** Expect the `max` attribute of the input. */
  async expectMax(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "max", value, options);
  }

  /** Expect the `step` attribute of the input. */
  async expectStep(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "step", value, options);
  }
}

/** Controller for `shiny.ui.input_date()` / `dateInput()`. */
export class InputDate extends UiWithLabel {
  constructor(app: ShinyApp, id: string) {
    super(
      app,
      id,
      "input[type=text].form-control",
      `div#${id}.shiny-input-container`,
    );
  }

  /** Type a date into the field, in the input's own format. */
  async set(value: string, options?: ActionOptions): Promise<void> {
    await this.loc.fill(value, options);
    // The datepicker only commits on blur, so leave the field.
    await this.loc.blur(options);
  }

  /** Expect the date currently shown. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveValue(value, options);
  }

  /** Expect the earliest selectable date. */
  async expectMinDate(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-min-date", value, options);
  }

  /** Expect the latest selectable date. */
  async expectMaxDate(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "data-max-date", value, options);
  }

  /** Expect the display format of the date. */
  async expectFormat(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(
      this.loc,
      "data-date-format",
      value,
      options,
    );
  }
}
