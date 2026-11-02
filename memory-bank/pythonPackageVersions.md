---
title: Python Package Versions in Shinylive
description: Where the Python package versions that examples run against come from (shinylive_lock.json, the packages/ submodules), and why py-shiny main's docs are not a safe guide when updating example apps.
---

# Python Package Versions in Shinylive

Python apps run against the wheels listed in `shinylive_lock.json`, on top of the base Pyodide
packages. The lockfile is generated from `shinylive_requirements.json` with
`make update_packages_lock`.

htmltools, shiny, shinywidgets, and faicons are built from the git submodules in `packages/`
(`make packages`), and their versions are read from each submodule's source by the `Makefile`. So
the Shiny that examples see is the submodule's commit, not py-shiny `main` and not the latest PyPI
release.

## Updating example apps

py-shiny's docs and `api-examples/` on `main` can describe APIs the bundled wheel does not have
yet. For example, `@render.download_button` appeared on `main` before it was in the bundled
release, and switching an example to it would have broken that example.

Before replacing an API in an example, check that the replacement exists in the bundled version:
look up the version in `shinylive_lock.json` (or the submodule's `__version__`), and inspect the
symbol in an environment with that version installed.

`make test-deps` installs Shiny from the same submodule, so the test controllers match the markup
the bundled Shiny renders.
