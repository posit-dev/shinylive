---
title: Quarto and Export Contract
description: How the separate Python/R `shinylive` packages and the Quarto extension use this repo's bundle — code block parsing (`#|` options including `shiny-version`, `## file:` separators), codeblock-to-json, run-python-blocks, runExportedApp, export_template/, `?_shinylive-mode=`, and the per-version files an export of a pinned app relies on. Read before changing any of these files, since external packages depend on them.
---

# Quarto and Export Contract

This repo does not ship `shinylive export` or the Quarto extension. Those live in the Python and R
`shinylive` packages and the Quarto extension repo. They take the files in `build/` (or the release
tarball, see `ciAndRelease.md`) and copy or call them. So the files below are a public API: a rename
or a changed argument breaks released versions of those packages, which this repo's CI does not test.

App modes and the URL hash are covered in `appModes.md`; how `build/` is produced is in
`buildPipeline.md`.

## What the external packages use

| Path in `build/` | Source | Used by |
| --- | --- | --- |
| `shinylive/shinylive.js` | `src/Components/App.tsx` | exports (`runExportedApp`), Quarto (`runApp`) |
| `shinylive/run-python-blocks.js` | `src/run-python-blocks.ts` | Quarto pages |
| `shinylive/load-shinylive-sw.js` | `src/load-shinylive-sw.ts` | exports and Quarto pages |
| `shinylive-sw.js` | `src/shinylive-sw.ts` | must sit at the site root, next to `shinylive/` |
| `scripts/codeblock-to-json.js` | `src/scripts/codeblock-to-json.ts` | Quarto extension, at render time |
| `export_template/index.html`, `export_template/edit/index.html` | `export_template/` | `shinylive export` |

`build/shinylive/` also contains the per-version files: `pyodide/pyodide-lock-shiny-<minor>.json`
for each Python minor and, in a build with `R_SHINY_IMAGE_BASE_URL` set, `webr/shiny-<minor>/`
(`buildPipeline.md`). It contains `shiny_versions.json` and `shiny_version_cases.json` as well. The
runtime never fetches those two; `src/shiny-version.ts` bundles `shiny_versions.json` at build time.

The `worker` esbuild context in `scripts/build.ts` builds `run-python-blocks.ts` with
`./shinylive.js` marked external, so the Quarto page loads `shinylive.js` once and
`run-python-blocks.js` imports `runApp` from it at run time.

## Code block format (`src/parse-codeblock.ts`)

`parseCodeBlock(codeblock, engine)` turns the text of one code block into
`{ files: FileContent[], quartoArgs }`. It has unit tests in `src/parse-codeblock.test.ts`.

1. `processQuartoArgs` reads the leading lines that match `^(# ?|##)\| ` (so `#| `, `# | `, or
   `##| `), strips the prefix, and parses them together as YAML. It drops at most one blank line
   after them. No option lines gives `{}`.
2. Defaults: `components` is `["viewer"]` and `standalone` is `false`.
3. If `components` includes `"viewer"`, `standalone: true` is required, otherwise it throws. The
   default file name is `app.py` or `app.R`. Without a viewer, `standalone: true` throws, and the
   default file name is `code.py` or `code.R`.
4. `parseFileContents` splits the rest on `## file: <name>` lines. Right after a `## file:` line, an
   optional `## type: text` or `## type: binary` line sets the type (binary content is base64).
   Leading blank lines before the first content line are skipped. Content before any `## file:`
   goes into the default file name.

`Component` is `"editor" | "terminal" | "viewer" | "examples" | "cell"`. `QuartoArgs` is
`components`, `standalone`, `shiny-version`, and any other key (`[name: string]: any`). Those
extra keys are passed through to `runApp` as options, so `layout`, `viewerHeight`, `editorHeight`
and the other fields of `AppOptions` in `App.tsx` work as `#|` options without any mapping code.

`#| shiny-version: "1.6"` pins the block's app to a bundled shiny minor by writing a pin into
`requirements.txt` or `DESCRIPTION` when the app has none. The value must be quoted: unquoted YAML
turns `1.10` into the number 1.1, and `runApp` rejects any non-string. An existing pin wins. For R,
the option and the pin take effect only in a bundle built with `R_SHINY_IMAGE_BASE_URL`; a default
build ignores both and runs the single R image. The rules are in `shinyVersions.md`. Quarto blocks
get no version picker by default, even in the `editor-terminal-viewer` layout, because
`run-python-blocks.ts` does not set `showVersionPicker`. Extra keys are passed through to `runApp`,
so a block with `#| showVersionPicker: true` gets one when it also uses the `editor-terminal-viewer`
layout (`components: [editor, terminal, viewer]`) and its engine is version-aware (Python, or R in
a build with per-version images). Other layouts have no header bar picker.

## Quarto render step (`src/scripts/codeblock-to-json.ts`)

This script runs under Deno, not Node. It reads one code block on stdin, calls `parseCodeBlock`,
and writes the `{files, quartoArgs}` JSON to stdout. The first argument picks the engine: `r` means
R, anything else (or nothing) means Python, so old Quarto extension versions that pass no argument
keep working. It is bundled by esbuild only so that the `parse-codeblock` import resolves.

## Quarto page step (`src/run-python-blocks.ts`)

In the browser, it finds every `.shinylive-python` and `.shinylive-r` element in page order,
replaces each with a `div.shinylive-wrapper` (keeping the element's inline style), parses its
`innerText` with `parseCodeBlock`, and calls `runApp(container, appMode, {startFiles, ...quartoArgs},
engine)`.

`convertComponentArrayToAppMode` sorts the components and only accepts these sets:

| `components` | App mode |
| --- | --- |
| `[viewer]` | `viewer` |
| `[editor, viewer]` | `editor-viewer` |
| `[editor, terminal, viewer]` | `editor-terminal-viewer` |
| `[editor, terminal]` | `editor-terminal` |
| `[editor, cell]` | `editor-cell` |

Anything else throws. `examples` is a valid `Component` type but has no mode here.

## Exported apps (`runExportedApp` and `export_template/`)

`runExportedApp({id, appEngine})` in `src/Components/App.tsx`:

1. fetches `./app.json`, a JSON array of `{name, content, type}`;
2. finds the element with id `id`;
3. reads the mode from `?_shinylive-mode=` in the query string (not the hash), defaulting to
   `viewer`. An unknown mode logs a warning and falls back to `viewer`;
4. calls `runApp` with only `startFiles`. So `allowCodeUrl`, `allowGistUrl` and `allowExampleUrl`
   stay false, an export ignores `#code=` in the URL, and it has no version picker.

The runtime falls back to `pyodide-lock.json` (or `webr/library.data.gz`) when the per-version
file for the app's pinned minor is missing. So an export that contains one version's lock (or
image) under the default name runs that version, and an export that copies the whole bundle runs
any bundled version. The version messages an export prints are described in `shinyVersions.md`.

`export_template/index.html` is a Mustache template. The external packages fill in:

- `{{REL_PATH}}` — path from the page back to the folder holding `shinylive/` (empty for a single
  app, something like `../` for apps in subfolders of a multi-app export);
- `{{APP_ENGINE}}` — `python` or `r`;
- `{{#title}}...{{/title}}` — optional `<title>`;
- `{{{ include_in_head }}}`, `{{{ include_before_body }}}`, `{{{ include_after_body }}}` — raw HTML
  slots.

`export_template/edit/index.html` has no variables. It is a meta-refresh redirect to
`../index.html?_shinylive-mode=editor-terminal-viewer`, so `<app>/edit/` opens the same app in the
editor.

The Makefile copies both templates into `build/export_template/` as part of `make all`.

## How the tests build an export

The tests cannot use `shinylive export` (circular dependency, see `browserTests.md`).
`export_app()` in `tests/export_app.py` does the same job by hand: writes `app.json`, renders
`index.html` with plain string replacement (title section and include slots handled by regex),
copies `edit/index.html`, and symlinks `build/shinylive` and `build/shinylive-sw.js` into the export
root. With `shiny_minor`, it links every bundle file except the Pyodide locks, and copies
`pyodide-lock-shiny-<minor>.json` to `pyodide-lock.json`: one version under the default name.
`export_quarto_page()` (fixture `quarto_page`) writes a page shaped like a Quarto render, one
`<pre class="shinylive-python">` (or `-r`) block plus `run-python-blocks.js`.
`tests/test_site_export.py` checks the root page, the `edit/` redirect, that a URL hash is ignored,
the missing header bar, and `editor-cell` mode; `tests/test_site_shiny_version.py` covers a pinned
export and the Quarto `shiny-version` option. If you change the template or
`runExportedApp`, update `export_app.py` to match, and think about what the external packages do.

## Things that must stay stable

- File names and locations in the table above, including `shinylive-sw.js` at the root.
- The `runExportedApp` and `runApp` exports and their argument shapes.
- The `app.json` shape, and the template variable names.
- The `shiny-version` option, the `pyodide-lock-shiny-<minor>.json` and `webr/shiny-<minor>/`
  names, and the fallback to the default lock and image names.
- The `_shinylive-mode` query parameter and the mode strings in `AppModes`.
- The code block syntax, the CSS classes `shinylive-python` / `shinylive-r`, and
  `codeblock-to-json`'s stdin/stdout and engine argument.
