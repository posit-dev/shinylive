Shiny live JS/CSS/wasm components
=================================

This directory contains source files needed to build shinylive. To build, run:

```sh
make submodules
make all
```

You may occasionally need to clean out the built artifacts and rebuild:

```sh
make clean
make all
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
├── py_package_versions.py # Script for downloading PyPI packages and inserting
│                          #   package metadata into pyodide's package.json.

├── src                    # TypeScript source files.
├── site                   # Example web site with shinylive, served by `yarn build-and-reload`.
├── serviceworker.js       # Generated from src/serviceworker.ts. This file must
│                          #   live in the parent of shinylive/.
└── shinylive              # Generated JS/CSS/wasm components for shinylive.
```
