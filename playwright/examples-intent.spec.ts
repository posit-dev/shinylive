import { expect, test } from "@playwright/test";
import { openExample } from "./examples-smoke-helpers";

test.describe("engine:py", () => {
  test("basic_app updates code output from slider", async ({ page }) => {
    await openExample(page, "py", "Basic App");
    const frame = page.frameLocator(".app-frame");
    const output = frame.locator("#txt");
    await expect(output).toContainText("n*2 is 40");
  });

  test("app_with_plot renders histogram plot", async ({ page }) => {
    await openExample(page, "py", "App with plot");
    const frame = page.frameLocator(".app-frame");
    const plot = frame.locator("img[alt='A histogram']");
    await expect(plot).toBeVisible();
  });

  test("input_update updates slider via action button", async ({ page }) => {
    await openExample(page, "py", "Dynamically updating inputs");
    const frame = page.frameLocator(".app-frame");
    const btn20 = frame.locator("#to_20");
    await btn20.click();
    const slider = frame.locator("#slider");
    await expect(slider).toHaveValue("20");
  });

  test("reactive_calc computes reactive outputs", async ({ page }) => {
    await openExample(page, "py", "Reactive calc");
    const frame = page.frameLocator(".app-frame");
    const txt1 = frame.locator("#txt1");
    await expect(txt1).toContainText('x times 2 is: "100"');
  });
});

test.describe("engine:r", () => {
  test("001-hello renders histogram plot", async ({ page }) => {
    await openExample(page, "r", "Hello Shiny!");
    const frame = page.frameLocator(".app-frame");
    const plot = frame.locator(
      "#distPlot img, #distPlot svg, #distPlot canvas",
    );
    await expect(plot).toBeVisible();
  });
});
