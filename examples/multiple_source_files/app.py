from shiny import *
from utils import square

app_ui = ui.page_fluid(
    ui.input_slider("n", "N", 0, 100, 20),
    ui.output_text_verbatim("txt"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.text
    def txt():
        val = square(input.n())
        return f"{input.n()} squared is {val}"


app = App(app_ui, server, debug=True)
