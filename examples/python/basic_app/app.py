from shiny.express import ui, input, render


ui.input_slider("n", "N", 0, 100, 20),


@render.text
def txt():
    return f"n*2 is {input.n() * 2}"
