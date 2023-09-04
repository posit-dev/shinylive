import matplotlib.pyplot as plt
import numpy as np
from shiny import App, render, ui

# Note that if the window is narrow, then the sidebar will be shown above the
# main content, instead of being on the left.

app_ui = ui.page_fluid(
    ui.layout_sidebar(
        ui.panel_sidebar(ui.input_slider("n", "N", 0, 100, 20)),
        ui.panel_main(ui.output_plot("plot")),
    ),
)


def server(input, output, session):
    @output
    @render.plot(alt="A histogram")
    def plot() -> object:
        np.random.seed(19680801)
        x = 100 + 15 * np.random.randn(437)

        fig, ax = plt.subplots()
        ax.hist(x, input.n(), density=True)
        return fig


app = App(app_ui, server)
