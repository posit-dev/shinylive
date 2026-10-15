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
    MOD_KEY,
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


PICKER = 'select[aria-label="Shiny version"]'
# The file tab list in FileTabs.tsx; each tab's name sits in .editor-filename.
REQUIREMENTS_TAB = (
    ".shinylive-editor .editor-files .editor-filename:has-text('requirements.txt')"
)
# Editor.tsx labels the button "Re-run app (<mod>-Shift-Enter)"; the modifier varies by platform.
RERUN_BUTTON = '.shinylive-editor button[aria-label^="Re-run app"]'


def test_the_picker_switches_the_version_and_writes_the_pin(page: Page) -> None:
    page.goto(app_url_for_files("py", py_files(None)))
    expect_running_version(page, NEWEST_PY)
    expect(page.locator(PICKER)).to_have_value(NEWEST_PY)
    expect(page.locator(".HeaderBar .latest-badge")).to_be_visible()

    page.select_option(PICKER, OLDEST_PY)
    # The engine restarts: the loader shows, then the app comes back on the
    # other version.
    expect(page.locator(".shinylive-viewer .loading-status")).to_be_visible()
    expect_running_version(page, OLDEST_PY)
    expect(page.locator(PICKER)).to_have_value(OLDEST_PY)
    expect(page.locator(".HeaderBar .latest-badge")).to_have_count(0)

    page.locator(REQUIREMENTS_TAB).click()
    expect(page.locator(".shinylive-editor .cm-content")).to_contain_text(
        f"shiny=={OLDEST_PY}"
    )
    assert "requested shiny" not in terminal_text(page)
    assert "#code=" in page.url


def test_the_picker_is_disabled_while_the_engine_starts(page: Page) -> None:
    page.goto(app_url_for_files("py", py_files(None)))
    expect(page.locator(PICKER)).to_be_disabled()
    expect_running_version(page, NEWEST_PY)
    expect(page.locator(PICKER)).to_be_enabled()


def test_editing_the_pin_and_rerunning_restarts_the_engine(page: Page) -> None:
    page.goto(
        app_url_for_files(
            "py", {**py_files(None), "requirements.txt": f"shiny=={NEWEST_PY}\n"}
        )
    )
    expect_running_version(page, NEWEST_PY)

    page.locator(REQUIREMENTS_TAB).click()
    editor = page.locator(".shinylive-editor .cm-content")
    editor.click()
    page.keyboard.press(f"{MOD_KEY}+a")
    page.keyboard.type(f"shiny=={OLDEST_PY}")
    page.locator(RERUN_BUTTON).click()

    expect_running_version(page, OLDEST_PY)
    expect(page.locator(PICKER)).to_have_value(OLDEST_PY)


def test_the_picker_does_not_appear_without_the_option(page: Page) -> None:
    # The app view renders the same header bar, but never sets showVersionPicker.
    page.goto(app_url_for_files("py", py_files(None), view="app"))
    expect(page.locator(".HeaderBar")).to_be_visible()
    expect(page.locator(PICKER)).to_have_count(0)


QUARTO_BLOCK = """#| standalone: true
#| components: [editor, terminal, viewer]
#| shiny-version: "{minor}"
## file: app.py
{app}"""


def test_a_quarto_embed_honors_shiny_version_and_has_no_picker(
    page: Page, quarto_page: Callable[..., str]
) -> None:
    oldest_minor = list(PY_MINORS)[-1]
    page.goto(quarto_page(QUARTO_BLOCK.format(minor=oldest_minor, app=VERSION_APP_PY)))
    expect_running_version(page, OLDEST_PY)
    expect(page.locator(".HeaderBar")).to_be_visible()
    expect(page.locator(PICKER)).to_have_count(0)
    page.locator(REQUIREMENTS_TAB).click()
    expect(page.locator(".shinylive-editor .cm-content")).to_contain_text(
        f"shiny=={OLDEST_PY}"
    )


@pytest.mark.allow_page_errors
def test_an_unquoted_shiny_version_is_rejected(
    page: Page, quarto_page: Callable[..., str]
) -> None:
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    block = QUARTO_BLOCK.replace('"{minor}"', "1.10").format(
        minor="", app=VERSION_APP_PY
    )
    page.goto(quarto_page(block, name="quarto-unquoted"))
    page.wait_for_timeout(2000)
    assert any("shiny-version option must be a quoted string" in e for e in errors), (
        errors
    )


def test_two_apps_on_one_page_share_the_engine_and_show_the_notice(
    page: Page, quarto_page: Callable[..., str]
) -> None:
    newest_minor = next(iter(PY_MINORS))
    oldest_minor = list(PY_MINORS)[-1]
    first = QUARTO_BLOCK.replace("[editor, terminal, viewer]", "[viewer]").format(
        minor=newest_minor, app=VERSION_APP_PY
    )
    second = QUARTO_BLOCK.replace("[editor, terminal, viewer]", "[viewer]").format(
        minor=oldest_minor, app=VERSION_APP_PY
    )
    url = quarto_page(first, name="quarto-two")
    page.goto(url)
    # The helper writes one block per page; the second is appended here and
    # processed by loading run-python-blocks.js again.
    page.evaluate(
        """(block) => {
            const pre = document.createElement("pre");
            pre.className = "shinylive-python";
            pre.style.height = "400px";
            pre.textContent = block;
            document.body.appendChild(pre);
            const s = document.createElement("script");
            s.type = "module";
            s.src = "./shinylive/run-python-blocks.js?second";
            document.body.appendChild(s);
        }""",
        second,
    )
    frames = page.locator(APP_FRAME)
    expect(frames).to_have_count(2)
    expect(frames.nth(1).content_frame.locator("#version")).to_have_text(NEWEST_PY)
    expect(page.locator(".shinylive-version-notice")).to_have_text(
        f"This app requests shiny {oldest_minor}; this page runs {newest_minor}."
    )
