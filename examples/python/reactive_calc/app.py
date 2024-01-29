# A reactive Calc is used for its return value. It intelligently caches its value, and
# only re-runs after it has been invalidated -- that is, when upstream reactive inputs
# change.

from shiny import reactive
from shiny.express import input, render, ui

ui.input_slider("x", "Choose a number", 1, 100, 50)


@reactive.Calc
def x_times_2():
    val = input.x() * 2
    print(f"Running x_times_2(). Result is {val}.")
    return val


@render.text
def txt1():
    return f'x times 2 is: "{x_times_2()}"'


@render.text
def txt2():
    return f'x times 2 is: "{x_times_2()}"'
