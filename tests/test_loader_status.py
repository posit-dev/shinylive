"""The loading overlay and the error screens, per failure mode.

Replaces scripts/loader-demo.ts, which showed these by hand. See tests/README.md
for how to watch one in a browser.
"""

from __future__ import annotations

from typing import cast

import pytest
from playwright.sync_api import Page, expect

from loader_apps import app_url, sabotage

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

    Whether `page.route()` can even intercept the worker script (loaded via
    `importScripts()`/`new Worker()`, not `fetch()`) is an open question this
    test resolves: `sabotage()`'s handler installs first, then a second handler
    on the same glob is layered on top of it purely to observe that *some*
    handler ran for that URL before falling back to the real one. If neither
    fires, `fired` stays empty and the assertion below -- not a silently-passing
    page -- is what reports it.
    """
    sabotage(page, "py", "engine-setup", loader_delay)
    fired = []
    page.route(
        "**/pyodide-worker.js",
        lambda route: (fired.append(route.request.url), route.fallback()),
    )
    page.goto(app_url("py", "engine-setup"))
    expect(page.locator(".error-message")).to_have_text("Error loading Python!")
    expect(page.locator(".error-log pre")).to_contain_text("ModuleNotFoundError")
    assert fired, (
        "no request for pyodide-worker.js was ever intercepted by page.route()"
    )


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
