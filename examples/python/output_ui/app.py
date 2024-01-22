from shiny import render
from shiny.express import ui, input, output
import numpy as np
import matplotlib.pyplot as plt


ui.input_slider("card_n", "Number of cards", value=3, min=1, max=5)


@render.express
def cards():
    with ui.layout_columns():
        for i in range(input.card_n()):
            with ui.card():
                f"Card {i}"

                # Specifying the ID like this lets us include a renderer in the iterator
                # without causing ID conflicts.
                @output(id=f"hist_{i}")
                @render.plot(alt="A histogram")
                def histogram():
                    np.random.seed(19680801)
                    x = 100 + 15 * np.random.randn(437)
                    plt.hist(x, 20, density=True)
