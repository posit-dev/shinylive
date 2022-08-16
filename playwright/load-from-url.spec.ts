import {
  click_run_app_button,
  expect_editor_has_text,
  expect_terminal_has_text,
  wait_until_initialized,
} from "./helpers";
import { test, expect } from "@playwright/test";

test("test", async ({ page }) => {
  await page.goto(
    "http://localhost:3000/editor/#code=NobwRAdghgtgpmAXGALnAzigdABwJ5gA0YAxgPYRqVJg4BOAlpQBQA6YAKgBYPoAEvPuQAmcPgDM6ZGHxRcxAVzoAbdgEowAXwC6QA"
  );

  // Wait for initialization to complete
  await wait_until_initialized(page);

  // Make sure the correct text is in the editor
  await expect_editor_has_text(page, 'print("This is code from the url")');

  // This is a bit of an intense selector for the run button but right now I
  // cant figure out a better way
  await click_run_app_button(page);

  await expect_terminal_has_text(page, "This is code from the url");
});
