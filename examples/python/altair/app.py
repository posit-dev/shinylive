from shiny.express import input, ui
from shinywidgets import render_altair

ui.input_selectize("var", "Select variable", choices=["bill_length_mm", "body_mass_g"])


@render_altair
def hist():
    import altair as alt
    from palmerpenguins import load_penguins

    df = load_penguins()
    return (
        alt.Chart(df)
        .mark_bar()
        .encode(x=alt.X(f"{input.var()}:Q", bin=True), y="count()")
    )
