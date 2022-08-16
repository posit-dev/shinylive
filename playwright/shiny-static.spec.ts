import { expect_editor_has_text } from "./helpers";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:8008" });

test.describe("Shiny-Static deploys", async () => {
  test("Main app view is base of URL", async ({ page }) => {
    await page.goto(`/`);

    await expect(
      page.frameLocator(".app-frame").locator("text=Hello Shiny-Static!")
    ).toBeVisible();
  });

  test("Edit view is accessable via the edit path", async ({ page }) => {
    await page.goto(`/edit`);

    // Make sure editor is there and has the identifying header
    await expect_editor_has_text(page, `ui.h2("Hello Shiny-Static!")`);

    await expect(
      page.frameLocator(".app-frame").locator("text=Hello Shiny-Static!")
    ).toBeVisible();
  });
});
