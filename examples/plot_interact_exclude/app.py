# Note: This app uses a development version of plotnine.

import numpy as np
import statsmodels.api as sm
from plotnine import aes, geom_point, geom_smooth, ggplot
from plotnine.data import mtcars as mtcars_orig
from shiny import App, Inputs, Outputs, Session, reactive, render, ui
from shiny.plotutils import brushed_points, near_points

mtcars = mtcars_orig.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1)


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
        ui.column(3),
        ui.column(
            6,
            ui.output_plot("plot1", click=True, brush=True),
            ui.div(
                {"style": "text-align: center"},
                ui.input_action_button("exclude_toggle", "Toggle brushed points"),
                ui.input_action_button("exclude_reset", "Reset"),
            ),
        ),
    ),
    ui.row(
        ui.column(12, {"style": "margin-top: 15px;"}, ui.output_text_verbatim("model")),
    ),
)


def server(input: Inputs, output: Outputs, session: Session):
    keep_rows = reactive.Value([True] * len(mtcars))

    @reactive.Calc
    def data_with_keep():
        df = mtcars.copy()
        df["keep"] = keep_rows()
        return df

    @reactive.Effect
    @reactive.event(input.plot1_click)
    def _():
        res = near_points(mtcars, input.plot1_click(), all_rows=True, max_points=1)
        keep_rows.set(list(np.logical_xor(keep_rows(), res.selected_)))

    @reactive.Effect
    @reactive.event(input.exclude_toggle)
    def _():
        res = brushed_points(mtcars, input.plot1_brush(), all_rows=True)
        keep_rows.set(list(np.logical_xor(keep_rows(), res.selected_)))

    @reactive.Effect
    @reactive.event(input.exclude_reset)
    def _():
        keep_rows.set([True] * len(mtcars))

    @output
    @render.plot()
    def plot1():
        df = data_with_keep()
        df_keep = df[df["keep"]]
        df_exclude = df[~df["keep"]]

        return (
            ggplot(df_keep, aes("wt", "mpg"))
            + geom_point()
            + geom_point(data=df_exclude, color="#666", fill="white")
            + geom_smooth(method="lm", fullrange=True)
        )

    @output
    @render.text()
    def model():
        df = data_with_keep()
        df_keep = df[df["keep"]]
        mod = sm.OLS(df_keep["wt"], df_keep["mpg"])
        res = mod.fit()
        return res.summary()


app = App(app_ui, server)
