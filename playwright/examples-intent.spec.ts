// Intent tests for every example app, for both engines.
//
// Where the smoke test only asks "did this app start without complaining?",
// these ask "does it do the thing it exists to demonstrate?" -- drive its
// inputs, and check the outputs that depend on them.
//
// Apps are driven through the Shiny controllers in ./controllers, a port of the
// ones py-shiny uses for its own tests, so an assertion here describes the Shiny
// component rather than the markup bslib happens to render for it. See
// ./controllers/README.md.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import * as path from "path";
import type { OutputPlot } from "./controllers";
import {
  Accordion,
  DownloadButton,
  InputActionButton,
  InputCheckbox,
  InputCheckboxGroup,
  InputDarkMode,
  InputDate,
  InputFile,
  InputNumeric,
  InputPassword,
  InputRadioButtons,
  InputSelect,
  InputSelectize,
  InputSlider,
  InputSliderRange,
  InputSwitch,
  InputText,
  InputTextArea,
  Navset,
  OutputCode,
  OutputDataFrame,
  OutputTable,
  OutputText,
  OutputTextVerbatim,
  OutputUi,
  OutputPlot as Plot,
  Sidebar,
  ValueBox,
} from "./controllers";
import { openExample, terminalText } from "./examples-smoke-helpers";

const UPLOAD_CSV = path.join(__dirname, "fixtures", "upload.csv");

/**
 * Run `action` and expect the plot to be redrawn.
 *
 * Both engines send plots down as inline base64 images, so a new `src` means the
 * app really re-ran the plotting code. The comparison is reduced to a boolean so
 * a failure reports "the plot did not change" rather than two data URLs.
 */
async function expectPlotToRedraw(
  plot: OutputPlot,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = await plot.locImg.getAttribute("src");
  await action();
  await expect
    .poll(async () => (await plot.locImg.getAttribute("src")) !== before, {
      message: "expected the plot to be redrawn",
    })
    .toBe(true);
}

/**
 * Drag a brush across part of an interactive plot.
 *
 * The corners are fractions of the rendered image, so the region covers the same
 * part of the data whatever size the plot came back at. Keep them well inside
 * the image: Shiny ignores a drag that starts outside the plotting panel, so a
 * brush begun in the axis margin silently does nothing.
 */
async function brush(
  page: Page,
  plot: OutputPlot,
  region: { x1: number; y1: number; x2: number; y2: number },
): Promise<void> {
  await plot.locImg.scrollIntoViewIfNeeded();
  const box = await plot.locImg.boundingBox();
  if (box === null) throw new Error(`plot #${plot.id} has no bounding box`);
  const at = (fx: number, fy: number): [number, number] => [
    box.x + fx * box.width,
    box.y + fy * box.height,
  ];

  await page.mouse.move(...at(region.x1, region.y1));
  await page.mouse.down();
  // Two moves: shiny's brush handler needs to see the drag, not just the end.
  await page.mouse.move(...at((region.x1 + region.x2) / 2, region.y2));
  await page.mouse.move(...at(region.x2, region.y2));
  await page.mouse.up();
  // Shiny debounces brush input by 300ms, so the coordinates have not reached
  // the server yet when the mouse comes up.
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Shiny for Python
// ---------------------------------------------------------------------------

test.describe("engine:py", () => {
  test("Basic App", async ({ page }) => {
    const app = await openExample(page, "py", "Basic App");
    const n = new InputSlider(app, "n");
    const txt = new OutputCode(app, "txt");

    await n.expectLabel("N");
    await n.expectValue("20");
    await txt.expectValue("n*2 is 40");

    await n.set("40");
    await n.expectValue("40");
    await txt.expectValue("n*2 is 80");
  });

  test("App with plot", async ({ page }) => {
    const app = await openExample(page, "py", "App with plot");
    const n = new InputSlider(app, "n");
    const histogram = new Plot(app, "histogram");

    await new Sidebar(app).expectOpen(true);
    await n.expectValue("20");
    await histogram.expectRendered();
    await histogram.expectImgAlt("A histogram");

    // The bin count is the one thing this app lets you change.
    await expectPlotToRedraw(histogram, () => n.set("60"));
  });

  test("CPU info", async ({ page }) => {
    const app = await openExample(page, "py", "CPU info");
    const cmap = new InputSelect(app, "cmap");
    const navset = new Navset(app);

    await cmap.expectChoices(["inferno", "viridis", "copper", "prism"]);
    await cmap.expectSelected(["inferno"]);
    await new InputSwitch(app, "hold").expectChecked(false);
    await new InputActionButton(app, "reset").expectLabel("Clear history");

    await navset.expectNavTitles(["Graphs", "Heatmap"]);
    await navset.expectValue("Graphs");
    await new Plot(app, "plot").expectRendered();

    // The heatmap is a table with one column per (fake) CPU.
    await navset.set("Heatmap");
    await navset.expectValue("Heatmap");
    await new InputNumeric(app, "table_rows").expectValue("15");
    await new OutputTable(app, "table").expectNcol(8);
  });

  test("Regularization", async ({ page }) => {
    const app = await openExample(page, "py", "Regularization");

    await new InputSlider(app, "a").expectValue("0.1");
    // One simulation feeds all three plots through a reactive calc.
    await new Plot(app, "plot").expectRendered();
    await new Plot(app, "plotVOWELS").expectRendered();
    await new Plot(app, "plotCONSONANTS").expectRendered();
  });

  test("Plotly", async ({ page }) => {
    const app = await openExample(page, "py", "Plotly");

    // shinywidgets outputs are ipywidgets, not Shiny outputs, so there is no
    // controller for them -- assert on what plotly renders instead.
    for (const id of ["plot1", "plot2"]) {
      const plot = app.root.locator(`#${id}.shiny-ipywidget-output`);
      await expect(plot.locator(".js-plotly-plot")).toBeVisible();
      await expect(plot.locator("g.bars")).toBeVisible();
    }
  });

  test("altair", async ({ page }) => {
    const app = await openExample(page, "py", "altair");
    const variable = new InputSelectize(app, "var");
    const chart = app.root.locator("#hist.shiny-ipywidget-output");

    await variable.expectChoices(["bill_length_mm", "body_mass_g"]);
    await variable.expectSelected(["bill_length_mm"]);
    await expect(chart.locator("canvas, svg").first()).toBeVisible();

    await variable.set("body_mass_g");
    await variable.expectSelected(["body_mass_g"]);
    await expect(chart.locator("canvas, svg").first()).toBeVisible();
  });

  test("Map", async ({ page }) => {
    const app = await openExample(page, "py", "Map");
    const center = new InputSelect(app, "center");

    await center.expectChoices(["London", "Paris", "New York"]);
    await center.expectSelected(["London"]);
    await expect(app.root.locator("#map .leaflet-container")).toBeVisible();

    await center.set("Paris");
    await center.expectSelected(["Paris"]);
  });

  test("Multiple source files", async ({ page }) => {
    const app = await openExample(page, "py", "Multiple source files");
    const n = new InputSlider(app, "n");
    const txt = new OutputCode(app, "txt");

    // square() lives in utils.py; a wrong answer here means the second file
    // never made it into the app.
    await txt.expectValue("20 squared is 400");
    await n.set("30");
    await txt.expectValue("30 squared is 900");
  });

  test("Read local CSV", async ({ page }) => {
    const app = await openExample(page, "py", "Read local CSV");
    const navset = new Navset(app);
    const frame = new OutputDataFrame(app, "frame");

    await navset.expectNavTitles(["Data frame", "Table"]);
    await frame.expectNrow(32);
    await frame.expectNcol(11);
    await frame.expectCell("21", { row: 0, col: 0 });

    // The same data, rendered as a static table.
    await navset.set("Table");
    const table = new OutputTable(app, "table");
    await table.expectNrow(32);
    await table.expectNcol(11);
  });

  test("File upload", async ({ page }) => {
    const app = await openExample(page, "py", "File upload");
    const file1 = new InputFile(app, "file1");
    const type = new InputRadioButtons(app, "type");
    const content = new OutputCode(app, "file_content");

    await file1.expectMultiple(true);
    await type.expectChoices(["Text", "Binary"]);
    await type.expectSelected("Text");
    await content.expectValue("");

    await file1.set(UPLOAD_CSV);
    await content.expect.toContainText("upload.csv");
    await content.expect.toContainText("MIME type: text/csv");
    await content.expect.toContainText("theta,8");

    // The same bytes, now as a hex dump: "name" is 6e 61 6d 65.
    await type.set("Binary");
    await content.expect.toContainText("6e 61 6d 65");
  });

  test("Dynamically inserting UI", async ({ page }) => {
    const app = await openExample(page, "py", "Dynamically inserting UI");
    const btn = new InputActionButton(app, "btn");
    const inserted = app.root.locator("#inserted-slider");

    // One slider comes from @render.ui and is there from the start.
    await new OutputUi(app, "dyn_ui").expectEmpty(false);
    await new InputSlider(app, "n1").expectValue("20");
    await expect(inserted).toHaveCount(0);

    // The other is inserted and removed imperatively.
    await btn.click();
    await new InputSlider(app, "n2").expectValue("20");
    await btn.click();
    await expect(inserted).toHaveCount(0);
  });

  test("Dynamically updating inputs", async ({ page }) => {
    const app = await openExample(page, "py", "Dynamically updating inputs");
    const slider = new InputSlider(app, "slider");

    await slider.expectValue("50");
    await slider.expectWidth("50%");

    await new InputActionButton(app, "to_20").click();
    await slider.expectValue("20");

    await new InputActionButton(app, "to_60").click();
    await slider.expectValue("60");
  });

  test("Extra packages", async ({ page }) => {
    const app = await openExample(page, "py", "Extra packages");

    // The app renders nothing but prose; the point is that importing attrs,
    // isodate and tabulate from requirements.txt did not blow up.
    await expect(app.root.locator("body")).toContainText("requirements.txt");
    await expect(app.root.locator("body")).toContainText("micropip");
  });

  test("Fetch data from a web API", async ({ page }) => {
    const app = await openExample(page, "py", "Fetch data from a web API");
    const city = new InputSelectize(app, "city");
    const dataType = new InputRadioButtons(app, "data_type");

    // No city is selected on startup, so the app makes no request -- which is
    // what keeps this test off the network.
    await city.expectSelected([""]);
    await dataType.expectChoices(["json", "string", "bytes"]);
    await dataType.expectSelected("json");
    await new OutputCode(app, "info").expectValue("");
  });

  test("Branded Theming", async ({ page }) => {
    const app = await openExample(page, "py", "Branded Theming");
    const navset = new Navset(app);
    const plot1 = new Plot(app, "plot1");

    await navset.expectNavTitles([
      "Input Output Demo",
      "Widget Gallery",
      "Colors",
      "Documentation",
    ]);

    // The app iframe is narrow enough to put bslib in mobile mode, where this
    // layout starts with its sidebar closed.
    const sidebar = new Sidebar(app);
    await sidebar.expectOpen(false);
    await sidebar.set(true);

    // First panel: one of every input type the brand theme has to style.
    await new InputSlider(app, "slider1").expectValue("11");
    await new InputNumeric(app, "numeric1").expectValue("30");
    await new InputDate(app, "date1").expectValue("2024-01-01");
    await new InputSwitch(app, "switch1").expectChecked(true);
    await new InputRadioButtons(app, "radio1").expectSelected("Option A");
    await new ValueBox(app, { nth: 0 }).expectTitle("Metric 1");
    await new ValueBox(app, { nth: 0 }).expectValue("100");
    await plot1.expectRendered();
    await new OutputTextVerbatim(app, "out_text1").expect.toContainText(
      "def example_function():",
    );

    // The plot is drawn from the slider and the numeric input.
    await expectPlotToRedraw(plot1, () =>
      new InputSlider(app, "slider1").set("5"),
    );

    await navset.set("Widget Gallery");
    const check1 = new InputCheckboxGroup(app, "check1");
    await check1.expectChoices(["Item 1", "Item 2", "Item 3"]);
    await check1.set(["Item 1", "Item 3"]);
    await check1.expectSelected(["Item 1", "Item 3"]);

    const text1 = new InputText(app, "text1");
    await text1.set("hello");
    await text1.expectValue("hello");

    await new InputTextArea(app, "textarea1").expectValue(
      "Default text content for the text area widget",
    );
    const password1 = new InputPassword(app, "password1");
    await password1.set("hunter2");
    await password1.expectValue("hunter2");

    // The navbar's dark mode switch themes the whole page.
    const darkMode = new InputDarkMode(app, "color_mode");
    await darkMode.expectPageMode("light");
    await darkMode.click();
    await darkMode.expectPageMode("dark");
  });

  test("Event decorator", async ({ page }) => {
    const app = await openExample(page, "py", "Event decorator");
    const n = new InputSlider(app, "n");
    const btn = new InputActionButton(app, "btn");
    const txt = new OutputCode(app, "txt");

    // @reactive.event means the output waits for the button, not the slider.
    await txt.expectValue("");
    await btn.click();
    await txt.expectValue("Last value: 10");

    await n.set("15");
    await n.expectValue("15");
    await txt.expectValue("Last value: 10");
    await btn.click();
    await txt.expectValue("Last value: 15");
  });

  test("Reactive effect", async ({ page }) => {
    const app = await openExample(page, "py", "Reactive effect");
    const x = new InputText(app, "x");

    await x.expectPlaceholder("Enter text");
    await x.set("shinylive");

    // The effect's only output is a print(), which pyodide wires to the
    // shinylive terminal.
    await expect
      .poll(async () => await terminalText(page), {
        message: "expected the effect's print() to reach the terminal",
      })
      .toContain("x has changed to shinylive");
  });

  test("Reactive calc", async ({ page }) => {
    const app = await openExample(page, "py", "Reactive calc");
    const x = new InputSlider(app, "x");
    const txt1 = new OutputCode(app, "txt1");
    const txt2 = new OutputCode(app, "txt2");

    // Both outputs read the same calc, so they always agree.
    await txt1.expectValue('x times 2 is: "100"');
    await txt2.expectValue('x times 2 is: "100"');

    await x.set("60");
    await txt1.expectValue('x times 2 is: "120"');
    await txt2.expectValue('x times 2 is: "120"');
  });

  test("Reactive value", async ({ page }) => {
    const app = await openExample(page, "py", "Reactive value");
    const btn = new InputActionButton(app, "btn");
    const txt = new OutputCode(app, "txt");

    // The output lists the gaps between presses, so it starts empty and gains
    // one entry per press.
    await txt.expectValue("[]");
    await btn.click();
    await txt.expectValue(/^\[\d+(\.\d+)?\]$/);
    await btn.click();
    await txt.expectValue(/^\[\d+(\.\d+)?, \d+(\.\d+)?\]$/);
  });

  test("File download", async ({ page }) => {
    const app = await openExample(page, "py", "File download");

    // A file straight off disk, keeping the name it has there.
    const download1 = new DownloadButton(app, "download1");
    await download1.expectLabel("Download CSV");
    expect((await download1.download()).suggestedFilename()).toBe("mtcars.csv");

    // A PNG generated on demand from the two inputs above it.
    await new InputText(app, "title").expectValue("Random scatter plot");
    await new InputSlider(app, "num_points").expectValue("50");
    const download2 = new DownloadButton(app, "download2");
    expect((await download2.download()).suggestedFilename()).toBe("image.png");

    // A name computed when the download is requested.
    const download3 = new DownloadButton(app, "download3");
    expect((await download3.download()).suggestedFilename()).toMatch(
      /^data-\d{4}-\d{2}-\d{2}-\d{3}\.csv$/,
    );
  });

  test("Modules", async ({ page }) => {
    const app = await openExample(page, "py", "Modules");

    // Two instances of one module, each keeping its own count.
    for (const id of ["counter1", "counter2"]) {
      await new OutputCode(app, `${id}-out`).expectValue("Click count is 0");
    }
    await new InputActionButton(app, "counter1-button").click();
    await new OutputCode(app, "counter1-out").expectValue("Click count is 1");
    await new OutputCode(app, "counter2-out").expectValue("Click count is 0");
  });

  test("Orbit simulation", async ({ page }) => {
    const app = await openExample(page, "py", "Orbit simulation");
    const accordion = new Accordion(app);
    const days = new InputSlider(app, "days");
    const orbits = new Plot(app, "orbits");

    await accordion.expectPanels(["Settings", "Earth", "Moon", "Planet X"]);
    await accordion.accordionPanel("Settings").expectOpen(true);
    await days.expectValue("60");
    // The empty 3D axes are drawn before the first run.
    await orbits.expectRendered();

    // Shorten the simulation before running it, so the test is not waiting on
    // 60 days of integration.
    await days.set("10");
    await expectPlotToRedraw(orbits, () =>
      new InputActionButton(app, "run").click(),
    );
  });

  test("Wordle", async ({ page }) => {
    const app = await openExample(page, "py", "Wordle");
    const currentGuess = app.root.locator("#current_guess .letter");
    const previousGuesses = app.root.locator("#previous_guesses .word");

    // Five blanks waiting for a guess.
    await expect(currentGuess).toHaveCount(5);
    await expect(currentGuess).toHaveText(["", "", "", "", ""]);

    for (const key of ["S", "T", "A", "R", "E"]) {
      await new InputActionButton(app, key).click();
    }
    await expect(currentGuess).toHaveText(["S", "T", "A", "R", "E"]);

    // Backspace clears the last letter, and only the last letter.
    await new InputActionButton(app, "Back").click();
    await expect(currentGuess).toHaveText(["S", "T", "A", "R", ""]);

    // Submitting scores the guess and starts a fresh row.
    await new InputActionButton(app, "E").click();
    await new InputActionButton(app, "Enter").click();
    await expect(previousGuesses).toHaveCount(1);
    await expect(previousGuesses.locator(".letter")).toHaveText([
      "S",
      "T",
      "A",
      "R",
      "E",
    ]);
  });

  test("Static content", async ({ page }) => {
    const app = await openExample(page, "py", "Static content");
    const n = new InputSlider(app, "n");
    const images = new OutputUi(app, "images");

    // The image is served from the app's www/ directory, and the slider decides
    // how many times it is tiled.
    await n.expectValue("2");
    await expect(images.loc.locator("img")).toHaveCount(4);
    await expect(images.loc.locator("img").first()).toHaveAttribute(
      "src",
      "logo.png",
    );

    await n.set("3");
    await expect(images.loc.locator("img")).toHaveCount(9);
  });

  test("Basic plot interaction", async ({ page }) => {
    const app = await openExample(page, "py", "Basic plot interaction");
    const plot1 = new Plot(app, "plot1");
    const clickInfo = new OutputCode(app, "click_info");

    await new InputRadioButtons(app, "plot_type").expectChoices([
      "matplotlib",
      "plotnine",
    ]);
    await plot1.expectRendered();
    await plot1.expectImgAlt("A scatterplot");
    await clickInfo.expectValue("click:\nnull");

    // Clicking the plot sends coordinates back to the server.
    await plot1.locImg.click({ position: { x: 200, y: 150 } });
    await clickInfo.expect.toContainText('"x":');
    await clickInfo.expect.toContainText("coords_css");

    // Switching renderer draws the same data with plotnine.
    await expectPlotToRedraw(plot1, () =>
      new InputRadioButtons(app, "plot_type").set("plotnine"),
    );
  });

  test("Selecting data", async ({ page }) => {
    const app = await openExample(page, "py", "Selecting data");
    const plot1 = new Plot(app, "plot1");
    const nearHover = new OutputTable(app, "near_hover");
    const inBrush = new OutputTable(app, "in_brush");

    await plot1.expectRendered();
    await new InputSlider(app, "max_distance").expectValue("5");
    await new InputRadioButtons(app, "brush_dir").expectSelected("xy");

    // Nothing is hovered or brushed yet, so both tables are headers only.
    await nearHover.expectNrow(0);
    await inBrush.expectNrow(0);

    // "Return all rows" makes the helpers report the whole data frame with a
    // selection column, instead of only the matching rows.
    await new InputCheckbox(app, "all_rows").set(true);
    await nearHover.expectNrow(32);
    await inBrush.expectNrow(32);

    // Faceting re-renders the plot the interactions read from.
    await expectPlotToRedraw(plot1, () =>
      new InputCheckbox(app, "facet").set(true),
    );
  });

  test("Interactively excluding data", async ({ page }) => {
    const app = await openExample(page, "py", "Interactively excluding data");
    const plot1 = new Plot(app, "plot1");
    const model = new OutputCode(app, "model");

    // The fitted model reports how many points went into it, which is the one
    // number in its summary that does not move on its own -- the summary also
    // prints the time it was fitted.
    const observations = async (): Promise<number | null> => {
      const match = (await model.loc.innerText()).match(
        /No\. Observations:\s+(\d+)/,
      );
      return match === null ? null : Number(match[1]);
    };

    await plot1.expectRendered();
    await model.expect.toContainText("OLS Regression Results");
    expect(await observations()).toBe(32);

    // Brushing the left of the panel covers some of the scatter but not all of
    // it; toggling drops whatever was brushed and refits.
    await brush(page, plot1, { x1: 0.2, y1: 0.15, x2: 0.55, y2: 0.85 });
    await new InputActionButton(app, "exclude_toggle").click();
    await expect.poll(observations).toBeLessThan(32);
    expect(await observations()).toBeGreaterThan(0);

    // Reset puts every point back.
    await new InputActionButton(app, "exclude_reset").click();
    await expect.poll(observations).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// Shiny for R
// ---------------------------------------------------------------------------

test.describe("engine:r", () => {
  test("Hello Shiny!", async ({ page }) => {
    const app = await openExample(page, "r", "Hello Shiny!");
    const bins = new InputSlider(app, "bins");
    const distPlot = new Plot(app, "distPlot");

    await bins.expectLabel("Number of bins:");
    await bins.expectMin("1");
    await bins.expectMax("50");
    await bins.expectValue("30");
    await distPlot.expectRendered();

    await expectPlotToRedraw(distPlot, () => bins.set("10"));
    await bins.expectValue("10");
  });

  test("Shiny Text", async ({ page }) => {
    const app = await openExample(page, "r", "Shiny Text");
    // R's selectInput() is selectize-backed, unlike ui.input_select().
    const dataset = new InputSelectize(app, "dataset");
    const obs = new InputNumeric(app, "obs");
    const summary = new OutputTextVerbatim(app, "summary");
    const view = new OutputTable(app, "view");

    await dataset.expectChoices(["rock", "pressure", "cars"]);
    await dataset.expectSelected(["rock"]);
    await obs.expectValue("10");
    await summary.expect.toContainText("area");
    await view.expectColumnLabels(["area", "peri", "shape", "perm"]);
    await view.expectNrow(10);

    // The table is head(n); the summary is of the whole dataset.
    await obs.set("3");
    await view.expectNrow(3);
    await summary.expect.toContainText("area");

    await dataset.set("cars");
    await summary.expect.toContainText("speed");
    await view.expectColumnLabels(["speed", "dist"]);
  });

  test("Reactivity", async ({ page }) => {
    const app = await openExample(page, "r", "Reactivity");
    const caption = new InputText(app, "caption_text");
    const captionOut = new OutputText(app, "caption");

    await caption.expectValue("Data Summary");
    await captionOut.expectValue("Data Summary");
    await captionOut.expectInline(true);

    // The caption output depends on the text box and nothing else.
    await caption.set("Something else");
    await captionOut.expectValue("Something else");
    await new OutputTextVerbatim(app, "summary").expect.toContainText("area");

    // The table depends on both the dataset and the row count.
    await new InputSelectize(app, "dataset").set("pressure");
    const view = new OutputTable(app, "view");
    await view.expectColumnLabels(["temperature", "pressure"]);
    await new InputNumeric(app, "obs").set("4");
    await view.expectNrow(4);
  });

  test("Miles Per Gallon", async ({ page }) => {
    const app = await openExample(page, "r", "Miles Per Gallon");
    const variable = new InputSelectize(app, "variable");
    const outliers = new InputCheckbox(app, "outliers");
    const caption = new OutputText(app, "caption");
    const mpgPlot = new Plot(app, "mpgPlot");

    await variable.expectChoices(["cyl", "am", "gear"]);
    await variable.expectChoiceLabels(["Cylinders", "Transmission", "Gears"]);
    await outliers.expectChecked(true);
    await caption.expectValue("mpg ~ cyl");
    await mpgPlot.expectRendered();

    // Hiding outliers only shows up in the plot while it is grouped by cylinder
    // count -- the transmission and gear boxplots have no outliers to hide.
    await expectPlotToRedraw(mpgPlot, () => outliers.set(false));
    await outliers.expectChecked(false);
    await expectPlotToRedraw(mpgPlot, () => outliers.set(true));

    // The formula in the caption is the one the boxplot is drawn from.
    await expectPlotToRedraw(mpgPlot, () => variable.set("am"));
    await caption.expectValue("mpg ~ am");
  });

  test("Sliders", async ({ page }) => {
    const app = await openExample(page, "r", "Sliders");
    const integer = new InputSlider(app, "integer");
    const format = new InputSlider(app, "format");
    const values = new OutputTable(app, "values");

    await integer.expectValue("500");
    await new InputSlider(app, "decimal").expectValue("0.5");
    await new InputSliderRange(app, "range").expectValue(["200", "500"]);

    // The formatted slider prints its value with a prefix and separators.
    await format.expectPre("$");
    await format.expectSep(",");
    await format.expectAnimate(true);

    // Looping animation, at the interval the app asked for.
    await new InputSlider(app, "animation").expectAnimateOptions({
      loop: true,
      interval: 300,
    });

    await values.expectColumnLabels(["Name", "Value"]);
    await values.expectColumnText(1, [
      "Integer",
      "Decimal",
      "Range",
      "Custom Format",
      "Animation",
    ]);
    await values.expectCell("500", { row: 1, col: 2 });
    await values.expectCell("200 500", { row: 3, col: 2 });

    // Every slider feeds the same summary table.
    await integer.set("300");
    await values.expectCell("300", { row: 1, col: 2 });

    await format.set("$2,500");
    await values.expectCell("2500", { row: 4, col: 2 });
  });

  test("Tabsets", async ({ page }) => {
    const app = await openExample(page, "r", "Tabsets");
    const dist = new InputRadioButtons(app, "dist");
    const n = new InputSlider(app, "n");
    const navset = new Navset(app);

    await dist.expectChoices(["norm", "unif", "lnorm", "exp"]);
    await dist.expectChoiceLabels([
      "Normal",
      "Uniform",
      "Log-normal",
      "Exponential",
    ]);
    await dist.expectSelected("norm");
    await n.expectValue("500");
    await navset.expectNavTitles(["Plot", "Summary", "Table"]);

    // One sample of `n` observations, shown three ways. The sample size is left
    // alone: the sidebar is only a couple of hundred pixels wide, so a 1..1000
    // slider has no pixel that lands on a round number to drag to.
    await new Plot(app, "plot").expectRendered();

    await navset.set("Summary");
    await new OutputTextVerbatim(app, "summary").expect.toContainText("Median");

    await navset.set("Table");
    const table = new OutputTable(app, "table");
    await table.expectNcol(1);
    await table.expectNrow(500);

    // Changing the distribution draws a new sample.
    await navset.set("Plot");
    await expectPlotToRedraw(new Plot(app, "plot"), () => dist.set("unif"));
  });

  test("Widgets", async ({ page }) => {
    const app = await openExample(page, "r", "Widgets");
    const dataset = new InputSelectize(app, "dataset");
    const update = new InputActionButton(app, "update");
    const summary = new OutputTextVerbatim(app, "summary");
    const view = new OutputTable(app, "view");

    await update.expectLabel("Update View");
    await summary.expect.toContainText("area");
    await view.expectNrow(10);

    // eventReactive() holds the outputs until the button is pressed, which is
    // the whole point of this example.
    await dataset.set("cars");
    await summary.expect.toContainText("area");

    await update.click();
    await summary.expect.toContainText("speed");
    await view.expectColumnLabels(["speed", "dist"]);
  });

  test("Custom HTML UI", async ({ page }) => {
    const app = await openExample(page, "r", "Custom HTML UI");
    const summary = new OutputTextVerbatim(app, "summary");
    const plot = new Plot(app, "plot");

    // This app's inputs come from a hand-written HTML template and are bound by
    // name, so they have none of the markup the input controllers key on.
    const dist = app.root.locator("select[name=dist]");
    const n = app.root.locator("input[name=n]");

    await expect(n).toHaveValue("500");
    await summary.expect.toContainText("Min.");
    await plot.expectRendered();

    const before = await summary.loc.innerText();
    await expectPlotToRedraw(plot, () => dist.selectOption("unif"));
    await expect
      .poll(async () => (await summary.loc.innerText()) !== before, {
        message: "expected the summary to be recomputed",
      })
      .toBe(true);
  });

  test("R File Upload", async ({ page }) => {
    const app = await openExample(page, "r", "R File Upload");
    const file1 = new InputFile(app, "file1");
    const header = new InputCheckbox(app, "header");
    const disp = new InputRadioButtons(app, "disp");
    const contents = new OutputTable(app, "contents");

    await file1.expectMultiple(true);
    await file1.expectButtonLabel("Browse...");
    await header.expectChecked(true);
    await new InputRadioButtons(app, "sep").expectSelected(",");
    await disp.expectSelected("head");

    // Eight data rows, of which "Head" shows the first six.
    await file1.set(UPLOAD_CSV);
    await contents.expectColumnLabels(["name", "value"]);
    await contents.expectNrow(6);

    await disp.set("all");
    await contents.expectNrow(8);

    // Without a header row, the first line becomes data.
    await header.set(false);
    await contents.expectNrow(9);
    await contents.expectColumnLabels(["V1", "V2"]);
  });

  test("R File Download", async ({ page }) => {
    const app = await openExample(page, "r", "R File Download");
    const dataset = new InputSelectize(app, "dataset");
    const table = new OutputTable(app, "table");
    const downloadData = new DownloadButton(app, "downloadData");

    await dataset.expectSelected(["rock"]);
    await table.expectColumnLabels(["area", "peri", "shape", "perm"]);
    await table.expectNrow(48);

    // The download handler writes whichever dataset is selected, and names the
    // file after it.
    expect((await downloadData.download()).suggestedFilename()).toBe(
      "rock.csv",
    );

    await dataset.set("cars");
    await table.expectColumnLabels(["speed", "dist"]);
    expect((await downloadData.download()).suggestedFilename()).toBe(
      "cars.csv",
    );
  });

  test("Timer", async ({ page }) => {
    const app = await openExample(page, "r", "Timer");
    const currentTime = new OutputText(app, "currentTime");

    await currentTime.expectValue(/^The current time is \d{4}-\d{2}-\d{2} /);

    // invalidateLater() should keep re-running the output once a second.
    const before = await currentTime.loc.innerText();
    await expect
      .poll(async () => (await currentTime.loc.innerText()) !== before, {
        message: "expected the clock to tick",
        timeout: 10 * 1000,
      })
      .toBe(true);
  });
});
