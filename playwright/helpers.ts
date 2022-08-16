import { Page, expect } from "@playwright/test";

/**
 * Wait until shinylive terminal shows the three >>>'s indicating that it's
 * ready to go
 * @param page Page object available from inside playwright tests
 */
export async function wait_until_initialized(page: Page) {
  await page.waitForSelector(`text=">>>"`, { timeout: 10000 });
}

/**
 * Click the run app button in the upper right of the editor
 * @param page Page object available from inside playwright tests
 */
export async function click_run_app_button(page: Page) {
  // This is a bit of an intense selector for the run button but right now I
  // can't figure out a better way
  await page.locator(`[aria-label="Re-run code (Ctrl)-Shift-Enter"]`).click();
}

async function expect_pane_has_text(
  page: Page,
  pane_selector: string,
  text: string
) {
  expect(page.locator(pane_selector, { hasText: text })).toBeVisible();
}

/**
 * Test that some text exists in the editor pane
 * @param page Page object available from inside playwright tests
 * @param text Text to search for in the editor panel
 */
export async function expect_editor_has_text(page: Page, text: string) {
  expect_pane_has_text(page, `.Editor`, text);
}

/**
 * Test that some text exists in the terminal pane
 * @param page Page object available from inside playwright tests
 * @param text Text to search for in the terminal panel
 */
export async function expect_terminal_has_text(page: Page, text: string) {
  expect_pane_has_text(page, `.Terminal`, text);
}

/**
 * Test that some text exists in the app viewer pane
 * @param page Page object available from inside playwright tests
 * @param text Text to search for in the terminal panel
 * @param selector Element to search for text in. Defaults to h1 tag
 */
export async function expect_app_has_text(
  page: Page,
  text: string,
  selector: string = "h1"
) {
  // For some reason there needs to be an await for the frame locator but not
  // for the other normal locators
  await expect(
    page.frameLocator(".app-frame").locator(selector, { hasText: text })
  ).toBeVisible();
}

/**
 * A URL data-hash containing the following app:
 *
 * ```
 * from shiny import App, render, ui
 *
 * app_ui = ui.page_fluid(
 *     ui.h1("Code from a url")
 * )
 *
 * def server(input, output, session):
 *     pass
 *
 * app = App(app_ui, server)
 * ```
 *
 */
export const app_url_encoding =
  "code=NobwRAdghgtgpmAXGKAHVA6VBPMAaMAYwHsIAXOcpMAMwCdiYACAZwAsBLCbJjmVYnTJMAgujxM6lACZw6EgK4cAOhFVpUAfSVMAvEyVYoAcziaaAGyXSAFKqYODHDGwCMdsAGFispvUZMUAZ0FspgAJSqkWoQsjSscgBucjZcqApkEsQZ6ZkJLCwcpOGI9o6oUAVlDuroeqLoNhraHBIsSXLRYAC+ALpAA";
