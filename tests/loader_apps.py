"""App sources, URL hashes and sabotage for the loader-status tests.

The app source travels in the URL hash, the same mechanism test_site_url_loading
uses: an LZ-compressed JSON array of {name, content}. That covers every app-level
failure without intercepting a request. Only the engine-level modes need
page.route().
"""

from __future__ import annotations

import json
import time

import lzstring
from playwright.sync_api import Page, Route

from shinylive_app import BASE_URL

_LZ = lzstring.LZString()

MODES = (
    "off",
    "app-syntax",
    "requirements",
    "engine-load",
    "engine-unreachable",
    "engine-setup",
)

MAIN_FILE = {"py": "app.py", "r": "app.R"}

# The one request every engine makes unconditionally during startup, and the
# thing engine-load / engine-unreachable sabotage.
CORE_ASSET = {
    "py": "**/pyodide/pyodide.asm.wasm",
    "r": "**/webr/R.wasm",
}

# engine-setup needs a failure *after* loadPyodide() resolves, which no missing
# asset can produce. Rewriting the first line of Python that setupPythonEnv()
# runs lands in that window -- the one where the worker holds a live pyodide but
# no pyUtils.
WORKER_BUNDLE = "**/pyodide-worker.js"
SETUP_ANCHOR = "import pyodide.console"

MISSING_PKG = "definitely-not-a-real-package"

WORKING_APP = {
    "py": (
        "from shiny import App, render, ui\n\n"
        'app_ui = ui.page_fluid(ui.h1("Loader test"))\n\n\n'
        "def server(input, output, session):\n    pass\n\n\n"
        "app = App(app_ui, server)\n"
    ),
    "r": (
        "library(shiny)\n\n"
        'ui <- fluidPage(h1("Loader test"))\n\n'
        "server <- function(input, output, session) { }\n\n"
        "shinyApp(ui, server)\n"
    ),
}

# `server` on its own line is a bare symbol where a call is expected: a parse
# error R reports with a line number and caret, and Python reports as a
# SyntaxError.
SYNTAX_ERROR_APP = {
    "py": "from shiny import App, ui\n\napp_ui = ui.page_fluid(\n",
    "r": "library(shiny)\n\nui <- fluidPage(\nserver\n",
}


def _files(engine: str, mode: str) -> list[dict[str, str]]:
    main = MAIN_FILE[engine]
    if mode == "app-syntax":
        return [{"name": main, "content": SYNTAX_ERROR_APP[engine]}]
    if mode == "requirements":
        if engine == "py":
            return [
                {"name": main, "content": WORKING_APP["py"]},
                {
                    "name": "requirements.txt",
                    "content": f"# Does not exist, so micropip.install() fails.\n{MISSING_PKG}\n",
                },
            ]
        # R has no requirements file: .start_app scans for library() calls.
        return [
            {
                "name": main,
                "content": WORKING_APP["r"].replace(
                    "library(shiny)",
                    f"library(shiny)\nlibrary({MISSING_PKG.replace('-', '.')})",
                ),
            }
        ]
    # "off" and the engine-* modes all want a working app: when the engine never
    # starts, the app code is never reached.
    return [{"name": main, "content": WORKING_APP[engine]}]


def app_url(engine: str, mode: str, view: str = "app") -> str:
    files = _files(engine, mode)
    code = _LZ.compressToEncodedURIComponent(json.dumps(files))
    return f"{BASE_URL}/{engine}/{view}/#code={code}"


def sabotage(page: Page, engine: str, mode: str, delay_ms: int) -> None:
    """Install whatever route handlers `mode` needs. A no-op for app-level modes."""
    if mode == "engine-load":
        page.route(CORE_ASSET[engine], lambda r: r.fulfill(status=404, body="nope"))
        return
    if mode == "engine-unreachable":
        # fetch() rejects rather than returning a status: a separate branch of
        # the same check.
        page.route(CORE_ASSET[engine], lambda r: r.abort())
        return
    if mode == "engine-setup":
        page.route(WORKER_BUNDLE, _break_setup)
        return
    if mode == "off":
        page.route(CORE_ASSET[engine], lambda r: _delay(r, delay_ms))


def _delay(route: Route, delay_ms: int) -> None:
    """Answer late, so the loader has stages worth reporting.

    A fixed delay rather than CDP bandwidth throttling: throttling ties the
    timing to how loaded the runner is, and these assertions are about the
    order of stages, not their duration.

    time.sleep() rather than page.wait_for_timeout(): the sync API dispatches
    route handlers on the same greenlet as the page call that triggered them, so
    issuing another page call from in here deadlocks.
    """
    time.sleep(delay_ms / 1000)
    route.continue_()


def _break_setup(route: Route) -> None:
    body = route.fetch().text()
    assert SETUP_ANCHOR in body, (
        f"{SETUP_ANCHOR!r} is gone from the worker bundle; engine-setup needs "
        "another way to fail after loadPyodide() resolves"
    )
    route.fulfill(
        body=body.replace(SETUP_ANCHOR, "import shinylive_no_such_module"),
        content_type="text/javascript",
    )
