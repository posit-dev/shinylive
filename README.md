Shiny live
==========

A Python package for deploying Shiny applications that will run completely in the browser, using Pyodide (Python compiled to WebAssembly).

## Build instructions

There are two parts that need to be built:

* The `shinylive` Python package
* The JS/wasm resources used by `shinylive`.

To build the JS/wasm resources, you must initialize the git submodules. This only needs to be done once:

```bash
make submodules
```

Then after that, you can simply run `make` in the `srcjs/` directory:

```bash
cd srcjs
make all
```

To build serve the test web site with examples, run:

```bash
make quarto
make quartoserve
```

This will also watch the source TS files for changes and auto-reload the web page when they are modified and rebuilt.


## Pulling changes

After pulling changes to the parent repo, you may need to tell it to update submodules. (Note that running `make` in the `srcjs/` subdirectory will do this for you automatically.)

```bash
git pull
make submodules-pull
```
