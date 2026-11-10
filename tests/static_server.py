"""A static file server that can take Pyodide's burst of package requests.

Pyodide fetches every wheel an app needs at once -- 40-odd for a Shiny app.
`python -m http.server` queues only 5 pending connections; past that, macOS
resets the connection, and Pyodide skips any package it could not fetch rather
than failing, so the app dies later on an import of a package that "is not
installed".

Run as a script to serve a directory on a port, as `static_server` in
conftest.py does:

    python tests/static_server.py 8100 _shinylive

Every response names the directory it serves in a `X-Served-From` header, so the
tests can tell whether a server already on their port is serving this checkout.
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


class StaticServer(ThreadingHTTPServer):
    request_queue_size = 128


SERVED_FROM_HEADER = "X-Served-From"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def end_headers(self) -> None:
        self.send_header(SERVED_FROM_HEADER, self.directory)
        super().end_headers()


def static_server(port: int, directory: str) -> StaticServer:
    return StaticServer(
        ("127.0.0.1", port),
        partial(QuietHandler, directory=str(Path(directory).resolve())),
    )


if __name__ == "__main__":
    static_server(int(sys.argv[1]), sys.argv[2]).serve_forever()
