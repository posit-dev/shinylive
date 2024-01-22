import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from shiny import App, render, ui

mtcars = pd.read_csv(Path(__file__).parent / "mtcars.csv")
mtcars.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1, inplace=True)


app_ui = ui.page_fluid(
    ui.head_content(
        ui.tags.style(
            """
        /* Smaller font for preformatted text */
        pre, table.table {
          font-size: smaller;
        }

        pre, table.table {
            font-size: smaller;
        }
        """
        )
    ),
    ui.row(
        ui.column(
            4,
            ui.panel_well(
                ui.input_radio_buttons(
                    "plot_type", "Plot type", ["matplotlib", "plotnine"]
                )
            ),
        ),
        ui.column(
            8,
            ui.output_plot("plot1", click=True, dblclick=True, hover=True, brush=True),
        ),
    ),
    ui.row(
        ui.column(3, ui.output_text_verbatim("click_info")),
        ui.column(3, ui.output_text_verbatim("dblclick_info")),
        ui.column(3, ui.output_text_verbatim("hover_info")),
        ui.column(3, ui.output_text_verbatim("brush_info")),
    ),
)


def server(input, output, session):
    @output
    @render.plot(alt="A scatterplot")
    def plot1():
        if input.plot_type() == "matplotlib":
            fig, ax = plt.subplots()
            plt.title("Good old mtcars")
            ax.scatter(mtcars["wt"], mtcars["mpg"])
            return fig

        elif input.plot_type() == "plotnine":
            from plotnine import aes, geom_point, ggplot, ggtitle

            p = (
                ggplot(mtcars, aes("wt", "mpg"))
                + geom_point()
                + ggtitle("Good old mtcars")
            )

            return p

    @output
    @render.text()
    def click_info():
        return "click:\n" + json.dumps(input.plot1_click(), indent=2)

    @output
    @render.text()
    def dblclick_info():
        return "dblclick:\n" + json.dumps(input.plot1_dblclick(), indent=2)

    @output
    @render.text()
    def hover_info():
        return "hover:\n" + json.dumps(input.plot1_hover(), indent=2)

    @output
    @render.text()
    def brush_info():
        return "brush:\n" + json.dumps(input.plot1_brush(), indent=2)


app = App(app_ui, server, debug=True)
