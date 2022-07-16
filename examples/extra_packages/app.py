from shiny import App, ui

import isodate
import attrs
import tabulate

app_ui = ui.page_fluid(
    ui.markdown(
        """
        This application doesn't actually do anything -- it simply demonstrates how to
        import extra packages from PyPI, by using a `requirements.txt` file.

        Packages listed in `requirements.txt` will be installed by micropip just before
        the app is started. This means that each time someone visits the app, the
        packages will be downloaded and installed into the browser's Pyodide
        environment.

        If you want test whether a package can be installed this way, either edit
        `requirements.txt` and reload this app, or try running this in the terminal:

        ```
        import micropip
        micropip.install("mypackage")
        import mypackage
        ```
        """
    ),
)

app = App(app_ui, None)
