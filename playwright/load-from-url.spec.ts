import {
  expect_app_has_text,
  expect_editor_has_text,
  wait_until_initialized,
} from "./helpers";
import { test } from "@playwright/test";

test("test", async ({ page }) => {
  await page.goto(
    "http://localhost:3000/editor/#code=NobwRAdghgtgpmAXGKAHVA6VBPMAaMAYwHsIAXOcpMAMwCdiYACAZwAsBLCbJjmVYnTJMAgujxM6lACZw6EgK4cAOhFVpUAfSVMAvEyVYoAcziaaAGyXSAFKqYODHDGwCMdsAGFispvUZMUAZ0FspgAJSqkWoQsjSscgBucjZcqApkEsQZ6ZkJLCwcpOGI9o6oUAVlDuroeqLoNhraHBIsSXLRYAC+ALpAA"
  );

  // Wait for initialization to complete
  await wait_until_initialized(page);

  // Make sure the correct text is in the editor
  await expect_editor_has_text(page, 'ui.h1("Code from a url")');

  await expect_app_has_text(page, "Code from a url", "h1");
});
