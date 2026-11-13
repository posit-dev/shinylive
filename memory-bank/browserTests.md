---
title: Browser Test Gotchas
description: Traps when running or writing the pytest + Playwright tests in tests/ — the shared static-server port, stale service workers, per-engine differences in what errors are visible, URL-hash fallback, and what the shiny version tests need from the build (probe 404s on the console, R tests that skip without per-version images). Read before trusting a failure or adding a test. Conventions themselves are in tests/README.md.
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
logs `Unexpected response type`. The Viewer answers any request it receives after `stopApp` began
with an empty 503 and does not pass it to the engine (`requestFlow.md`); a request the Viewer passed
on before that is not covered. These errors do not happen when an app is loaded directly by URL
hash, so prefer a fresh page per example.

## Unknown URL hashes fall back silently

When the hash names no known example, `App.tsx` loads the first example instead of failing. A test
that navigates by hash should assert that the intended example is the one selected.

## Shiny version tests depend on the build

`tests/test_site_shiny_version.py` reads `shiny_versions.json` from the repo root, so the build
under test must come from the same file, or the version assertions fail.

- A per-version lock or image that is missing is found by a HEAD request, which Chromium logs as a
  "Failed to load resource" console error. Tests that provoke one are marked `allow_page_errors`
  and assert that the probe is the only error.
- The R version tests skip unless the served build has `webr/shiny-<minor>/` images (a build with
  `R_SHINY_IMAGE_BASE_URL` set). The `webr` make target deletes old `shiny-*` directories first, so
  a default build after a version-aware one has none. A default build skips them and runs only the test that checks R
  ignores the pin. A green run on a default build therefore says nothing about the R version path.
- `app_url_for_files()` in `tests/shinylive_app.py` builds a `#code=` URL from a dict of files, for
  tests that supply their own files.
