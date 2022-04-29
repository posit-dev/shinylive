from shiny import *

app_ui = ui.page_fluid(
    ui.input_date("x", "Date input"),
    ui.output_text_verbatim("txt"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render_text()
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
