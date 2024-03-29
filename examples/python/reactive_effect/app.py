# A reactive Effect is run for its side effects, not for its return value. These
# side effects can include printing messages to the console, writing files to
# disk, or sending messages to a server.

from shiny import reactive
from shiny.express import input, ui

ui.input_text("x", "Text input", placeholder="Enter text")


@reactive.effect
def _():
    print(f"x has changed to {input.x()}")
