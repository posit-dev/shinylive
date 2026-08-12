"""The loading overlay and the error screens, per failure mode.

Replaces scripts/loader-demo.ts, which showed these by hand. See tests/README.md
for how to watch one in a browser.
"""

from __future__ import annotations

from typing import cast

import pytest
from playwright.sync_api import Page, expect

from loader_apps import MISSING_PKG, app_url, sabotage

pytestmark = [pytest.mark.site, pytest.mark.loader]

ENGINE_LABEL = {"py": "Python", "r": "R"}


@pytest.mark.allow_page_errors
@pytest.mark.parametrize("engine", ["py", "r"])
@pytest.mark.parametrize("mode", ["engine-load", "engine-unreachable"])
def test_engine_failure_shows_the_recovery_hint(
    page: Page, engine: str, mode: str, loader_delay: int
) -> None:
    """An engine that cannot load names the engine and offers the hint.

    Absorbs viewer-error.test.tsx's first case. The hint is engine-only: an app
    error is the author's to fix, so a hard refresh would not help.
    """
    sabotage(page, engine, mode, loader_delay)
    page.goto(app_url(engine, mode))
    expect(page.locator(".error-message")).to_have_text(
        f"Error loading {ENGINE_LABEL[engine]}!"
    )
    expect(page.locator(".error-recovery")).to_be_visible()
    log = page.locator(".error-log pre")
    if mode == "engine-load":
        expect(log).to_contain_text("404")
    else:
        expect(log).to_contain_text("unreachable")


@pytest.mark.allow_page_errors
def test_engine_setup_failure_replies_instead_of_hanging(
    page: Page, loader_delay: int
) -> None:
    """Python only: webR has no setupPythonEnv() equivalent.

    This is the window where the worker holds a live pyodide but no pyUtils.
    Before the fix the error handler itself threw on the absent pyUtils, no
    reply was posted, and the loader spun forever -- so the assertion that
    matters is that an error screen appears at all.
    """
    sabotage(page, "py", "engine-setup", loader_delay)
    page.goto(app_url("py", "engine-setup"))
    expect(page.locator(".error-message")).to_have_text("Error loading Python!")
    expect(page.locator(".error-recovery")).to_be_visible()
    expect(page.locator(".error-log pre")).to_contain_text("ModuleNotFoundError")


@pytest.mark.allow_page_errors
@pytest.mark.parametrize("engine", ["py", "r"])
def test_app_syntax_error_shows_no_recovery_hint(
    page: Page, engine: str, loader_delay: int
) -> None:
    """Absorbs viewer-error.test.tsx's second and third cases."""
    sabotage(page, engine, "app-syntax", loader_delay)
    page.goto(app_url(engine, "app-syntax"))
    expect(page.locator(".error-message")).to_have_text("Error starting app!")
    expect(page.locator(".error-recovery")).to_have_count(0)
    expect(page.locator(".error-log pre")).not_to_be_empty()


@pytest.mark.allow_page_errors
def test_r_syntax_error_reports_the_line(page: Page, loader_delay: int) -> None:
    """shiny's sourceUTF8 catches the parse error and re-raises a bare
    "Error sourcing <file>". .start_app parses the app's files first so the real
    message survives; this asserts that it still does.
    """
    sabotage(page, "r", "app-syntax", loader_delay)
    page.goto(app_url("r", "app-syntax"))
    log = page.locator(".error-log pre")
    # The R fixture ships a second, valid .R file, so this also pins which of the
    # files the guard iterated is named as the one that failed.
    expect(log).to_contain_text("app.R:")
    expect(log).to_contain_text("^")
    # The guard re-raises without the condition's call, which would otherwise be
    # its own parse(file = f) -- a prefix naming our loop variable, in front of
    # the message that is the entire point of parsing here.
    expect(log).not_to_contain_text("Error in parse")


@pytest.mark.allow_page_errors
def test_r_failure_names_the_call(page: Page, loader_delay: int) -> None:
    """conditionMessage() drops conditionCall(), so the dialog said what failed
    but not which call failed. A failure inside a function the app author wrote
    is where the difference shows: R attaches that call to the condition.
    """
    sabotage(page, "r", "r-runtime-call", loader_delay)
    page.goto(app_url("r", "r-runtime-call"))
    expect(page.locator(".error-message")).to_have_text("Error starting app!")
    log = page.locator(".error-log pre")
    expect(log).to_contain_text("Error in load_data(")
    expect(log).to_contain_text("deliberate failure")
    # deparse() breaks a call wider than 60 characters across lines and
    # .start_app keeps only the first, so the app's last argument is past the
    # break: a dialog containing it would mean the truncation is gone.
    expect(log).not_to_contain_text("truncated_marker")


@pytest.mark.allow_page_errors
def test_r_top_level_failure_shows_only_the_message(
    page: Page, loader_delay: int
) -> None:
    """A top-level failure has no call of the author's to name: shiny evaluates
    every app body inside ..stacktraceon.., so that wrapper is the only call the
    condition carries, and deparsing it yields the whole app source.

    .start_app drops a call from that family, which leaves exactly what the
    dialog showed before it reported calls at all. The exact-text assertion is
    what rules out both the wrapper's name and the app source behind it.
    """
    sabotage(page, "r", "r-runtime", loader_delay)
    page.goto(app_url("r", "r-runtime"))
    expect(page.locator(".error-message")).to_have_text("Error starting app!")
    expect(page.locator(".error-log pre")).to_have_text("deliberate failure")


@pytest.mark.allow_page_errors
def test_python_unresolvable_requirement_fails_the_app(
    page: Page, loader_delay: int
) -> None:
    sabotage(page, "py", "requirements", loader_delay)
    page.goto(app_url("py", "requirements"))
    expect(page.locator(".error-message")).to_have_text("Error starting app!")


@pytest.mark.allow_page_errors
def test_r_unresolvable_library_still_runs(page: Page, loader_delay: int) -> None:
    """Deliberately not fatal (useWebR.tsx:371-376): renv::dependencies() also
    reports packages that are named but never used, and those apps run today.

    This opts out of conftest's fail_on_page_errors, so it asserts for itself
    which console error is acceptable: webr::install() warning that it could
    not find the never-used package, which reaches the console (rather than
    the shinylive terminal) because it fires before the Terminal component
    mounts and takes over App.tsx's "preload error:" fallback logger. Anything
    else -- an unrelated error, or this one going silent -- still fails the
    test.
    """
    from shinylive_app import wait_for_app_rendered

    errors: list[str] = []
    page.on(
        "console", lambda m: errors.append(m.text) if m.type == "error" else None
    )

    sabotage(page, "r", "requirements", loader_delay)
    page.goto(app_url("r", "requirements"))
    wait_for_app_rendered(page)
    expect(page.locator(".loading-wrapper-error")).to_have_count(0)

    # R prints this warning as two lines -- "Warning in webr::install(...) :"
    # and an indented message body -- each its own console.error() call, so
    # both need to pass. Every line goes through App.tsx's "preload error:"
    # fallback (see the docstring), and the body names the exact package this
    # sabotage() mode injects, which is what rules out an unrelated error
    # merely sharing that prefix.
    assert errors, "expected webr::install()'s not-found warning on the console"
    assert all(e.startswith("preload error:") for e in errors), errors
    combined = "\n".join(errors)
    missing_pkg_r_name = MISSING_PKG.replace("-", ".")
    assert "webr::install" in combined, combined
    assert f"{missing_pkg_r_name} not found in webR binary repo" in combined, combined


def test_an_unknown_mode_is_rejected_before_it_reaches_the_page() -> None:
    """A typo'd mode string should fail loudly at the call, not silently at
    the assertion. `_files()` and `sabotage()`'s guards run before either
    function touches a page, so this needs neither a browser nor
    `allow_page_errors`: the page passed to `sabotage()` here is a stand-in
    that would blow up if the guard did not raise first.
    """
    with pytest.raises(ValueError):
        app_url("py", "bogus-mode")
    with pytest.raises(ValueError):
        sabotage(cast(Page, None), "py", "bogus-mode", 0)
