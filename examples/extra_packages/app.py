from shiny import *

import isodate
import attrs
import tabulate

app_ui = ui.page_fluid(
    ui.div("See the requirements.txt file to see how to specify packages."),
)


def server(input: Inputs, output: Outputs, session: Session):
    pass


app = App(app_ui, server, debug=True)
