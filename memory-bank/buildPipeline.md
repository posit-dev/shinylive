---
title: Build Pipeline
description: What `make all`, `scripts/build.ts`, `make dist`, and `_shinylive` actually do, where Pyodide and webR come from, and how build/, site/, and _shinylive/ relate. Read before changing the Makefile or build.ts, bumping Pyodide or webR, or when a build output is missing or stale.
---

# Build Pipeline

## What `make all` does

`all` lists its prerequisites in order, and the Makefile is run serially, so they run top to
bottom:

1. `node_modules` — `npm ci`, only when `package.json` is newer.
2. `build/shinylive/style-resets.css` — copied from `src/style-resets.css`.
3. `build/shinylive/pyodide` — downloads `pyodide-$(PYODIDE_VERSION).tar.bz2` from the Pyodide
   GitHub release into `downloads/`, then untars it into `build/shinylive/` (the tarball's top
   folder is `pyodide/`). `*test*.tar` and `node_modules` are left out.
4. `build/shinylive/webr` (the phony `webr` target, so it runs every time) — copies
   `node_modules/webr/dist/` (the npm `webr` version in `package.json`), then downloads
   `library.data.gz` and `library.js.metadata` from the `r-wasm/shiny` release
   `v$(R_SHINY_VERSION)`. These hold the prebuilt R package library. Finally a `sed` strips
   `if(!hasByteServing)` from `R.js` so Emscripten downloads whole files (GitHub Pages does not
   cache partial-content responses).
5. `pyodide_js` — copies `pyodide.mjs` to `src/pyodide/pyodide.js`, plus `pyodide.d.ts` and
   `ffi.d.ts`. These three files are tracked in git, so a Pyodide bump shows up as a diff in
   `src/pyodide/`. `scripts/build.ts` bundles them into the app and worker.
6. `pyodide_packages_local` — copies the htmltools, shiny, shinywidgets, faicons, and libsass
   wheels from `packages/` into `build/shinylive/pyodide/`. Each copy depends on the wheel in
   `packages/`, so a missing wheel is built (or, for libsass, downloaded) here.
7. `update_packages_lock_local`, `retrieve_packages`, `update_pyodide_lock_json` — the Python
   package steps. See `pythonPackageVersions.md`.
8. `create_typeshed_json` and `copy_pyright` — the editor's type checker (below).
9. `build/export_template/index.html` and `build/export_template/edit/index.html` — copied from
   `export_template/`.
10. `_shinylive` — the only step that runs `scripts/build.ts`: `buildjs-prod`, then
    `cp -Lr site/. _shinylive/py`; then `buildjs-prod-r`, then `cp -Lr site/. _shinylive/r`.

Versions live at the top of the `Makefile`: `PYODIDE_VERSION`, `R_SHINY_VERSION`, and
`LIBSASS_WHEEL`. The webR version is the npm dependency.

## What `make all` does not do

- `make submodules` — must be run first, or the wheel versions come out empty.
- `make packages` — runs `clean-packages` and rebuilds all submodule wheels. `make all` only builds
  a wheel when the file for the current version is missing, so new submodule code with an
  unchanged version keeps the old wheel. Run `make packages` after updating a submodule.
- `make update_packages_lock` — the full lockfile regeneration from PyPI.
- `make dist`, `make test-deps`, tests, and `make quarto`.

`make all` does change tracked files: `shinylive_lock.json` (via `update_packages_lock_local`) and
`src/pyodide/*`.

## `scripts/build.ts`

Flags (read from `process.argv`):

- `--prod` — minify and set `process.env.NODE_ENV` to `"production"`.
- `--r` — make `"r"` the engine written into the site HTML (default `"python"`).
- `--watch` — keep all four contexts watching.
- `--serve` — implies `--watch`, and serves the site.
- `--test-server` — serve without watching and without opening a browser (`npm run test-server`).
- `--metafile` — write `esbuild-metadata.json` for bundle size analysis.

`buildSiteHtml()` runs first. It copies each file in `site_template/` to `site/`, replacing
`{{APP_ENGINE}}` and `{{GOOGLE_TAG_MANAGER_SCRIPT}}` (filled only when `GOOGLE_TAG_MANAGER_ID` is
set, as in `.github/workflows/build.yml`). Because every run rewrites `site/*/index.html`, the
site's engine is whatever the last run chose. After `make all` that is R.

The four esbuild contexts in `buildmap`:

| Context | Entry points | Output |
| --- | --- | --- |
| `app` | `src/Components/App.tsx` (as `shinylive`), `src/Components/Editor.tsx` | `site/shinylive/` = `build/shinylive/`, code-split into `[name]-[hash]` chunks |
| `worker` | `pyodide-worker.ts`, `load-shinylive-sw.ts`, `run-python-blocks.ts`, `lzstring-worker.ts` | `build/shinylive/` |
| `codeblock-to-json` | `src/scripts/codeblock-to-json.ts` (es2022, used by Quarto) | `build/scripts/` |
| `shinylive-sw` | `src/shinylive-sw.ts` | `build/shinylive-sw.js` |

The `app` and `worker` contexts mark the Node-only imports inside `pyodide.js` (`node:fs`,
`node-fetch`, ...) as external. `worker` also leaves `./shinylive.js` external, since
`run-python-blocks.ts` loads the app bundle at runtime.

Plugins on the `app` context:

- `chunk-cleaner` — on each build start, deletes `build/shinylive/chunk-*` so old hashed chunks do
  not pile up.
- `example-builder` — on each build start, calls `buildExamples()` from
  `scripts/build_examples_json.ts`. It skips the work unless some file under `examples/` is newer
  than `build/shinylive/examples.json`. Otherwise it reads `examples/index.json` for the order and
  each app's `about.txt` for the title, and writes every file (base64 for binary) into
  `examples.json`. Example files are not esbuild watch inputs, so editing one does not trigger a
  rebuild or live reload.

`injectSocketPlugin` on the `shinylive-sw` context resolves `virtual:shinylive-inject-socket` by
running a separate unminified esbuild build of `src/shinylive-inject-socket.ts` and returning the
result as a text module. The service worker then serves that string as
`shinylive-inject-socket.js`. On a build error it still returns watch files, so watch mode
recovers once the shim is fixed.

## Serving and live reload

With `--serve` or `--test-server`, esbuild serves `site/` on port 3001, and a Node proxy on port
3000 adds `cross-origin-opener-policy: same-origin`,
`cross-origin-embedder-policy: credentialless`, and `cross-origin-resource-policy: cross-origin`.
When the proxy sends `/shinylive/shinylive.js`, it prepends a snippet that, on `localhost`,
listens to esbuild's `/esbuild` event stream and reloads the page on `change`. Only `--serve`
watches, so only it emits changes. With `--serve`, the browser opens `http://localhost:3000/examples`
after one second if no page has connected.

## Directory layout

- `build/` — the real output (git-ignored): `shinylive/` (bundles, `pyodide/`, `webr/`,
  `pyright/`, `examples.json`, CSS), `shinylive-sw.js`, `scripts/`, `export_template/`.
- `site/` — tracked except the generated `*/index.html`. `site/shinylive` and
  `site/shinylive-sw.js` are tracked symlinks into `build/`.
- `_shinylive/` — the deploy folder. Only `_redirects` and `favicon.ico` are tracked; `py/` and `r/`
  are full copies of `site/` with symlinks resolved (`cp -L`), so each holds its own Pyodide and
  webR. `build/scripts/` and `build/export_template/` are not in it.
- `export_template/` — the HTML that the Python and R `shinylive export` commands fill in
  (`{{REL_PATH}}`, `{{APP_ENGINE}}`, `{{#title}}`, `include_in_head`, ...). `edit/index.html`
  redirects to `../index.html?_shinylive-mode=editor-terminal-viewer`.

## `make dist`

`dist` depends on `buildjs` (a non-minified, Python-default build), not on `all`. It symlinks
`shinylive-$(SHINYLIVE_VERSION)` to `build/`, runs `tar -chzvf` (`-h` follows the link) into
`dist/shinylive-<version>.tar.gz`, and removes the link. So the tarball is `build/` as it stands,
and needs a prior `make all` for Pyodide, webR, and the wheels. `build.yml` runs it only on a
release, after checking that the tag matches `package.json`'s version.

## Editor type checking

- `scripts/create_typeshed.py` deletes `typings/<pkg>` and runs `pyright --createstub` for
  htmltools, shiny, shinywidgets, and shinyswatch, for Python `3.12` (hard-coded
  `PYODIDE_PYTHON_VERSION`). It stubs whatever versions are installed in `venv/`, not the bundled
  wheels. It bundles those stubs, `typeshed/stdlib` (the `typeshed` git submodule, minus a skip
  list), and a `pyrightconfig.json` into `build/shinylive/pyright/typeshed.en.json`.
- `copy_pyright` copies `src/pyright/` (a prebuilt browser `pyright.worker.js` from the
  `pyright-browser` branch of posit-dev/pyright; see `src/pyright/README.md`) into
  `build/shinylive/pyright/`. `src/language-server/pyright-client.ts` loads both files.
- `PYODIDE_PYTHON_VERSION` in `create_typeshed.py` and the Python tag in `LIBSASS_WHEEL` must be
  changed by hand when a Pyodide bump changes the Python version.
