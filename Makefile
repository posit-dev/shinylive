.PHONY: all dist \
	packages \
	update_packages_lock retrieve_packages update_pyodide_repodata_json \
	pyodide_packages_local \
	create_typeshed_json \
	copy_pyright \
	submodules submodules-pull \
	buildjs watch serve \
	packages \
	quarto quartoserve \
	clean-packages clean distclean \
	test test-watch webr \
	_shinylive

.DEFAULT_GOAL := help

SHINYLIVE_VERSION = $(shell node -p "require('./package.json').version")

PYODIDE_VERSION = 0.22.1
PYODIDE_DIST_FILENAME = pyodide-$(PYODIDE_VERSION).tar.bz2
BUILD_DIR = ./build
PACKAGE_DIR = ./packages
DIST_DIR = ./dist
SITE_DIR = ./site
SHINYLIVE_DIR = ./_shinylive

# Read htmltools and shiny versions from the package code. It's done with grep
# because if we try to load the package and read shiny.__version__, it requires
# the packages to be loadable first, which isn't possible without their
# dependencies being installed first.
HTMLTOOLS_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-htmltools/htmltools/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')
SHINY_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-shiny/shiny/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')
SHINYWIDGETS_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-shinywidgets/shinywidgets/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')
FAICONS_VERSION = $(shell grep '^__version__ = ' $(PACKAGE_DIR)/py-faicons/faicons/__init__.py | sed -E -e 's/^__version__ = "(.*)"/\1/')

HTMLTOOLS_WHEEL = htmltools-$(HTMLTOOLS_VERSION)-py3-none-any.whl
SHINY_WHEEL = shiny-$(SHINY_VERSION)-py3-none-any.whl
SHINYWIDGETS_WHEEL = shinywidgets-$(SHINYWIDGETS_VERSION)-py3-none-any.whl
FAICONS_WHEEL = faicons-$(FAICONS_VERSION)-py3-none-any.whl

# Hard code these versions for now
PLOTNINE_VERSION=0.0.0
MIZANI_VERSION=0.0.0
PLOTNINE_WHEEL=plotnine-$(PLOTNINE_VERSION)-py3-none-any.whl
MIZANI_WHEEL=mizani-$(MIZANI_VERSION)-py3-none-any.whl

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


## Build everything _except_ the shinylive.tar.gz distribution file
all: node_modules \
	$(BUILD_DIR)/shinylive/style-resets.css \
	$(BUILD_DIR)/shinylive/pyodide \
	$(BUILD_DIR)/shinylive/webr \
	src/pyodide/pyodide.js \
	src/pyodide/pyodide.d.ts \
	pyodide_packages_local \
	update_packages_lock_local \
	retrieve_packages \
	update_pyodide_repodata_json \
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

## Install node modules using yarn
node_modules: package.json
	yarn

$(BUILD_DIR)/shinylive/style-resets.css: src/style-resets.css
	mkdir -p $(BUILD_DIR)/shinylive
	cp src/style-resets.css $(BUILD_DIR)/shinylive

$(BUILD_DIR)/shinylive/pyodide:
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	cd $(BUILD_DIR)/shinylive && \
	curl -L https://github.com/pyodide/pyodide/releases/download/$(PYODIDE_VERSION)/$(PYODIDE_DIST_FILENAME) \
	    | tar --exclude "*test*.tar" --exclude "node_modules" -xvj

$(BUILD_DIR)/shinylive/webr: webr
webr:
	mkdir -p $(BUILD_DIR)/shinylive/webr
	cp -r node_modules/webr/dist/. $(BUILD_DIR)/shinylive/webr

# Copy pyodide.js and .d.ts to src/pyodide/. This is a little weird in that in
# `make all`, it comes after downloading pyodide. In the future we may be able
# to use a pyodide node module, but the one currently on npm is a bit out of
# date.
src/pyodide/pyodide.js: $(BUILD_DIR)/shinylive/pyodide/pyodide.mjs
	cp $(BUILD_DIR)/shinylive/pyodide/pyodide.mjs src/pyodide/pyodide.js
src/pyodide/pyodide.d.ts: $(BUILD_DIR)/shinylive/pyodide/pyodide.d.ts
	cp $(BUILD_DIR)/shinylive/pyodide/pyodide.d.ts src/pyodide/

## Copy local package wheels to the pyodide directory
pyodide_packages_local: $(BUILD_DIR)/shinylive/pyodide/$(HTMLTOOLS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(SHINY_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(SHINYWIDGETS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(FAICONS_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(MIZANI_WHEEL) \
	$(BUILD_DIR)/shinylive/pyodide/$(PLOTNINE_WHEEL)

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

$(BUILD_DIR)/shinylive/pyodide/$(MIZANI_WHEEL): $(PACKAGE_DIR)/$(MIZANI_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	rm -f $(BUILD_DIR)/shinylive/pyodide/mizani*.whl
	cp $(PACKAGE_DIR)/$(MIZANI_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(MIZANI_WHEEL)

$(BUILD_DIR)/shinylive/pyodide/$(PLOTNINE_WHEEL): $(PACKAGE_DIR)/$(PLOTNINE_WHEEL)
	mkdir -p $(BUILD_DIR)/shinylive/pyodide
	rm -f $(BUILD_DIR)/shinylive/pyodide/plotnine*.whl
	cp $(PACKAGE_DIR)/$(PLOTNINE_WHEEL) $(BUILD_DIR)/shinylive/pyodide/$(PLOTNINE_WHEEL)

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
	$(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL) \
	$(PACKAGE_DIR)/$(SHINY_WHEEL) \
	$(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL) \
	$(PACKAGE_DIR)/$(FAICONS_WHEEL) \
	$(PACKAGE_DIR)/$(MIZANI_WHEEL) \
	$(PACKAGE_DIR)/$(PLOTNINE_WHEEL) \

$(PACKAGE_DIR)/$(HTMLTOOLS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-htmltools
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/htmltools*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-htmltools[dev,test]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-htmltools && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(SHINY_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-shiny
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/shiny*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-shiny[dev,test]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-shiny && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(SHINYWIDGETS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-shinywidgets
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/shinywidgets*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-shinywidgets[dev,test]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-shinywidgets && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(FAICONS_WHEEL): $(PYBIN) $(PACKAGE_DIR)/py-faicons
	# Remove any old copies of the package
	rm -f $(PACKAGE_DIR)/faicons*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/py-faicons[dev,test]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/py-faicons && make dist && mv dist/*.whl ../

$(PACKAGE_DIR)/$(MIZANI_WHEEL): $(PYBIN) $(PACKAGE_DIR)/mizani
	rm -f $(PACKAGE_DIR)/mizani*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/mizani[build]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/mizani && make dist && mv dist/*.whl ../$(MIZANI_WHEEL)

$(PACKAGE_DIR)/$(PLOTNINE_WHEEL): $(PYBIN) $(PACKAGE_DIR)/plotnine
	rm -f $(PACKAGE_DIR)/plotnine*.whl
	$(PYBIN)/pip install -e $(PACKAGE_DIR)/plotnine[build]
	. $(PYBIN)/activate && cd $(PACKAGE_DIR)/plotnine && make dist && mv dist/*.whl ../$(PLOTNINE_WHEEL)

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

## Update pyodide/repodata.json to include packages in shinylive_lock.json
update_pyodide_repodata_json: $(PYBIN)
	. $(PYBIN)/activate && scripts/pyodide_packages.py update_pyodide_repodata_json

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

## Remove all build files and venv/
distclean: clean
	rm -rf $(VENV)

## Run tests
test:
	yarn playwright test
