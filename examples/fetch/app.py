# Normally in Python, you would use urllib.request.urlopen() to fetch data from a web
# API. However, it won't work in Pyodide because sockets are not available.
#
# Instead, you can pyodide.http.pyfetch(), which is a wrapper for the JavaScript fetch()
# function.
#
# One important difference between urllib.request.urlopen() and pyodide.http.pyfetch()
# is that the latter is asynchronous. In a Shiny app, this just means that the
# reactive.Calc's and outputs must have `async` in front of the function definitions,
# and when they're called, they must have `await` in front of them.
#
# If you want to write code that works in both regular Python and Pyodide, see the
# download.py file for a wrapper function that can be used to make requests in both
# regular Python and Pyodide. (Note that the function isn't actually used in this app.)

from shiny import *
import pyodide.http

app_ui = ui.page_fluid(
    ui.input_numeric("n", "Enter a number:", value=42),
    ui.input_radio_buttons(
        "type",
        "What kind of fact do you want?",
        {"trivia": "Trivia", "year": "Year", "date": "Date"},
    ),
    ui.input_radio_buttons(
        "data_type",
        "Data conversion type",
        {
            "json": "Parse JSON and return dict/list",
            "string": "String",
            "bytes": "Byte object",
        },
    ),
    ui.input_action_button(
        id="go", label="Fetch another fact", style="margin-bottom: 10px;"
    ),
    ui.output_text_verbatim("info"),
)


def server(input: Inputs, output: Outputs, session: Session):
    @reactive.Calc
    def url():
        return f"http://numbersapi.com/{input.n()}/{input.type()}?json"

    @reactive.Calc
    async def number_data():
        # Take a dependency on the button, so that the user can hit the API again with
        # the same values.
        input.go()

        response = await pyodide.http.pyfetch(url())
        if response.status != 200:
            raise Exception(f"Error fetching {url()}: {response.status}")

        if input.data_type() == "json":
            # .json() parses the response as JSON and converts to dictionary.
            data = await response.json()
        elif input.data_type() == "string":
            # .string() returns the response as a string.
            data = await response.string()
        elif input.data_type() == "bytes":
            # .bytes() returns the response as a byte object.
            data = await response.bytes()

        return data

    @output
    @render.text
    async def info():
        data = await number_data()
        return f"Request URL: {url()}\nResult type: {type(data)}\n{str(data)}"


app = App(app_ui, server)
