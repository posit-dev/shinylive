from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.input_radio_buttons(
        "type",
        "Input Type",
        choices=["text", "select", "date", "slider", "other"],
    ),
    ui.output_ui("dyn_ui"),
)


def server(input, output, session):
    @output
    @render.ui
    def dyn_ui():
        if input.type() == "text":
            return ui.TagList(
                ui.input_text("x", "Text input", placeholder="Enter text"),
                ui.output_text("txt"),
            )

        elif input.type() == "select":
            return ui.TagList(
                ui.input_select(
                    "x",
                    "Select",
                    {"a": "Choice A", "b": "Choice B", "c": "Choice C"},
                ),
                ui.output_text("txt"),
            )

        elif input.type() == "date":
            return ui.TagList(
                ui.input_date("x", "Choose a date"),
                ui.output_text_verbatim("txt"),
            )

        elif input.type() == "slider":
            return ui.TagList(
                ui.input_slider("x", "Select a number", 1, 100, 50),
                ui.output_text_verbatim("txt"),
            )

        else:
            return ui.div("You selected", ui.tags.b("other", style="color: red;"))

    @output
    @render.text
    def txt():
        return f'x is: "{input.x()}"'


app = App(app_ui, server, debug=True)
