import palmerpenguins
from shiny import App, render, ui

penguins = palmerpenguins.load_penguins()
# Slim down the data frame to a few representative columns
penguins = penguins.loc[
    penguins["body_mass_g"].notnull(),
    ["species", "island", "body_mass_g", "year"],
]

app_ui = ui.page_fluid(
    ui.input_select(
        "selection_mode",
        "Selection mode",
        {"none": "(None)", "single": "Single", "multiple": "Multiple"},
        selected="multiple",
    ),
    ui.input_switch("gridstyle", "Grid", True),
    ui.input_switch("fullwidth", "Take full width", True),
    ui.input_switch("fixedheight", "Fixed height", True),
    ui.input_switch("filters", "Filters", True),
    ui.output_data_frame("grid"),
    ui.panel_fixed(
        ui.output_text_verbatim("detail"),
        right="10px",
        bottom="10px",
    ),
    class_="p-3",
)


def server(input, output, session):
    @output
    @render.data_frame
    def grid():
        height = 350 if input.fixedheight() else None
        width = "100%" if input.fullwidth() else "fit-content"
        if input.gridstyle():
            return render.DataGrid(
                penguins,
                row_selection_mode=input.selection_mode(),
                height=height,
                width=width,
                filters=input.filters(),
            )
        else:
            return render.DataTable(
                penguins,
                row_selection_mode=input.selection_mode(),
                height=height,
                width=width,
                filters=input.filters(),
            )

    @output
    @render.text
    def detail():
        if (
            input.grid_selected_rows() is not None
            and len(input.grid_selected_rows()) > 0
        ):
            # "split", "records", "index", "columns", "values", "table"
            return penguins.iloc[list(input.grid_selected_rows())]


app = App(app_ui, server)
