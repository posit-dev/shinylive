# The shinyswatch package provides themes from https://bootswatch.com/

import shinyswatch
from shiny import App, render, ui

app_ui = ui.page_navbar(
    # Available themes:
    #  cerulean, cosmo, cyborg, darkly, flatly, journal, litera, lumen, lux,
    #  materia, minty, morph, pulse, quartz, sandstone, simplex, sketchy, slate,
    #  solar, spacelab, superhero, united, vapor, yeti, zephyr
    shinyswatch.theme.superhero(),
    ui.nav(
        "Navbar 1",
        ui.layout_sidebar(
            ui.panel_sidebar(
                ui.input_file("file", "File input:"),
                ui.input_text("txt", "Text input:", "general"),
                ui.input_slider("slider", "Slider input:", 1, 100, 30),
                ui.tags.h5("Default actionButton:"),
                ui.input_action_button("action", "Search"),
                ui.tags.h5("actionButton with CSS class:"),
                ui.input_action_button(
                    "action2", "Action button", class_="btn-primary"
                ),
            ),
            ui.panel_main(
                ui.navset_tab(
                    ui.nav(
                        "Tab 1",
                        ui.tags.h4("Table"),
                        ui.output_table("table"),
                        ui.tags.h4("Verbatim text output"),
                        ui.output_text_verbatim("txtout"),
                        ui.tags.h1("Header 1"),
                        ui.tags.h2("Header 2"),
                        ui.tags.h3("Header 3"),
                        ui.tags.h4("Header 4"),
                        ui.tags.h5("Header 5"),
                    ),
                    ui.nav("Tab 2"),
                    ui.nav("Tab 3"),
                )
            ),
        ),
    ),
    ui.nav("Plot"),
    ui.nav("Table"),
    title="Shinyswatch",
)


def server(input, output, session):
    @output
    @render.text
    def txtout():
        return f"{input.txt()}, {input.slider()}, {input.slider()}"

    @output
    @render.table
    def table():
        import pandas as pd

        cars = pd.DataFrame(
            {
                "speed": [4, 4, 7, 7, 8, 9],
                "dist": [2, 10, 4, 22, 16, 10],
            }
        )
        return cars.head(4)


app = App(app_ui, server)
