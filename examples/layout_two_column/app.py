from shiny import App, ui


app_ui = ui.page_fluid(
    ui.tags.style(
        """
        .app-col {
            border: 1px solid black;
            border-radius: 5px;
            background-color: #eee;
            padding: 8px;
            margin-top: 5px;
            margin-bottom: 5px;
        }
        """
    ),
    ui.h2({"style": "text-align: center;"}, "App Title"),
    ui.row(
        ui.column(
            12,
            ui.div(
                {"class": "app-col"},
                ui.p(
                    """
                    This is a column that spans the entire width of the page.
                    """,
                ),
                ui.p(
                    """
                    Here's some more text in another paragraph.
                    """,
                ),
            ),
        )
    ),
    ui.row(
        ui.column(
            6,
            ui.div(
                {"class": "app-col"},
                """
                Here's some text in a column. Note that if the page is very
                narrow, the two columns will be be stacked on top of each other
                instead of being side-by-side.
                """,
            ),
        ),
        ui.column(
            6,
            ui.div(
                {"class": "app-col"},
                """
                Here's some text in another column.
                """,
            ),
        ),
    ),
)


def server(input, output, session):
    pass


app = App(app_ui, server)
