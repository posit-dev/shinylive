from shiny import App, reactive, render, ui

app_ui = ui.page_fluid(
    {"id": "main-content"},
    ui.h2("Dynamic UI"),
    ui.input_action_button("btn", "Trigger insert/remove ui"),
    ui.output_ui("dyn_ui"),
)


def server(input, output, session):
    # One way of adding dynamic content is with @render.ui.
    @output
    @render.ui
    def dyn_ui():
        return ui.input_slider(
            "n1", "This slider is rendered via @render.ui", 0, 100, 20
        )

    # Another way of adding dynamic content is with ui.insert_ui() and ui.remove_ui().
    # The insertion is imperative, so, compared to @render.ui, more care is needed to
    # make sure you don't add multiple copies of the content.
    @reactive.Effect
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


app = App(app_ui, server)
