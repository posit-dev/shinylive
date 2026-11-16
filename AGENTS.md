# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex, and others) when working with code in this repository.

Shinylive runs Shiny apps entirely in the browser: Python apps on Pyodide, R apps on webR. This repo builds the JS/CSS/wasm bundle (`build/`), the Examples/Editor site (`site/`), and the deployable `_shinylive/` directory. The Python and R `shinylive` packages (separate repos) consume the bundle for `shinylive export` and Quarto.

## Commands

Setup (once): `make submodules`, then `make all` (downloads Pyodide and webR, builds the shinywidgets and faicons wheels from the `packages/` submodules, writes one Pyodide lock per bundled shiny version, checks the bundle against `shiny_versions.json`, builds everything). Python tooling lives in `venv/`, which `make` creates.

- `make serve` / `make serve-r` — build, watch `src/`, and serve the Python / R site with live reload
- `make buildjs` — rebuild only the JS from `src/` (`scripts/build.ts`, esbuild). `--prod` minifies, `--r` makes webR the default engine
- `make type-check` — `tsc --noEmit` over everything, including tests (swc does not check types)
- `make test-unit` — jest unit tests (`src/**/*.test.ts` and `.test.tsx`); no build or Python needed
- `npx jest src/utils.test.ts` / `npx jest -t "name"` — one test file / test name
- `make test-deps` — once, installs pytest deps, Shiny from the `packages/py-shiny` submodule (kept at the newest bundled release), and chromium
- `make test-examples`, `make test-examples-intent`, `make test-site`, `make test-loader` — browser tests; need `make all` first
- `venv/bin/pytest tests/test_site_editor.py -k "name"` — one browser test
- `EXAMPLES_ENGINE=py|r` and `EXAMPLES_SHARD=1/3` — run part of the example suite
- `make examples-check-index` — every example on disk must be listed in `examples/index.json`
- `make test-scripts` — `unittest` suites for the build scripts in `scripts/`
- `make update_shiny_versions` — recompute `shiny_versions.json` (the last five shiny minors per language) from PyPI and CRAN
- `make update_packages_lock` — regenerate `shinylive_lock.json` (one `uv pip compile` resolution per shiny minor) after editing `shinylive_requirements.json` or `shiny_versions.json`

Formatting is Prettier with `prettier-plugin-organize-imports`; ESLint config is in `package.json` (note `no-floating-promises` and `consistent-type-imports` are errors).

## Architecture

**Request flow.** A Shiny app has no real server. `src/shinylive-sw.ts` is a service worker that intercepts any request under `/app_<id>/` and hands it to the engine with `fetchASGI` (`src/messageporthttp.ts`). For Python, that calls the ASGI app looked up in Pyodide's `_shiny_app_registry`; for R, it goes through httpuv (`makeHttpuvRequest`). The service worker also injects `<script src="shinylive-inject-socket.js">` into app HTML. That shim (`src/shinylive-inject-socket.ts`) is bundled into the service worker as a string by `injectSocketPlugin` in `scripts/build.ts`, and replaces the app's WebSocket with a MessagePort channel (`src/messageportwebsocket*.ts`). Service workers only work over https or localhost, so the site must be served from `127.0.0.1`/`localhost`.

**Engines.** Pyodide runs in a web worker (`src/pyodide-worker.ts`) behind `src/pyodide-proxy.ts`; webR runs behind `src/webr-proxy.ts`. The React hooks `src/hooks/usePyodide.tsx` and `src/hooks/useWebR.tsx` start them and install Shiny. `runApp` resolves which bundled shiny version an app runs from its `requirements.txt` or `DESCRIPTION` before the engine starts, and a re-run that needs another version restarts the engine (`memory-bank/shinyVersions.md`). `src/Components/App.tsx` picks the engine (`AppEngine = "python" | "r"`) and the layout mode (examples browser, editor+terminal+viewer, app-only, exported app). It also reads the URL hash (`#code=`, `#gist=`, an example name, `h=0`).

**Build outputs.** `scripts/build.ts` runs four esbuild contexts: the app (`App.tsx`, `Editor.tsx` → `site/shinylive/`, which is a symlink into `build/shinylive/`), the workers, `codeblock-to-json` (used by Quarto), and the service worker (`build/shinylive-sw.js`). It also regenerates the examples JSON from `examples/` and writes `site/*.html` for the chosen engine. The `_shinylive` make target builds the site twice, once per engine, into `_shinylive/py` and `_shinylive/r`. `export_template/` holds the HTML for `shinylive export`.

**Python packages.** The bundle has one Python package set per shiny minor listed in `shiny_versions.json`, resolved with uv into `shinylive_lock.json` and written as `build/shinylive/pyodide/pyodide-lock-shiny-<minor>.json`. shiny and htmltools come from PyPI; shinywidgets and faicons are built from the `packages/` submodules. Examples have no pin, so they run the newest bundled shiny release, which can lag py-shiny `main`. Check that version before using a newer Shiny API in an example. R apps choose a shiny version only in a build made with `R_SHINY_IMAGE_BASE_URL` set; by default R has one library image.

**Browser tests.** `tests/` is pytest + Playwright against the built `_shinylive/` over a static server. It does not depend on the Python `shinylive` package, which would be a circular dependency; `tests/export_app.py` assembles static exports from `build/` instead. Every test needs the `examples` or `site` marker. See `tests/README.md` before adding tests.

## Memory bank

`memory-bank/` holds architecture notes with YAML frontmatter (`title`, `description`). **Before exploring the codebase**, use the `memory-bank` skill (`.agents/skills/memory-bank/`) to list the documents and read the relevant ones. Update them when you learn something that would have saved time, or when you change the architecture they describe. Keep each document's frontmatter in sync with its content.

Project skills live in `.agents/skills/`; `.claude/skills` is a symlink to it.
