---
title: Browser Test Gotchas
description: Traps when running or writing the pytest + Playwright tests in tests/ — each worker's own static-server port, stale service workers, per-engine differences in what errors are visible, and URL-hash fallback. Read before trusting a failure or adding a test. Conventions themselves are in tests/README.md.
---

# Browser Test Gotchas

`tests/README.md` covers the suites, markers, and controller shims. This document covers the
things that make a run fail (or pass) for reasons unrelated to the change under test.

## Each worker serves on its own free port

`STATIC_PORT` (in `tests/shinylive_app.py`) is a port the OS reports as free when the module is
imported. Each xdist worker imports it separately, so each worker starts its own
`tests/static_server.py` on its own port, and other checkouts running tests at the same time do
not collide. The server prints `ready` once it holds the port; the `static_server` fixture in
`tests/conftest.py` waits for that line. If another program takes the port first, the server
exits with "Address already in use" on stderr and the fixture fails. Rerun the tests.

There is no fixed port, so a server left running by hand is never reused.

## Stale service workers

The service worker cache name (`src/shinylive-sw.ts`) does not change with the Pyodide version. A
reused browser profile can keep serving old engine files after a rebuild. Clear service workers and
caches when reusing a profile by hand.

## What each engine makes visible

- Pyodide writes Python stderr to the xterm terminal (`stderr: terminalInterface.error` in
  `src/Components/App.tsx`), so warnings and tracebacks can be asserted there. webR apps write
  nothing to the terminal, so R coverage comes from `.shiny-output-error` and console errors.
- The REPL prompt is `>>>` for Python and `>` for R.
- xterm hard-wraps long lines. Rejoin wrapped rows before matching, or a pattern matches half a
  message.

## Switching apps in one page races the old app

Switching examples inside one warm session can log errors from the outgoing app: Pyodide raises
`KeyError: 'app_<key>'` from the `_shiny_app_registry` lookup in `src/messageporthttp.ts`, and webR
logs `Unexpected response type`. These do not happen when an app is loaded directly by URL hash, so
prefer a fresh page per example.

## Unknown URL hashes fall back silently

When the hash names no known example, `App.tsx` loads the first example instead of failing. A test
that navigates by hash should assert that the intended example is the one selected.
