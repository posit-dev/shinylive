import {
  app_url_encoding,
  expect_app_has_text,
  expect_editor_has_text,
} from "./helpers";
import { expect, test } from "@playwright/test";

test.describe("The URL can be used to load data", async () => {
  test("Editor view", async ({ page }) => {
    await page.goto(`/editor/#${app_url_encoding}`);

    // Make sure the correct text is in the editor
    await expect_editor_has_text(page, 'ui.h1("Code from a url")');

    await expect_app_has_text(page, "Code from a url", "h1");
  });

  test("Examples view", async ({ page }) => {
    await page.goto(`/examples/#${app_url_encoding}`);

    // Sanity check we're in the examples view.
    await expect(page.locator("text=/^examples$/i")).toBeVisible();

    // Make sure the correct text is in the editor
    await expect_editor_has_text(page, 'ui.h1("Code from a url")');

    await expect_app_has_text(page, "Code from a url", "h1");
  });

  test("App view", async ({ page }) => {
    await page.goto(`/app/#${app_url_encoding}`);

    await expect_app_has_text(page, "Code from a url", "h1");
  });
});

// Looks for the shiny logo
const header_bar_selector = '.HeaderBar img[alt="Shiny"]';

test.describe("The header bar parameter can turn off the header in app view but not the other views", async () => {
  test("Editor view can't turn off header bar", async ({ page }) => {
    await page.goto(`/editor/#h=0&${app_url_encoding}`);

    await expect(page.locator(header_bar_selector)).toBeVisible();
  });
  test("Examples view can't turn off header bar", async ({ page }) => {
    await page.goto(`/examples/#h=0&${app_url_encoding}`);

    await expect(page.locator(header_bar_selector)).toBeVisible();
  });

  test("App view can turn off header bar", async ({ page }) => {
    await page.goto(`/app/#h=0&${app_url_encoding}`);

    await expect(page.locator(header_bar_selector)).not.toBeVisible();
  });
  test("App view can show header bar", async ({ page }) => {
    await page.goto(`/editor/#${app_url_encoding}`);

    await expect(page.locator(header_bar_selector)).toBeVisible();
  });
});
