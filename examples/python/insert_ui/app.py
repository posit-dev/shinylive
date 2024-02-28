from shiny import reactive
from shiny.express import input, render, ui

ui.h2("Dynamic UI")
with ui.div(id="main-content"):
    ui.input_action_button("btn", "Trigger insert/remove ui")

    @render.ui
    def dyn_ui():
        return ui.input_slider(
            "n1", "This slider is rendered via @render.ui", 0, 100, 20
        )

    # Another way of adding dynamic content is with ui.insert_ui() and ui.remove_ui().
    # The insertion is imperative, so, compared to @render.ui, more care is needed to
    # make sure you don't add multiple copies of the content.
    @reactive.effect
    def _():
        btn = input.btn()
        if btn % 2 == 1:
            slider = ui.input_slider(
                "n2", "This slider is inserted with ui.insert_ui()", 0, 100, 20
            )
            ui.insert_ui(
                ui.div({"id": "inserted-slider"}, slider),
                selector="#main-content",
                where="beforeEnd",
            )
        elif btn > 0:
            ui.remove_ui("#inserted-slider")
