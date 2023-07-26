# A reactive Effect is run for its side effects, not for its return value. These
# side effects can include printing messages to the console, writing files to
# disk, or sending messages to a server.

from shiny import App, reactive, ui

app_ui = ui.page_fluid(
    ui.input_text("x", "Text input", placeholder="Enter text"),
)


def server(input, output, session):
    @reactive.Effect
    def _():
        print(f"x has changed to {input.x()}")


app = App(app_ui, server)
