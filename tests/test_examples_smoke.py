"""Smoke test for the apps in examples/index.json that no intent test covers.

Every intent test opens its example through `open_example()`, and the autouse
`fail_on_page_errors` fixture checks the terminal, the app's outputs and the
console after it -- which is all this smoke test does. So an example with an
intent test is already smoke-tested, and booting it a second time here would
only double the suite's run time. This test covers the rest: a new example
added without an intent test still has to start cleanly.

Each example is loaded by URL hash in its own page; see `open_example()` for why
the engine session is not shared between them.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page

from shinylive_app import (
    ENGINES,
    example_app_titles,
    open_example,
    titles_with_intent_tests,
)

pytestmark = pytest.mark.examples

EXAMPLES = [
    (engine, title)
    for engine in ENGINES
    for title in example_app_titles(engine)
    if title not in titles_with_intent_tests(engine)
]


@pytest.mark.parametrize(
    "engine,title", EXAMPLES, ids=[f"{engine}-{title}" for engine, title in EXAMPLES]
)
def test_example_app_starts_cleanly(page: Page, engine: str, title: str) -> None:
    # fail_on_example_errors fixture (autouse=true) will test for console errors.
    open_example(page, engine, title)
