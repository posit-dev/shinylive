.PHONY: all packages submodule_update download_pypi_packages clean test test-watch

PYODIDE_VERSION = 0.20.0
PYODIDE_DIST_FILENAME = pyodide-build-$(PYODIDE_VERSION).tar.bz2
OUT_DIR = ./shinylive
PACKAGE_DIR = ./packages

# Read htmltools and shiny versions from the package code
HTMLTOOLS_VERSION = $(shell cd packages/py-htmltools/ && python3 -c "import htmltools; print(htmltools.__version__)")
SHINY_VERSION = $(shell cd packages/py-shiny/ && python3 -c "import shiny; print(shiny.__version__)")

HTMLTOOLS_WHEEL = htmltools-$(HTMLTOOLS_VERSION)-py3-none-any.whl
SHINY_WHEEL = shiny-$(SHINY_VERSION)-py3-none-any.whl

all: node_modules \
	submodule_update \
	serviceworker.js \
	$(OUT_DIR)/jquery.terminal \
	$(OUT_DIR)/jquery.min.js \
	$(OUT_DIR)/style-resets.css \
	$(OUT_DIR)/loading.html \
	$(OUT_DIR)/pyodide \
	$(OUT_DIR)/pyodide/$(HTMLTOOLS_WHEEL) \
	$(OUT_DIR)/pyodide/$(SHINY_WHEEL) \
	$(OUT_DIR)/inject-socket.js \
	$(OUT_DIR)/pyodide-worker.js \
	$(OUT_DIR)/run-python-blocks.js \
	download_pypi_packages \
	$(OUT_DIR)/pyodide/packages.json \
	$(OUT_DIR)/Components/App.js


node_modules: package.json
	yarn

$(OUT_DIR)/jquery.terminal: node_modules/jquery.terminal
	mkdir -p $(OUT_DIR)
	cp -Rv node_modules/jquery.terminal $(OUT_DIR)

$(OUT_DIR)/jquery.min.js: node_modules/jquery/dist/jquery.min.js
	cp -Rv node_modules/jquery/dist/jquery.min.js $(OUT_DIR)

$(OUT_DIR)/style-resets.css: src/style-resets.css
	cp src/style-resets.css $(OUT_DIR)

$(OUT_DIR)/loading.html: src/loading.html
	cp src/loading.html $(OUT_DIR)

$(OUT_DIR)/pyodide:
	cd $(OUT_DIR) && \
	curl -L https://github.com/pyodide/pyodide/releases/download/$(PYODIDE_VERSION)/$(PYODIDE_DIST_FILENAME) \
	    | tar --exclude "*test*.tar" -xvz

$(OUT_DIR)/pyodide/$(HTMLTOOLS_WHEEL): $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL)
	mkdir -p $(OUT_DIR)/pyodide
	cp $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) $(OUT_DIR)/pyodide/$(HTMLTOOLS_WHEEL)

$(OUT_DIR)/pyodide/$(SHINY_WHEEL): $(PACKAGE_DIR)/$(SHINY_WHEEL)
	mkdir -p $(OUT_DIR)/pyodide
	cp $(PACKAGE_DIR)/$(SHINY_WHEEL) $(OUT_DIR)/pyodide/$(SHINY_WHEEL)


serviceworker.js: src/serviceworker.ts
	esbuild src/serviceworker.ts --target=es2020 --bundle --outdir=./

$(OUT_DIR)/pyodide-worker.js: src/pyodide-worker.ts
	esbuild src/pyodide-worker.ts --target=es2020 --bundle --outdir=$(OUT_DIR)

$(OUT_DIR)/inject-socket.js: src/inject-socket.ts
	esbuild src/inject-socket.ts --target=es2020 --bundle --outdir=$(OUT_DIR)

$(OUT_DIR)/run-python-blocks.js: src/run-python-blocks.ts
	esbuild src/run-python-blocks.ts --target=es2020 --outdir=$(OUT_DIR)

$(OUT_DIR)/Components/App.js:
# Create symlink from site/shinylive to shinylive, if needed.
	cd site && if [ ! -h shinylive ]; then ln -s ../shinylive; fi
	node bundle-and-serve.mjs


# Build htmltools and shiny. This target must be run manually after updating the
# package submodules; it will not run automatically with `make all` because I'm
# not sure how to set up the dependencies reliably.
packages: $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) $(PACKAGE_DIR)/$(SHINY_WHEEL)

$(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL): $(PACKAGE_DIR)/py-htmltools
	pip install -r $(PACKAGE_DIR)/py-htmltools/requirements-dev.txt
	pip install -e $(PACKAGE_DIR)/py-htmltools
	cd $(PACKAGE_DIR)/py-htmltools && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(SHINY_WHEEL): $(PACKAGE_DIR)/py-shiny
	pip install -r $(PACKAGE_DIR)/py-shiny/requirements-dev.txt
	pip install -e $(PACKAGE_DIR)/py-shiny
	cd $(PACKAGE_DIR)/py-shiny && make dist && mv dist/*.whl ../


submodule_update:
	git submodule init
	git submodule update --depth=20

# Download some packages from PyPI.
# TODO: Figure out how to make this _not_ run every time, or at least not need
# network access.
download_pypi_packages: ./py_package_versions.py
	mkdir -p $(OUT_DIR)/pyodide
	./py_package_versions.py download_pypi_packages $(OUT_DIR)/pyodide

# Update pyodide's package.json to include htmltools, shiny, and their
# dependencies which aren't included in Pyodide.
$(OUT_DIR)/pyodide/packages.json: ./py_package_versions.py $(OUT_DIR)/pyodide/$(HTMLTOOLS_WHEEL) $(OUT_DIR)/pyodide/$(SHINY_WHEEL)
	./py_package_versions.py insert_into_pyodide_packages $(OUT_DIR)/pyodide

clean:
	rm -rf  $(PACKAGE_DIR)/*.whl shinylive

test:
	jest

test-watch:
	jest --watch
