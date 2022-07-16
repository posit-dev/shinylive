import pathlib

import palmerpenguins
import pandas as pd
from shiny import App, render, ui

penguins = palmerpenguins.load_penguins()

numeric_cols = [
    "bill_length_mm",
    "bill_depth_mm",
    "flipper_length_mm",
    "body_mass_g",
]

app_ui = ui.page_fluid(
    ui.input_checkbox("highlight", "Highlight min/max values"),
    ui.output_table("result"),
    # Legend
    ui.panel_conditional(
        "input.highlight",
        ui.panel_absolute(
            ui.span("minimum", style="background-color: silver;"),
            ui.span("maximum", style="background-color: yellow;"),
            top="6px",
            right="6px",
            class_="p-1 bg-light border",
        ),
    ),
    class_="p-3",
)


def server(input, output, session):
    @output
    @render.table
    def result():
        if not input.highlight():
            # If we're not highlighting values, we can simply
            # return the pandas data frame as-is; @render.table
            # will call .to_html() on it.
            return penguins
        else:
            # We need to use the pandas Styler API. The default
            # formatting options for Styler are not the same as
            # DataFrame.to_html(), so we set a few options to
            # make them match.
            return (
                penguins.style.set_table_attributes(
                    'class="dataframe shiny-table table w-auto"'
                )
                .hide(axis="index")
                .format(
                    {
                        "bill_length_mm": "{0:0.1f}",
                        "bill_depth_mm": "{0:0.1f}",
                        "flipper_length_mm": "{0:0.0f}",
                        "body_mass_g": "{0:0.0f}",
                    }
                )
                .set_table_styles(
                    [
                        dict(selector="th", props=[("text-align", "right")]),
                        dict(
                            selector="tr>td",
                            props=[
                                ("padding-top", "0.1rem"),
                                ("padding-bottom", "0.1rem"),
                            ],
                        ),
                    ]
                )
                .highlight_min(color="silver", subset=numeric_cols)
                .highlight_max(color="yellow", subset=numeric_cols)
            )


app = App(app_ui, server)
