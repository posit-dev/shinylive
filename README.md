Shinylive
==========

Code for deploying Shiny applications that will run completely in the browser, using Pyodide (Python compiled to WebAssembly).

* Current semi-stable version (deployed from `deploy` branch of this repo): https://shinylive.io/py/examples/
* Latest dev version (deployed from `main` branch of this repo): https://rstudio.github.io/shinylive/examples/

## Build instructions

You must first initialize the git submodules. This only needs to be done once:

```bash
make submodules
```

After that, you can simply run `make all`:

```bash
make all
```

To build and serve the live Examples page:

```bash
make serve
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
node_modules           Install node modules using yarn
pyodide_packages_local Copy local package wheels to the pyodide directory
buildjs                Build JS resources from src/ dir
buildjs-prod           Build JS resources for production (with minification)
watch                  Build JS resources and watch for changes
serve                  Build JS resources, watch for changes, and serve site
serve-prod             Build JS resources for production, watch for changes, and serve site
packages               Build htmltools, shiny, and shinywidgets wheels
update_packages_lock   Update the shinylive_lock.json file, based on shinylive_requirements.json
update_packages_lock_local Update the shinylive_lock.json file, but with local packages only
retrieve_packages      Download packages in shinylive_lock.json from PyPI
update_pyodide_repodata_json Update pyodide/repodata.json to include packages in shinylive_lock.json
create_typeshed_json   Create the typeshed.json file which will be used by the shinylive type checker
copy_pyright           Copy src/pyright files to build directory
api-docs               Build Shiny API docs
quarto                 Build Quarto example site in quarto/
quartoserve            Build Quarto example site and serve
clean-packages         Remove built wheels from the packages/ directory
clean                  Remove all build files
distclean              Remove all build files and venv/
test                   Run tests
test-watch             Run tests and watch
```


## Pulling changes

After pulling changes to the parent repo, you may need to tell it to update submodules.

```bash
git pull
make submodules
```

## Adding new packages

If you add a package to `shinylive_requirements.json`, the lockfile must also be regenerated:

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
