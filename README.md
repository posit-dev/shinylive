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

To build the JS/wasm resources, you must initialize the git submodules. This only needs to be done once:

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


## Pulling changes

After pulling changes to the parent repo, you may need to tell it to update submodules.

```bash
git pull
make submodules-pull
```
