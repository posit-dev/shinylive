.PHONY: all dist \
	packages \
	update_packages_lock retrieve_packages update_pyodide_lock_json \
	pyodide_js \
	pyodide_packages_local \
	create_typeshed_json \
	copy_pyright \
	submodules submodules-pull submodules-pull-shiny submodules-pull-htmltools \
	buildjs watch serve \
	packages \
	quarto quartoserve \
	clean-packages clean distclean \
	examples-check-index type-check \
	test-deps test-unit test-unit-coverage \
	test-examples-smoke test-examples-intent test-site test-loader webr \
	_shinylive

.DEFAULT_GOAL := help

SHINYLIVE_VERSION = $(shell node -p "require('./package.json').version")

PYODIDE_VERSION = 0.27.7
PYODIDE_DIST_FILENAME = pyodide-$(PYODIDE_VERSION).tar.bz2
DOWNLOAD_DIR = ./downloads
R_SHINY_VERSION = 1.13.0.8000
BUILD_DIR = ./build
PACKAGE_DIR = ./packages
DIST_DIR = ./dist
SITE_DIR = ./site
SHINYLIVE_DIR = ./_shinylive

# Extract package versions by grepping source files. Each package may define
# __version__ in __init__.py, _version.py, or __version.py (hatch-vcs).
# We use a consistent helper that checks all three locations.
_get_version = $(shell grep '^__version__ = ' $(1)/__version.py $(1)/__init__.py $(1)/_version.py 2>/dev/null | head -1 | sed -E "s/.*['\"]([^'\"]+)['\"]/\1/")
HTMLTOOLS_VERSION = $(call _get_version,$(PACKAGE_DIR)/py-htmltools/htmltools)
SHINY_VERSION = $(call _get_version,$(PACKAGE_DIR)/py-shiny/shiny)
SHINYWIDGETS_VERSION = $(call _get_version,$(PACKAGE_DIR)/py-shinywidgets/shinywidgets)
FAICONS_VERSION = $(call _get_version,$(PACKAGE_DIR)/py-faicons/faicons)

HTMLTOOLS_WHEEL = htmltools-$(HTMLTOOLS_VERSION)-py3-none-any.whl
SHINY_WHEEL = shiny-$(SHINY_VERSION)-py3-none-any.whl
SHINYWIDGETS_WHEEL = shinywidgets-$(SHINYWIDGETS_VERSION)-py3-none-any.whl
FAICONS_WHEEL = faicons-$(FAICONS_VERSION)-py3-none-any.whl

# libsass is built in gadenbuie/libsass-python
# NOTE: Update https://github.com/gadenbuie/libsass-python/blob/dev/.github/workflows/pyodide.yml
# Pyodide, Emscripten, or Python versions change here.
LIBSASS_WHEEL=libsass-0.23.0-cp312-abi3-pyodide_2024_0_wasm32.whl

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
	cd packages/py-shiny && git fetch --tags --unshallow

## Pull latest changes in git submodules
submodules-pull:
	git submodule update --recursive --remote
	cd packages/py-shiny && git fetch --tags
submodules-pull-shiny:
	git submodule update --remote packages/py-shiny
	cd packages/py-shiny && git fetch --tags
submodules-pull-htmltools:
	git submodule update --remote packages/py-htmltools


## Build everything _except_ the shinylive.tar.gz distribution file
all: node_modules \
	$(BUILD_DIR)/shinylive/style-resets.css \
	$(BUILD_DIR)/shinylive/pyodide \
	$(BUILD_DIR)/shinylive/webr \
	pyodide_js \
	pyodide_packages_local \
	update_packages_lock_local \
	retrieve_packages \
	update_pyodide_lock_json \
	create_typeshed_json \
	copy_pyright \
	$(BUILD_DIR)/export_template/index.html \
	$(BUILD_DIR)/export_template/edit/index.html \
	_shinylive

## Build shinylive distribution .tar.gz file
dist: buildjs
	mkdir -p $(DIST_DIR)
	ln -s $(BUILD_DIR) shinylive-$(SHINYLIVE_VERSION)
	tar -chzvf $(DIST_DIR)/shinylive-$(SHINYLIVE_VERSION).tar.gz shinylive-$(SHINYLIVE_VERSION)
	rm shinylive-$(SHINYLIVE_VERSION)

## Install node modules
node_modules: package.json
	npm ci

$(BUILD_DIR)/shinylive/style-resets.css: src/style-resets.css
	mkdir -p $(BUILD_DIR)/shinylive
	cp src/style-resets.css $(BUILD_DIR)/shinylive

$(DOWNLOAD_DIR)/$(PYODIDE_DIST_FILENAME):
	mkdir -p $(DOWNLOAD_DIR)
	cd $(DOWNLOAD_DIR) && \
		curl --fail -L -O https://github.com/pyodide/pyodide/releases/download/$(PYODIDE_VERSION)/$(PYODIDE_DIST_FILENAME)

$(BUILD_DIR)/shinylive/pyodide: $(DOWNLOAD_DIR)/$(PYODIDE_DIST_FILENAME)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	tar --exclude "*test*.tar" --exclude "node_modules" \
		-xvjf $(DOWNLOAD_DIR)/$(PYODIDE_DIST_FILENAME) \
		-C $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/webr: webr
webr:
	mkdir -p $(BUILD_DIR)/shinylive/webr
	cp -r node_modules/webr/dist/. $(BUILD_DIR)/shinylive/webr
	curl --fail -L https://github.com/r-wasm/shiny/releases/download/v$(R_SHINY_VERSION)/library.data.gz -o $(BUILD_DIR)/shinylive/webr/library.data.gz
	curl --fail -L https://github.com/r-wasm/shiny/releases/download/v$(R_SHINY_VERSION)/library.js.metadata -o $(BUILD_DIR)/shinylive/webr/library.js.metadata
# FIXME: GitHub Pages does not cache Partial Content downloads. Here, we reduce
# the damage by forcing entire file downloads with Emscripten's lazy filesystem.
# Potentially, we can add a switch to Emscripten to disable the mechanism.
	sed -i.bak 's/if(!hasByteServing)//' $(BUILD_DIR)/shinylive/webr/R.js

# Copy pyodide.js and .d.ts to src/pyodide/. This is a little weird in that in
# `make all`, it comes after downloading pyodide. In the future we may be able
# to use a pyodide node module, but the one currently on npm is a bit out of
# date.
pyodide_js:
	cp $(BUILD_DIR)/shinylive/pyodide/pyodide.mjs src/pyodide/pyodide.js
	cp $(BUILD_DIR)/shinylive/pyodide/pyodide.d.ts src/pyodide/
	cp $(BUILD_DIR)/shinylive/pyodide/ffi.d.ts src/pyodide/

## Copy local package wheels to the pyodide directory
pyodide_packages_local: $(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(SHINYWIDGETS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(FAICONS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(LIBSASS_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL): $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	# Remove any old copies of htmltools
	rm -f $(BUILD_DIR)/shinylive/pyodide/htmltools*.whl
	cp $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL): $(PACKAGE_DIR)/$(SHINY_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	# Remove any old copies of shiny
	rm -f $(BUILD_DIR)/shinylive/pyodide/shiny*.whl
	cp $(PACKAGE_DIR)/$(SHINY_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(SHINYWIDGETS_WHEEL): $(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	# Remove any old copies of shinywidgets
	rm -f $(BUILD_DIR)/shinylive/pyodide/shinywidgets*.whl
	cp $(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(SHINYWIDGETS_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(FAICONS_WHEEL): $(PACKAGE_DIR)/$(FAICONS_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	# Remove any old copies of faicons
	rm -f $(BUILD_DIR)/shinylive/pyodide/faicons*.whl
	cp $(PACKAGE_DIR)/$(FAICONS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(FAICONS_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(LIBSASS_WHEEL): $(PACKAGE_DIR)/$(LIBSASS_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	rm -f $(BUILD_DIR)/shinylive/pyodide/libsass*.whl
	cp $(PACKAGE_DIR)/$(LIBSASS_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(LIBSASS_WHEEL)

$(BUILD_DIR)/export_template/index.html: export_template/index.html
	mkdir -p $(BUILD_DIR)/export_template
	cp export_template/index.html $(BUILD_DIR)/export_template/index.html

$(BUILD_DIR)/export_template/edit/index.html: export_template/edit/index.html
	mkdir -p $(BUILD_DIR)/export_template/edit
	cp export_template/edit/index.html $(BUILD_DIR)/export_template/edit/index.html


## Build JS resources from src/ dir
buildjs:
	node_modules/.bin/tsx scripts/build.ts

## Build JS resources for production (with minification)
buildjs-prod:
	node_modules/.bin/tsx scripts/build.ts --prod

## Build JS resources and watch for changes
watch:
	node_modules/.bin/tsx scripts/build.ts --watch

## Build JS resources, watch for changes, and serve site
serve:
	node_modules/.bin/tsx scripts/build.ts --serve

## Build JS resources for production, watch for changes, and serve site
serve-prod:
	node_modules/.bin/tsx scripts/build.ts --serve --prod

## Build JS resources with webR as the default engine
buildjs-r:
	node_modules/.bin/tsx scripts/build.ts --r

## Build JS resources for production with webR as the default engine
buildjs-prod-r:
	node_modules/.bin/tsx scripts/build.ts --prod --r

## Build JS resources for production and serve site with webR as the default engine
serve-prod-r:
	node_modules/.bin/tsx scripts/build.ts --serve --prod --r

## Build JS resources and serve site with webR as the default engine
serve-r:
	node_modules/.bin/tsx scripts/build.ts --serve --r

# Build the _shinylive directory for deployment of both R and Python sites
_shinylive:
	$(MAKE) buildjs-prod
	cp -Lr $(SITE_DIR)/. $(SHINYLIVE_DIR)/py
	$(MAKE) buildjs-prod-r
	cp -Lr $(SITE_DIR)/. $(SHINYLIVE_DIR)/r

# Build htmltools, shiny, and shinywidgets. This target must be run manually after
# updating the package submodules; it will not run automatically with `make all`
# because I'm not sure how to set up the dependencies reliably.
## Build htmltools, shiny, and shinywidgets wheels
packages: clean-packages \
	package-htmltools \
	package-shiny \
	package-shinywidgets \
	package-faicons


package-htmltools: $(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL)

package-shiny: $(PACKAGE_DIR)/$(SHINY_WHEEL)

package-shinywidgets: $(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL)

package-faicons: $(PACKAGE_DIR)/$(FAICONS_WHEEL)


$(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-htmltools
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/htmltools*.whl
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-htmltools && pip wheel --no-deps -w ../  .

$(PACKAGE_DIR)/$(SHINY_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-shiny
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/shiny*.whl
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-shiny && pip wheel --no-deps -w ../ .

$(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-shinywidgets
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/shinywidgets*.whl
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-shinywidgets && pip wheel --no-deps -w ../ .

$(PACKAGE_DIR)/$(FAICONS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-faicons
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/faicons*.whl
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-faicons && pip wheel --no-deps -w ../ .

$(PACKAGE_DIR)/$(LIBSASS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/$(LIBSASS_WHEEL)
	rm -f $(PACKAGE_DIR)/libsass*.whl
	curl --fail -L https://pkg.garrickadenbuie.com/libsass-python/$(LIBSASS_WHEEL) -o $(PACKAGE_DIR)/$(LIBSASS_WHEEL)

## Update the shinylive_lock.json file, based on shinylive_requirements.json
update_packages_lock: $(PYBIN) $(BUILD_DIR)/shinylive/pyodide
	$(PYBIN)/pip install -r requirements-dev.txt
	. $(PYBIN)/activate && scripts/pyodide_packages.py generate_lockfile

## Update the shinylive_lock.json file, but with local packages only
update_packages_lock_local: $(PYBIN) $(BUILD_DIR)/shinylive/pyodide
	$(PYBIN)/pip install -r requirements-dev.txt
	. $(PYBIN)/activate && scripts/pyodide_packages.py update_lockfile_local

## Download packages in shinylive_lock.json from PyPI
retrieve_packages: $(PYBIN) $(BUILD_DIR)/shinylive/pyodide \
		$(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL) \
		$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL) \
		$(BUILD_DIR)/shinylive/pyodide/$(SHINYWIDGETS_WHEEL) \
		$(BUILD_DIR)/shinylive/pyodide/$(FAICONS_WHEEL)
	$(PYBIN)/pip install -r requirements-dev.txt
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	. $(PYBIN)/activate && scripts/pyodide_packages.py retrieve_packages

## Update pyodide/pyodide-lock.json to include packages in shinylive_lock.json
update_pyodide_lock_json: $(PYBIN)
	. $(PYBIN)/activate && scripts/pyodide_packages.py update_pyodide_lock_json

## Create the typeshed.json file which will be used by the shinylive type checker
create_typeshed_json: $(PYBIN)
	. $(PYBIN)/activate && scripts/create_typeshed.py

## Copy src/pyright files to build directory
copy_pyright:
	mkdir -p $(BUILD_DIR)/shinylive/pyright
	cp -r src/pyright/* $(BUILD_DIR)/shinylive/pyright


## Build Quarto example site in quarto/
quarto:
	cd quarto && quarto render

## Build Quarto example site and serve
quartoserve:
	cd quarto && quarto preview --port 8080


## Remove built wheels from the packages/ directory
clean-packages:
	rm -f $(PACKAGE_DIR)/*.whl

## Remove all build files
clean:
	rm -rf $(PACKAGE_DIR)/*.whl $(BUILD_DIR) $(DIST_DIR) \
	  $(SHINYLIVE_DIR)/py $(SHINYLIVE_DIR)/r quarto/docs/ typings/

## Remove all build files, venv/, and downloads/
distclean: clean
	rm -rf $(VENV) $(DOWNLOAD_DIR)

## Check that every example on disk is listed in examples/index.json
examples-check-index:
	node scripts/check_examples_index.mjs

## Type-check everything, including the unit tests (swc does not check types)
type-check: node_modules
	npm run type-check

## Run the TypeScript unit tests (jest); needs no build and no Python
test-unit: node_modules
	npm run test:unit

## Run the TypeScript unit tests and report coverage
test-unit-coverage: node_modules
	npm run test:unit:coverage

# The example tests drive apps with `shiny.playwright.controller`, whose locators
# track the markup a given Shiny renders, so the installed Shiny has to be the
# one shinylive bundles -- the submodule $(SHINY_WHEEL) is built from.
#
# The `##` line has to sit directly above the target for `make help` to find it.
## Install the Python dependencies for the tests in tests/
test-deps: $(PYBIN) $(PACKAGE_DIR)/py-shiny
	$(PYBIN)/pip install -r requirements-test.txt
	$(PYBIN)/pip install $(PACKAGE_DIR)/py-shiny
	$(PYBIN)/playwright install --with-deps chromium

# Arguments shared by the example app test targets. Set EXAMPLES_ENGINE (`py` or
# `r`) and EXAMPLES_SHARD (as in `1/3`) to run part of the suite; CI splits it
# both ways so every job gets a runner, and therefore the full memory, to
# itself. Each test boots a whole Pyodide or webR instance, so they want memory
# rather than cores, and parallel workers inside one runner would squeeze all of
# them -- wall-clock time comes from sharding across jobs instead.
#
# The `examples` marker keeps the site tests out of that matrix; they get their
# own target below.
EXAMPLES_PYTEST_ARGS = \
  -m "examples$(if $(EXAMPLES_ENGINE), and $(EXAMPLES_ENGINE))" \
  $(if $(EXAMPLES_SHARD),--shard=$(EXAMPLES_SHARD)) \
  $(if $(CI),--reruns 1)

## Run the smoke and intent tests for every example app (needs `make all`)
test-examples-smoke: test-deps
	$(PYBIN)/pytest tests $(EXAMPLES_PYTEST_ARGS)

## Run only the example app intent tests (needs `make all`)
test-examples-intent: test-deps
	$(PYBIN)/pytest tests/test_examples_intent_py.py tests/test_examples_intent_r.py \
	  $(EXAMPLES_PYTEST_ARGS)

# The site tests cover the build itself rather than any example app: the editor,
# apps loaded from the URL, and a static export assembled from build/ by
# tests/export_app.py. There is one engine's worth of work here, so they run in a
# single job rather than the examples' engine x shard matrix.
#
# This and `test-loader` are halves of a pair: every test in tests/ marked `site`
# is in exactly one of them. The loader tests are split out because they boot an
# engine per test and cost about as much as all the other site tests together, so
# they get their own CI job rather than sitting in the one that deploys. Running
# both covers the whole `site` marker.
## Run the site and static export tests (needs `make all`)
test-site: test-deps
	$(PYBIN)/pytest tests -m "site and not loader" $(if $(CI),--reruns 1)

# The other half of the pair above. Slow by nature: most of these load a real
# engine, and one deliberately delays the load so the loader has stages to
# report. See "Watching a loader test by hand" in tests/README.md.
## Run the loader status and failure-mode tests (needs `make all`)
test-loader: test-deps
	$(PYBIN)/pytest tests -m loader $(if $(CI),--reruns 1)
