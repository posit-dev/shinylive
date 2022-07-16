# Normally in Python, you would use urllib.request.urlopen() to fetch data from a web
# API. However, it won't work in Pyodide because sockets are not available.
#
# Instead, you can pyodide.http.pyfetch(), which is a wrapper for the JavaScript fetch()
# function. Note that when running shinylive, the endpoint MUST use https. This is
# because shinylive must be served over https (unless you are running on localhost),
# and browsers will not allow a https page to fetch data with http.
#
# One important difference between urllib.request.urlopen() and pyodide.http.pyfetch()
# is that the latter is asynchronous. In a Shiny app, this just means that the
# reactive.Calc's and outputs must have `async` in front of the function definitions,
# and when they're called, they must have `await` in front of them.
#
# If you want to write code that works in both regular Python and Pyodide, see the
# download.py file for a wrapper function that can be used to make requests in both
# regular Python and Pyodide. (Note that the function isn't actually used in this app.)

from pprint import pformat
import pyodide.http
from shiny import App, reactive, render, ui

app_ui = ui.page_fluid(
    ui.input_selectize(
        "city",
        "Select a city:",
        [
            "",
            "Berlin",
            "Cairo",
            "Chicago",
            "Kyiv",
            "London",
            "Lima",
            "Los Angeles",
            "Mexico City",
            "Mumbai",
            "New York",
            "Paris",
            "São Paulo",
            "Seoul",
            "Shanghai",
            "Taipei",
            "Tokyo",
        ],
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
    ui.output_text_verbatim("info"),
)


def server(input, output, session):
    # Weather data API: https://github.com/robertoduessmann/weather-api
    @reactive.Calc
    def url():
        return f"https://goweather.herokuapp.com/weather/{input.city()}"

    @reactive.Calc
    async def weather_data():
        if input.city() == "":
            return

        response = await pyodide.http.pyfetch(url())
        if response.status != 200:
            raise Exception(f"Error fetching {url()}: {response.status}")

        if input.data_type() == "json":
            # .json() parses the response as JSON and converts to dictionary.
            data = await response.json()
        elif input.data_type() == "string":
            # .string() returns the response as a string.
            data = await response.string()
        else:
            # .bytes() returns the response as a byte object.
            data = await response.bytes()

        return data

    @output
    @render.text
    async def info():
        if input.city() == "":
            return ""

        data = await weather_data()
        if isinstance(data, (str, bytes)):
            data_str = data
        else:
            data_str = pformat(data)
        return f"Request URL: {url()}\nResult type: {type(data)}\n{data_str}"


app = App(app_ui, server)
