import { expect_terminal_has_text, wait_until_initialized } from "./helpers";
import { expect, test } from "@playwright/test";

test("Open examples page and click to a new example", async ({ page }) => {
  await page.goto("/examples/");
  // Click text=App with plot
  await page.locator("text=App with plot").click();
  await expect(page).toHaveURL("http://localhost:3000/examples/#app-with-plot");
});

test("Add a new non-app script, type in it, and run code", async ({ page }) => {
  await page.goto("/examples/");

  // Wait for initialization to complete
  await wait_until_initialized(page);
  await page.locator(`[aria-label="Add a file"]`).click();
  await page.locator('[aria-label="Name current file"]').fill("my_app.py");

  await page.locator(".cm-editor [role=textbox]").type(`print("hello world")`);

  // Running both command enter for mac and control enter for non-macs. Running
  // both just helps avoid looking at running environment
  await page.locator(".cm-editor [role=textbox]").press(`Meta+Enter`);
  await page.locator(".cm-editor [role=textbox]").press(`Control+Enter`);

  // Make sure that hello world exists in the terminal output
  await expect_terminal_has_text(page, `>>> print("hello world")`);
  await expect_terminal_has_text(page, "hello world");
});
