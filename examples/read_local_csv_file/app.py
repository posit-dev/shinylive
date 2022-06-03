from pathlib import Path
import pandas
from shiny import *

app_ui = ui.page_fluid(
    ui.output_ui("table"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @output()
    @render_ui()
    def table():
        infile = Path(__file__).parent / "mtcars.csv"
        df = pandas.read_csv(infile)
        # Use the DataFrame's to_html() function to convert it to an HTML table, and
        # then wrap with ui.HTML() so Shiny knows to treat it as raw HTML.
        return ui.HTML(df.to_html())


app = App(app_ui, server)
