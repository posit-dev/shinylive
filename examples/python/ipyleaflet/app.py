from shiny import reactive
from shiny.express import input, ui
from shinywidgets import render_widget
import ipyleaflet as ipyl

city_centers = {
    "London": (51.5074, 0.1278),
    "Paris": (48.8566, 2.3522),
    "New York": (40.7128, -74.0060),
}
ui.input_select("center", "Center", choices=list(city_centers.keys()))


@render_widget
def map():
    return ipyl.Map(zoom=4)


@reactive.effect
def _():
    map.widget.center = city_centers[input.center()]
