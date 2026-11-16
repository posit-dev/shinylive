---
title: Shiny Version Selection
description: How an app picks one of the bundled shiny versions at runtime. It covers shiny_versions.json, the pin in requirements.txt or DESCRIPTION, the resolver (src/shiny-version.ts), per-version Pyodide locks and webR images with the HEAD-probe fallback, the "requested X, running Y" report, engine restart on re-run, the header-bar picker, the Quarto shiny-version option, and why R is version-unaware unless R_SHINY_IMAGE_BASE_URL is set. Read before changing any of these, App.tsx's engine startup, or shiny_versions.json.
---

# Shiny Version Selection

A build bundles several Python shiny versions: the newest patch release of each of the last five
minor versions. It bundles the same window of R shiny versions only when it is built with
`R_SHINY_IMAGE_BASE_URL` set; otherwise R has one library image and ignores pins. An app
chooses one by pinning shiny in its own dependency file. One engine runs per page, so the
version is chosen before the engine starts, and a re-run that needs another version restarts the
engine.

How the Python package sets are built is in `pythonPackageVersions.md`; the Makefile side is in
`buildPipeline.md`; the engines themselves are in `pythonEngine.md` and `rEngine.md`.

## The version list

- `shiny_versions.json` (repo root, tracked) — `{"python": {minor: exact}, "r": {minor: exact}}`,
  newest first. `scripts/update_shiny_versions.py` (`make update_shiny_versions`) recomputes it
  from the PyPI release list and the CRAN timeline (crandb.r-pkg.org): release versions only
  (`x.y.z`, no dev builds or pre-releases, no fully yanked PyPI releases), `WINDOW = 5` minors.
  `--check` exits 1 when the file is stale. The script is stdlib-only.
- The runtime imports the file in `src/shiny-version.ts`, so esbuild bundles it into
  `shinylive.js` and nothing is fetched at startup. The Makefile also copies it to
  `build/shinylive/shiny_versions.json`.
- `shiny_version_cases.json` (repo root) — the resolver fixture: its own `available` versions and a
  list of cases (`engine`, `files`, expected `minor`, `exact`, `requested`, `note`).
  `src/shiny-version.test.ts` runs every case. It is copied to `build/shinylive/` too, so the
  bundle and the release tarball include it.

## Where an app records its version

- Python: the first line of `requirements.txt` that names shiny (PEP 503 name normalization,
  extras such as `shiny[theme]` and environment markers allowed). A `shiny @ <url>` line counts as
  unreadable.
- R: the `shiny` entry in `Imports:`, else `Depends:`, of `DESCRIPTION`, for example
  `shiny (== 1.11.1)`.

Because the pin is an ordinary app file, it survives share links, gists, `app.json`, downloads,
and the `#code=` hash with no format change. `_install_requirements_from_dir` never passes
the pin line to micropip: it skips any name already installed, and shiny always is.

## Resolving (`resolveShinyVersion` in `src/shiny-version.ts`)

Pure functions, no I/O. The result is `{minor, exact, requested, note}`.

- No pin, or a shiny line with no version: the newest bundled version.
- An unreadable line: the newest, with a note that quotes the line.
- A single `==` clause picks a minor directly. `==1.6`, `==1.6.*`, and `==1.6.3` all mean the 1.6
  line and run its bundled patch. A minor outside the window runs the oldest bundled version (for
  an older pin) or the newest (for a newer one), with a note.
- Any other set of clauses: the newest bundled version that satisfies all of them. `!=1.8.*`
  excludes the whole minor. If nothing satisfies, an upper bound below the window gives the
  oldest, anything else the newest, with a note.
- `requested` is set only for an `==` pin with a full `x.y.z` version.

`shinyVersionMessage(resolved, actual)` returns `requested shiny <X>, running <Y>` when the
version the engine loaded differs from `requested` (if set) or from `exact`, else null.

## Startup

`runApp()` in `src/Components/App.tsx` decodes the start files, then, for a version-aware engine,
applies the Quarto `shiny-version` option and calls the resolver. It passes the resolution and any
startup notes to `App` as the `shinyVersion` and `startupNotes` props. `App` calls `startEngine`,
which passes the minor to `ensurePyodideProxyHandlePromise` or `ensureWebRProxyHandlePromise`;
`engineShinyMinors` records the minor each singleton started with.

The engine then loads the files for that minor, with a fallback:

- Python: `initPyodide` passes `lockFileURL` to `loadPyodide`. For the newest minor it uses
  `pyodide-lock.json` directly, since that file is a copy of the newest lock. For any other minor it
  sends a HEAD request (`assetExists` in `src/engine-load-guard.ts`) for
  `pyodide-lock-shiny-<minor>.json`, and uses `pyodide-lock.json` if the request fails.
- R (version-aware builds only): `initWebR` mounts `webr/shiny-<minor>/library.data.gz` the same
  way, falling back to `webr/library.data.gz`. webR's `mount()` reads the `.js.metadata` file next
  to the image.

A failed probe is a 404, which Chromium logs on the console as "Failed to load resource". An export
with one version's lock under the default name (the shape `tests/export_app.py` builds) takes the
fallback on every start of a pinned app whose minor is not the newest.

After startup the engine reports the version it really loaded: `importlib.metadata.version("shiny")`
in Python (this avoids importing shiny at startup) and `utils::packageVersion("shiny")` in R. It is
`shinyVersion` on the proxy handle, and is empty when startup failed. An effect in `App` prints
three kinds of message once per loaded version. Layouts with a terminal echo them there; the others
send them to `console.warn` with a `[shinylive]` prefix.

- Startup notes, from `applyShinyVersionOption` in `src/shiny-version-pin.ts`, about the Quarto
  `shiny-version` value.
- The resolver's note, from `resolveShinyVersion`, about a pin it could not honor exactly. It
  depends only on the files, so an export prints the same note as a full bundle.
- The version line, from `shinyVersionMessage`: `requested shiny X, running Y` whenever the version
  the engine loaded differs from the requested or resolved one. It compares against the loaded
  version, so it also reports a probe fallback, or an export whose lock does not match the app's
  current pin.

The source of each function lists the exact cases.

## Re-run and engine restart

Every run goes through `runAppWithVersion` in `App.tsx`, which resolves the current files again:

- Same minor as the running engine, or more than one `App` on the page uses this engine
  (`appInstances`): the engine is kept. If the note or `requested` changed, the report prints again.
- Pyodide on the main thread (`?webworker=0`) cannot be terminated, so the files are written to
  `#code=` and the page reloads.
- Otherwise `restartEngine`: stop the app, `terminate()` the old proxy (the Pyodide worker, or
  `webR.close()`), `loadStatusStore(engine).reset()`, `clearEngineSingleton`, start the engine for
  the new minor, and store the new promise in React state. `usePyodide` / `useWebR` drop back to a
  not-ready handle when the promise changes. The Viewer's effect cleanup disposes its service
  worker registration, and the new Viewer registers a fresh `app_<id>` path. When the new viewer
  reports ready, the files run on it.

Runs are serialized through `restartInFlightRef`: a run or stop requested during a restart
waits for it. A restart whose engine fails (`initError`, or a rejected promise) rejects, so later
runs are not blocked. The Editor receives `editorViewerMethods`, and the viewer-only effect
depends on it. Its identity changes only when the first viewer becomes ready; otherwise each
restart would re-run the start files and restart back to their pin.

## The picker

`HeaderBar` renders a `<select>` labeled "Shiny" when `App` passes `shinyVersionPicker`. `App`
does that only when the `showVersionPicker` run option is set and the engine is version-aware. The
`editor/` and `examples/` pages in `site_template/` set it; the `app/` page, Quarto, and exports
do not. Layout alone cannot gate it, because a Quarto block can produce `editor-terminal-viewer`.

- Options are the bundled exact versions, newest first, with the newest marked "(latest)". The
  value is the loaded version once the engine is ready, else the bundled version of the minor the
  engine is starting; a running version that is not in the list is added at the top.
- It is disabled while the engine loads, and enabled again if the load fails, so another version
  can be picked.
- Selecting a version calls `writeShinyPin` (`src/shiny-version-pin.ts`) on the editor's current
  files, rewrites the `#code=` hash when `updateUrlHashOnRerun` is set, and sets the files; the
  Editor then runs them through `runAppWithVersion`, which restarts the engine.

`writeShinyPin` always writes `==<exact>`. In `requirements.txt` it rewrites the first shiny line
and keeps indentation, extras, and a trailing comment, or appends `shiny==<exact>`. In
`DESCRIPTION` it rewrites the shiny entry in `Imports:` or `Depends:`, or appends one to
`Imports:`. A missing file is created (a minimal `DESCRIPTION` for R).

## Quarto `shiny-version` and several apps per page

`#| shiny-version: "1.6"` is passed to `runApp` like any other `#|` option (`quartoAndExport.md`).
`applyShinyVersionOption` runs before the resolver:

- The value must be a YAML string. Unquoted, `1.10` parses as the number 1.1. A non-string throws
  an error that shows the quoted form; `runApp` logs it with `console.error` and rethrows.
- An existing pin with a version clause, or an unreadable shiny line, wins, and a startup note
  says the option was ignored. An unversioned shiny line counts as no pin.
- Otherwise the pin is written: a full `x.y.z` value as given, a minor value as its bundled exact
  version.

The first `App` on a page to start an engine sets its version. A later `App` whose resolution
names another minor runs on the engine's version, and its Viewer shows a notice
(`.shinylive-version-notice`, "This app requests shiny A; this page runs B.").

## R and `R_SHINY_IMAGE_BASE_URL`

R is version-aware only in a build made with the Makefile variable `R_SHINY_IMAGE_BASE_URL` set.
`scripts/build.ts` turns that into `process.env.R_SHINY_IMAGES`, read as `R_VERSIONS_AVAILABLE` in
`src/hooks/useWebR.tsx`; `engineIsVersionAware` in `App.tsx` is true for Python always and for R
only when that flag is set.

With the variable empty (the default, and in CI), the build has one R library image, from
`R_SHINY_VERSION`. Every R app then gets the newest bundled resolution without reading
`DESCRIPTION`, mounts the default image with no probe, and has no version report, picker, restart,
or notice.

## Tests

- jest: `src/shiny-version.test.ts` (parsing and the shared fixture), `src/shiny-version-pin.test.ts`
  (pin writing and the Quarto option), `src/Components/HeaderBar.test.tsx` (the picker).
- Browser: `tests/test_site_shiny_version.py` (marker `site`, so it runs in `make test-site`). It
  covers every bundled Python version, the lock fallback, an export of a pinned app, the picker,
  restart and retry after a failed restart, the Quarto option, and two apps on one page. The R
  tests skip unless the build has per-version images, and one R test runs only when it does not.
  See `browserTests.md`.
