from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from plotnine import aes, geom_point, geom_smooth, ggplot

from shiny import reactive
from shiny.express import input, output_args, render, ui
from shiny.plotutils import brushed_points, near_points

mtcars = pd.read_csv(Path(__file__).parent / "mtcars.csv")
mtcars.drop(["disp", "hp", "drat", "qsec", "vs", "gear", "carb"], axis=1, inplace=True)

@output_args(click=True, brush=True)
@render.plot
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


ui.div(
    ui.input_action_button("exclude_toggle", "Toggle brushed points"),
    ui.input_action_button("exclude_reset", "Reset"),
    class_="d-flex justify-content-center pb-3 gap-3",
)


@render.code
def model():
    df = data_with_keep()
    df_keep = df[df["keep"]]
    mod = sm.OLS(df_keep["wt"], df_keep["mpg"])
    res = mod.fit()
    return res.summary()


@reactive.calc
def data_with_keep():
    df = mtcars.copy()
    df["keep"] = keep_rows()
    return df


keep_rows = reactive.value([True] * len(mtcars))

@reactive.effect
@reactive.event(input.plot1_click)
def _():
    res = near_points(mtcars, input.plot1_click(), all_rows=True, max_points=1)
    keep_rows.set(list(np.logical_xor(keep_rows(), res.selected_)))

@reactive.effect
@reactive.event(input.exclude_toggle)
def _():
    res = brushed_points(mtcars, input.plot1_brush(), all_rows=True)
    keep_rows.set(list(np.logical_xor(keep_rows(), res.selected_)))

@reactive.effect
@reactive.event(input.exclude_reset)
def _():
    keep_rows.set([True] * len(mtcars))
