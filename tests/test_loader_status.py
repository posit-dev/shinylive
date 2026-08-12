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


@pytest.mark.allow_page_errors
def test_missing_engine_asset_reports_the_status(page: Page, loader_delay: int) -> None:
    sabotage(page, "py", "engine-load", loader_delay)
    page.goto(app_url("py", "engine-load"))
    expect(page.locator(".error-message")).to_have_text("Error loading Python!")
    expect(page.locator(".error-log pre")).to_contain_text("404")


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
