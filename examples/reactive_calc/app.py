# A reactive Calc is used for its return value. It intelligently caches its value, and
# only re-runs after it has been invalidated -- that is, when upstream reactive inputs
# change.

from shiny import *

app_ui = ui.page_fluid(
    ui.input_slider("x", "Choose a number", 1, 100, 50),
    ui.output_text_verbatim("txt1"),
    ui.output_text_verbatim("txt2"),
)


def server(input: Inputs, output: Outputs, session: Session):
    # Each time input.x() changes, it invalidates this reactive.Calc object. If someone
    # then calls x_times_2(), it will execute the user function and return the value.
    # The value is cached, so if another function calls x_times_2(), it will simply
    # return the cached value, without re-running the function.  When input.x() changes
    # again, it will invalidate this reactive.Calc, and the cache will be cleared.
    @reactive.Calc()
    def x_times_2():
        val = input.x() * 2
        print(f"Running x_times_2(). Result is {val}.")
        return val

    @output()
    @render_text()
    def txt1():
        return f'x times 2 is: "{x_times_2()}"'

    @output()
    @render_text()
    def txt2():
        return f'x times 2 is: "{x_times_2()}"'


app = App(app_ui, server)
