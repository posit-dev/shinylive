import { test, expect } from "@playwright/test";

test("test", async ({ page }) => {
  // Go to http://localhost:3000/examples/
  await page.goto("http://localhost:3000/examples/");
  // Click text=App with plot
  await page.locator("text=App with plot").click();
  await expect(page).toHaveURL("http://localhost:3000/examples/#app-with-plot");
});
