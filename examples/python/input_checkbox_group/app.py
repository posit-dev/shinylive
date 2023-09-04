from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_checkbox_group(
        "x", "Checkbox group input", {"a": "Choice A", "b": "Choice B"}
    ),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @output
    @render.text
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
