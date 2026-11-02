---
title: Quarto and Export Contract
description: How the separate Python/R `shinylive` packages and the Quarto extension use this repo's bundle — code block parsing (`#|` options, `## file:` separators), codeblock-to-json, run-python-blocks, runExportedApp, export_template/, and `?_shinylive-mode=`. Read before changing any of these files, since external packages depend on them.
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
`components`, `standalone`, and any other key (`[name: string]: any`). Those extra keys are passed
through to `runApp` as options, so `layout`, `viewerHeight`, `editorHeight` and the other fields
of `AppOptions` in `App.tsx` work as `#|` options without any mapping code.

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
   stay false, and an export ignores `#code=` in the URL.

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
root. `tests/test_site_export.py` checks the root page, the `edit/` redirect, that a URL hash is
ignored, the missing header bar, and `editor-cell` mode. If you change the template or
`runExportedApp`, update `export_app.py` to match, and think about what the external packages do.

## Things that must stay stable

- File names and locations in the table above, including `shinylive-sw.js` at the root.
- The `runExportedApp` and `runApp` exports and their argument shapes.
- The `app.json` shape, and the template variable names.
- The `_shinylive-mode` query parameter and the mode strings in `AppModes`.
- The code block syntax, the CSS classes `shinylive-python` / `shinylive-r`, and
  `codeblock-to-json`'s stdin/stdout and engine argument.
