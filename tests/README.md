# Browser tests

Everything here drives the built `_shinylive/` output in a real browser, under
pytest. There are two groups, marked `examples` and `site`, and every test
carries one of the two — CI selects on those markers and nothing else, so
`conftest.py` refuses to collect a test that has neither rather than let it
quietly never run.

**`examples`** — the apps in `examples/`:

- **`test_examples_smoke.py`** loads every indexed example, for both engines, and
  fails on tracebacks, deprecation warnings, output errors or JS console errors.
- **`test_examples_intent_py.py`** and **`test_examples_intent_r.py`** go further
  for each app: drive its inputs, and check the outputs that depend on them.

**`site`** — shinylive itself, rather than any one app:

- **`test_site_editor.py`** selects an example, and runs a script in the
  terminal.
- **`test_site_url_loading.py`** loads an app out of the URL hash in each of the
  three views, and checks the `h=0` option only the app view honours.
- **`test_site_export.py`** covers a static export: the app page, the `edit/`
  page, and the editor-cell mode.

Every test also fails on terminal tracebacks or warnings, Shiny output errors,
and browser console errors, including errors emitted after an interaction. A
test that provokes one on purpose opts out with `@pytest.mark.allow_page_errors`
and asserts on the failure itself.

```console
make test-deps              # once
make all                    # the tests drive the built output
make examples-smoke-test    # the smoke and intent suites
make examples-intent-test   # only the intent tests
make site-test              # the site and export suites
```

`EXAMPLES_ENGINE=py|r` and `EXAMPLES_SHARD=1/3` run part of the example suite; CI
splits it both ways, in `test-apps.yml`. The site tests are one job, in
`build.yml`, next to the build they test.

## Static exports without the Python package

`test_site_export.py` needs an exported app, which normally comes from the
Python shinylive package's `shinylive export`. Depending on that package here
would cause a circular dependency, so `export_app.py` assembles an export from `build/`
instead: `app.json` (the files, verbatim), `export_template/index.html`
with its variables filled in, `edit/index.html` as-is, and the shinylive bundle,
all of which `make all` produces. The `exported_app` fixture writes one and returns
the URL it is served at:

```python
def test_something(page, exported_app):
    page.goto(exported_app({"app.py": "..."}, name="something"))
```

The app mode comes from the `?_shinylive-mode=` query string, which is where
`runExportedApp()` reads it.

## Shiny's own controllers

The intent tests drive apps through `shiny.playwright.controller` -- the same
controllers py-shiny uses to test Shiny itself -- so an assertion describes the
Shiny component rather than the markup bslib happens to render for it:

```python
n = controller.InputSlider(app, "n")
n.expect_value("20")
n.set("40")
controller.OutputCode(app, "txt").expect_value("n*2 is 80")
```

`make test-deps` installs Shiny from the `packages/py-shiny` submodule rather
than from PyPI, because the controllers' locators track the markup a given Shiny
renders, and that submodule is the source of the Shiny wheel shinylive bundles
into the Python apps.

### The iframe

Those controllers take a `Page`, because in py-shiny's own tests the app under
test *is* the page. Shinylive renders it into an iframe. `open_example()` returns
a `ShinyliveApp`, which is that iframe wearing a `Page`'s clothes: the
controllers only ever reach for `locator()`, `keyboard`, `wait_for_timeout()` and
`evaluate()`, and only the first has to be frame-relative.

### Where the controllers need help

`controller_shims.py` holds the exceptions, each for one of two reasons.

R writes different markup from Python for the same component:

- **`OutputPlot`** — py-shiny keys on `.shiny-image-output.shiny-plot-output`,
  which is what `ui.output_plot()` renders. R's `plotOutput()` writes only the
  second of those.
- **`InputSelectize` vs `InputSelect`** — no shim needed, but note that R's
  `selectInput()` is selectize-backed by default where `ui.input_select()`
  renders a plain `<select>`.
- **`expect_animate_options(loop=)`** — expects Python's empty `data-loop`
  attribute; R writes the R literal `TRUE`. `tests/test_examples_intent_r.py`
  asserts that attribute directly.

An example app leaves an `id` unset that the controller keys on:

- **`NavPanel`** — py-shiny keys on `ul#{id}`; no example gives its navset an id,
  so the shim keys on the `data-tabsetid` bslib always writes. It also expands a
  navbar that has collapsed into a hamburger before clicking, the way py-shiny's
  opens an enclosing dropdown: the app iframe is narrower than Bootstrap's `md`
  breakpoint at shinylive's default split, so every `page_navbar()` starts
  collapsed.
- **`sidebar()`** — returns `controller.Sidebar` for the id bslib generated,
  which only exists once the page has rendered.
- `controller.Accordion` and `controller.ValueBox` want ids the `orbit` and
  `brand` examples never set, so those two assertions use plain locators.

And two that are simply gaps in py-shiny:

- **`InputSelectize._populate_dom()`** -- which `expect_choices()` and
  `expect_choice_labels()` call, because selectize builds its dropdown lazily --
  opens the dropdown and then closes it by clicking the page body. That clicks
  whatever sits at the centre of the app, and on CI the `altair` example's chart
  is there and swallows the event, so the dropdown never closes and the
  assertion times out. The shim presses Escape instead, which is bound to
  selectize's own input and is what the upstream docstring says it does.
- **`DownloadButton.expect_label()`** looks for the `.action-label` span it
  inherits from `InputActionBase`, which a download link does not render. The
  `file_download_core` test asserts the link's text directly.

## Things worth knowing when adding a test

- **A slider can only be dragged to a value the track has a pixel for.** A
  1..1000 slider in a 200px sidebar steps about five units per pixel, so most
  round numbers are not reachable. Assert on a value the widget can land on, or
  drive the app another way.
- **A brush must start inside the plotting panel.** Shiny drops a drag that
  begins in the axis margin, silently.
- **Interactions are debounced.** Shiny holds slider input for 250ms and brush
  input for 300ms, so an action taken immediately afterwards can reach the server
  first. py-shiny's `set()` absorbs this by inching across the track; `brush()`
  in the tests waits explicitly.
