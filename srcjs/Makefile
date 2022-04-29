.PHONY: all clean test test-watch

PYODIDE_VERSION = 0.20.0
PYODIDE_DIST_FILENAME = pyodide-build-$(PYODIDE_VERSION).tar.bz2
OUTDIR = ./shinylive/

all: node_modules \
	serviceworker.js \
	$(OUTDIR)/jquery.terminal \
	$(OUTDIR)/jquery.min.js \
	$(OUTDIR)/style-resets.css \
	$(OUTDIR)/loading.html \
	$(OUTDIR)/pyodide \
	$(OUTDIR)/inject-socket.js \
	$(OUTDIR)/pyodide-worker.js \
	$(OUTDIR)/run-python-blocks.js \
	$(OUTDIR)/Components/App.js


node_modules: package.json
	yarn

$(OUTDIR)/jquery.terminal: node_modules/jquery.terminal
	mkdir -p $(OUTDIR)
	cp -Rv node_modules/jquery.terminal $(OUTDIR)

$(OUTDIR)/jquery.min.js: node_modules/jquery/dist/jquery.min.js
	cp -Rv node_modules/jquery/dist/jquery.min.js $(OUTDIR)

$(OUTDIR)/style-resets.css: src/style-resets.css
	cp src/style-resets.css $(OUTDIR)

$(OUTDIR)/loading.html: src/loading.html
	cp src/loading.html $(OUTDIR)

$(OUTDIR)/pyodide:
	cd $(OUTDIR) && \
	curl -L https://github.com/pyodide/pyodide/releases/download/$(PYODIDE_VERSION)/$(PYODIDE_DIST_FILENAME) \
	    | tar --exclude "*test*.tar" -xvz

serviceworker.js: src/serviceworker.ts
	esbuild src/serviceworker.ts --target=es2020 --bundle --outdir=./

$(OUTDIR)/pyodide-worker.js: src/pyodide-worker.ts
	esbuild src/pyodide-worker.ts --target=es2020 --bundle --outdir=$(OUTDIR)

$(OUTDIR)/inject-socket.js: src/inject-socket.ts
	esbuild src/inject-socket.ts --target=es2020 --bundle --outdir=$(OUTDIR)

$(OUTDIR)/run-python-blocks.js: src/run-python-blocks.ts
	esbuild src/run-python-blocks.ts --target=es2020 --outdir=$(OUTDIR)

$(OUTDIR)/Components/App.js:
# Create symlink from site/shinylive to shinylive, if needed.
	cd site && if [ ! -h shinylive ]; then ln -s ../shinylive; fi
	node bundle-and-serve.mjs



clean:
	rm -rf shinylive

test:
	jest

test-watch:
	jest --watch
