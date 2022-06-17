# A reactive Effect is run for its side effects, not for its return value. These
# side effects can include printing messages to the console, writing files to
# disk, or sending messages to a server.

from shiny import *

app_ui = ui.page_fluid(
    ui.input_slider("n", "N", 0, 20, 10),
    ui.input_action_button("btn", "Click me"),
    ui.tags.br(),
    "The value of the slider when the button was last clicked:",
    ui.output_text_verbatim("txt", placeholder=True),
)


def server(input: Inputs, output: Outputs, session: Session):

    # The @event() causes the function to run only when input.btn is
    # invalidated.
    @reactive.Effect
    @event(input.btn)
    def _():
        print(f"You clicked the button!")
        # You can do other things here, like write data to disk.

    # This output updates only when input.btn is invalidated.
    @output
    @render.text
    @event(input.btn)
    def txt():
        return f"Last value: {input.n()}"


app = App(app_ui, server)
