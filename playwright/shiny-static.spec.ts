import { expect, test } from "@playwright/test";

test.describe("The URL can be used to load data", async () => {
  test("Editor view", async ({ page }) => {
    await page.goto(`http://localhost:8008/`);

    await expect(
      page.frameLocator(".app-frame").locator("text=Hello Shiny-Static!")
    ).toBeVisible();
  });
});
