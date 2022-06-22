import json
from typing import Any, Literal


class HttpResponse:
    def __init__(self, status: int, data: Any):
        self.status = status
        self.data = data


async def get_url(
    url: str, type: Literal["string", "bytes", "json"] = "string"
) -> HttpResponse:
    """
    An async wrapper function for http requests that works in both regular Python and
    Pyodide.

    In Pyodide, it uses the pyodide.http.pyfetch() function, which is a wrapper for the
    JavaScript fetch() function. pyfetch() is asynchronous, so this whole function must
    also be async.

    In regular Python, it uses the urllib.request.urlopen() function.

    Args:
        url: The URL to download.

        type: How to parse the content. If "string", it returns the response as a
        string. If "bytes", it returns the response as a bytes object. If "json", it
        parses the reponse as JSON, then converts it to a Python object, usually a
        dictionary or list.

    Returns:
        A HttpResponse object
    """
    import sys

    if "pyodide" in sys.modules:
        import pyodide.http

        response = await pyodide.http.pyfetch(url)

        if type == "json":
            # .json() parses the response as JSON and converts to dictionary.
            data = await response.json()
        elif type == "string":
            # .string() returns the response as a string.
            data = await response.string()
        elif type == "bytes":
            # .bytes() returns the response as a byte object.
            data = await response.bytes()

        return HttpResponse(response.status, data)

    else:
        import urllib.request

        response = urllib.request.urlopen(url)
        if type == "json":
            data = json.loads(response.read().decode("utf-8"))
        elif type == "string":
            data = response.read().decode("utf-8")
        elif type == "bytes":
            data = response.read()

        return HttpResponse(response.status, data)
