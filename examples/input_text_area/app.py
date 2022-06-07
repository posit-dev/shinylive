from shiny import *

app_ui = ui.page_fluid(
    ui.input_text_area("x", "Text area input", placeholder="Enter text"),
    ui.output_text_verbatim("txt"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render.text()
    def txt():
        return f'x: "{input.x()}"'


app = App(app_ui, server, debug=True)
