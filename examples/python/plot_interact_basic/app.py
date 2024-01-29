import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from shiny.express import input, output_args, render, ui

mtcars = pd.read_csv(Path(__file__).parent / "mtcars.csv")
mtcars.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1, inplace=True)

with ui.sidebar():
    ui.input_radio_buttons(
        "plot_type", "Plot type", ["matplotlib", "plotnine"]
    )


@output_args(click=True, dblclick=True, hover=True, brush=True)
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


with ui.layout_column_wrap(heights_equal="row"):

    @render.code
    def click_info():
        return "click:\n" + json.dumps(input.plot1_click(), indent=2)

    @render.code
    def dblclick_info():
        return "dblclick:\n" + json.dumps(input.plot1_dblclick(), indent=2)

    @render.code
    def hover_info():
        return "hover:\n" + json.dumps(input.plot1_hover(), indent=2)

    @render.code
    def brush_info():
        return "brush:\n" + json.dumps(input.plot1_brush(), indent=2)
