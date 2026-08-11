"""Intent tests for the Shiny for R example apps.

The same controllers as the Python tests, against webR. Two engine differences
show up here: R's `selectInput()` is selectize-backed where `ui.input_select()`
renders a plain `<select>`, and R writes R literals into data attributes that
Python leaves out. See ./README.md.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from playwright.sync_api import Page
from playwright.sync_api import expect as playwright_expect
from shiny.playwright import controller

from controller_shims import InputSelectize, NavPanel, OutputPlot
from shinylive_app import expect_plot_to_redraw, open_example, wait_until

pytestmark = [pytest.mark.examples, pytest.mark.r]

UPLOAD_CSV = str(Path(__file__).parent / "fixtures" / "upload.csv")


def test_001_hello(page: Page) -> None:
    app = open_example(page, "r", "Hello Shiny!")
    bins = controller.InputSlider(app, "bins")
    dist_plot = OutputPlot(app, "distPlot")

    bins.expect_label("Number of bins:")
    bins.expect_min("1")
    bins.expect_max("50")
    bins.expect_value("30")
    dist_plot.expect_rendered()

    expect_plot_to_redraw(dist_plot, lambda: bins.set("10"))
    bins.expect_value("10")


def test_002_text(page: Page) -> None:
    app = open_example(page, "r", "Shiny Text")
    # R's selectInput() is selectize-backed, unlike ui.input_select().
    dataset = InputSelectize(app, "dataset")
    obs = controller.InputNumeric(app, "obs")
    summary = controller.OutputTextVerbatim(app, "summary")
    view = controller.OutputTable(app, "view")

    dataset.expect_choices(["rock", "pressure", "cars"])
    dataset.expect_selected(["rock"])
    obs.expect_value("10")
    summary.expect.to_contain_text("area")
    view.expect_column_labels(["area", "peri", "shape", "perm"])
    view.expect_nrow(10)

    # The table is head(n); the summary is of the whole dataset.
    obs.set("3")
    view.expect_nrow(3)
    summary.expect.to_contain_text("area")

    dataset.set("cars")
    summary.expect.to_contain_text("speed")
    view.expect_column_labels(["speed", "dist"])


def test_003_reactivity(page: Page) -> None:
    app = open_example(page, "r", "Reactivity")
    caption = controller.InputText(app, "caption_text")
    caption_out = controller.OutputText(app, "caption")

    caption.expect_value("Data Summary")
    caption_out.expect_value("Data Summary")
    caption_out.expect_inline(True)

    # The caption output depends on the text box and nothing else.
    caption.set("Something else")
    caption_out.expect_value("Something else")
    controller.OutputTextVerbatim(app, "summary").expect.to_contain_text("area")

    # The table depends on both the dataset and the row count.
    InputSelectize(app, "dataset").set("pressure")
    view = controller.OutputTable(app, "view")
    view.expect_column_labels(["temperature", "pressure"])
    controller.InputNumeric(app, "obs").set("4")
    view.expect_nrow(4)


def test_004_mpg(page: Page) -> None:
    app = open_example(page, "r", "Miles Per Gallon")
    variable = InputSelectize(app, "variable")
    outliers = controller.InputCheckbox(app, "outliers")
    caption = controller.OutputText(app, "caption")
    mpg_plot = OutputPlot(app, "mpgPlot")

    variable.expect_choices(["cyl", "am", "gear"])
    variable.expect_choice_labels(["Cylinders", "Transmission", "Gears"])
    outliers.expect_checked(True)
    caption.expect_value("mpg ~ cyl")
    mpg_plot.expect_rendered()

    # Hiding outliers only shows up in the plot while it is grouped by cylinder
    # count -- the transmission and gear boxplots have no outliers to hide.
    expect_plot_to_redraw(mpg_plot, lambda: outliers.set(False))
    outliers.expect_checked(False)
    expect_plot_to_redraw(mpg_plot, lambda: outliers.set(True))

    # The formula in the caption is the one the boxplot is drawn from.
    expect_plot_to_redraw(mpg_plot, lambda: variable.set("am"))
    caption.expect_value("mpg ~ am")


def test_005_sliders(page: Page) -> None:
    app = open_example(page, "r", "Sliders")
    integer = controller.InputSlider(app, "integer")
    fmt = controller.InputSlider(app, "format")
    values = controller.OutputTable(app, "values")

    integer.expect_value("500")
    controller.InputSlider(app, "decimal").expect_value("0.5")
    controller.InputSliderRange(app, "range").expect_value(("200", "500"))

    # The formatted slider prints its value with a prefix and separators.
    fmt.expect_pre("$")
    fmt.expect_sep(",")
    fmt.expect_animate(True)

    # Looping animation, at the interval the app asked for. `expect_animate_
    # options(loop=)` is not usable here: it expects Python's empty `data-loop`
    # attribute, and R writes the R literal instead.
    animation = controller.InputSlider(app, "animation")
    animation.expect_animate_options(interval=300)
    playwright_expect(animation.loc_play_pause).to_have_attribute("data-loop", "TRUE")

    values.expect_column_labels(["Name", "Value"])
    values.expect_column_text(
        1, ["Integer", "Decimal", "Range", "Custom Format", "Animation"]
    )
    values.expect_cell("500", 1, 2)
    values.expect_cell("200 500", 3, 2)

    # Every slider feeds the same summary table.
    integer.set("300")
    values.expect_cell("300", 1, 2)

    fmt.set("$2,500")
    values.expect_cell("2500", 4, 2)


def test_006_tabsets(page: Page) -> None:
    app = open_example(page, "r", "Tabsets")
    dist = controller.InputRadioButtons(app, "dist")
    n = controller.InputSlider(app, "n")

    dist.expect_choices(["norm", "unif", "lnorm", "exp"])
    dist.expect_choice_labels(["Normal", "Uniform", "Log-normal", "Exponential"])
    dist.expect_selected("norm")
    n.expect_value("500")
    playwright_expect(app.locator("ul.nav[data-tabsetid] a[role=tab]")).to_have_text(
        ["Plot", "Summary", "Table"]
    )

    # One sample of `n` observations, shown three ways. The sample size is left
    # alone: the sidebar is only a couple of hundred pixels wide, so a 1..1000
    # slider has no pixel that lands on a round number to drag to.
    OutputPlot(app, "plot").expect_rendered()

    NavPanel(app, "Summary").click()
    controller.OutputTextVerbatim(app, "summary").expect.to_contain_text("Median")

    NavPanel(app, "Table").click()
    table = controller.OutputTable(app, "table")
    table.expect_ncol(1)
    table.expect_nrow(500)

    # Changing the distribution draws a new sample.
    NavPanel(app, "Plot").click()
    expect_plot_to_redraw(OutputPlot(app, "plot"), lambda: dist.set("unif"))


def test_007_widgets(page: Page) -> None:
    app = open_example(page, "r", "Widgets")
    dataset = InputSelectize(app, "dataset")
    update = controller.InputActionButton(app, "update")
    summary = controller.OutputTextVerbatim(app, "summary")
    view = controller.OutputTable(app, "view")

    update.expect_label("Update View")
    summary.expect.to_contain_text("area")
    view.expect_nrow(10)

    # eventReactive() holds the outputs until the button is pressed, which is
    # the whole point of this example.
    dataset.set("cars")
    summary.expect.to_contain_text("area")

    update.click()
    summary.expect.to_contain_text("speed")
    view.expect_column_labels(["speed", "dist"])


def test_008_html(page: Page) -> None:
    app = open_example(page, "r", "Custom HTML UI")
    summary = controller.OutputTextVerbatim(app, "summary")
    plot = OutputPlot(app, "plot")

    # This app's inputs come from a hand-written HTML template and are bound by
    # name, so they have none of the markup the input controllers key on.
    dist = app.locator("select[name=dist]")
    n = app.locator("input[name=n]")

    playwright_expect(n).to_have_value("500")
    summary.expect.to_contain_text("Min.")
    plot.expect_rendered()

    before = summary.loc.inner_text()
    expect_plot_to_redraw(plot, lambda: dist.select_option("unif"))
    wait_until(
        page,
        lambda: summary.loc.inner_text() != before,
        "expected the summary to be recomputed",
    )


def test_009_upload(page: Page) -> None:
    app = open_example(page, "r", "R File Upload")
    file1 = controller.InputFile(app, "file1")
    header = controller.InputCheckbox(app, "header")
    disp = controller.InputRadioButtons(app, "disp")
    contents = controller.OutputTable(app, "contents")

    file1.expect_multiple(True)
    file1.expect_button_label("Browse...")
    header.expect_checked(True)
    controller.InputRadioButtons(app, "sep").expect_selected(",")
    disp.expect_selected("head")

    # Eight data rows, of which "Head" shows the first six.
    file1.set(UPLOAD_CSV)
    contents.expect_column_labels(["name", "value"])
    contents.expect_nrow(6)

    disp.set("all")
    contents.expect_nrow(8)

    # Without a header row, the first line becomes data.
    header.set(False)
    contents.expect_nrow(9)
    contents.expect_column_labels(["V1", "V2"])


def test_010_download(page: Page) -> None:
    app = open_example(page, "r", "R File Download")
    dataset = InputSelectize(app, "dataset")
    table = controller.OutputTable(app, "table")
    download_data = controller.DownloadButton(app, "downloadData")

    dataset.expect_selected(["rock"])
    table.expect_column_labels(["area", "peri", "shape", "perm"])
    table.expect_nrow(48)

    # The download handler writes whichever dataset is selected, and names the
    # file after it.
    with page.expect_download() as info:
        download_data.click()
    assert info.value.suggested_filename == "rock.csv"

    dataset.set("cars")
    table.expect_column_labels(["speed", "dist"])
    with page.expect_download() as info:
        download_data.click()
    assert info.value.suggested_filename == "cars.csv"


def test_011_timer(page: Page) -> None:
    app = open_example(page, "r", "Timer")
    current_time = controller.OutputText(app, "currentTime")

    current_time.expect_value(re.compile(r"^The current time is \d{4}-\d{2}-\d{2} "))

    # invalidateLater() should keep re-running the output once a second.
    before = current_time.loc.inner_text()
    wait_until(
        page,
        lambda: current_time.loc.inner_text() != before,
        "expected the clock to tick",
    )
