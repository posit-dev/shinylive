from shiny import App, render, ui
from shiny.express import ui, input
from utils import square

ui.input_slider("n", "N", 0, 100, 20),


@render.text
def txt():
    val = square(input.n())
    return f"{input.n()} squared is {val}"
