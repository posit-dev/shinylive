// Buttons, links and file uploads.
// Port of shiny/playwright/controller/_input_buttons.py

import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import {
  UiBase,
  UiWithLabel,
  expectAttributeToHaveValue,
  expectStyleToHaveValue,
} from "./_base";

/** Shared behaviour of things that are clicked and counted. */
export class InputActionBase extends UiBase {
  /** Expect the button's label. */
  async expectLabel(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc.locator(".action-label")).toHaveText(value, options);
  }

  /** Click the button. */
  async click(options?: ActionOptions): Promise<void> {
    await this.loc.click(options);
  }
}

/** Controller for `shiny.ui.input_action_button()` / `actionButton()`. */
export class InputActionButton extends InputActionBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `button[id="${id}"].action-button.shiny-bound-input`);
  }

  /** Expect the button to be disabled, or not. */
  async expectDisabled(value: boolean, options?: ActionOptions): Promise<void> {
    if (value) {
      await expect(this.loc).toBeDisabled(options);
    } else {
      await expect(this.loc).toBeEnabled(options);
    }
  }

  /** Expect the width the app asked for. */
  async expectWidth(value: string, options?: ActionOptions): Promise<void> {
    await expectStyleToHaveValue(this.loc, "width", value, options);
  }
}

/** Controller for `shiny.ui.input_action_link()` / `actionLink()`. */
export class InputActionLink extends InputActionBase {
  constructor(app: ShinyApp, id: string) {
    super(app, id, `a#${id}.action-button.shiny-bound-input`);
  }
}

/** Controller for `shiny.ui.input_file()` / `fileInput()`. */
export class InputFile extends UiWithLabel {
  /** Playwright `Locator` of the "Browse..." button. */
  readonly locButton: Locator;
  /** Playwright `Locator` of the read-only field showing the file name. */
  readonly locFileDisplay: Locator;
  /** Playwright `Locator` of the upload progress bar. */
  readonly locProgress: Locator;

  constructor(app: ShinyApp, id: string) {
    super(app, id, `input[type=file]#${id}`);
    this.locButton = this.locContainer.locator("label span.btn");
    this.locFileDisplay = this.locContainer.locator("input[type=text]");
    this.locProgress = this.locContainer.locator(".progress-bar");
  }

  /**
   * Upload files.
   *
   * `files` are paths on the machine running the test; playwright hands them to
   * the browser's file chooser, and shinylive uploads them into the wasm
   * filesystem the same way a person would.
   */
  async set(
    files: string | string[],
    options?: ActionOptions & { expectComplete?: boolean },
  ): Promise<void> {
    await this.loc.setInputFiles(files, { timeout: options?.timeout });
    if (options?.expectComplete ?? true) {
      await this.expectComplete(options);
    }
  }

  /** Wait for the upload to finish. */
  async expectComplete(options?: ActionOptions): Promise<void> {
    await expectStyleToHaveValue(this.locProgress, "width", "100%", options);
  }

  /** Expect whether more than one file can be uploaded at a time. */
  async expectMultiple(value: boolean, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(
      this.loc,
      "multiple",
      value ? "multiple" : null,
      options,
    );
  }

  /** Expect the `accept` attribute, i.e. the file types offered. */
  async expectAccept(
    value: string[] | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(
      this.loc,
      "accept",
      value === null ? null : value.join(","),
      options,
    );
  }

  /** Expect the label on the browse button. */
  async expectButtonLabel(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locButton).toHaveText(value, options);
  }

  /** Expect the placeholder shown before a file is chosen. */
  async expectPlaceholder(
    value: string | null,
    options?: ActionOptions,
  ): Promise<void> {
    await expectAttributeToHaveValue(
      this.locFileDisplay,
      "placeholder",
      value,
      options,
    );
  }
}

/** Controller for `shiny.ui.input_dark_mode()`. */
export class InputDarkMode extends UiBase {
  constructor(app: ShinyApp, id?: string) {
    super(
      app,
      id ?? "",
      `bslib-input-dark-mode${id === undefined ? "" : `#${id}`}`,
    );
  }

  /** Toggle between light and dark. */
  async click(options?: ActionOptions): Promise<void> {
    await this.loc.click(options);
  }

  /** Expect the mode the toggle reports. */
  async expectMode(value: string, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(this.loc, "mode", value, options);
  }

  /** Expect the mode the page is actually rendered in. */
  async expectPageMode(value: string, options?: ActionOptions): Promise<void> {
    const html = this.app.root.locator("html");
    await expectAttributeToHaveValue(html, "data-bs-theme", value, options);
  }
}
