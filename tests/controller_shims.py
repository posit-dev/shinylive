"""The few places Shiny's controllers need adjusting for these apps.

Everything else in the tests uses `shiny.playwright.controller` unchanged. Each
shim here exists for one of two reasons: R writes different markup from Python
for the same component, or an example app leaves a component's `id` unset and the
controller keys on it.
"""

from __future__ import annotations

import re
from typing import Optional

from playwright.sync_api import Locator, Page
from playwright.sync_api import expect as playwright_expect
from shiny.playwright import controller
from shiny.playwright.expect import expect_to_have_style

# py-shiny spells this `shiny.playwright._types.Timeout`, which is private.
Timeout = Optional[float]


class OutputPlot(controller.OutputPlot):
    """`controller.OutputPlot`, for plots from either engine.

    py-shiny keys on `.shiny-image-output.shiny-plot-output`, which holds for
    `ui.output_plot()`. R's `plotOutput()` writes only the second of those.
    """

    def __init__(self, page: Page, id: str) -> None:
        super().__init__(page, id)
        self.loc = page.locator(f"#{id}.shiny-plot-output")
        self.loc_img = self.loc.locator("img")

    def expect_rendered(self, *, timeout: Timeout = None) -> None:
        """Expect that a plot was actually drawn.

        Both engines render matplotlib and base R plots to an inline base64 PNG,
        so a visible `<img>` with a data URL means the plot round-tripped through
        the app rather than the element merely existing.
        """
        playwright_expect(self.loc_img).to_be_visible(timeout=timeout)
        self.expect_img_src(re.compile(r"^data:image/"), timeout=timeout)


class NavPanel(controller.NavPanel):
    """`controller.NavPanel` for a navset that has no `id`.

    py-shiny keys on `ul#{id}`. None of shinylive's examples give their navsets
    an id, so this keys on the `data-tabsetid` bslib always writes, picking the
    `nth` navset in the app when there is more than one.
    """

    def __init__(self, page: Page, panel_value: str, *, nth: int = 0) -> None:
        # The id is only used to build locators, both of which are replaced here.
        super().__init__(page, id="navset", panel_value=panel_value)
        self.loc_container = page.locator("ul.nav[data-tabsetid]").nth(nth)
        self.loc = self.loc_container.locator(
            f"a[role='tab'][data-value='{panel_value}']"
        )

    def click(self, *, timeout: Timeout = None) -> None:
        """Expand a collapsed navbar, then click as py-shiny does.

        `navbar-expand-md` collapses below 768px and the app iframe is narrower
        than that at shinylive's default split, so the tabs of a `page_navbar()`
        or `navset_bar()` start hidden behind a hamburger. py-shiny's `click()`
        has the equivalent for tabs nested in a dropdown.
        """
        if not self.loc.is_visible():
            self._expand_navbar(timeout=timeout)
        super().click(timeout=timeout)

    def _expand_navbar(self, *, timeout: Timeout = None) -> None:
        collapse = self.loc_container.locator(
            "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '),"
            " ' navbar-collapse ')][1]"
        )
        if collapse.count() == 0:
            return
        collapse_id = collapse.get_attribute("id", timeout=timeout)
        toggler = self.page.locator(
            "button.navbar-toggler"
            if collapse_id is None
            else f"button.navbar-toggler[data-bs-target='#{collapse_id}']"
        )
        if toggler.count() == 0:
            return
        toggler.click(timeout=timeout)
        playwright_expect(self.loc).to_be_visible(timeout=timeout)


def sidebar(page: Page, *, nth: int = 0) -> controller.Sidebar:
    """`controller.Sidebar` for a sidebar whose id bslib generated.

    py-shiny keys on `aside#{id}`; these apps call `sidebar()` without an id, so
    the id only exists once the page has rendered.
    """
    aside = page.locator("div.bslib-sidebar-layout > aside.sidebar").nth(nth)
    aside_id = aside.get_attribute("id")
    if aside_id is None:
        raise AssertionError("sidebar has no id to key on")
    return controller.Sidebar(page, aside_id)


class InputSelectize(controller.InputSelectize):
    """`controller.InputSelectize` that dismisses its dropdown with Escape.

    `expect_choices()` and `expect_choice_labels()` have to open the dropdown
    first, because selectize builds it lazily. py-shiny then closes it by
    clicking the page body, which clicks whatever sits at the centre of the app;
    the dropdown is full-width and sits directly under the input, so in a short
    app that is the dropdown itself, and it never closes. Escape closes it
    wherever it is -- which is what the upstream docstring says it does.
    """

    # Assigned in py-shiny's __init__, but absent from the type stubs, so restate
    # them for the benefit of a type checker.
    _loc_dropdown: Locator
    _loc_events: Locator

    def _populate_dom(self, timeout: Timeout = None) -> None:
        self._loc_events.click(timeout=timeout)
        expect_to_have_style(self._loc_dropdown, "display", "block", timeout=timeout)
        self._loc_events.press("Escape", timeout=timeout)
        expect_to_have_style(self._loc_dropdown, "display", "none", timeout=timeout)
