"""The loading overlay and the error screens, per failure mode.

Replaces scripts/loader-demo.ts, which showed these by hand. See tests/README.md
for how to watch one in a browser.
"""

from __future__ import annotations

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
