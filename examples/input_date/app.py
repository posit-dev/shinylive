from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_date("x", "Date input"),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @output
    @render.text
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
