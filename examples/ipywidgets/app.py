from shiny import *
from ipyshiny import *
import ipywidgets as ipy
from ipywidgets.widgets.widget import Widget


app_ui = ui.page_fluid(output_widget("slider", height="50px"), ui.output_text("value"))


def server(input: Inputs, output: Outputs, session: Session):
    v = reactive.Value(None)
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

    # This should print on every client-side change to the slider
    s.observe(lambda change: v.set(change.new), "value")

    @output()
    @render_widget()
    def slider():
        return s

    @output()
    @render_text()
    def value():
        return f"The value of the slider is: {v()}"


app = App(app_ui, server, debug=True)
