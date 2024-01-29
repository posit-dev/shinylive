from shiny.express import ui, input, render


ui.input_radio_buttons(
    "type",
    "Input Type",
    choices=["text", "select", "date", "slider", "other"],
),


@render.ui
def dyn_ui():
    if input.type() == "text":
        return ui.input_text("x", "Text input", placeholder="Enter text")

    elif input.type() == "select":
        return ui.input_select(
            "x",
            "Select",
            {"a": "Choice A", "b": "Choice B", "c": "Choice C"},
        )

    elif input.type() == "date":
        return ui.input_date("x", "Choose a date")

    elif input.type() == "slider":
        return ui.input_slider("x", "Select a number", 1, 100, 50)

    else:
        return ui.div("You selected", ui.tags.b("other", style="color: red;"))


@render.text
def txt():
    return f'x is: "{input.x()}"'
