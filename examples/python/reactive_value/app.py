# When a reactive Value's value changes, it will invalidate (and trigger re-execution)
# of any reactive objects (Calcs, Effects, and outputs) that depend on it. Typically, a
# reactive Value will be set with a reactive Effect. The Effect, in turn, may be driven
# by a user input (like a button), or something else, like a timer.
#
# Reactive Values are often used for tracking or accumulating state over time.
#
# In this example, a button press triggers an Effect which adds the current timestamp to
# a reactive Value containing an array of timestamps. Importantly, the Effect sets the
# reactive Value's value, which causes all downstream reactive objects to be
# invalidated.
#
# There is also an output which reads the reactive Value and returns a string. When the
# reactive Value changes, it invalidates this output, causing it to re-execute and
# return a new string.

import textwrap
from datetime import datetime

from shiny import reactive
from shiny.express import ui, input, render

ui.h3("Press the button:")
ui.input_action_button("btn", "Time")
ui.h3("Time between button presses:")


# A reactive.Value with an array tracking timestamps of all button presses.
all_times = reactive.Value([datetime.now().timestamp()])


# This Effect is triggered by pressing the button. It makes a copy of all_times(),
# because we don't want to modify the original, then appends the new timestamp,
# then sets all_times() to the new, longer array.
@reactive.Effect
@reactive.event(input.btn)
def _():
    x = all_times().copy()
    x.append(datetime.now().timestamp())
    all_times.set(x)


# This text output is invalidated when all_times() changes. It calculates the
# differences between each timestamp and returns the array of differences as a
# string.


@render.text
def txt():
    x = all_times()
    x = [round(j - i, 2) for i, j in zip(x[:-1], x[1:])]
    return "\n".join(textwrap.wrap(str(x), width=45))
