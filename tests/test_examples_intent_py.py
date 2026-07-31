"""Intent tests for the Shiny for Python example apps.

Where the smoke test only asks "did this app start without complaining?", these
ask "does it do the thing it exists to demonstrate?" -- drive its inputs, and
check the outputs that depend on them.

Apps are driven through `shiny.playwright.controller`, the controllers py-shiny
uses for its own tests, so an assertion describes the Shiny component rather than
the markup bslib happens to render for it. See ./README.md.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from playwright.sync_api import Page
from playwright.sync_api import expect as playwright_expect
from shiny.playwright import controller

from controller_shims import InputSelectize, NavPanel, OutputPlot, sidebar
from shinylive_app import (
    brush,
    expect_plot_to_redraw,
    open_example,
    terminal_text,
    wait_for_input_debounce,
    wait_until,
)

pytestmark = pytest.mark.py

UPLOAD_CSV = str(Path(__file__).parent / "fixtures" / "upload.csv")


def test_basic_app(page: Page) -> None:
    app = open_example(page, "py", "Basic App")
    n = controller.InputSlider(app, "n")
    txt = controller.OutputCode(app, "txt")

    n.expect_label("N")
    n.expect_value("20")
    txt.expect_value("n*2 is 40")

    n.set("40")
    n.expect_value("40")
    txt.expect_value("n*2 is 80")


def test_app_with_plot(page: Page) -> None:
    app = open_example(page, "py", "App with plot")
    n = controller.InputSlider(app, "n")
    histogram = OutputPlot(app, "histogram")

    sidebar(app).expect_open(True)
    n.expect_value("20")
    histogram.expect_rendered()
    histogram.expect_img_alt("A histogram")

    # The bin count is the one thing this app lets you change.
    expect_plot_to_redraw(histogram, lambda: n.set("60"))


def test_cpuinfo(page: Page) -> None:
    app = open_example(page, "py", "CPU info")
    cmap = controller.InputSelect(app, "cmap")

    cmap.expect_choices(["inferno", "viridis", "copper", "prism"])
    cmap.expect_selected("inferno")
    controller.InputSwitch(app, "hold").expect_checked(False)
    controller.InputActionButton(app, "reset").expect_label("Clear history")

    graphs, heatmap = NavPanel(app, "Graphs"), NavPanel(app, "Heatmap")
    graphs.expect_active(True)
    OutputPlot(app, "plot").expect_rendered()

    # The heatmap is a table with one column per (fake) CPU.
    heatmap.click()
    heatmap.expect_active(True)
    controller.InputNumeric(app, "table_rows").expect_value("15")
    controller.OutputTable(app, "table").expect_ncol(8)


def test_regularization(page: Page) -> None:
    app = open_example(page, "py", "Regularization")

    controller.InputSlider(app, "a").expect_value("0.1")
    # One simulation feeds all three plots through a reactive calc.
    OutputPlot(app, "plot").expect_rendered()
    OutputPlot(app, "plotVOWELS").expect_rendered()
    OutputPlot(app, "plotCONSONANTS").expect_rendered()


def test_plotly(page: Page) -> None:
    app = open_example(page, "py", "Plotly")

    # shinywidgets outputs are ipywidgets, not Shiny outputs, so they have no
    # controller -- assert on what plotly renders instead.
    for output_id in ("plot1", "plot2"):
        plot = app.locator(f"#{output_id}.shiny-ipywidget-output")
        playwright_expect(plot.locator(".js-plotly-plot")).to_be_visible()
        playwright_expect(plot.locator("g.bars")).to_be_visible()


def test_altair(page: Page) -> None:
    app = open_example(page, "py", "altair")
    variable = InputSelectize(app, "var")
    chart = app.locator("#hist.shiny-ipywidget-output")

    variable.expect_choices(["bill_length_mm", "body_mass_g"])
    variable.expect_selected(["bill_length_mm"])
    playwright_expect(chart.locator("canvas, svg").first).to_be_visible()

    variable.set("body_mass_g")
    variable.expect_selected(["body_mass_g"])
    playwright_expect(chart.locator("canvas, svg").first).to_be_visible()


def test_ipyleaflet(page: Page) -> None:
    app = open_example(page, "py", "Map")
    center = controller.InputSelect(app, "center")

    center.expect_choices(["London", "Paris", "New York"])
    center.expect_selected("London")
    playwright_expect(app.locator("#map .leaflet-container")).to_be_visible()

    center.set("Paris")
    center.expect_selected("Paris")


def test_multiple_source_files(page: Page) -> None:
    app = open_example(page, "py", "Multiple source files")
    n = controller.InputSlider(app, "n")
    txt = controller.OutputCode(app, "txt")

    # square() lives in utils.py; a wrong answer here means the second file
    # never made it into the app.
    txt.expect_value("20 squared is 400")
    n.set("30")
    txt.expect_value("30 squared is 900")


def test_read_local_csv_file(page: Page) -> None:
    app = open_example(page, "py", "Read local CSV")
    frame = controller.OutputDataFrame(app, "frame")

    frame.expect_nrow(32)
    frame.expect_ncol(11)
    frame.expect_cell("21", row=0, col=0)

    # The same data, rendered as a static table.
    NavPanel(app, "Table").click()
    table = controller.OutputTable(app, "table")
    table.expect_nrow(32)
    table.expect_ncol(11)


def test_file_upload(page: Page) -> None:
    app = open_example(page, "py", "File upload")
    file1 = controller.InputFile(app, "file1")
    file_type = controller.InputRadioButtons(app, "type")
    content = controller.OutputCode(app, "file_content")

    file1.expect_multiple(True)
    file_type.expect_choices(["Text", "Binary"])
    file_type.expect_selected("Text")
    content.expect_value("")

    file1.set(UPLOAD_CSV)
    content.expect.to_contain_text("upload.csv")
    content.expect.to_contain_text("MIME type: text/csv")
    content.expect.to_contain_text("theta,8")

    # The same bytes, now as a hex dump: "name" is 6e 61 6d 65.
    file_type.set("Binary")
    content.expect.to_contain_text("6e 61 6d 65")


def test_insert_ui(page: Page) -> None:
    app = open_example(page, "py", "Dynamically inserting UI")
    btn = controller.InputActionButton(app, "btn")
    inserted = app.locator("#inserted-slider")

    # One slider comes from @render.ui and is there from the start.
    controller.OutputUi(app, "dyn_ui").expect_empty(False)
    controller.InputSlider(app, "n1").expect_value("20")
    playwright_expect(inserted).to_have_count(0)

    # The other is inserted and removed imperatively.
    btn.click()
    controller.InputSlider(app, "n2").expect_value("20")
    btn.click()
    playwright_expect(inserted).to_have_count(0)


def test_input_update(page: Page) -> None:
    app = open_example(page, "py", "Dynamically updating inputs")
    slider = controller.InputSlider(app, "slider")

    slider.expect_value("50")
    slider.expect_width("50%")

    controller.InputActionButton(app, "to_20").click()
    slider.expect_value("20")

    controller.InputActionButton(app, "to_60").click()
    slider.expect_value("60")


def test_extra_packages(page: Page) -> None:
    app = open_example(page, "py", "Extra packages")

    # The app renders nothing but prose; the point is that importing attrs,
    # isodate and tabulate from requirements.txt did not blow up.
    playwright_expect(app.locator("body")).to_contain_text("requirements.txt")
    playwright_expect(app.locator("body")).to_contain_text("micropip")


def test_fetch(page: Page) -> None:
    app = open_example(page, "py", "Fetch data from a web API")
    city = InputSelectize(app, "city")
    data_type = controller.InputRadioButtons(app, "data_type")

    # No city is selected on startup, so the app makes no request -- which is
    # what keeps this test off the network.
    city.expect_selected([""])
    data_type.expect_choices(["json", "string", "bytes"])
    data_type.expect_selected("json")
    controller.OutputCode(app, "info").expect_value("")


def test_brand(page: Page) -> None:
    app = open_example(page, "py", "Branded Theming")
    plot1 = OutputPlot(app, "plot1")

    playwright_expect(app.locator("ul.nav[data-tabsetid] a[role=tab]")).to_have_text(
        ["Input Output Demo", "Widget Gallery", "Colors", "Documentation"]
    )

    # The app iframe is narrow enough to put bslib in mobile mode, where this
    # layout starts with its sidebar closed.
    app_sidebar = sidebar(app)
    app_sidebar.expect_open(False)
    app_sidebar.set(True)

    # First panel: one of every input type the brand theme has to style.
    controller.InputSlider(app, "slider1").expect_value("11")
    controller.InputNumeric(app, "numeric1").expect_value("30")
    controller.InputDate(app, "date1").expect_value("2024-01-01")
    controller.InputSwitch(app, "switch1").expect_checked(True)
    controller.InputRadioButtons(app, "radio1").expect_selected("Option A")
    plot1.expect_rendered()
    controller.OutputTextVerbatim(app, "out_text1").expect.to_contain_text(
        "def example_function():"
    )

    # The value boxes have no id for `controller.ValueBox` to key on.
    metric1 = app.locator("div.bslib-value-box").first
    playwright_expect(metric1.locator(".value-box-title")).to_have_text("Metric 1")
    playwright_expect(metric1.locator(".value-box-value")).to_have_text("100")

    # The plot is drawn from the slider and the numeric input.
    expect_plot_to_redraw(
        plot1, lambda: controller.InputSlider(app, "slider1").set("5")
    )

    NavPanel(app, "Widget Gallery").click()
    check1 = controller.InputCheckboxGroup(app, "check1")
    check1.expect_choices(["Item 1", "Item 2", "Item 3"])
    check1.set(["Item 1", "Item 3"])
    check1.expect_selected(["Item 1", "Item 3"])

    text1 = controller.InputText(app, "text1")
    text1.set("hello")
    text1.expect_value("hello")

    controller.InputTextArea(app, "textarea1").expect_value(
        "Default text content for the text area widget"
    )
    password1 = controller.InputPassword(app, "password1")
    password1.set("hunter2")
    password1.expect_value("hunter2")

    # The navbar's dark mode switch themes the whole page.
    dark_mode = controller.InputDarkMode(app, "color_mode")
    dark_mode.expect_page_mode("light")
    dark_mode.click()
    dark_mode.expect_page_mode("dark")


def test_reactive_event(page: Page) -> None:
    app = open_example(page, "py", "Event decorator")
    n = controller.InputSlider(app, "n")
    btn = controller.InputActionButton(app, "btn")
    txt = controller.OutputCode(app, "txt")

    # @reactive.event means the output waits for the button, not the slider.
    txt.expect_value("")
    btn.click()
    txt.expect_value("Last value: 10")

    n.set("15")
    n.expect_value("15")
    txt.expect_value("Last value: 10")

    # Nothing here reflects the slider until the button is pressed, so the press
    # has to wait for the new value to reach the server.
    wait_for_input_debounce(page)
    btn.click()
    txt.expect_value("Last value: 15")


def test_reactive_effect(page: Page) -> None:
    app = open_example(page, "py", "Reactive effect")
    x = controller.InputText(app, "x")

    x.expect_placeholder("Enter text")
    x.set("shinylive")

    # The effect's only output is a print(), which pyodide wires to the
    # shinylive terminal.
    wait_until(
        page,
        lambda: "x has changed to shinylive" in terminal_text(page),
        "the effect's print() never reached the terminal",
    )


def test_reactive_calc(page: Page) -> None:
    app = open_example(page, "py", "Reactive calc")
    x = controller.InputSlider(app, "x")
    txt1 = controller.OutputCode(app, "txt1")
    txt2 = controller.OutputCode(app, "txt2")

    # Both outputs read the same calc, so they always agree.
    txt1.expect_value('x times 2 is: "100"')
    txt2.expect_value('x times 2 is: "100"')

    x.set("60")
    txt1.expect_value('x times 2 is: "120"')
    txt2.expect_value('x times 2 is: "120"')


def test_reactive_value(page: Page) -> None:
    app = open_example(page, "py", "Reactive value")
    btn = controller.InputActionButton(app, "btn")
    txt = controller.OutputCode(app, "txt")

    # The output lists the gaps between presses, so it starts empty and gains
    # one entry per press.
    txt.expect_value("[]")
    btn.click()
    txt.expect_value(re.compile(r"^\[\d+(\.\d+)?\]$"))
    btn.click()
    txt.expect_value(re.compile(r"^\[\d+(\.\d+)?, \d+(\.\d+)?\]$"))


def test_file_download_core(page: Page) -> None:
    app = open_example(page, "py", "File download")

    # A file straight off disk, keeping the name it has there.
    download1 = controller.DownloadButton(app, "download1")
    # Not `expect_label()`: it inherits the action button's, which looks for a
    # `.action-label` span that a download link does not have.
    playwright_expect(download1.loc).to_have_text("Download CSV")
    with page.expect_download() as info:
        download1.click()
    assert info.value.suggested_filename == "mtcars.csv"

    # A PNG generated on demand from the two inputs above it.
    controller.InputText(app, "title").expect_value("Random scatter plot")
    controller.InputSlider(app, "num_points").expect_value("50")
    with page.expect_download() as info:
        controller.DownloadButton(app, "download2").click()
    assert info.value.suggested_filename == "image.png"

    # A name computed when the download is requested.
    with page.expect_download() as info:
        controller.DownloadButton(app, "download3").click()
    assert re.fullmatch(r"data-\d{4}-\d{2}-\d{2}-\d{3}\.csv", info.value.suggested_filename)


def test_modules(page: Page) -> None:
    app = open_example(page, "py", "Modules")

    # Two instances of one module, each keeping its own count.
    for module_id in ("counter1", "counter2"):
        controller.OutputCode(app, f"{module_id}-out").expect_value("Click count is 0")

    controller.InputActionButton(app, "counter1-button").click()
    controller.OutputCode(app, "counter1-out").expect_value("Click count is 1")
    controller.OutputCode(app, "counter2-out").expect_value("Click count is 0")


def test_orbit(page: Page) -> None:
    app = open_example(page, "py", "Orbit simulation")
    days = controller.InputSlider(app, "days")
    orbits = OutputPlot(app, "orbits")

    # The accordion has no `shiny-bound-input` class for `controller.Accordion`
    # to key on, because the app never gives it an id.
    panels = app.locator("div.accordion > div.accordion-item")
    playwright_expect(panels).to_have_count(4)
    for i, value in enumerate(["Settings", "Earth", "Moon", "Planet X"]):
        playwright_expect(panels.nth(i)).to_have_attribute("data-value", value)
    playwright_expect(
        panels.first.locator(".accordion-button")
    ).to_have_attribute("aria-expanded", "true")

    days.expect_value("60")
    # The empty 3D axes are drawn before the first run.
    orbits.expect_rendered()

    # Shorten the simulation before running it, so the test is not waiting on
    # 60 days of integration.
    days.set("10")
    expect_plot_to_redraw(
        orbits, lambda: controller.InputActionButton(app, "run").click()
    )


def test_wordle(page: Page) -> None:
    app = open_example(page, "py", "Wordle")
    current_guess = app.locator("#current_guess .letter")
    previous_guesses = app.locator("#previous_guesses .word")

    # Five blanks waiting for a guess.
    playwright_expect(current_guess).to_have_count(5)
    playwright_expect(current_guess).to_have_text(["", "", "", "", ""])

    for key in ("S", "T", "A", "R", "E"):
        controller.InputActionButton(app, key).click()
    playwright_expect(current_guess).to_have_text(["S", "T", "A", "R", "E"])

    # Backspace clears the last letter, and only the last letter.
    controller.InputActionButton(app, "Back").click()
    playwright_expect(current_guess).to_have_text(["S", "T", "A", "R", ""])

    # Submitting scores the guess and starts a fresh row.
    controller.InputActionButton(app, "E").click()
    controller.InputActionButton(app, "Enter").click()
    playwright_expect(previous_guesses).to_have_count(1)
    playwright_expect(previous_guesses.locator(".letter")).to_have_text(
        ["S", "T", "A", "R", "E"]
    )


def test_static_content(page: Page) -> None:
    app = open_example(page, "py", "Static content")
    n = controller.InputSlider(app, "n")
    images = controller.OutputUi(app, "images")

    # The image is served from the app's www/ directory, and the slider decides
    # how many times it is tiled.
    n.expect_value("2")
    playwright_expect(images.loc.locator("img")).to_have_count(4)
    playwright_expect(images.loc.locator("img").first).to_have_attribute(
        "src", "logo.png"
    )

    n.set("3")
    playwright_expect(images.loc.locator("img")).to_have_count(9)


def test_plot_interact_basic(page: Page) -> None:
    app = open_example(page, "py", "Basic plot interaction")
    plot1 = OutputPlot(app, "plot1")
    click_info = controller.OutputCode(app, "click_info")

    controller.InputRadioButtons(app, "plot_type").expect_choices(
        ["matplotlib", "plotnine"]
    )
    plot1.expect_rendered()
    plot1.expect_img_alt("A scatterplot")
    click_info.expect_value("click:\nnull")

    # Clicking the plot sends coordinates back to the server.
    plot1.loc_img.click(position={"x": 200, "y": 150})
    click_info.expect.to_contain_text('"x":')
    click_info.expect.to_contain_text("coords_css")

    # Switching renderer draws the same data with plotnine.
    expect_plot_to_redraw(
        plot1,
        lambda: controller.InputRadioButtons(app, "plot_type").set("plotnine"),
    )


def test_plot_interact_select(page: Page) -> None:
    app = open_example(page, "py", "Selecting data")
    plot1 = OutputPlot(app, "plot1")
    near_hover = controller.OutputTable(app, "near_hover")
    in_brush = controller.OutputTable(app, "in_brush")

    plot1.expect_rendered()
    controller.InputSlider(app, "max_distance").expect_value("5")
    controller.InputRadioButtons(app, "brush_dir").expect_selected("xy")

    # Nothing is hovered or brushed yet, so both tables are headers only.
    near_hover.expect_nrow(0)
    in_brush.expect_nrow(0)

    # "Return all rows" makes the helpers report the whole data frame with a
    # selection column, instead of only the matching rows.
    controller.InputCheckbox(app, "all_rows").set(True)
    near_hover.expect_nrow(32)
    in_brush.expect_nrow(32)

    # Faceting re-renders the plot the interactions read from.
    expect_plot_to_redraw(
        plot1, lambda: controller.InputCheckbox(app, "facet").set(True)
    )


def test_plot_interact_exclude(page: Page) -> None:
    app = open_example(page, "py", "Interactively excluding data")
    plot1 = OutputPlot(app, "plot1")
    model = controller.OutputCode(app, "model")

    def observations() -> int | None:
        match = re.search(r"No\. Observations:\s+(\d+)", model.loc.inner_text())
        return None if match is None else int(match.group(1))

    plot1.expect_rendered()
    model.expect.to_contain_text("OLS Regression Results")
    # The fitted model reports how many points went into it, which is the one
    # number in its summary that does not move on its own -- the summary also
    # prints the time it was fitted.
    assert observations() == 32

    # Brushing the left of the panel covers some of the scatter but not all of
    # it; toggling drops whatever was brushed and refits.
    brush(page, plot1, 0.2, 0.15, 0.55, 0.85)
    controller.InputActionButton(app, "exclude_toggle").click()
    wait_until(
        page,
        lambda: (observations() or 32) < 32,
        "brushed points were never excluded from the model",
    )
    remaining = observations()
    assert remaining is not None and remaining > 0

    # Reset puts every point back.
    controller.InputActionButton(app, "exclude_reset").click()
    wait_until(
        page, lambda: observations() == 32, "resetting did not put every point back"
    )
