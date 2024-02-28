from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_numeric("x", "Number input", value=100),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @render.text
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
