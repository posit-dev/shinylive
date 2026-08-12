"""The loading overlay and the error screens, per failure mode.

Replaces scripts/loader-demo.ts, which showed these by hand. See tests/README.md
for how to watch one in a browser.
"""

from __future__ import annotations

import uuid
from typing import Iterator, cast

import pytest
from playwright.sync_api import Page, expect

from loader_apps import MISSING_PKG, _files, app_url, sabotage
from shinylive_app import BASE_URL, SHINYLIVE_DIR

pytestmark = [pytest.mark.site, pytest.mark.loader]

ENGINE_LABEL = {"py": "Python", "r": "R"}

# Installed with `page.add_init_script()`, before either of `sabotage("off",
# ...)`'s two delays has a chance to fire (see the docstring on
# test_slow_load_announces_its_stages for why that matters). Records every
# change to the loader's own DOM with a timestamp, in the page rather than in
# this process, so the recording is immune to how blocked this process gets.
_STAGE_RECORDER_SCRIPT = """
window.__stageLog = [];
const t0 = performance.now();
const record = () => {
  const wrapper = document.querySelector(".loading-status");
  const stage = document.querySelector(".loading-stage");
  window.__stageLog.push({
    t: performance.now() - t0,
    wrapper: !!wrapper,
    text: stage ? stage.textContent : null,
  });
};
new MutationObserver(record).observe(document, {
  subtree: true,
  childList: true,
  characterData: true,
});
record();
"""


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


@pytest.mark.parametrize("engine", ["py", "r"])
def test_slow_load_announces_its_stages(
    page: Page, engine: str, loader_delay: int
) -> None:
    """The feature's headline behaviour: a slow first load explains itself.

    Deliberately carries no `@pytest.mark.allow_page_errors`: this is a
    successful load, so `fail_on_page_errors` should see nothing at all, and
    that marker would mask real console noise rather than let it fail the test.

    Reads back a recording rather than polling live for each stage in turn.
    `sabotage("off", ...)` answers the engine's core-wasm requests with
    `time.sleep()`, which -- per that function's own docstring -- blocks this
    whole process's connection to the browser, not just the one request it is
    answering. The engine makes *two* such requests before it is up
    (`engine-load-guard`'s reachability check, then the real load), so any of
    this test's own commands, including `page.goto()` itself, can each land in
    the middle of one of those sleeps and block for a full `loader_delay`
    with no way to poll in between. A first version of this test used
    sequential `expect(...).to_have_text(...)` calls to assert the order, and
    it was flaky in exactly that way: on a fast local engine, enough of that
    blocked time could go by that the app finished booting before the first
    check ever got a chance to observe the DOM, and text that has already
    come and gone does not come back for a later, more patient `expect()` to
    find. A `MutationObserver`, installed before either delay has fired,
    sidesteps this: it runs in the browser and timestamps every change to the
    loader's own DOM, so the recording it produces is immune to how blocked
    this process gets. This test lets the load run to completion and then
    reads that recording back once.
    """
    page.add_init_script(_STAGE_RECORDER_SCRIPT)
    sabotage(page, engine, "off", loader_delay)
    page.goto(app_url(engine, "off"))

    from shinylive_app import wait_for_app_rendered

    wait_for_app_rendered(page)
    expect(page.locator(".loading-status")).to_have_count(0)

    label = ENGINE_LABEL[engine]
    log = page.evaluate("window.__stageLog")

    # STATUS_DELAY_MS (LoadingStatus.tsx) withholds the stage text until 3s
    # after the loader mounts. Asserted as an absence, not a duration: the
    # recording's own first "wrapper is up" entry -- not assumed to be the
    # log's first entry, in case the observer fired for some other reason
    # first -- must show no stage text yet. `next()` raises on an empty log
    # rather than letting this pass vacuously.
    mounted = next(entry for entry in log if entry["wrapper"])
    assert mounted["text"] is None, (
        "stage text was already showing when the loader mounted",
        mounted,
    )

    # The order stages appeared in, deduplicated -- the recording is a log of
    # every DOM mutation, so the same stage text shows up on more than one
    # entry in a row.
    seen = [entry["text"] for entry in log if entry["text"] is not None]
    stages = [text for i, text in enumerate(seen) if i == 0 or text != seen[i - 1]]
    assert stages == [
        f"Downloading {label}…",
        f"Starting {label}…",
        "Loading packages and starting app…",
    ], stages


_EMBED_BLOCK_CLASS = {"py": "shinylive-python", "r": "shinylive-r"}

# Arbitrary but fixed, so the block never scrolls; nothing here depends on the
# exact value.
_EMBED_VIEWER_HEIGHT = 320


def _codeblock_body(files: list[dict[str, str]]) -> str:
    """Render a file set as a shinylive code-block body.

    Mirrors codeBlockBody() in scripts/loader-demo.ts: a single file needs no
    header, and more than one uses the '## file:' syntax parse-codeblock.ts
    understands.
    """
    if len(files) == 1:
        return files[0]["content"]
    return "\n".join(f"## file: {f['name']}\n{f['content']}" for f in files).rstrip()


@pytest.fixture
def embed_page(engine: str, mode: str) -> Iterator[str]:
    """A minimal page with one embedded block, served from the site root.

    Embedded blocks take their engine from the block's own class
    (run-python-blocks.ts selects on ".shinylive-python, .shinylive-r"), so one
    JS bundle serves both -- unlike the full-page layout, where the engine is
    substituted into the HTML at build time. `_shinylive/py/shinylive/` and
    `_shinylive/r/shinylive/` are byte-for-byte identical, so the only thing
    that determines which engine actually runs is the block's class below.

    The page is still written next to whichever engine's own `shinylive-sw.js`
    matches `engine`: load-shinylive-sw.js derives the service worker's path
    from the page's own directory, the same way the built editor/app pages do.

    Modeled on scripts/loader-demo.ts's embedPage()/buildDemoSite() -- the last
    known-working generator of this markup, since replaced by this test.
    """
    body = _codeblock_body(_files(engine, mode))
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="shinylive/load-shinylive-sw.js" type="module"></script>
    <link href="shinylive/shinylive.css" rel="stylesheet" />
    <script src="shinylive/run-python-blocks.js" type="module"></script>
  </head>
  <body>
    <pre class="{_EMBED_BLOCK_CLASS[engine]}">
#| standalone: true
#| viewerHeight: {_EMBED_VIEWER_HEIGHT}

{body}</pre>
  </body>
</html>
"""
    # A unique name per test so parallel runs (xdist, or two parametrized cases
    # touching the same engine) never collide on the same file.
    page_path = SHINYLIVE_DIR / engine / f"_embed_test_{uuid.uuid4().hex}.html"
    page_path.write_text(html)
    try:
        yield f"{BASE_URL}/{engine}/{page_path.name}"
    finally:
        page_path.unlink(missing_ok=True)


@pytest.mark.allow_page_errors
@pytest.mark.parametrize("engine", ["py", "r"])
@pytest.mark.parametrize("mode", ["app-syntax", "engine-load"])
def test_embedded_block_shows_the_error(
    page: Page, engine: str, mode: str, loader_delay: int, embed_page: str
) -> None:
    """Two representative modes, not all six: the failure plumbing is identical
    across layouts, so what is being checked here is the error screen's
    presentation inside a small block rather than the detection.

    Asserts the exact headline rather than just that one showed up: for the
    "r" case this is what would catch the embed accidentally booting Pyodide
    instead of webR (or vice versa) -- a wrong-language headline is the one
    symptom a mixed-up engine could not hide.
    """
    sabotage(page, engine, mode, loader_delay)
    page.goto(embed_page)
    if mode == "app-syntax":
        expect(page.locator(".error-message")).to_have_text("Error starting app!")
        expect(page.locator(".error-recovery")).to_have_count(0)
    else:
        expect(page.locator(".error-message")).to_have_text(
            f"Error loading {ENGINE_LABEL[engine]}!"
        )
        expect(page.locator(".error-recovery")).to_be_visible()
        expect(page.locator(".error-log pre")).to_contain_text("404")
    expect(page.locator(".error-log pre")).not_to_be_empty()


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
