from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_select("x", "Select input", {"a": "Choice A", "b": "Choice B"}),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @render.text
    def txt():
        return f'x: "{input.x()}"'


app = App(app_ui, server, debug=True)
