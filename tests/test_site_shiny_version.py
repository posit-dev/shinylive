"""Pinning shiny to a bundled version: startup on the right lock, the fallback
when a lock is missing, the warning for pins outside the window, and an export
that includes one version under the default name.

The app shows the version the engine really loaded, so every assertion is on
`shiny.__version__` (or `packageVersion("shiny")`) as rendered in the iframe.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from playwright.sync_api import ConsoleMessage, Page, expect

from shinylive_app import (
    APP_FRAME,
    app_url_for_files,
    is_benign_console_error,
    terminal_text,
    wait_for_app_rendered,
)

pytestmark = pytest.mark.site

VERSIONS = json.loads(
    (Path(__file__).resolve().parent.parent / "shiny_versions.json").read_text()
)
PY_MINORS = VERSIONS["python"]
NEWEST_PY = next(iter(PY_MINORS.values()))
OLDEST_PY = list(PY_MINORS.values())[-1]

VERSION_APP_PY = """from shiny import App, ui
import shiny

app_ui = ui.page_fluid(ui.h1(shiny.__version__, id="version"))


def server(input, output, session):
    pass


app = App(app_ui, server)
"""


def py_files(pin: str | None) -> dict[str, str]:
    files = {"app.py": VERSION_APP_PY}
    if pin is not None:
        files["requirements.txt"] = f"{pin}\n"
    return files


def expect_running_version(page: Page, exact: str) -> None:
    wait_for_app_rendered(page)
    expect(page.frame_locator(APP_FRAME).locator("#version")).to_have_text(exact)


def collect_console_errors(page: Page) -> list[tuple[str, str]]:
    """Console errors from here on, as `(url, text)`, for tests that opt out of
    conftest's fail_on_page_errors.

    A lock probe that finds nothing is a 404, which Chromium reports on the
    console as "Failed to load resource". The tests that provoke one take this
    list and assert that the probe is the only error. The predicate shared with
    fail_on_page_errors forgives the same noise that fixture forgives.
    """
    errors: list[tuple[str, str]] = []

    def collect(message: ConsoleMessage) -> None:
        if message.type == "error" and not is_benign_console_error(message):
            errors.append((message.location["url"], message.text))

    page.on("console", collect)
    page.on("pageerror", lambda error: errors.append(("", str(error))))
    return errors


def expect_only_the_lock_probe_failed(
    errors: list[tuple[str, str]], minor: str
) -> None:
    lock = f"/pyodide-lock-shiny-{minor}.json"
    assert errors, f"expected the probe for {lock} to fail on the console"
    assert all(
        url.endswith(lock) and text.startswith("Failed to load resource")
        for url, text in errors
    ), errors


@pytest.mark.parametrize("minor", list(PY_MINORS))
def test_each_bundled_python_version_runs(page: Page, minor: str) -> None:
    exact = PY_MINORS[minor]
    page.goto(app_url_for_files("py", py_files(f"shiny=={exact}")))
    expect_running_version(page, exact)
    assert "requested shiny" not in terminal_text(page)


def test_an_unpinned_python_app_runs_the_newest(page: Page) -> None:
    page.goto(app_url_for_files("py", py_files(None)))
    expect_running_version(page, NEWEST_PY)


def test_a_pin_to_an_older_patch_reports_the_patch_it_runs(page: Page) -> None:
    # The oldest minor's exact version with its patch number changed. Every
    # bundled minor has exactly one patch, so this never matches.
    major, minor, patch = OLDEST_PY.split(".")
    requested = f"{major}.{minor}.{int(patch) + 7}"
    page.goto(app_url_for_files("py", py_files(f"shiny=={requested}")))
    expect_running_version(page, OLDEST_PY)
    assert f"requested shiny {requested}, running {OLDEST_PY}" in terminal_text(page)


def test_a_pin_outside_the_window_runs_the_closest_and_warns(page: Page) -> None:
    page.goto(app_url_for_files("py", py_files("shiny==0.1.0")))
    expect_running_version(page, OLDEST_PY)
    assert "shiny 0.1.0 is outside the bundled versions" in terminal_text(page)


@pytest.mark.allow_page_errors
def test_a_missing_lock_falls_back_to_the_newest_with_a_warning(page: Page) -> None:
    oldest_minor = list(PY_MINORS)[-1]
    errors = collect_console_errors(page)
    # The runtime probes the per-version lock with a HEAD request; a 404 is
    # what an export without that version looks like.
    page.route(
        f"**/pyodide-lock-shiny-{oldest_minor}.json",
        lambda r: r.fulfill(status=404, body=""),
    )
    page.goto(app_url_for_files("py", py_files(f"shiny=={OLDEST_PY}")))
    expect_running_version(page, NEWEST_PY)
    assert f"requested shiny {OLDEST_PY}, running {NEWEST_PY}" in terminal_text(page)
    expect_only_the_lock_probe_failed(errors, oldest_minor)


@pytest.mark.allow_page_errors
def test_an_export_of_a_pinned_app_runs_that_version_quietly(
    page: Page, exported_app: Callable[..., str]
) -> None:
    oldest_minor = list(PY_MINORS)[-1]
    errors = collect_console_errors(page)
    warnings: list[str] = []

    def on_console(message: ConsoleMessage) -> None:
        if message.type == "warning" and "requested shiny" in message.text:
            warnings.append(message.text)

    page.on("console", on_console)
    url = exported_app(
        py_files(f"shiny=={OLDEST_PY}"), name="pinned", shiny_minor=oldest_minor
    )
    page.goto(url)
    expect_running_version(page, OLDEST_PY)
    assert warnings == []
    expect_only_the_lock_probe_failed(errors, oldest_minor)
