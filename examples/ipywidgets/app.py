from shiny import *
from ipyshiny import *
import ipywidgets as ipy
from ipywidgets.widgets.widget import Widget


app_ui = ui.page_fluid(output_widget("slider", height="50px"), ui.output_text("value"))


def server(input: Inputs, output: Outputs, session: Session):
    s = ipy.IntSlider(
        value=5,
        min=0,
        max=10,
        step=1,
        description="Test:",
        continuous_update=True,
        orientation="horizontal",
        readout=False,
    )

    @output
    @render_widget
    def slider():
        return s

    @output
    @render.text
    def value():
        return f"The value of the slider is: {reactive_read(s, 'value')}"


app = App(app_ui, server, debug=True)
