"""Smoke test for every app in examples/index.json, for both engines.

Each example is loaded by URL hash in its own page; see `open_example()` for why
the engine session is not shared between them.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page

from shinylive_app import ENGINES, example_app_titles, open_example

pytestmark = pytest.mark.examples

EXAMPLES = [(engine, title) for engine in ENGINES for title in example_app_titles(engine)]


@pytest.mark.parametrize(
    "engine,title", EXAMPLES, ids=[f"{engine}-{title}" for engine, title in EXAMPLES]
)
def test_example_app_starts_cleanly(page: Page, engine: str, title: str) -> None:
    # fail_on_example_errors fixture (autouse=true) will test for console errors.
    open_example(page, engine, title)
