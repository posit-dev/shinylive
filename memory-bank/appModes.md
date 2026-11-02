---
title: App Modes, URL Hash, Sharing, and Examples
description: How src/Components/App.tsx picks a layout (AppMode), how runApp() gets its starting files from options or the URL hash (#code=, #gist=, example names, h=0), how share links and the examples index are built, how files move between JSON, editor, and disk, and how the site_template/ pages boot each mode. Read before changing App.tsx, runApp() options, share links, or examples/index.json.
---

# App Modes, URL Hash, Sharing, and Examples

`src/Components/App.tsx` is the entry point of the main bundle (`shinylive.js`, built by the
`app` context in `scripts/build.ts`). It exports `runApp()`, `runExportedApp()`, and the `App`
component. How requests reach the engine is in `requestFlow.md`; engine startup is in
`pythonEngine.md` and `rEngine.md`; Quarto and `shinylive export` callers are in
`quartoAndExport.md`; the editor itself is in `editorLanguageServer.md`.

## AppMode values

`AppMode` is a string union. Each value is a fixed layout returned by one branch of `App`:

| Mode | Components |
| --- | --- |
| `examples-editor-terminal-viewer` | HeaderBar + ResizableGrid of ExampleSelector, Editor, Terminal, Viewer |
| `editor-terminal-viewer` | HeaderBar + ResizableGrid of Editor, Terminal, Viewer |
| `editor-terminal` | ResizableGrid of Editor and Terminal (no header) |
| `editor-viewer` | ResizableGrid of Editor and Viewer, `layout` horizontal or vertical |
| `editor-cell` | Editor (no tabs, no line numbers, floating run button) + OutputCell |
| `viewer` | Viewer only; HeaderBar only when `showHeaderBar` is true |

`ResizableGrid` only sets `grid-template-areas` and adds drag handles; each child places itself
with a `grid-area` rule in `App.css`.

Things that differ by mode:

- Every mode except `editor-terminal` installs Shiny into the engine (`loadShiny`).
- `Editor` is loaded with `React.lazy`, so the editor chunk (and Pyright) never loads in
  `viewer` mode.
- In `viewer` mode, an effect calls `viewerMethods.runApp(currentFiles)` once the Viewer is ready,
  and the HeaderBar gets one callback, `openEditorWindowFromViewer`, which opens the shinylive.io
  editor with `#code=` for the start files.
- `OutputCell` and the `_save_files` to `/home/pyodide` effect only do anything on Pyodide.
- If no start files are given, `App` uses a built-in Python template: `app.py` in modes that
  include a viewer, `script.py` otherwise. This is Python even when the engine is R.

The HeaderBar has no buttons of its own. The Editor fills them in through
`setHeaderBarCallbacks` (load, save, download, share, open in editor).

`ensurePyodideProxyHandlePromise` / `ensureWebRProxyHandlePromise` keep the engine in a module
variable, so all `App`s on a page share one engine. `?webworker=0` runs Pyodide on the main thread.

## runApp() and its options

`runApp(domTarget, mode, opts, appEngine)` renders `App` into `domTarget`. `AppOptions` fields:
`startFiles`, `layout`, `viewerHeight`, `editorHeight`, `selectedExample`, `showHeaderBar`,
`updateUrlHashOnRerun`, `setWindowTitle`. `runApp` adds three security switches, all `false` by
default: `allowCodeUrl`, `allowGistUrl`, `allowExampleUrl`. Turning them on lets the URL run code,
so a page that does should live on its own domain (see the comment above `runApp`).

`startFiles` may be `FileContentJson[]` or `FileContent[]`; `runApp` maps them through
`FCorFCJSONtoFC`. Extra keys in `opts` (such as Quarto's `components` and `standalone`) are
passed through to `App` without a warning.

`runExportedApp()` fetches `./app.json` and reads `?_shinylive-mode=` (default `viewer`); see
`quartoAndExport.md`.

## URL hash handling

The hash is read only when `opts.startFiles` is undefined. It is parsed with `URLSearchParams`,
and the first matching branch wins:

1. `#code=<lz>` (needs `allowCodeUrl`): `LZString.decompressFromEncodedURIComponent`, then
   `JSON.parse` into `FileContentJson[]`. A bad value gives `[]`, which means the built-in
   template, not an error.
2. `#gist=<id>` (needs `allowGistUrl`): `fetchGist` and `gistApiResponseToFileContents` in
   `src/Components/gist.ts`. It asks the GitHub API for base64 content, fetches `raw_url` for
   truncated files, and uses `isBinary` to pick text or binary.
3. Example name, like `#app-with-plot` (needs `allowExampleUrl`): the last key with an empty value
   is the name. `findExampleByTitle` compares it, lowercased, to `sanitizeTitleForUrl(title)`.
   **If nothing matches, including an empty hash, it silently uses the first example** and sets
   `selectedExample` to that example's name.

Then `h=0` sets `showHeaderBar = false`. Only `viewer` mode uses it.

Because all three site pages turn on `allowExampleUrl`, opening `editor/` or `app/` with no hash
loads the first example, not the built-in template.

`ExampleSelector` writes `#<sanitized-title>` with `window.location.hash` when you click an
example, and asks before dropping edits (`filesHaveChanged`). It has its own fallback to the first
example when `startWithSelectedExample` is not found.

When `updateUrlHashOnRerun` is true and files changed since the last run, the Editor's re-run
(`runAllApp`) replaces the hash with `#code=...` through `history.replaceState`. It skips this, with
a one-time toast, when the files are over `UPDATE_URL_SIZE_THRESHOLD` (250000 characters).

## Sharing

`src/Components/share.ts`:

- `editorUrlPrefix` / `appUrlPrefix` always point at `https://shinylive.io/{py|r}/editor/` and
  `/app/`, even on a local build.
- `fileContentsToUrlString` sorts files by name, converts them with `FCtoFCJSON`, and
  LZ-compresses the JSON on the main thread. `ShareModal` and "open in editor" use it.
- `fileContentsToUrlStringInWebWorker` does the same work in `src/lzstring-worker.ts`. Only the
  hash update on re-run uses it. The worker is created once, loaded from
  `currentScriptDir() + "/lzstring-worker.js"`, and answers each request on a `MessageChannel`
  port. Its `"decode"` message is not used.

`ShareModal` shows the editor URL and the app URL with their byte lengths. Its "Hide header"
checkbox adds `h=0&` to the app URL. Gist links are only read, never created.

## Examples index

- `examples/index.json` lists, per engine, categories and app directory names. Order here is the
  order in the sidebar.
- `scripts/build_examples_json.ts` (`buildExamples`, run by the `example-builder` esbuild plugin
  on every build) writes `build/shinylive/examples.json`. It skips the work when no file under
  `examples/` is newer than the output. For each app it reads the title from the first line of
  `about.txt`, sorts files (`app.py`/`app.R`/`server.R` first, then scripts, then `_brand.yml` and
  `requirements.txt`), and base64-encodes binary files. A listed app missing on disk throws.
- `scripts/check_examples_index.mjs` (`make examples-check-index`) checks the other way: every
  directory on disk is listed, and every listed app has `about.txt`. It uses only node builtins so
  CI can run it without `npm ci`.
- `src/examples.ts` `getExampleCategories(engine)` fetches `../shinylive/examples.json` (relative to
  the page), picks the entry for the engine, and caches it in a module variable.

## File content shapes

`src/Components/filecontent.ts` has two types. `FileContentJson` is the wire form (examples.json,
`#code=`, `app.json`, `runApp`): binary content is base64 and `type` is optional. `FileContent` is
the in-memory form, where binary content is a `Uint8Array`. `FCJSONtoFC`, `FCtoFCJSON` (drops
`type: "text"` to save space), and `FCorFCJSONtoFC` convert between them.

`src/fileio.ts` backs the HeaderBar disk buttons. It uses the File System Access API
(`assertHasFileAccessApiSupport` alerts outside Chrome and Edge). `loadDirectoryRecursive` skips
names starting with `.` or `_`, and stops at 20 files and 20 MB per file.
`saveFileContentsToDirectory` creates subdirectories. `downloadFile` saves through a blob link; the
Editor zips more than one file with `fflate`.

## Embedding through postMessage

When `App` runs inside an iframe, it posts `{type: "shinyliveReady"}` to the parent on mount. It
accepts `setFiles` (replaces the current files) and `getFiles` (replies on `event.ports[0]` with
the editor's files) from `window.parent` only.

## How site_template/ boots each mode

`buildSiteHtml` in `scripts/build.ts` copies each `site_template/*/index.html` to `site/`, filling in
`{{APP_ENGINE}}` and `{{GOOGLE_TAG_MANAGER_SCRIPT}}`. Each page loads
`../shinylive/load-shinylive-sw.js` (see `requestFlow.md`) and then calls `runApp` on `#root`
with all three `allow*Url` switches on:

- `examples/` uses `examples-editor-terminal-viewer` with `updateUrlHashOnRerun: true`.
- `editor/` uses `editor-terminal-viewer` with `updateUrlHashOnRerun: true` and the window title
  prefix `"Shiny - "`.
- `app/` uses `viewer` and copies the app's title into the window title.

The other modes (`editor-viewer`, `editor-cell`, `editor-terminal`) come only from Quarto
(`src/run-python-blocks.ts`) or `?_shinylive-mode=` on an export.
