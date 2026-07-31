// Tabsets and navbars.
// Port of shiny/playwright/controller/_navs.py

import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ActionOptions, PatternOrStr, ShinyApp } from "./_base";
import { expectValuesInList } from "./_base";

/**
 * How to find a navset.
 *
 * py-shiny has one class per navset flavour, each keyed on `ul#{id}`. Shinylive's
 * examples never give their navsets an id, so this also accepts a position among
 * the navsets in the app.
 */
export type NavsetSelector = { id: string } | { nth: number };

function navsetContainer(app: ShinyApp, selector: NavsetSelector): Locator {
  return "id" in selector
    ? app.root.locator(`ul#${selector.id}`)
    : app.root.locator("ul.nav[data-tabsetid]").nth(selector.nth);
}

/** Controller for `shiny.ui.nav_panel()` / `tabPanel()` / `nav_panel()`. */
export class NavPanel {
  readonly app: ShinyApp;
  /** The `data-value` identifying this panel within its navset. */
  readonly panelValue: string;
  /** Playwright `Locator` of the tab itself. */
  readonly loc: Locator;
  /** Playwright `Locator` of the `ul` holding the tabs. */
  readonly locContainer: Locator;

  constructor(app: ShinyApp, selector: NavsetSelector, panelValue: string) {
    this.app = app;
    this.panelValue = panelValue;
    this.locContainer = navsetContainer(app, selector);
    this.loc = this.locContainer.locator(
      `a[role="tab"][data-value="${panelValue}"]`,
    );
  }

  /**
   * Playwright `Locator` of this panel's content.
   *
   * The tab and its content are siblings rather than parent and child, tied
   * together by the navset's `data-tabsetid`, so this has to read that attribute
   * first.
   */
  async locContent(options?: ActionOptions): Promise<Locator> {
    const tabsetId = await this.locContainer.getAttribute(
      "data-tabsetid",
      options,
    );
    return this.app.root.locator(
      `div.tab-content[data-tabsetid="${tabsetId}"] > div.tab-pane[data-value="${this.panelValue}"]`,
    );
  }

  /** Switch to this tab. */
  async click(options?: ActionOptions): Promise<void> {
    await this.openEnclosingNavbar(options);
    await this.loc.click(options);
  }

  /**
   * Expand the navbar this tab lives in, if it has collapsed into a toggler.
   *
   * `navbar-expand-md` collapses below 768px, and the app iframe is narrower
   * than that at shinylive's default split, so the tabs of a `page_navbar()` or
   * `navset_bar()` are hidden behind a hamburger button. py-shiny's controller
   * has the equivalent for tabs nested in a dropdown.
   */
  private async openEnclosingNavbar(options?: ActionOptions): Promise<void> {
    if (await this.loc.isVisible()) return;

    const collapse = this.locContainer.locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' navbar-collapse ')][1]",
    );
    if ((await collapse.count()) === 0) return;

    const collapseId = await collapse.getAttribute("id", options);
    const toggler = this.app.root.locator(
      collapseId === null
        ? "button.navbar-toggler"
        : `button.navbar-toggler[data-bs-target="#${collapseId}"]`,
    );
    if ((await toggler.count()) === 0) return;

    await toggler.click(options);
    await expect(this.loc).toBeVisible(options);
  }

  /** Expect this tab to be the selected one, or not. */
  async expectActive(value: boolean, options?: ActionOptions): Promise<void> {
    if (value) {
      await expect(this.loc).toHaveClass(/(^|\s)active(\s|$)/, options);
    } else {
      await expect(this.loc).not.toHaveClass(/(^|\s)active(\s|$)/, options);
    }
  }
}

/**
 * Controller for the `shiny.ui.navset_*()` family, R's `tabsetPanel()` and the
 * navbar of a `page_navbar()` / `navbarPage()`.
 */
export class Navset {
  readonly app: ShinyApp;
  private readonly selector: NavsetSelector;
  /** Playwright `Locator` of the `ul` holding the tabs. */
  readonly locContainer: Locator;
  /** Playwright `Locator` of the tabs. */
  readonly loc: Locator;

  constructor(app: ShinyApp, selector: NavsetSelector = { nth: 0 }) {
    this.app = app;
    this.selector = selector;
    this.locContainer = navsetContainer(app, selector);
    this.loc = this.locContainer.locator('a[role="tab"]');
  }

  /** A controller for one of this navset's panels. */
  navPanel(panelValue: string): NavPanel {
    return new NavPanel(this.app, this.selector, panelValue);
  }

  /** Switch to the named tab. */
  async set(value: string, options?: ActionOptions): Promise<void> {
    await this.navPanel(value).click(options);
  }

  /** Expect the selected tab. */
  async expectValue(
    value: PatternOrStr,
    options?: ActionOptions,
  ): Promise<void> {
    await expect(
      this.locContainer.locator('a[role="tab"].active'),
    ).toHaveAttribute("data-value", value, options);
  }

  /** Expect the `data-value`s of every tab, in order. */
  async expectNavValues(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expectValuesInList(
      this.locContainer,
      'a[role="tab"]',
      "data-value",
      value,
      options,
    );
  }

  /** Expect the visible titles of every tab, in order. */
  async expectNavTitles(
    value: string[],
    options?: ActionOptions,
  ): Promise<void> {
    await expect(this.loc).toHaveText(value, options);
  }

  /** Playwright `Locator` of whichever panel is currently showing. */
  async locActiveContent(options?: ActionOptions): Promise<Locator> {
    const tabsetId = await this.locContainer.getAttribute(
      "data-tabsetid",
      options,
    );
    return this.app.root.locator(
      `div.tab-content[data-tabsetid="${tabsetId}"] > div.tab-pane.active`,
    );
  }
}
