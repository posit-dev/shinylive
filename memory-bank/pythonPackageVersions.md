---
title: Python Package Versions in Shinylive
description: Where the Python package versions that examples run against come from (shiny_versions.json, shinylive_requirements.json, shinylive_lock.json with one package set per shiny minor, the packages/ submodules, the per-version pyodide-lock-shiny-<minor>.json files), how scripts/pyodide_packages.py resolves them with uv, how scripts/check_shiny_bundle.py and update_shiny.yml keep them in step, and why py-shiny main's docs are not a safe guide when updating example apps.
---

# Python Package Versions in Shinylive

The build bundles one Python package set per shiny minor version listed in `shiny_versions.json`
(see `shinyVersions.md` for how an app picks one). Each set is the base Pyodide packages plus the
packages for that minor in `shinylive_lock.json`. The lockfile is generated from
`shinylive_requirements.json` and `shiny_versions.json` with `make update_packages_lock`.

shiny and htmltools come from PyPI. shinywidgets and faicons are built from the git submodules in
`packages/` (`make packages`), and libsass is a downloaded wheel. Apps with no pin run the newest
bundled release, never py-shiny `main`.

## The files

- `shiny_versions.json` (tracked) — the bundled shiny minors and their exact versions, newest
  first. See `shinyVersions.md`.
- `shinylive_requirements.json` (hand-edited) — the top-level packages to add to Pyodide. Each
  entry has `name`, `source` (`"local"` or `"pypi"`), and `version` (`"latest"` or an exact
  version; ranges are not supported). shiny's entry has version `"bundled"`: every resolution
  replaces it with `shiny==<exact>` for one minor. Extra keys such as `comment` are ignored.
- `shinylive_lock.json` (generated, tracked) — `{"format": 2, "locks": {minor: {name: entry}}}`.
  Each entry has `version`, `filename`, `sha256`, `url`, `depends`, and `imports`. Local packages
  have `sha256: null` and `url: null`, because local wheel builds are not byte-for-byte
  reproducible. A lockfile in any other shape fails with a message to run
  `make update_packages_lock`.
- `build/shinylive/pyodide/pyodide-lock-shiny-<minor>.json` (generated, not tracked) — one Pyodide
  package index per bundled minor. `pyodide-lock.json` next to them is a copy of the newest one.
  Pyodide reads the one the runtime chooses (`lockFileURL`).

## `scripts/pyodide_packages.py`

One subcommand per Makefile target. All run inside `venv/` with `requirements-dev.txt`
(`pkginfo`, `requirements-parser`, `packaging`, `uv`) installed.

- `generate_lockfile` (`make update_packages_lock`) — for each minor in `shiny_versions.json`,
  `resolve_with_uv` runs `python -m uv pip compile` for the Pyodide target
  (`--python-platform wasm32-pyodide2024 --python-version 3.12 --only-binary :all:`) with
  `--find-links` on `packages/` and `build/shinylive/pyodide/`. Its inputs:
  - requirements from `uv_requirements`: every requirement except `LOCAL_NOT_RESOLVED`, with shiny
    pinned to that minor's exact version;
  - constraints from `uv_constraints`: every stock Pyodide Python package at its stock version,
    every local wheel in `packages/` at its version, then `SHARED_CONSTRAINTS` and that minor's
    `VERSION_CONSTRAINTS` entry;
  - overrides from `uv_overrides`: the stock packages named in `STOCK_OVERRIDES`, at their stock
    version, for dependencies that declare a floor above the version Pyodide ships.

  `_lock_entries_for` then turns the pins into lock entries, skipping packages Pyodide already
  ships. Local packages are read from their wheel in `packages/` with `pkginfo` (exactly one wheel
  per name must exist; the Makefile's `LOCAL_WHEELS` prerequisite builds or downloads them). Other packages come from `https://pypi.org/pypi/<name>/<version>/json`; if
  PyPI's metadata names another version (the pinned release has no `py3-none-any` wheel), the run
  fails. `LOCAL_NOT_RESOLVED` packages (libsass, whose platform tag uv may reject) are added to
  every lock straight from their wheel. The whole file is replaced. The comments next to each
  constant say why each constraint or override exists; remove a `VERSION_CONSTRAINTS` entry when
  its minor leaves `shiny_versions.json`.
- `update_lockfile_local` (`make update_packages_lock_local`, part of `make all`) — refreshes the
  `local` entries in every minor's lock from the wheels in `packages/`. It resolves nothing, so a
  change to `shiny_versions.json` or to a local wheel's dependencies needs
  `make update_packages_lock`.
- `retrieve_packages` (`make retrieve_packages`) — copies or downloads every wheel any lock names
  into `build/shinylive/pyodide/`, once per file name. A file already on disk is kept if its
  SHA256 matches. Downloads are checked against the lockfile SHA256.
- `update_pyodide_lock_json` (`make update_pyodide_lock_json`; the Python function is
  `update_pyodide_pyodide_lock_json`) — deletes every `pyodide-lock-shiny-*.json`, then writes one
  per lock in `shinylive_lock.json`: a copy of the original Pyodide lock (`orig_pyodide_lock()`),
  each lock entry added with `install_dir: "site"` (local wheel SHA256s computed from
  `packages/`), `EXTRA_DEPENDENCIES` appended (jinja2 for pandas, exceptiongroup for anyio,
  setuptools for palmerpenguins), and `OMIT_DEPENDENCIES` dropped (shiny from shinychat, to break
  a cycle). It then drops every `depends` name that is not in that lock (uv leaves out dependencies
  whose environment marker excludes Pyodide), normalizes the rest, and copies the newest minor's
  file to `pyodide-lock.json`. Files are written without indentation. A lock for a minor that is
  not in `shiny_versions.json` fails here with a `KeyError`.

`orig_pyodide_lock()` keeps `pyodide-lock.orig.json` next to `pyodide-lock.json`. It copies the
current file over it when the copy is missing or when the `info.version` fields differ, so the
script can be run again without stacking additions.

Dependency filtering (`_filter_requires`, used for each entry's `depends`): any requirement with a
`;` marker is dropped, except `platform_system == "Emscripten"` (kept for mizani's tzdata). Names
in `AVOID_DEPEND_PACKAGES` (`contextvars`, `websockets`, `ipykernel`, `widgetsnbextension`,
`typing`, `python`) are never listed as dependencies. The `imports` value for PyPI packages is
guessed from the name (`python-` and `-py` stripped, `-` to `_`).

A lockfile package that Pyodide also ships replaces Pyodide's entry, even when the lockfile
version is older. `update_pyodide_pyodide_lock_json` prints `<name> (replaces Pyodide's <version>)`
for each one, so check the `make all` output after a Pyodide bump.

## `scripts/check_shiny_bundle.py`

`make check_shiny_bundle`, run by `make all` after the lock steps. Stdlib-only. For Python it
checks that every listed minor has its `pyodide-lock-shiny-<minor>.json` with that exact shiny,
that every dependency a lock names is in the lock, that every wheel a lock names is on disk (the
`*test*.tar` files the Makefile does not extract are exempt), that no lock exists for an unlisted
minor, and that `pyodide-lock.json` has the newest shiny. With `--r` (passed when
`R_SHINY_IMAGE_BASE_URL` is set) it also checks the per-minor webR images. Its unit tests and those
of the other build scripts run with `make test-scripts`.

## How the submodule wheels get their version

The `Makefile` helper `_get_version` greps `^__version__ = ` in `__version.py`, `__init__.py`, or
`_version.py` of shinywidgets and faicons, and builds file names like
`shinywidgets-$(SHINYWIDGETS_VERSION)-py3-none-any.whl`. `pip wheel --no-deps` builds them into
`packages/`. Because the rules are keyed on that file name:

- An uninitialized submodule gives an empty version and a broken file name.
- New submodule code with the same `__version__` does not rebuild the wheel in `make all`; use
  `make packages`.
- The lockfile records whatever version the wheel's metadata reports.

The `packages/py-shiny` submodule is not built into the bundle. `make test-deps` installs it so the
Playwright controllers match the bundled markup, and `update_shiny.yml` checks it out at the tag of
the newest bundled release. `packages/py-htmltools` is still a submodule, but no build step uses it.
`make submodules` fetches full history and tags for py-shiny and py-shinywidgets.

## libsass

libsass has compiled code, so it is not a PyPI pure-Python wheel. It is built for Pyodide in
gadenbuie/libsass-python, and the Makefile downloads `$(LIBSASS_WHEEL)` (currently
`libsass-0.23.0-cp312-abi3-pyodide_2024_0_wasm32.whl`) from `pkg.garrickadenbuie.com` into
`packages/`. In `shinylive_requirements.json` it is a `local` package in `LOCAL_NOT_RESOLVED`, so
every lock gets it directly. The file name encodes the Python version and Pyodide ABI; when a
Pyodide bump changes either, a new wheel must be built in that repo (its `pyodide.yml` workflow)
and `LIBSASS_WHEEL` updated. `make clean-packages` deletes it too; `make all` downloads it again.

`PYODIDE_PYTHON_VERSION` and `UV_PYTHON_PLATFORM` in `pyodide_packages.py` describe the Pyodide
target for uv, and must change with a Pyodide bump as well.

## `.github/workflows/update_shiny.yml`

Runs weekly and on demand. It recomputes `shiny_versions.json`, checks out `packages/py-shiny` at
the newest bundled Python release tag, runs `make update_packages_lock` and `make all`, and opens
or updates a pull request from the `update-shiny-versions` branch when any of those three changed.
Details are in `ciAndRelease.md`.

## Updating example apps

py-shiny's docs and `api-examples/` on `main` can describe APIs that no bundled release has yet.
For example, `@render.download_button` appeared on `main` before it was released, and switching an
example to it would have broken that example.

Examples have no shiny pin, so they run the newest bundled version. Before replacing an API in an
example, check that the replacement exists in that release (the first `python` entry in
`shiny_versions.json`), and inspect the symbol in an environment with that version installed. An
example that needs an older shiny can pin it in `requirements.txt`.

`make test-deps` installs Shiny from the `packages/py-shiny` submodule, which `update_shiny.yml`
keeps at the newest bundled release, so the test controllers match the markup that version renders.
