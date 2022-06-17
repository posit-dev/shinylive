from pathlib import Path
from shiny import ui, render, App, Inputs, Outputs, Session

app_ui = ui.page_fluid(
    ui.row(
        ui.column(
            6, ui.input_slider("n", "Make a Shiny square:", min=0, max=6, value=2)
        ),
        ui.column(
            6,
            ui.output_ui("images"),
        ),
    )
)


def square(x: ui.TagChildArg, n: int) -> ui.Tag:
    row = ui.div([x] * n)
    return ui.div([row] * n)


def server(input: Inputs, output: Outputs, session: Session):
    @output
    @render.ui
    def images() -> ui.Tag:
        img = ui.img(src="logo.png", style="width: 40px;")
        return square(img, input.n())


www_dir = Path(__file__).parent / "www"
app = App(app_ui, server, static_assets=www_dir)
