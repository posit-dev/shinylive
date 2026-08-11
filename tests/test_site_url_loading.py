"""Apps loaded from the URL, and the options that come with them.

Migrated from playwright/load-from-url.spec.ts. The editor, examples and app
pages all set `allowCodeUrl`, so each of them will run an app that arrives in the
URL hash; only the app page honours the `h=0` option that hides the header bar.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page
from playwright.sync_api import expect

from shinylive_app import APP_FRAME, BASE_URL, wait_for_app_rendered

pytestmark = pytest.mark.site

# The lz-string-compressed hash the site decodes into this app:
#
#     from shiny import App, render, ui
#
#     app_ui = ui.page_fluid(
#         ui.h1("Code from a url")
#     )
#
#     def server(input, output, session):
#         pass
#
#     app = App(app_ui, server)
#
# Carried over verbatim from the spec this replaces. The tests below assert on
# both the source and the rendered heading, so a change to the encoding that
# stopped it decoding would fail here rather than pass vacuously.
APP_URL_HASH = (
    "code=NobwRAdghgtgpmAXGKAHVA6VBPMAaMAYwHsIAXOcpMAMwCdiYACAZwAsBLCbJjmVYnTJ"
    "MAgujxM6lACZw6EgK4cAOhFVpUAfSVMAvEyVYoAcziaaAGyXSAFKqYODHDGwCMdsAGFispvUZ"
    "MUAZ0FspgAJSqkWoQsjSscgBucjZcqApkEsQZ6ZkJLCwcpOGI9o6oUAVlDuroeqLoNhraHBIs"
    "SXLRYAC+ALpAA"
)

APP_SOURCE = 'ui.h1("Code from a url")'
APP_HEADING = "Code from a url"

# Looks for the shiny logo.
HEADER_BAR = '.HeaderBar img[alt="Shiny"]'


def expect_editor_to_show_the_app(page: Page) -> None:
    expect(page.locator(".shinylive-editor", has_text=APP_SOURCE)).to_be_visible()


def expect_app_to_render(page: Page) -> None:
    wait_for_app_rendered(page)
    expect(
        page.frame_locator(APP_FRAME).locator("h1", has_text=APP_HEADING)
    ).to_be_visible()


@pytest.mark.parametrize("view", ["editor", "examples"])
def test_an_editor_view_runs_an_app_from_the_url(page: Page, view: str) -> None:
    page.goto(f"{BASE_URL}/py/{view}/#{APP_URL_HASH}")

    if view == "examples":
        # The two views' editor and app panes are identical, so without this the
        # examples case could be testing the editor page and nobody would know.
        expect(page.locator(".shinylive-example-selector")).to_be_visible()

    expect_editor_to_show_the_app(page)
    expect_app_to_render(page)


def test_the_app_view_runs_an_app_from_the_url(page: Page) -> None:
    page.goto(f"{BASE_URL}/py/app/#{APP_URL_HASH}")

    expect_app_to_render(page)


@pytest.mark.parametrize("view", ["editor", "examples"])
def test_h0_does_not_hide_the_header_bar_in_an_editor_view(
    page: Page, view: str
) -> None:
    page.goto(f"{BASE_URL}/py/{view}/#h=0&{APP_URL_HASH}")

    expect(page.locator(HEADER_BAR)).to_be_visible()


def test_the_app_view_shows_the_header_bar_by_default(page: Page) -> None:
    page.goto(f"{BASE_URL}/py/app/#{APP_URL_HASH}")

    expect(page.locator(HEADER_BAR)).to_be_visible()


def test_h0_hides_the_header_bar_in_the_app_view(page: Page) -> None:
    page.goto(f"{BASE_URL}/py/app/#h=0&{APP_URL_HASH}")

    expect_app_to_render(page)
    expect(page.locator(HEADER_BAR)).not_to_be_visible()
