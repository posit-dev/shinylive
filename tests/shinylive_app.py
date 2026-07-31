"""Loading shinylive's example apps, and handing them to Shiny's controllers.

The tests drive apps through `shiny.playwright.controller`, the same controllers
py-shiny uses for its own tests. See ./README.md.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from playwright.sync_api import FrameLocator, Locator, Page
from playwright.sync_api import expect as playwright_expect
from shiny.playwright.controller import OutputPlot as OutputPlotBase

# Where `make _shinylive` puts the built sites.
SHINYLIVE_DIR = Path(__file__).resolve().parent.parent / "_shinylive"

STATIC_PORT = 8100
BASE_URL = f"http://127.0.0.1:{STATIC_PORT}"

# The iframe shinylive renders the app into.
APP_FRAME = ".app-frame"

ENGINES = ("py", "r")

# Categories whose entries are not Shiny apps and so have nothing to test --
# selecting them loads a plain script into the editor and never starts an app.
NON_APP_CATEGORIES = ("Non-Apps",)


# ---------------------------------------------------------------------------
# The app under test
# ---------------------------------------------------------------------------


class ShinyliveApp:
    """The example app inside shinylive's iframe, in the shape of a `Page`.

    Shiny's controllers take a `Page`, because in py-shiny's own tests the app
    under test *is* the page. Shinylive renders it into an iframe instead.

    The controllers only ever reach for four things on that object: `locator()`,
    `keyboard`, `wait_for_timeout()` and `evaluate()`. Only the first has to be
    frame-relative -- keyboard and mouse events belong to the page whatever they
    are aimed at -- so this forwards `locator()` to the frame and everything else
    to the page underneath.
    """

    def __init__(self, page: Page) -> None:
        self.page = page
        self.frame: FrameLocator = page.frame_locator(APP_FRAME)

    def locator(self, *args: Any, **kwargs: Any) -> Locator:
        return self.frame.locator(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.page, name)


# ---------------------------------------------------------------------------
# The example index
# ---------------------------------------------------------------------------


def sanitize_title_for_url(title: str) -> str:
    """Kept in sync by hand with `sanitizeTitleForUrl()` in src/examples.ts.

    `open_example()` asserts that the example the site actually selected is the
    one we asked for, so drift here fails loudly rather than silently testing the
    wrong app.
    """
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"[\s/]", "-", title.lower()))


def read_examples_json(engine: str) -> dict[str, Any]:
    """The examples.json that shipped in the built site.

    Reading the built file rather than examples/index.json means the test list
    matches exactly what the site serves, and `examples-check-index` already
    guarantees the two agree.
    """
    path = SHINYLIVE_DIR / engine / "shinylive" / "examples.json"
    if not path.exists():
        raise RuntimeError(
            f"{path} not found. Run `make all` before the example app tests."
        )
    engine_name = "python" if engine == "py" else "r"
    for entry in json.loads(path.read_text()):
        if entry["engine"] == engine_name:
            return entry
    raise RuntimeError(f"No {engine_name} examples found in {path}")


def example_app_titles(engine: str) -> list[str]:
    """Titles of every app worth testing, in the order the site lists them."""
    return [
        app["title"]
        for category in read_examples_json(engine)["examples"]
        if category["category"] not in NON_APP_CATEGORIES
        for app in category["apps"]
    ]


# ---------------------------------------------------------------------------
# Loading an example
# ---------------------------------------------------------------------------


def open_example(page: Page, engine: str, title: str) -> Page:
    """Open one example in a fresh page and wait for its app to render.

    The return value is the running app, ready to hand to a controller. It is a
    `ShinyliveApp`; the cast is here rather than at every call site, because
    every controller wants a `Page`.

    Every example gets its own page rather than sharing one warm engine session.
    A warm session is faster in principle, but switching examples inside one
    races against the outgoing app: pending proxied requests hit a
    `_shiny_app_registry` key that has already been swapped (Python) or get a
    null channel response (webR), both of which surface as console errors that
    have nothing to do with the example. Serving from a local static file server
    makes a cold boot cheap enough -- a couple of seconds for Pyodide, a few for
    webR -- that isolation is the better trade.
    """
    url = f"{BASE_URL}/{engine}/examples/#{sanitize_title_for_url(title)}"
    page.goto(url, wait_until="domcontentloaded")

    _wait_for_prompt(page, engine)

    # App.tsx falls back to the first example when a hash does not resolve, so
    # without this a typo would silently test the same app over and over.
    playwright_expect(
        page.locator(".shinylive-example-selector .example.selected h4.title"),
        f'expected the "{title}" example to be selected',
    ).to_have_text(title)

    _wait_for_app_rendered(page)

    return cast(Page, ShinyliveApp(page))


def _wait_for_prompt(page: Page, engine: str) -> None:
    """Wait for the REPL prompt, which means the engine has finished booting."""
    page.wait_for_function(
        # Python's prompt is ">>>", R's is ">".
        """(prompt) => {
            const div = document.querySelector(".shinylive-terminal");
            // xterm is attached to the element by Terminal.tsx.
            const xterm = div?.xterm;
            if (!xterm) return false;
            for (let i = 0; ; i++) {
                const line = xterm.buffer.normal.getLine(i);
                if (!line) return false;
                if (line.translateToString().includes(prompt)) return true;
            }
        }""",
        arg=">>>" if engine == "py" else ">",
        # webR is a much bigger download than Pyodide and boots correspondingly
        # slower, especially on a cold CI runner.
        timeout=5 * 60 * 1000,
    )


def _wait_for_app_rendered(page: Page) -> None:
    """Wait for the app iframe to render something."""
    body = page.frame_locator(APP_FRAME).locator("body")
    error_log = page.locator(".shinylive-viewer .loading-wrapper-error .error-log pre")

    deadline = 3 * 60 * 1000
    waited = 0
    while waited < deadline:
        # Surface shinylive's own "Error starting app!" panel as soon as it
        # appears instead of waiting out the full timeout on an empty iframe.
        if error_log.count() > 0:
            raise AssertionError(
                f"shinylive failed to start the app: {error_log.inner_text()}"
            )
        try:
            if body.inner_text(timeout=1000).strip():
                break
        except Exception:
            pass
        page.wait_for_timeout(250)
        waited += 250
    else:
        raise AssertionError("app iframe never rendered anything")

    # Outputs render after the initial UI, and warnings reach the terminal later
    # still, so give both a moment to land.
    page.wait_for_timeout(2500)


# ---------------------------------------------------------------------------
# Terminal
# ---------------------------------------------------------------------------


def terminal_text(page: Page) -> str:
    """Everything the engine has written to the shinylive terminal.

    The body runs inside the page, so it cannot reference anything else in this
    file. Components/Terminal.tsx attaches the xterm object to the container
    element, which is the only handle we have on the buffer.

    xterm hard-wraps long lines, so one message can span several buffer lines.
    The continuations get rejoined here, otherwise we would be pattern-matching
    against half a warning at a time.
    """
    lines: list[str] = page.evaluate(
        """() => {
            const div = document.querySelector(".shinylive-terminal");
            const xterm = div?.xterm;
            if (!xterm) return [];
            const out = [];
            for (let i = 0; ; i++) {
                const line = xterm.buffer.normal.getLine(i);
                if (!line) break;
                const text = line.translateToString(true);
                if (line.isWrapped && out.length > 0) {
                    out[out.length - 1] += text;
                } else {
                    out.push(text);
                }
            }
            return out;
        }"""
    )
    return "\n".join(lines)


# Terminal output worth a human looking at.
#
# This is a deny-list rather than an allow-list of benign output: normal
# shinylive chatter (package loading, R startup banners, an app's own print()
# calls) is open-ended, but the failure signatures we care about are not.
#
# Note that this carries much less weight for R than for Python. Pyodide wires
# Python's stderr to the terminal (see App.tsx), so warnings and tracebacks land
# here; webR apps write nothing to it at all. R coverage comes from the output
# error and console error assertions instead.
_SUSPECT_PATTERNS = [
    re.compile(r"Traceback"),
    re.compile(r"Exception"),
    re.compile(r"\bError\b", re.IGNORECASE),
    re.compile(r"Warning\b"),
    re.compile(r"Deprecat", re.IGNORECASE),
]

# Lines matching _SUSPECT_PATTERNS that are known to be benign. Several examples
# run with `App(..., debug=True)`, which echoes every websocket frame to the
# terminal. Those frames carry an `"errors": {}` key and arbitrary app values, so
# they match the deny-list on content rather than on any real problem.
_ALLOWED_PATTERNS = [re.compile(r"^SEND: "), re.compile(r"^RECV: ")]


def suspect_terminal_lines(terminal: str) -> list[str]:
    return [
        line
        for line in (raw.strip() for raw in terminal.split("\n"))
        if line
        and any(p.search(line) for p in _SUSPECT_PATTERNS)
        and not any(p.search(line) for p in _ALLOWED_PATTERNS)
    ]


# ---------------------------------------------------------------------------
# Interacting with plots
# ---------------------------------------------------------------------------


def expect_plot_to_redraw(plot: OutputPlotBase, action: Callable[[], object]) -> None:
    """Run `action` and expect the plot to be redrawn.

    Both engines send plots down as inline base64 images, so a new `src` means
    the app really re-ran the plotting code.
    """
    before = plot.loc_img.get_attribute("src")
    action()
    playwright_expect(
        plot.loc_img, "expected the plot to be redrawn"
    ).not_to_have_attribute("src", before or "")


def brush(
    page: Page, plot: OutputPlotBase, x1: float, y1: float, x2: float, y2: float
) -> None:
    """Drag a brush across part of an interactive plot.

    The corners are fractions of the rendered image, so the region covers the
    same part of the data whatever size the plot came back at. Keep them well
    inside the image: Shiny ignores a drag that starts outside the plotting
    panel, so a brush begun in the axis margin silently does nothing.
    """
    plot.loc_img.scroll_into_view_if_needed()
    box = plot.loc_img.bounding_box()
    assert box is not None, f"plot #{plot.id} has no bounding box"

    def at(fx: float, fy: float) -> tuple[float, float]:
        return box["x"] + fx * box["width"], box["y"] + fy * box["height"]

    page.mouse.move(*at(x1, y1))
    page.mouse.down()
    # Two moves: shiny's brush handler needs to see the drag, not just the end.
    page.mouse.move(*at((x1 + x2) / 2, y2))
    page.mouse.move(*at(x2, y2))
    page.mouse.up()
    # Shiny debounces brush input by 300ms, so the coordinates have not reached
    # the server yet when the mouse comes up.
    page.wait_for_timeout(500)


def wait_until(page: Page, predicate: Callable[[], bool], message: str) -> None:
    """Poll `predicate` until it holds, or fail with `message`.

    For the handful of assertions that are about a value changing rather than a
    locator settling, which is all playwright's own expectations cover.
    """
    for _ in range(60):
        if predicate():
            return
        page.wait_for_timeout(500)
    raise AssertionError(message)


def wait_for_input_debounce(page: Page) -> None:
    """Let a just-changed input reach the server.

    Shiny debounces slider input by 250ms, and flushes mid-drag as well as on
    release, so an action taken immediately after `InputSlider.set()` can be
    processed while the server still holds an earlier value from the drag. Only
    needed when nothing observable confirms the new value has landed -- an app
    that renders it will settle on its own.
    """
    page.wait_for_timeout(500)
