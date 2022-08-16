import { expect_editor_has_text, app_url_encoding } from "./helpers";
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

  test("Doesn't load data from URL", async ({ page }) => {
    await page.goto(`/edit/#${app_url_encoding}`);

    // Make sure editor is there and has the identifying header
    await expect(
      page.locator(`.Editor`, { hasText: `ui.h2("Hello Shiny-Static!")` })
    ).toBeVisible();

    // Double check that the header from the app from url encoding didnt make it
    // into the editor
    await expect(
      page.locator(`.Editor`, { hasText: 'ui.h1("Code from a url")' })
    ).not.toBeVisible();

    await expect(
      page.frameLocator(".app-frame").locator("text=Hello Shiny-Static!")
    ).toBeVisible();
  });

  test("App view never shows header bar - no url req", async ({ page }) => {
    await page.goto(`/`);

    await expect(page.locator('.HeaderBar img[alt="Shiny"]')).not.toBeVisible();
  });

  test("App view never shows header bar - with url req", async ({ page }) => {
    await page.goto(`/#h=0`);

    await expect(page.locator('.HeaderBar img[alt="Shiny"]')).not.toBeVisible();
  });
});
