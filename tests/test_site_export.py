"""Static exports: the app page, its editor page, and the editor-cell mode.

Migrated from playwright/shiny-static.spec.ts and playwright/editor-cell.spec.ts,
which needed `shinylive export` from the Python shinylive package to produce an
export to test. `tests/export_app.py` assembles one from `build/` instead; see
its docstring for why that is enough.

The app mode comes from the `?_shinylive-mode=` query string, which is where
`runExportedApp()` reads it from. The specs replaced here patched the exported
`index.html` with `sed -e 's/viewer/editor-cell/'`, which had not matched
anything in `export_template/index.html` for a long time.
"""

from __future__ import annotations

from typing import Callable

import pytest
from playwright.sync_api import Page
from playwright.sync_api import expect

from export_app import EDITOR_CELL_MODE
from shinylive_app import APP_FRAME, wait_for_app_rendered

pytestmark = pytest.mark.site

APP_HEADING = "Hello Shiny-Static!"
APP_SOURCE = f'ui.h2("{APP_HEADING}")'

STATIC_APP = {
    "app.py": f"""from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.h2("{APP_HEADING}"),
    ui.input_slider("n", "N", 0, 100, 20),
    ui.output_text_verbatim("txt"),
)


def server(input, output, session):
    @render.text
    def txt():
        return f"n*2 is {{input.n() * 2}}"


app = App(app_ui, server)
"""
}

# Any name but app.py keeps this a plain script rather than a Shiny app, which
# is what the editor-cell mode runs.
CELL_APP = {"code.py": "123 + 456"}

# The hash from test_site_url_loading.py, which an export must ignore.
APP_FROM_URL_HASH = (
    "code=NobwRAdghgtgpmAXGKAHVA6VBPMAaMAYwHsIAXOcpMAMwCdiYACAZwAsBLCbJjmVYnTJ"
    "MAgujxM6lACZw6EgK4cAOhFVpUAfSVMAvEyVYoAcziaaAGyXSAFKqYODHDGwCMdsAGFispvUZ"
    "MUAZ0FspgAJSqkWoQsjSscgBucjZcqApkEsQZ6ZkJLCwcpOGI9o6oUAVlDuroeqLoNhraHBIs"
    "SXLRYAC+ALpAA"
)

# Looks for the shiny logo.
HEADER_BAR = '.HeaderBar img[alt="Shiny"]'

# An export downloads and boots a whole engine before it renders anything, which
# is slower than the assertion timeout allows for on a cold CI runner.
ENGINE_BOOT_MS = 3 * 60 * 1000


@pytest.fixture
def static_app(exported_app: Callable[..., str]) -> str:
    return exported_app(STATIC_APP, name="static-app")


@pytest.fixture
def cell_app(exported_app: Callable[..., str]) -> str:
    return exported_app(CELL_APP, name="editor-cell")


def expect_app_to_render(page: Page) -> None:
    wait_for_app_rendered(page)
    expect(page.frame_locator(APP_FRAME).get_by_text(APP_HEADING)).to_be_visible()


def test_the_export_root_serves_the_app(page: Page, static_app: str) -> None:
    page.goto(static_app)

    expect_app_to_render(page)


def test_the_edit_path_serves_the_editor(page: Page, static_app: str) -> None:
    page.goto(f"{static_app}edit/")

    # edit/index.html is a redirect, and the mode it redirects to is the whole
    # point of it.
    expect(page).to_have_url(
        f"{static_app}index.html?_shinylive-mode=editor-terminal-viewer"
    )
    expect(
        page.locator(".shinylive-editor", has_text=APP_SOURCE)
    ).to_be_visible(timeout=ENGINE_BOOT_MS)
    expect_app_to_render(page)


def test_an_export_ignores_an_app_in_the_url(page: Page, static_app: str) -> None:
    page.goto(f"{static_app}edit/#{APP_FROM_URL_HASH}")

    # An export runs the files it shipped with. It never sets `allowCodeUrl`, so
    # a deployed app cannot be replaced by whatever a link happens to carry.
    expect(
        page.locator(".shinylive-editor", has_text=APP_SOURCE)
    ).to_be_visible(timeout=ENGINE_BOOT_MS)
    expect(
        page.locator(".shinylive-editor", has_text='ui.h1("Code from a url")')
    ).not_to_be_visible()
    expect_app_to_render(page)


@pytest.mark.parametrize("fragment", ["", "#h=0"])
def test_the_export_app_page_never_shows_the_header_bar(
    page: Page, static_app: str, fragment: str
) -> None:
    # `h=0` is an option of the hosted app page, and an export has no header bar
    # to hide either way.
    page.goto(f"{static_app}{fragment}")

    expect_app_to_render(page)
    expect(page.locator(HEADER_BAR)).not_to_be_visible()


def test_the_editor_cell_mode_runs_the_exported_script(
    page: Page, cell_app: str
) -> None:
    page.goto(f"{cell_app}?_shinylive-mode={EDITOR_CELL_MODE}")

    expect(page.locator(".shinylive-editor")).to_contain_text("123 + 456")
    expect(page.locator("pre.output-content")).to_be_visible(timeout=ENGINE_BOOT_MS)
    expect(page.locator("code.output-content")).to_contain_text("579")
