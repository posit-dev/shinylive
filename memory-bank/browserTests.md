---
title: Browser Test Gotchas
description: Traps when running or writing the pytest + Playwright tests in tests/ — the shared static-server port, stale service workers, per-engine differences in what errors are visible, and URL-hash fallback. Read before trusting a failure or adding a test. Conventions themselves are in tests/README.md.
---

# Browser Test Gotchas

`tests/README.md` covers the suites, markers, and controller shims. This document covers the
things that make a run fail (or pass) for reasons unrelated to the change under test.

## Port 8100 may be someone else's build

The `static_server` fixture in `tests/conftest.py` reuses any server already listening on
`STATIC_PORT` (8100, in `tests/shinylive_app.py`) instead of starting its own. Another checkout or
worktree of this repo running the same tests may hold that port while serving a different
`_shinylive/` build — for example a different Pyodide version. The errors then look like random
package-load flakiness.

Before trusting a failure, check who owns the port:

```bash
lsof -nP -iTCP:8100 -sTCP:LISTEN
```

Do not kill another checkout's server. Change `STATIC_PORT` locally for the run and revert it.

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
