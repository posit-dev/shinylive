"""The editor on the examples page: selecting an example, and running code.

Migrated from playwright/examples-viewer.spec.ts. These drive the site itself
rather than any one example app, so they run against the Python site only --
what is under test is the editor, not the engine behind it.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page
from playwright.sync_api import expect

from shinylive_app import (
    BASE_URL,
    MOD_KEY,
    terminal_text,
    wait_for_prompt,
    wait_until,
)

pytestmark = pytest.mark.site

EXAMPLES_URL = f"{BASE_URL}/py/examples/"


def test_selecting_an_example_updates_the_url(page: Page) -> None:
    page.goto(EXAMPLES_URL, wait_until="domcontentloaded")

    # Clicked as soon as the list renders, which is well before the engine has
    # finished booting: switching examples out from under a *running* app races
    # the outgoing one, as open_example()'s docstring describes.
    page.locator(".shinylive-example-selector h4.title", has_text="App with plot").click()

    expect(page).to_have_url(f"{EXAMPLES_URL}#app-with-plot")


def test_running_a_new_script_in_the_terminal(page: Page) -> None:
    page.goto(EXAMPLES_URL, wait_until="domcontentloaded")
    wait_for_prompt(page, "py")

    # Any name but app.py makes it a plain script rather than part of the app,
    # so Ctrl-Enter runs it in the terminal instead of restarting the app.
    page.get_by_label("Add a file").click()
    page.get_by_label("Name current file").fill("my_script.py")

    editor = page.locator(".cm-editor [role=textbox]")
    editor.press_sequentially('print("hello world")')
    # Mod-Enter runs the selection, or the current line when there is none.
    editor.press(f"{MOD_KEY}+Enter")

    expect_terminal_to_contain(page, '>>> print("hello world")')
    expect_terminal_to_contain(page, "hello world")


def expect_terminal_to_contain(page: Page, text: str) -> None:
    """Wait for `text` to appear in the shinylive terminal.

    The terminal is an xterm buffer rather than markup, so this polls the buffer
    instead of settling a locator the way playwright's expectations do.
    """
    wait_until(
        page,
        lambda: text in terminal_text(page),
        f"{text!r} never appeared in the terminal:\n{terminal_text(page)}",
    )
