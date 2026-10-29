# Normally in Python, you would use urllib.request.urlopen() to fetch data from a web
# API. However, it won't work in Pyodide because sockets are not available.
#
# Instead, you can pyodide.http.pyfetch(), which is a wrapper for the JavaScript fetch()
# function. Note that when running shinylive, the endpoint MUST use https. This is
# because shinylive must be served over https (unless you are running on localhost),
# and browsers will not allow a https page to fetch data with http.
#
# If you are fetching data from a different origin, that server will also need to allow
# cross-origin requests by setting the Access-Control-Allow-Origin header. See
# https://en.wikipedia.org/wiki/Cross-origin_resource_sharing for more information.
#
# If you see "Failed to fetch" in the Python console, it is likely because the endpoint
# is http and not https, or because the server does not allow cross-origin requests.
#
# One important difference between urllib.request.urlopen() and pyodide.http.pyfetch()
# is that the latter is asynchronous. In a Shiny app, this just means that the
# reactive.calc's and outputs must have `async` in front of the function definitions,
# and when they're called, they must have `await` in front of them.
#
# If you want to write code that works in both regular Python and Pyodide, see the
# download.py file for a wrapper function that can be used to make requests in both
# regular Python and Pyodide. (Note that the function isn't actually used in this app.)

from pprint import pformat

import pyodide.http
from shiny import reactive
from shiny.express import input, render, ui


# Open-Meteo (https://open-meteo.com) is a free weather API that needs no API key and
# allows cross-origin requests. It looks up weather by coordinates, so each city maps to
# its (latitude, longitude).
CITIES = {
    "Berlin": (52.52, 13.41),
    "Cairo": (30.04, 31.24),
    "Chicago": (41.88, -87.63),
    "Kyiv": (50.45, 30.52),
    "London": (51.51, -0.13),
    "Lima": (-12.05, -77.04),
    "Los Angeles": (34.05, -118.24),
    "Mexico City": (19.43, -99.13),
    "Mumbai": (19.08, 72.88),
    "New York": (40.71, -74.01),
    "Paris": (48.86, 2.35),
    "São Paulo": (-23.55, -46.63),
    "Seoul": (37.57, 126.98),
    "Shanghai": (31.23, 121.47),
    "Taipei": (25.03, 121.57),
    "Tokyo": (35.68, 139.69),
}


@reactive.calc
def url():
    lat, lon = CITIES[input.city()]
    return (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,wind_speed_10m,weather_code"
    )


@reactive.calc
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


ui.input_selectize("city", "Select a city:", ["", *CITIES])
ui.input_radio_buttons(
    "data_type",
    "Data conversion type",
    {
        "json": "Parse JSON and return dict/list",
        "string": "String",
        "bytes": "Byte object",
    },
)


@render.code
async def info():
    if input.city() == "":
        return ""

    data = await weather_data()
    if isinstance(data, (str, bytes)):
        data_str = data
    else:
        data_str = pformat(data)
    return f"Request URL: {url()}\nResult type: {type(data)}\n{data_str}"
