from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_switch("x", "Switch input"),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @render.text
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
