Shiny live
==========

A Python package for deploying Shiny applications that will run completely in the browser, using Pyodide (Python compiled to WebAssembly).

## Build instructions

There are two parts that need to be built:

* The `shinylive` Python package
* The JS/wasm resources used by `shinylive`.

The Makefile lives in the `srcjs/` directory.

```bash
cd srcjs
```

You must first initialize the git submodules. This only needs to be done once:

```bash
make submodules
```

After that, you can simply run `make all` in the `srcjs/` directory:

```bash
make all
```

To build and serve the live Examples page:

```bash
make serve
```

This will also watch the source files in `srcjs/` for changes, and will rebuild and auto-reload the web page when the files change.

To build the shinylive.tar.gz distribution file:

```bash
make dist
```


There is also a Quarto web site which demonstrates the shinylive components in different configurations. To build and serve the test Quarto web site with Quarto components, run (still in `srcjs/`):

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
buildjs                Build JS resources from src/ dir
watch                  Build JS resources and watch for changes
serve                  Build JS resources, watch for changes, and serve site
packages               Build htmltools and shiny wheels
download_pypi_packages Download dependency packages from PyPI
api-docs               Build Shiny API docs
quarto                 Build Quarto example site in quarto/
quartoserve            Build Quarto example site and serve
clean                  Remove all build files
distclean              Remove all build files and venv/
test                   Run tests
test-watch             Run tests and watch
```


## Pulling changes

After pulling changes to the parent repo, you may need to tell it to update submodules.

```bash
git pull
make submodules-pull
```


## File overview

This an overview of some of the important files and directories in this project.

```
├── bundle-and-serve.mjs
├── examples               # Shiny app examples used in Examples browser
├── quarto                 # Sources for an example Quarto site
│   └── docs               # Generated files for Quarto site
├── packages               # Git submodules for shiny and htmltools. Used for
│   ├── py-htmltools       #   building wheel files for shinylive.
│   └── py-shiny
├── pyodide_packages.py    # Script for downloading PyPI packages and inserting
│                          #   package metadata into pyodide's package.json.
│
├── src                    # TypeScript source files.
├── site                   # Example web site with shinylive, served by `yarn build-and-reload`.
└── dist                   # Generated JS/CSS/wasm components for shinylive.
```
