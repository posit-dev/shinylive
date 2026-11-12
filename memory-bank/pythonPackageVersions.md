---
title: Python Package Versions in Shinylive
description: Where the Python package versions that examples run against come from (shinylive_requirements.json, shinylive_lock.json, the packages/ submodules, pyodide-lock.json), how scripts/pyodide_packages.py and update_shiny.yml move them along, and why py-shiny main's docs are not a safe guide when updating example apps.
---

# Python Package Versions in Shinylive

Python apps run against the wheels listed in `shinylive_lock.json`, on top of the base Pyodide
packages. The lockfile is generated from `shinylive_requirements.json` with
`make update_packages_lock`.

htmltools, shiny, shinywidgets, and faicons are built from the git submodules in `packages/`
(`make packages`), and their versions are read from each submodule's source by the `Makefile`. So
the Shiny that examples see is the submodule's commit, not py-shiny `main` and not the latest PyPI
release.

## The three files

- `shinylive_requirements.json` (hand-edited) — the top-level packages to add to Pyodide. Each
  entry has `name`, `source` (`"local"` or `"pypi"`), and `version` (`"latest"` or an exact
  version; ranges are not supported). Extra keys such as `comment` are ignored.
- `shinylive_lock.json` (generated, tracked) — every added package and its dependencies, with
  `version`, `filename`, `sha256`, `url`, `depends`, and `imports`. Local packages have
  `sha256: null` and `url: null`, because local wheel builds are not byte-for-byte reproducible.
- `build/shinylive/pyodide/pyodide-lock.json` (generated, not tracked) — Pyodide's own package
  index, which Pyodide reads at runtime. It is rebuilt from a saved copy of the original plus
  every package in `shinylive_lock.json`.

## `scripts/pyodide_packages.py`

One subcommand per Makefile target. All run inside `venv/` with `requirements-dev.txt`
(`pkginfo`, `requirements-parser`, `packaging`) installed.

- `generate_lockfile` (`make update_packages_lock`) — reads every requirement. Local packages get
  their info from the one wheel in `packages/` whose name starts with `<name>-` (exactly one must
  exist), read with `pkginfo`. Both lock targets depend on those wheels in the Makefile
  (`LOCAL_WHEELS`), and each wheel's rule removes older copies before building. PyPI packages come from `https://pypi.org/pypi/<name>[/<version>]/json`;
  `_find_pypi_meta_with_wheel` takes the first `py3-none-any.whl`, and if the chosen release has
  none, walks back to the newest release that does. `_recurse_dependencies_lockfile` then adds
  each dependency that is not already in the lockfile or in the original Pyodide lock, always at
  the latest pure-Python version. Lockfile keys and both checks use the PEP 503 name
  (`packaging.utils.canonicalize_name`), because Pyodide looks packages up by it and parents
  spell dependencies either way (`jupyterlab_widgets`). Version constraints in dependencies
  are ignored. The whole file is replaced.
- `update_lockfile_local` (`make update_packages_lock_local`, part of `make all`) — refreshes only
  the `local` entries from the wheels in `packages/`, merges them into the existing lockfile, and
  fetches any dependency that is now missing. PyPI entries keep their pinned versions, and
  dependencies that are no longer needed are not removed.
- `retrieve_packages` (`make retrieve_packages`) — for each lockfile entry, copies local wheels
  from `packages/` and downloads PyPI wheels into `build/shinylive/pyodide/`. A file already on
  disk is kept if its SHA256 matches. Downloads are checked against the lockfile SHA256.
- `update_pyodide_lock_json` (`make update_pyodide_lock_json`; the Python function is
  `update_pyodide_pyodide_lock_json`) — loads the original Pyodide lock via
  `orig_pyodide_lock()`, adds each lockfile package with `install_dir: "site"`, and computes the
  SHA256 of local wheels from `packages/`. It then appends `EXTRA_DEPENDENCIES` (jinja2 for pandas,
  setuptools for palmerpenguins, anyio for Pyodide's starlette) and drops `OMIT_DEPENDENCIES` (shiny
  from shinychat, to break a cycle). The result is written without indentation. Finally it
  deletes every `.whl` in `build/shinylive/pyodide/` (and its `.whl.metadata`) that the new lock
  does not list: older versions from earlier lock files, Pyodide's copies of packages the
  lockfile replaces. Wheels Pyodide lists, such as `numpy_tests`, stay. Before writing, it fails
  if the new lock lists a file that is not on disk (except the `*-tests.zip` archives the
  Makefile never unpacks). The Make target depends on `retrieve_packages`, so lockfile wheels
  are there first; the other cause is a dropped replacement whose Pyodide wheel was already
  deleted, which `make clean && make all` fixes. `make _shinylive` empties `_shinylive/py` and
  `_shinylive/r` before copying, so pruned wheels leave there too. `make test-scripts` tests
  this pruning and `orig_pyodide_lock()`.

`orig_pyodide_lock()` keeps `pyodide-lock.orig.json` next to `pyodide-lock.json`, so the script
can be run again without stacking additions. It copies the current file over it when the copy
is missing or when the current file has no `shiny` entry, which means Pyodide was just unpacked
(Pyodide 0.28 dropped `info.version`, so versions cannot be compared). This assumes Pyodide
never ships shiny. A current file that cannot be read raises an error rather than replacing
the saved copy.

Dependency filtering (`_filter_requires`): any requirement with a `;` marker is dropped, except
`platform_system == "Emscripten"` (kept for mizani's tzdata). Names in `AVOID_DEPEND_PACKAGES`
(`contextvars`, `websockets`, `ipykernel`, `widgetsnbextension`, `typing`, `python`) are never
listed as dependencies; the check uses the PEP 503 name. The `imports` value for PyPI packages
is guessed from the name PyPI reports, not the PEP 503 key, so dots survive (`python-` and `-py`
stripped, `-` to `_`).

A lockfile package that Pyodide also ships replaces Pyodide's entry, even when the lockfile
version is older. `update_pyodide_pyodide_lock_json` prints `<name> (replaces Pyodide's <version>)`
for each one, so check the `make all` output after a Pyodide bump.

## How submodule wheels get their version

The `Makefile` helper `_get_version` greps `^__version__ = ` in `__version.py`, `__init__.py`, or
`_version.py` of each package and builds file names like
`shiny-$(SHINY_VERSION)-py3-none-any.whl`. `pip wheel --no-deps` builds them into `packages/`.
Because the rules are keyed on that file name:

- An uninitialized submodule gives an empty version and a broken file name.
- New submodule code with the same `__version__` does not rebuild the wheel in `make all`; use
  `make packages`.
- The lockfile records whatever version the wheel's metadata reports.

`make submodules` also fetches full history and tags for py-shiny and py-shinywidgets, so
version tooling that reads git tags can work in those checkouts.

## libsass

libsass has compiled code, so it is not a PyPI pure-Python wheel. It is built for Pyodide in
gadenbuie/libsass-python, and the Makefile downloads `$(LIBSASS_WHEEL)` (currently
`libsass-0.23.0-cp312-abi3-pyodide_2024_0_wasm32.whl`) from `pkg.garrickadenbuie.com` into
`packages/`. In `shinylive_requirements.json` it is a `local` package, so it is handled like the
submodule wheels from there on. The file name encodes the Python version and Pyodide ABI; when a
Pyodide bump changes either, a new wheel must be built in that repo (its `pyodide.yml` workflow)
and `LIBSASS_WHEEL` updated. `make clean-packages` deletes it too; `make all` downloads it again.

## `.github/workflows/update_shiny.yml`

Manual (`workflow_dispatch`) only. It runs `make submodules`, then `make submodules-pull-shiny`
(moves `packages/py-shiny` to the tip of its remote branch), then `make all`. On a fresh runner
there are no wheels, so the new Shiny wheel is built, and `update_packages_lock_local` rewrites
the shiny entry and adds any new dependencies. It commits only `packages/py-shiny` and
`shinylive_lock.json`, with the message `Pull latest posit-dev/py-shiny@<sha>`, and pushes
straight to `main`. It does not update the other submodules or the PyPI pins.

## Updating example apps

py-shiny's docs and `api-examples/` on `main` can describe APIs the bundled wheel does not have
yet. For example, `@render.download_button` appeared on `main` before it was in the bundled
release, and switching an example to it would have broken that example.

Before replacing an API in an example, check that the replacement exists in the bundled version:
look up the version in `shinylive_lock.json` (or the submodule's `__version__`), and inspect the
symbol in an environment with that version installed.

`make test-deps` installs Shiny from the same submodule, so the test controllers match the markup
the bundled Shiny renders.
