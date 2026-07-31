# Shiny controllers for Playwright

A TypeScript port of [py-shiny]'s Playwright controllers
(`shiny.playwright.controller`), used by `playwright/examples-intent.spec.ts` to
drive the example apps.

Class names, locators and method names track py-shiny's, so `InputSlider` here
finds the same element and asserts the same things as `InputSlider` there --
`expect_value()` becomes `expectValue()`, and keyword arguments become an
options object.

## Why port rather than depend

py-shiny's controllers are Python, and they take a `Page`, because there the
Shiny app under test _is_ the page. Neither holds here:

- This repository's test suite is TypeScript and runs under `@playwright/test`.
  Adding a Python suite would mean a second runner in CI, plus a dependency on
  the `shiny` package from a repository that the `shinylive` Python package
  itself depends on.
- Shinylive renders an app inside an `iframe`. Controllers therefore take a
  `ShinyApp` -- a page plus the root to look elements up in -- so the same class
  works against the app frame, and mouse and keyboard actions still reach the
  page.

## Both engines

The controllers work against Shiny for Python and Shiny for R alike: both render
the same Bootstrap markup, from the same ionRangeSlider, selectize and bslib
components, so the selectors py-shiny derived from Python's output match R's
too. Two differences are worth knowing:

- R's `selectInput()` is selectize-backed by default, so it needs
  `InputSelectize`; Python's `ui.input_select()` renders a plain `<select>` and
  needs `InputSelect`.
- R's `plotOutput()` emits `.shiny-plot-output` alone, where Python's
  `ui.output_plot()` emits `.shiny-image-output.shiny-plot-output`. `OutputPlot`
  keys on the class both engines write, unlike py-shiny's, which keys on both.
- R writes R literals into some data attributes (`data-loop="FALSE"`) where
  Python omits the attribute. Assertions that touch those read the attribute
  instead of pattern-matching it.

## Deliberate differences from py-shiny

- **`InputSlider.set()`** aims at the position implied by `data-min`/`data-max`
  and hunts outwards from there, instead of walking the track a pixel at a time.
  It stops on the same condition py-shiny does -- the rendered label matching --
  so prefixes, separators and non-linear scales still work, but it takes a
  handful of steps rather than hundreds. It then waits out Shiny's 250ms input
  debounce, which py-shiny's slower walk never has to think about.

  Both versions can only reach a value the track has a pixel for. A 1..1000
  slider in a 200px sidebar steps about five units per pixel, so most round
  numbers are simply not draggable to; assert on the ones the widget can land
  on, or drive the app some other way.

- **`Navset`** is one class located by id _or_ by position, rather than one
  class per navset flavour keyed on `ul#{id}`. None of the example apps give
  their navsets an id.
- **`NavPanel.click()`** expands a navbar that has collapsed into a hamburger
  before clicking, the same way py-shiny's opens an enclosing dropdown. The app
  iframe is narrower than Bootstrap's `md` breakpoint at shinylive's default
  split, so every `page_navbar()` starts collapsed.
- **`DownloadButton.download()`** is new: it clicks and returns the resulting
  `Download`, which is the only way to assert that a download handler actually
  ran.
- Only the controllers the example apps need are ported, plus the counterpart of
  any control that comes in a pair (`DownloadLink` alongside `DownloadButton`,
  and so on).

[py-shiny]: https://github.com/posit-dev/py-shiny
