import os
from shiny import *

app_ui = ui.page_fluid(
    ui.output_text_verbatim("txt"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render_text()
    def txt():
        infile = os.path.join(os.path.dirname(__file__), "mtcars.csv")
        with open(infile, "r") as f:
            lines = f.readlines()
        return "".join(lines)


app = App(app_ui, server, debug=True)
