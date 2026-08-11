Shinylive
==========

Code for deploying Shiny applications that will run completely in the browser, using Pyodide and webR (Python and R compiled to WebAssembly).

* Current semi-stable version (deployed from `deploy` branch of this repo):
    * R: https://shinylive.io/r/examples/
    * Python: https://shinylive.io/py/examples/
* Latest dev version (deployed from `main` branch of this repo):
    * R: https://posit-dev.github.io/shinylive/r/examples/
    * Python: https://posit-dev.github.io/shinylive/py/examples/

## Prerequisites

Building Shinylive requires NodeJS.

## Build instructions

You must first initialize the git submodules. This only needs to be done once:

```bash
make submodules
```

After that, you can simply run `make all`:

```bash
make all
```

To build and serve the live Python Examples page:

```bash
make serve
```

To build and serve the live R Examples page:

```bash
make serve-r
```

This will also watch the source files in `src/` for changes, and will rebuild and auto-reload the web page when the files change.

To build the shinylive.tar.gz distribution file:

```bash
make dist
```


There is also a Quarto web site which demonstrates the shinylive components in different configurations. To build and serve the test Quarto web site with Quarto components:

```bash
make quarto
make quartoserve
```

This will auto-rebuild and reload the Quarto site when a .qmd file in `quarto/` changes, but it will not auto-rebuild when the source TS files change.


You may occasionally need to clean out the built artifacts and rebuild:

```sh
make clean
make submodules
make all
```


You can see many of the `make` targets by just running `make`:

```
$ make
submodules             Update git submodules to commits referenced in this repository
submodules-pull        Pull latest changes in git submodules
all                    Build everything _except_ the shinylive.tar.gz distribution file
dist                   Build shinylive distribution .tar.gz file
node_modules           Install node modules
pyodide_packages_local Copy local package wheels to the pyodide directory
buildjs                Build JS resources from src/ dir
buildjs-prod           Build JS resources for production (with minification)
watch                  Build JS resources and watch for changes
serve                  Build JS resources, watch for changes, and serve site
serve-prod             Build JS resources for production, watch for changes, and serve site
buildjs-r              Build JS resources with webR as the default engine
buildjs-prod-r         Build JS resources for production with webR as the default engine
serve-prod-r           Build JS resources for production and serve site with webR as the default engine
serve-r                Build JS resources and serve site with webR as the default engine
packages               Build htmltools, shiny, and shinywidgets wheels
update_packages_lock   Update the shinylive_lock.json file, based on shinylive_requirements.json
update_packages_lock_local Update the shinylive_lock.json file, but with local packages only
retrieve_packages      Download packages in shinylive_lock.json from PyPI
update_pyodide_lock_json Update pyodide/pyodide-lock.json to include packages in shinylive_lock.json
create_typeshed_json   Create the typeshed.json file which will be used by the shinylive type checker
copy_pyright           Copy src/pyright files to build directory
quarto                 Build Quarto example site in quarto/
quartoserve            Build Quarto example site and serve
clean-packages         Remove built wheels from the packages/ directory
clean                  Remove all build files
distclean              Remove all build files, venv/, and downloads/
examples-check-index   Check that every example on disk is listed in examples/index.json
test-deps              Install the Python dependencies for the tests in tests/
examples-smoke-test    Run the smoke and intent tests for every example app (needs `make all`)
examples-intent-test   Run only the example app intent tests (needs `make all`)
site-test              Run the site and static export tests (needs `make all`)
```

## Tests

The browser tests live in `tests/` and run under pytest. They drive the built
`_shinylive/` output, so they need a `make all` first.

```sh
make test-deps            # once
make examples-smoke-test  # every app in examples/, both engines
make site-test            # the editor, apps loaded from the URL, static exports
```

See [tests/README.md](tests/README.md) for what each suite covers and for the
conventions to follow when adding to them.


## Testing

There are two suites, split by what they need to run.

### TypeScript unit tests (jest)

Pure logic in `src/` -- parsing, encoding, path handling, the pieces that don't need a browser. They need no build and no Python, and the whole suite runs in about a second.

```bash
make unit-test
```

`make` installs dependencies first if they're stale. To skip that, or to leave jest running on a watch loop, use the scripts directly:

```bash
npm run test:unit
npm run test:unit:watch
```

Tests live next to the code they cover, as `src/**/*.test.ts`. The runner is configured in `jest.config.js`: jsdom for a DOM, `@swc/jest` to strip TypeScript, and the stubs in `testing-helpers/` for CSS and asset imports and for the browser globals jsdom lacks. swc does not type-check, so `make type-check` is what checks the tests' types, alongside the rest of `src/`. CI runs it in the same job as the tests, and a failure blocks the build.

Anything that needs a real browser, a running app, or Pyodide/webR belongs in the app tests below rather than here.

#### Coverage

```bash
make unit-test-coverage
```

The run prints a note under the table saying what the figures cover, because the number on its own is easy to misread -- see below.

On a pull request, CI posts the same report as a comment, with a per-file comparison against the base branch and annotations on uncovered lines you touched. It is a signal, not a gate: there is no threshold, and a drop will not fail the build.

To exclude a line that can't be reached -- a defensive branch the types rule out, say -- mark it in the source:

```ts
/* v8 ignore next 3 */
if (thisCannotHappen) {
  return fallback;
}
```

Note the dialect. Coverage runs through v8, so it honours c8's `/* c8 ignore next */` and `/* v8 ignore next */` (plus `start`/`stop` to bracket a region), and *not* istanbul's `/* istanbul ignore next */`, which is silently ignored. It has to be a `/* */` block comment; `//` does not work.

Read the number for its direction, not its size. Coverage is collected only for the files the tests load, so the total moves as files enter and leave the suite -- the per-file deltas are the reliable part. It also says nothing about the roughly 85% of `src/` that is React, the editor and the engine proxies, which the app tests below cover instead.

### App tests (pytest driving Playwright)

Every app in `examples/`, loaded in a real browser against the built `_shinylive/` output, checked for tracebacks, warnings, output errors and console errors -- and, in the intent tests, driven through its inputs.

```bash
make examples-test-deps    # once
make all                   # the tests drive the built output
make examples-smoke-test   # both suites
make examples-intent-test  # only the intent tests
```

`tests/README.md` covers how these are put together, including `EXAMPLES_ENGINE` and `EXAMPLES_SHARD` for running part of the suite.

The specs in `playwright/` predate all of this and are not currently run by either suite; the `make test` target still points at them, but the `npm run playwright` script it calls no longer exists.

## Pulling changes

After pulling changes to the parent repo, you may need to tell it to update submodules.

```bash
git pull
make submodules
```

## Adding new packages or updating package versions

The `shinylive_lock.json` file lists specific versions of packages which will be included in the Shinylive distribution (in addition to the base Pyodide packages). This file is generated from `shinylive_requirements.json`.

If you add a package to `shinylive_requirements.json`, or want to update package versions, the lockfile must also be regenerated:

```
make update_packages_lock
```


## File overview

This an overview of some of the important files and directories in this project.

```
├── shinylive_requirements.json # List of packages to add on top of standard Pyodide installation.
├── shinylive_lock.json    # Lockfile generated from shinylive_requirements.json.
├── build                  # Generated JS/CSS/wasm components for shinylive (not committed to repo)
├── examples               # Shiny app examples used in Examples browser
├── packages               # Git submodules for htmltools, shiny, and ipyshiny.
│   ├── py-htmltools       #   Used for building wheel files for shinylive.
│   ├── py-shiny
│   └── ipyshiny
├── quarto                 # Sources for an example Quarto site
│   └── docs               # Generated files for Quarto site
├── export_template        # Files used for deployment via `shinylive deploy`
├── scripts
│   └── pyodide_packages.py # Script for downloading PyPI packages and inserting
│                           #   package metadata into pyodide's package.json.
│
├── src                    # TypeScript source files.
├── site                   # Example web site with shinylive, served by `make serve`.
└── _shinylive             # Directory containing files that are deployed to shinylive.io.
```
