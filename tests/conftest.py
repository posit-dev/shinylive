"""Fixtures and options for the tests in this directory."""

from __future__ import annotations

import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from export_app import export_app
from playwright.sync_api import ConsoleMessage, Page, expect
from shinylive_app import (
    ANALYTICS_URL,
    APP_FRAME,
    SHINYLIVE_DIR,
    STATIC_PORT,
    is_benign_console_error,
    suspect_terminal_lines,
    terminal_text,
)

# Assertions get their own timeout, well short of the per-test one: an app that
# is going to answer at all answers long before this.
expect.set_options(timeout=30_000)


# See `ANALYTICS_URL` and `is_benign_console_error` in shinylive_app.py.


@pytest.fixture(autouse=True)
def block_analytics(page: Page) -> None:
    """Keep the tests off the network, and off anything but shinylive's own code.

    The loader is injected with `async`, so a slow or unreachable tag manager
    would hold up the page's load event and, with it, `page.goto()`. Aborting is
    also why `fail_on_page_errors` has to forgive these: a request that never
    completes reaches the console as an error, the same way a missing favicon
    does.
    """
    page.route(ANALYTICS_URL, lambda route: route.abort())


@pytest.fixture(autouse=True)
def fail_on_page_errors(request: pytest.FixtureRequest, page: Page) -> Iterator[None]:
    """Fail on errors emitted while an app is starting or being exercised.

    Every test that opens a page gets this. A test that provokes an error on
    purpose -- a deliberate syntax error, a download made to fail -- opts out
    with `@pytest.mark.allow_page_errors` and asserts on the failure itself.
    """
    if request.node.get_closest_marker("allow_page_errors"):
        yield
        return

    console_errors: list[str] = []

    def on_console(message: ConsoleMessage) -> None:
        if message.type != "error":
            return
        if is_benign_console_error(message):
            return
        console_errors.append(message.text)

    page.on("console", on_console)
    page.on("pageerror", lambda error: console_errors.append(str(error)))

    yield

    # Give debounced inputs and reactive effects time to surface asynchronous
    # errors before checking the final page state.
    page.wait_for_timeout(500)

    terminal = terminal_text(page)
    suspect_lines = suspect_terminal_lines(terminal)
    assert suspect_lines == [], (
        "unexpected output in the shinylive terminal:\n" + terminal
    )
    expect(
        page.frame_locator(APP_FRAME).locator(".shiny-output-error"),
        "app rendered an output error",
    ).to_have_count(0)
    assert console_errors == [], "browser console errors:\n" + "\n".join(console_errors)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--shard",
        default=None,
        metavar="N/TOTAL",
        help="Run one part of the suite, as in `1/3`.",
    )
    parser.addoption(
        "--loader-delay",
        type=int,
        default=4000,
        help=(
            "Milliseconds to hold the engine's core wasm before answering. "
            "LoadingStatus only shows text after 3s (STATUS_DELAY_MS), so the "
            "default leaves about a second of visible status. Turn it up to "
            "watch the stages by hand."
        ),
    )


@pytest.fixture
def loader_delay(request: pytest.FixtureRequest) -> int:
    return int(request.config.getoption("--loader-delay"))


def pytest_configure(config: pytest.Config) -> None:
    shard = config.getoption("--shard")
    if shard is not None:
        config.pluginmanager.register(_ShardPlugin(str(shard)), "shinylive-shard")


# The two markers every test is expected to carry. CI runs one job selecting on
# `examples` and another selecting on `site`, so a test with neither is a test
# nothing ever runs.
_SUITE_MARKERS = ("examples", "site")


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    # This runs before `-m` deselection: a conftest's implementation of this hook
    # is called ahead of the one in _pytest.mark, which is what makes the engine
    # markers added below visible to `-m py` / `-m r`.

    # Let `-m py` / `-m r` select an engine for tests that are parametrized by
    # one, the way the per-engine modules are already marked.
    for item in items:
        callspec = getattr(item, "callspec", None)
        engine = None if callspec is None else callspec.params.get("engine")
        if engine == "py" or engine == "r":
            item.add_marker(pytest.mark.py if engine == "py" else pytest.mark.r)

    unmarked = [
        item.nodeid
        for item in items
        if not any(item.get_closest_marker(name) for name in _SUITE_MARKERS)
    ]
    if unmarked:
        raise pytest.UsageError(
            "every test needs a `pytest.mark.examples` or `pytest.mark.site` "
            "marker, usually as a module-level `pytestmark`. Neither CI job "
            "selects a test without one, so it would quietly never run:\n  "
            + "\n  ".join(unmarked)
        )


class _ShardPlugin:
    """Run one part of the suite, as in `--shard=1/3`.

    A plugin rather than another function in this module so that its hook can be
    `trylast` and so run *after* `-m` deselection. Sharding first and selecting
    afterwards still covers every test exactly once, but it deals out the whole
    of `tests/` -- so each examples shard would be handed a slice of the site
    tests to throw away, and the shards' sizes would drift with whatever else
    happens to live here.
    """

    def __init__(self, shard: str) -> None:
        self.index, self.total = (int(part) for part in shard.split("/"))
        if not 1 <= self.index <= self.total:
            raise pytest.UsageError(f"--shard={shard} is out of range")

    @pytest.hookimpl(trylast=True)
    def pytest_collection_modifyitems(
        self, config: pytest.Config, items: list[pytest.Item]
    ) -> None:
        # Round-robin rather than playwright's contiguous blocks. Every test here
        # boots a whole engine, and their costs vary enough -- a couple of
        # seconds for a text output, half a minute for a simulation -- that
        # dealing them out one at a time keeps the shards closer in length.
        mine = self.index - 1
        keep = [item for i, item in enumerate(items) if i % self.total == mine]
        drop = [item for i, item in enumerate(items) if i % self.total != mine]
        config.hook.pytest_deselected(items=drop)
        items[:] = keep


@pytest.fixture(scope="session", autouse=True)
def static_server() -> Iterator[None]:
    """Serve the built `_shinylive/` for the session.

    The tests drive the built output rather than the esbuild dev server: it
    needs `shinylive export` from the Python shinylive package, which depends on
    this repository. Serving `_shinylive/` needs only a static file server, and
    exercises the same bytes we deploy.

    Shinylive registers a service worker, which browsers only allow over https or
    from localhost -- see src/load-shinylive-sw.ts.
    """
    if not (SHINYLIVE_DIR / "py" / "shinylive" / "examples.json").exists():
        pytest.fail(f"{SHINYLIVE_DIR} is not built. Run `make all` first.")

    # Already serving: a developer left one running, or -- under xdist -- another
    # worker got there first.
    if _port_is_open():
        yield
        return

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "http.server",
            str(STATIC_PORT),
            "--bind",
            "127.0.0.1",
            "--directory",
            str(SHINYLIVE_DIR),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_port()
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


@pytest.fixture(scope="session")
def export_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The directory the session's static exports are assembled in."""
    return tmp_path_factory.mktemp("exports")


@pytest.fixture(scope="session")
def export_server(export_root: Path) -> Iterator[str]:
    """Serve the session's exports, and return the base URL they are served at.

    In-process and on a port the OS picks, where `static_server` is a subprocess
    on a fixed one: `_shinylive/` is the same directory in every run and worth
    reusing a server for, but an export root is made fresh per session, so a
    server left over from another run would quietly serve the wrong files.
    """

    class _QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(_QuietHandler, directory=str(export_root))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def exported_app(export_root: Path, export_server: str) -> Callable[..., str]:
    """Export an app from the local build, and return the URL serving it.

    ```python
    url = exported_app({"app.py": "..."}, name="hello")
    page.goto(url)
    ```

    The keyword arguments are `export_app()`'s, plus the `name` of the directory
    to export into. Names are reused across tests on purpose: an export is a few
    files and two symlinks, so rewriting one is cheaper than reasoning about
    which test wrote what.
    """

    def _exported_app(
        files: Mapping[str, str], *, name: str = "app", **kwargs: Any
    ) -> str:
        export_app(files, export_root / name, **kwargs)
        return f"{export_server}/{name}/"

    return _exported_app


def _port_is_open() -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(("127.0.0.1", STATIC_PORT)) == 0


def _wait_for_port(timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _port_is_open():
            return
        time.sleep(0.1)
    raise RuntimeError(f"static server never came up on port {STATIC_PORT}")
