from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_date("x", "Date input"),
    ui.output_code("txt"),
)


def server(input, output, session):
    @render.code
    def txt():
        return f"x: {input.x()}"


app = App(app_ui, server, debug=True)
