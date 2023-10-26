import { expect_editor_has_text, expect_output_has_text } from "./helpers";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:8009" });

test.describe("Editor cell view in static deployment", async () => {
  test("Input text editor is populated", async ({ page }) => {
    await page.goto(`/`);

    await expect_editor_has_text(page, "123 + 456")
  });

  test("Result is computed and shown in output frame", async ({ page }) => {
    await page.goto(`/`);

    await expect(page.locator("pre.output-content")).toBeVisible();
    await expect_output_has_text(page, "579")
  });
});
