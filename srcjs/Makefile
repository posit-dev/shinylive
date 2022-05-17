.PHONY: all packages download_pypi_packages \
	submodules submodules-pull \
	build watch serve \
	api-docs \
	quarto quartoserve \
	clean distclean \
	test test-watch

.DEFAULT_GOAL := help


PYODIDE_VERSION = 0.20.1a1
PYODIDE_DIST_FILENAME = pyodide-build-$(PYODIDE_VERSION).tar.bz2
BUILD_DIR = ./build
PACKAGE_DIR = ./packages

# Read htmltools and shiny versions from the package code. It's done with grep
# because if we try to load the package and read shiny.__version__, it requires
# the packages to be loadable first, which isn't possible without their
# dependencies being installed first.
HTMLTOOLS_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-htmltools/htmltools/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')
SHINY_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-shiny/shiny/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')

HTMLTOOLS_WHEEL = htmltools-$(HTMLTOOLS_VERSION)-py3-none-any.whl
SHINY_WHEEL = shiny-$(SHINY_VERSION)-py3-none-any.whl

VENV = venv
PYBIN = $(VENV)/bin


# Any targets that depend on $(VENV) or $(PYBIN) will cause the venv to be
# created. To use the ven, python scripts should run with the prefix $(PYBIN),
# as in `$(PYBIN)/pip`.
$(VENV):
	python3 -m venv $(VENV)

$(PYBIN): $(VENV)

define PRINT_HELP_PYSCRIPT
import re, sys

prev_line_help = None
for line in sys.stdin:
	if prev_line_help is None:
		match = re.match(r"^## (.*)", line)
		if match:
			prev_line_help = match.groups()[0]
		else:
			prev_line_help = None
	else:
		match = re.match(r'^([a-zA-Z_-]+)', line)
		if match:
			target = match.groups()[0]
			print("%-22s %s" % (target, prev_line_help))

		target = None
		prev_line_help = None

endef
export PRINT_HELP_PYSCRIPT

help:
	@python3 -c "$$PRINT_HELP_PYSCRIPT" < $(MAKEFILE_LIST)


## Update git submodules to commits referenced in this repository
submodules:
	git submodule init
	git submodule update --depth=20

## Pull latest changes in git submodules
submodules-pull:
	git submodule update --recursive --remote


## Build everything
all: node_modules \
	$(BUILD_DIR)/shinylive/jquery.terminal \
	$(BUILD_DIR)/shinylive/jquery.min.js \
	$(BUILD_DIR)/shinylive/style-resets.css \
	$(BUILD_DIR)/shinylive/loading.html \
	$(BUILD_DIR)/shinylive/pyodide \
	$(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL) \
	download_pypi_packages \
	$(BUILD_DIR)/shinylive/pyodide/packages.json \
	buildjs


## Install node modules using yarn
node_modules: package.json
	yarn

$(BUILD_DIR)/shinylive/jquery.terminal: node_modules/jquery.terminal
	mkdir -p $(BUILD_DIR)/shinylive/shinylive
	cp -Rv node_modules/jquery.terminal $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/jquery.min.js: node_modules/jquery/dist/jquery.min.js
	cp -Rv node_modules/jquery/dist/jquery.min.js $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/style-resets.css: src/style-resets.css
	cp src/style-resets.css $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/loading.html: src/loading.html
	cp src/loading.html $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/pyodide:
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	cd $(BUILD_DIR)/shinylive && \
	curl -L https://github.com/pyodide/pyodide/releases/download/$(PYODIDE_VERSION)/$(PYODIDE_DIST_FILENAME) \
	    | tar --exclude "*test*.tar" --exclude "node_modules" -xvj

$(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL): $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	cp $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL): $(PACKAGE_DIR)/$(SHINY_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	cp $(PACKAGE_DIR)/$(SHINY_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL)


## Build JS resources from src/ dir
buildjs:
	node scripts/build.mjs

## Build JS resources and watch for changes
watch:
	node scripts/build.mjs --watch

## Build JS resources, watch for changes, and serve site
serve:
	node scripts/build.mjs --serve


# Build htmltools and shiny. This target must be run manually after updating the
# package submodules; it will not run automatically with `make all` because I'm
# not sure how to set up the dependencies reliably.
## Build htmltools and shiny wheels
packages: $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) $(PACKAGE_DIR)/$(SHINY_WHEEL)

$(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-htmltools
	$(PYBIN)/pip install -r $(PACKAGE_DIR)/py-htmltools/requirements-dev.txt
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-htmltools
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-htmltools && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(SHINY_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-shiny
	$(PYBIN)/pip install -r $(PACKAGE_DIR)/py-shiny/requirements-dev.txt
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-shiny
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-shiny && make dist && mv dist/*.whl ../

# TODO: Figure out how to make this _not_ run every time, or at least not need
# network access.
## Download dependency packages from PyPI
download_pypi_packages: $(PYBIN) scripts/py_package_versions.py
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	. $(PYBIN)/activate && scripts/py_package_versions.py download_pypi_packages $(BUILD_DIR)/shinylive/pyodide

# Update pyodide's package.json to include htmltools, shiny, and their deps which aren't included in Pyodide.
$(BUILD_DIR)/shinylive/pyodide/packages.json: $(PYBIN) scripts/py_package_versions.py $(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL)
	$(PYBIN)/pip install -r requirements-dev.txt
	. $(PYBIN)/activate && scripts/py_package_versions.py insert_into_pyodide_packages $(BUILD_DIR)/shinylive/pyodide

## Build Shiny API docs
api-docs: $(PYBIN)
	. $(PYBIN)/activate && cd packages/py-shiny/docs && make html

## Build Quarto example site in quarto/
quarto:
	cd quarto && quarto render

## Build Quarto example site and serve
quartoserve:
	cd quarto && quarto preview --port 8080


## Remove all build files
clean:
	rm -rf $(PACKAGE_DIR)/*.whl $(BUILD_DIR) quarto/docs/
	cd $(PACKAGE_DIR)/py-shiny/docs && make clean

## Remove all build files and venv/
distclean: clean
	rm -rf $(VENV)

## Run tests
test:
	jest

## Run tests and watch
test-watch:
	jest --watch
