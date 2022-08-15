import { Page } from "@playwright/test";

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
