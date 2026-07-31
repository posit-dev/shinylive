"""Smoke test for every app in examples/index.json, for both engines.

Each example is loaded by URL hash in its own page; see `open_example()` for why
the engine session is not shared between them.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import ConsoleMessage, Page
from playwright.sync_api import expect as playwright_expect

from shinylive_app import (
    APP_FRAME,
    ENGINES,
    example_app_titles,
    open_example,
    suspect_terminal_lines,
    terminal_text,
)

EXAMPLES = [(engine, title) for engine in ENGINES for title in example_app_titles(engine)]


@pytest.mark.parametrize(
    "engine,title", EXAMPLES, ids=[f"{engine}-{title}" for engine, title in EXAMPLES]
)
def test_example_app_starts_cleanly(page: Page, engine: str, title: str) -> None:
    console_errors: list[str] = []

    def on_console(message: ConsoleMessage) -> None:
        if message.type != "error":
            return
        # A missing favicon is not an app problem.
        if message.location["url"].endswith("favicon.ico"):
            return
        console_errors.append(message.text)

    page.on("console", on_console)
    page.on("pageerror", lambda error: console_errors.append(str(error)))

    open_example(page, engine, title)

    assert suspect_terminal_lines(terminal_text(page)) == [], (
        f"{title}: unexpected output in the shinylive terminal"
    )

    playwright_expect(
        page.frame_locator(APP_FRAME).locator(".shiny-output-error"),
        f"{title}: app rendered an output error",
    ).to_have_count(0)

    assert console_errors == [], f"{title}: browser console errors"
