from pathlib import Path

import pandas as pd
from plotnine import aes, facet_grid, geom_point, ggplot, ggtitle, theme_minimal

from shiny.express import input, render, ui
from shiny.plotutils import brushed_points, near_points
from shiny.ui import output_plot

mtcars = pd.read_csv(Path(__file__).parent / "mtcars.csv")
mtcars.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1, inplace=True)

# In fast mode, throttle interval in ms.
FAST_INTERACT_INTERVAL = 60

with ui.sidebar(title="Interaction options"):
    ui.input_checkbox("facet", "Use facets", False)
    ui.input_radio_buttons("brush_dir", "Brush direction", ["xy", "x", "y"], inline=True)
    ui.input_checkbox("fast", f"Fast hovering/brushing (throttled with {FAST_INTERACT_INTERVAL}ms interval)")
    ui.input_checkbox("all_rows", "Return all rows in data frame", False)
    ui.input_slider("max_distance", "Max distance of point from hover", 1, 20, 5)

with ui.hold():
    @render.plot
    def plot1():
        p = (
            ggplot(mtcars, aes("wt", "mpg")) + geom_point() + theme_minimal()
            + ggtitle("Hover over points or click + drag to brush")
        )
        if input.facet():
            p = p + facet_grid("am~cyl")
        return p

@render.ui
def plot_ui():
    hover_opts_kwargs = {}
    brush_opts_kwargs = {}
    brush_opts_kwargs["direction"] = input.brush_dir()

    if input.fast():
        hover_opts_kwargs["delay"] = FAST_INTERACT_INTERVAL
        hover_opts_kwargs["delay_type"] = "throttle"
        brush_opts_kwargs["delay"] = FAST_INTERACT_INTERVAL
        brush_opts_kwargs["delay_type"] = "throttle"

    return output_plot(
        "plot1",
        hover=ui.hover_opts(**hover_opts_kwargs),
        brush=ui.brush_opts(**brush_opts_kwargs),
    )


with ui.layout_columns():
    with ui.card():
        ui.card_header("Points near cursor")

        @render.data_frame
        def near_hover():
            return near_points(
                mtcars,
                input.plot1_hover(),
                threshold=input.max_distance(),
                add_dist=True,
                all_rows=input.all_rows(),
            )

    with ui.card():
        ui.card_header("Points in brush")

        @render.data_frame
        def in_brush():
            return brushed_points(
                mtcars,
                input.plot1_brush(),
                all_rows=input.all_rows(),
            )
