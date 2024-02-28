from datetime import date

from shiny import reactive
from shiny.express import input, ui

ui.h1("Updating inputs")

ui.markdown(
    """
Each Shiny input has an `update_*` function which can be used to update that input.
Most options can be changed including the value, style, and input label, please see
[the docs](https://shiny.posit.co/py/api/ui.update_sidebar.html) for more examples.
"""
)

ui.input_slider("slider", "Slider", 0, 100, 50, width="50%")
ui.input_action_button(
    "to_20", "Set slider to 20", class_="btn btn-primary", width="25%"
)
ui.input_action_button(
    "to_60", "Set slider to 60", class_="btn btn-primary", width="25%"
)


@reactive.effect
@reactive.event(input.to_20)
def set_to_20():
    ui.update_slider("slider", value=20)


@reactive.effect
@reactive.event(input.to_60)
def set_to_60():
    ui.update_slider("slider", value=60)
