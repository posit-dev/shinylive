// Sidebars, cards, value boxes and accordions.
// Port of shiny/playwright/controller/_layout.py, _card.py and _accordion.py.

import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import { UiBase, UiWithContainer, expectAttributeToHaveValue } from "./_base";

/**
 * Controller for `shiny.ui.sidebar()` / `bslib::sidebar()`.
 *
 * bslib generates the sidebar's id when the app does not set one, so this
 * defaults to the only sidebar in the app rather than requiring one.
 */
export class Sidebar extends UiWithContainer {
  /** Playwright `Locator` of the sidebar's title. */
  readonly locTitle: Locator;
  /** Playwright `Locator` of the open/close button. */
  readonly locHandle: Locator;

  constructor(app: ShinyApp, id?: string) {
    super(
      app,
      id ?? "",
      id === undefined ? "> aside" : `> aside#${id}`,
      ".bslib-sidebar-layout",
    );
    this.locTitle = this.loc.locator("> .sidebar-content > .sidebar-title");
    this.locHandle = this.locContainer.locator("button.collapse-toggle");
  }

  /** Expect the text content of the sidebar. */
  async expectText(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveText(value, options);
  }

  /** Expect the sidebar to be open, or collapsed. */
  async expectOpen(value: boolean, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(
      this.locHandle,
      "aria-expanded",
      String(value),
      options,
    );
  }

  /** Open or collapse the sidebar. */
  async set(open: boolean, options?: ActionOptions): Promise<void> {
    const isOpen =
      (await this.locHandle.getAttribute("aria-expanded", options)) === "true";
    if (isOpen !== open) {
      await this.locHandle.click(options);
    }
    await this.expectOpen(open, options);
  }
}

/** Controller for `shiny.ui.card()` / `bslib::card()`. */
export class Card extends UiBase {
  /** Playwright `Locator` of the card header. */
  readonly locHeader: Locator;
  /** Playwright `Locator` of the card body. */
  readonly locBody: Locator;
  /** Playwright `Locator` of the card footer. */
  readonly locFooter: Locator;

  /**
   * A card is usually anonymous in the DOM, so `nth` picks one by position in
   * document order when there is no id to key on.
   */
  constructor(app: ShinyApp, selector: { id: string } | { nth: number }) {
    const loc =
      "id" in selector
        ? app.root.locator(`#${selector.id}.card`)
        : app.root.locator("div.card.bslib-card").nth(selector.nth);
    super(app, "id" in selector ? selector.id : "", loc);
    this.locHeader = this.loc.locator("> .card-header");
    this.locBody = this.loc.locator("> .card-body");
    this.locFooter = this.loc.locator("> .card-footer");
  }

  /** Expect the text in the card header. */
  async expectHeader(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locHeader).toHaveText(value, options);
  }

  /** Expect the text in the card body. */
  async expectBody(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locBody).toHaveText(value, options);
  }
}

/** Controller for `shiny.ui.value_box()` / `bslib::value_box()`. */
export class ValueBox extends UiBase {
  /** Playwright `Locator` of the title. */
  readonly locTitle: Locator;
  /** Playwright `Locator` of the value. */
  readonly locValue: Locator;

  constructor(app: ShinyApp, selector: { id: string } | { nth: number }) {
    const loc =
      "id" in selector
        ? app.root.locator(`#${selector.id}.bslib-value-box`)
        : app.root.locator("div.bslib-value-box").nth(selector.nth);
    super(app, "id" in selector ? selector.id : "", loc);
    this.locTitle = this.loc.locator(".value-box-title");
    this.locValue = this.loc.locator(".value-box-value");
  }

  /** Expect the value box's title. */
  async expectTitle(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locTitle).toHaveText(value, options);
  }

  /** Expect the value box's value. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locValue).toHaveText(value, options);
  }
}

/** Controller for one panel of an accordion. */
export class AccordionPanel {
  /** Playwright `Locator` of the panel. */
  readonly loc: Locator;
  /** Playwright `Locator` of the panel's header button. */
  readonly locHeader: Locator;
  /** Playwright `Locator` of the panel's body. */
  readonly locBody: Locator;

  constructor(accordion: Locator, dataValue: string) {
    this.loc = accordion.locator(
      `> .accordion-item[data-value="${dataValue}"]`,
    );
    this.locHeader = this.loc.locator(
      "> .accordion-header > .accordion-button",
    );
    this.locBody = this.loc.locator("> .accordion-collapse");
  }

  /** Expect the panel to be expanded, or collapsed. */
  async expectOpen(value: boolean, options?: ActionOptions): Promise<void> {
    await expectAttributeToHaveValue(
      this.locHeader,
      "aria-expanded",
      String(value),
      options,
    );
  }

  /** Expand or collapse the panel. */
  async set(open: boolean, options?: ActionOptions): Promise<void> {
    const isOpen =
      (await this.locHeader.getAttribute("aria-expanded", options)) === "true";
    if (isOpen !== open) {
      await this.locHeader.click(options);
    }
    await this.expectOpen(open, options);
  }

  /** Expect the label on the panel's header. */
  async expectLabel(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.locHeader).toHaveText(value, options);
  }
}

/** Controller for `shiny.ui.accordion()` / `bslib::accordion()`. */
export class Accordion extends UiBase {
  constructor(
    app: ShinyApp,
    selector: { id: string } | { nth: number } = { nth: 0 },
  ) {
    super(
      app,
      "id" in selector ? selector.id : "",
      "id" in selector
        ? app.root.locator(`div#${selector.id}.accordion`)
        : app.root.locator("div.accordion").nth(selector.nth),
    );
  }

  /** A controller for one of this accordion's panels. */
  accordionPanel(dataValue: string): AccordionPanel {
    return new AccordionPanel(this.loc, dataValue);
  }

  /** Expect the `data-value`s of every panel, in order. */
  async expectPanels(value: string[], options?: ActionOptions): Promise<void> {
    const panels = this.loc.locator("> .accordion-item");
    await expect(panels).toHaveCount(value.length, options);
    for (let i = 0; i < value.length; i++) {
      await expect(panels.nth(i)).toHaveAttribute(
        "data-value",
        value[i],
        options,
      );
    }
  }
}
