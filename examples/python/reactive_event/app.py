# A reactive Effect is run for its side effects, not for its return value. These
# side effects can include printing messages to the console, writing files to
# disk, or sending messages to a server.

from shiny import reactive, render
from shiny.express import ui, input

ui.input_slider("n", "N", 0, 20, 10),
ui.input_action_button("btn", "Click me"),
ui.tags.br(),
"The value of the slider when the button was last clicked:",


@reactive.Effect
@reactive.event(input.btn)
def _():
    print("You clicked the button!")
    # You can do other things here, like write data to disk.


@render.text
@reactive.event(input.btn)
def txt():
    return f"Last value: {input.n()}"
