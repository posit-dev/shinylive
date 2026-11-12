"""A static file server that can take Pyodide's burst of package requests.

Pyodide fetches every wheel an app needs at once -- 40-odd for a Shiny app.
`python -m http.server` queues only 5 pending connections; past that, macOS
resets the connection, and Pyodide skips any package it could not fetch rather
than failing, so the app dies later on an import of a package that "is not
installed".

Run as a script to serve a directory on a port, as `static_server` in
conftest.py does:

    python tests/static_server.py 8100 _shinylive
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class StaticServer(ThreadingHTTPServer):
    request_queue_size = 128


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass


def static_server(port: int, directory: str) -> StaticServer:
    return StaticServer(("127.0.0.1", port), partial(QuietHandler, directory=directory))


if __name__ == "__main__":
    server = static_server(int(sys.argv[1]), sys.argv[2])
    # Tells conftest.py the port is bound and taking connections.
    print("ready", flush=True)
    server.serve_forever()
