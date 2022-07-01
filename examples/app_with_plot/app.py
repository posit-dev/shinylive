from shiny import *

# Import modules for plot rendering
import numpy as np
import matplotlib.pyplot as plt

app_ui = ui.page_fluid(
    ui.layout_sidebar(
        ui.panel_sidebar(
            ui.input_slider("n", "N", 0, 100, 20),
        ),
        ui.panel_main(
            ui.output_plot("plot"),
        ),
    ),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.plot(alt="A histogram")
    def plot():
        np.random.seed(19680801)
        x = 100 + 15 * np.random.randn(437)

        fig, ax = plt.subplots()
        ax.hist(x, input.n(), density=True)
        return fig


app = App(app_ui, server, debug=True)
