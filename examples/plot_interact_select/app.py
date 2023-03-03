# Note: This app uses a development version of plotnine.
from pathlib import Path

import pandas as pd
from plotnine import aes, facet_grid, geom_point, ggplot
from shiny import App, Inputs, Outputs, Session, render, ui
from shiny.plotutils import brushed_points, near_points

mtcars = pd.read_csv(Path(__file__).parent / "mtcars.csv")
mtcars.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1, inplace=True)

# In fast mode, throttle interval in ms.
FAST_INTERACT_INTERVAL = 60

app_ui = ui.page_fluid(
    ui.head_content(
        ui.tags.style(
            """
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
                ui.input_checkbox("facet", "Use facets", False),
                ui.input_radio_buttons(
                    "brush_dir", "Brush direction", ["xy", "x", "y"], inline=True
                ),
                ui.input_checkbox(
                    "fast",
                    f"Fast hovering/brushing (throttled with {FAST_INTERACT_INTERVAL}ms interval)",
                ),
                ui.input_checkbox("all_rows", "Return all rows in data frame", False),
                ui.input_slider(
                    "max_distance", "Max distance of point from hover", 1, 20, 5
                ),
            ),
        ),
        ui.column(
            8,
            ui.output_ui("plot_ui"),
        ),
    ),
    ui.row(
        ui.column(6, ui.tags.b("Points near cursor"), ui.output_table("near_hover")),
        ui.column(6, ui.tags.b("Points in brush"), ui.output_table("in_brush")),
    ),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
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

        return ui.output_plot(
            "plot1",
            hover=ui.hover_opts(**hover_opts_kwargs),
            brush=ui.brush_opts(**brush_opts_kwargs),
        )

    @output
    @render.plot()
    def plot1():
        p = ggplot(mtcars, aes("wt", "mpg")) + geom_point()
        if input.facet():
            p = p + facet_grid("am~cyl")

        return p

    @output
    @render.table()
    def near_hover():
        return near_points(
            mtcars,
            input.plot1_hover(),
            threshold=input.max_distance(),
            add_dist=True,
            all_rows=input.all_rows(),
        )

    @output
    @render.table()
    def in_brush():
        return brushed_points(
            mtcars,
            input.plot1_brush(),
            all_rows=input.all_rows(),
        )


app = App(app_ui, server)


def format_table(df: pd.DataFrame):
    return (
        df.style.set_table_attributes('class="dataframe shiny-table table w-auto"')
        .hide(axis="index")  # pyright: reportUnknownMemberType=false
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
            ]  # pyright: reportGeneralTypeIssues=false
        )
    )
