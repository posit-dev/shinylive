"""Fixtures and options for the example app tests."""

from __future__ import annotations

import socket
import subprocess
import sys
import time
from typing import Iterator

import pytest
from playwright.sync_api import ConsoleMessage, Page
from playwright.sync_api import expect

from shinylive_app import (
    APP_FRAME,
    SHINYLIVE_DIR,
    STATIC_PORT,
    suspect_terminal_lines,
    terminal_text,
)

# Assertions get their own timeout, well short of the per-test one: an app that
# is going to answer at all answers long before this.
expect.set_options(timeout=30_000)


@pytest.fixture(autouse=True)
def fail_on_example_errors(page: Page) -> Iterator[None]:
    """Fail on errors emitted while an example is starting or being exercised."""
    console_errors: list[str] = []

    def on_console(message: ConsoleMessage) -> None:
        if message.type != "error":
            return
        # A missing favicon is not an app problem.
        if message.location["url"].endswith("favicon.ico"):
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
    assert console_errors == [], "browser console errors:\n" + "\n".join(
        console_errors
    )


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--shard",
        default=None,
        metavar="N/TOTAL",
        help="Run one part of the suite, as in `1/3`.",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    # Let `-m py` / `-m r` select an engine for tests that are parametrized by
    # one, the way the per-engine modules are already marked.
    for item in items:
        callspec = getattr(item, "callspec", None)
        engine = None if callspec is None else callspec.params.get("engine")
        if engine == "py" or engine == "r":
            item.add_marker(pytest.mark.py if engine == "py" else pytest.mark.r)

    shard = config.getoption("--shard")
    if shard is None:
        return

    index, total = (int(part) for part in str(shard).split("/"))
    if not 1 <= index <= total:
        raise pytest.UsageError(f"--shard={shard} is out of range")

    # Round-robin rather than playwright's contiguous blocks. Every test here
    # boots a whole engine, and their costs vary enough -- a couple of seconds
    # for a text output, half a minute for a simulation -- that dealing them out
    # one at a time keeps the shards closer in length.
    keep = [item for i, item in enumerate(items) if i % total == index - 1]
    drop = [item for i, item in enumerate(items) if i % total != index - 1]
    config.hook.pytest_deselected(items=drop)
    items[:] = keep


@pytest.fixture(scope="session", autouse=True)
def static_server() -> Iterator[None]:
    """Serve the built `_shinylive/` for the session.

    The tests drive the built output rather than the esbuild dev server, because
    that server needs `shinylive export` from the Python shinylive package --
    which depends on this repository. That circular dependency is why the
    playwright job in build.yml is commented out. Serving `_shinylive/` needs
    nothing but a static file server, so this suite can actually run on CI, and
    it exercises the same bytes we deploy.

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
