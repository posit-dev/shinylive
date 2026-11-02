---
title: Editor and Python Language Server
description: How the CodeMirror 6 editor is set up (src/Components/Editor.tsx and src/Components/codeMirror/), how tabs keep per-file state, and how the in-browser Pyright language server (src/language-server/, src/pyright/, typeshed.en.json) gives Python completion, hover, signature help, and diagnostics in a web worker. Also what R gets instead. Read before changing editor extensions, key bindings, file tabs, Pyright, or the type stubs.
---

# Editor and Python Language Server

The editor is `src/Components/Editor.tsx`. It is its own esbuild entry point (`Editor` in the `app`
context of `scripts/build.ts`), and `App.tsx` loads it with `React.lazy`. So the editor, CodeMirror,
and Pyright only load in modes that show an editor (see `appModes.md`).

## One EditorView, many EditorStates

There is a single CodeMirror `EditorView` per Editor. Each open file is an `EditorFile` whose
`ref.editorState` holds that file's own `EditorState`, plus scroll position. Switching tabs calls
`cmView.setState(activeFile.ref.editorState)`. This keeps undo history and diagnostics per file.

`useTabbedCodeMirror` (`src/Components/codeMirror/useTabbedCodeMirror.tsx`) owns the file list and
the tab actions: `addFile` (always names new files `file<N>.py`), `uploadFile` (File System Access
API, replaces a file with the same name), `renameFile`, `closeFile`, `selectFile` (a click on the
active tab starts renaming). `FileTabs.tsx` is the tab bar UI.

`ref` is mutable on purpose. The live state is in the view, not in `files`, so code must call
`syncActiveFileState()` before reading `files` (run, share, save, download, and so on). Forgetting
it gives you the text from the last tab switch.

When the App sends a new file list (`currentFilesFromApp`), the hook rebuilds every `EditorFile`
and resets to tab 0. `fileContentToEditorFile` shows binary files as a read-only
`<< N bytes of binary data >>` placeholder and keeps the bytes in `content`.

## Extensions

`inferEditorExtensions` in `Editor.tsx` builds the extension list for one file:

- `getExtensions()` from `codeMirror/extensions.ts`: history, bracket matching, close brackets,
  autocompletion, search, and the default keymaps. `Tab` accepts a completion before it indents.
  Line numbers and a slim lint gutter are added only when `lineNumbers` is true.
- `getLanguageExtension(inferFiletype(name))`: Python, JavaScript, HTML, CSS, SQL, Sass, YAML, and
  R through the legacy `StreamLanguage` R mode. `inferFiletype` in `src/utils.ts` maps extensions
  to ids that match both CodeMirror and LSP language ids.
- Indent is 2 spaces for R files, 4 for everything else.
- An update listener that marks files as changed.
- `languageServerExtensions(lspClient, lspPathPrefix + name)`.
- High-priority run keys from `keyBindings()`: `Mod-Enter` runs the selection or current line in
  the terminal; `Mod-Shift-Enter` re-runs the app if there is an `app.py`, `app.R`, or `server.R`,
  else runs the whole file. On the R engine it also adds `Alt--` for `<-` and `Mod-Shift-m` for
  `|>`.

Binary files get only `EditorView.editable.of(false)`. On rename, the view is first reconfigured
to `getMinimalExtensions()` (history only) and then to the new set. That drops old lint markers
while keeping undo history; the two `dispatch` calls must stay separate.

The format button exists only for Python. It calls `_format_py_code` in Pyodide, which installs
`black` with micropip on first use (`src/hooks/usePyodide.tsx`).

## Language server client

`src/language-server/client.ts` has the abstract `LanguageServerClient` (adapted from the
micro:bit editor). It owns a `vscode-jsonrpc` `MessageConnection`, sends `initialize` with the
client capabilities and `getInitializationOptions()`, and stores the promise as `initPromise`.
Every call waits on it. It keeps a version number per URI, re-emits `publishDiagnostics` as a
`"diagnostics"` event, and turns `createFile` / `deleteFile` / `changeFile` into
`didOpen` / `didClose` / `didChange`. Files are never written anywhere; a deleted file is just
closed.

`createUri(name)` gives `file:///src/<name>`. The Editor puts each file under its own prefix,
`editor<N>/`, from `useInstanceCounter`, so two editors on one page (for example in Quarto) do not
see each other's files.

Two clients exist, both page-wide singletons:

- `ensurePyrightClient()` (`pyright-client.ts`) for the Python engine.
- `ensureNullClient()` (`null-client.ts`) for R. Its reader and writer do nothing, so `initialize`
  never gets an answer and every request waits forever.

## What runs in the worker

`PyrightLspClient` starts `pyright/pyright.worker.js` as a classic web worker named
`pyright-foreground` and talks to it with `BrowserMessageReader` / `BrowserMessageWriter`. The
whole type checker runs there, so typing never blocks on analysis. It adds two custom
notifications, `$/createFile` and `$/deleteFile`, before the usual open and close.

`src/pyright/pyright.worker.js` is a checked-in, prebuilt file from the `pyright-browser` branch of
posit-dev/pyright (commit in `src/pyright/README.md`, which also explains how to test a local
Pyright build). The `copy_pyright` make target copies `src/pyright/` to `build/shinylive/pyright/`.
Do not edit the worker by hand.

## typeshed.en.json

`scripts/create_typeshed.py`, run by `make create_typeshed_json` as part of `make all`:

1. Runs `pyright --createstub` (the `pyright` Python package in `venv/`) for `htmltools`, `shiny`,
   `shinywidgets`, and `shinyswatch` into `typings/` (gitignored). The stubs come from whatever
   versions are installed in `venv/`, which may not match `shinylive_lock.json`.
2. Reads the `typeshed` git submodule's `stdlib/`, leaving out modules that do not work in the
   browser (`tkinter`, `subprocess`, `socket`, `multiprocessing`, `unittest`, `xml`, and others).
3. Adds `/src/pyrightconfig.json`: Python `3.12` (hard-coded as `PYODIDE_PYTHON_VERSION`), Linux,
   `basic` checking, `typeshedPath: /typeshed/`, and missing-import reports off.
4. Writes one JSON object, virtual path to file text, to `build/shinylive/pyright/typeshed.en.json`.

At startup, `PyrightLspClient.getInitializationOptions()` loads it with `fetch()` (not `import`, so
esbuild does not inline it) and sends it as `initializationOptions.files`. The worker mounts these
as its virtual file system. Package stubs sit under `/src/typings/`, next to the user's files.

## Editor features from the server

`languageServerExtensions` (`codeMirror/language-server/lsp-extension.ts`) returns nothing unless
the file is Python. For Python files it adds:

- A change listener. A single change is sent as a ranged edit. When there are several changes at
  once (multiple cursors), it sends the whole document, because CodeMirror and LSP order the
  change positions differently.
- `autocompletion.ts`: asks on identifier characters or the server's trigger characters. Items
  with `additionalTextEdits` (auto-imports) are dropped.
- `signatureHelp.ts`: asks again on every edit, opens with `Mod-Shift-Space`, closes with `Escape`.
- `hover.ts`: hover tooltips. Markdown from the server goes through `marked` and `DOMPurify` in
  `documentation.ts`, and links open in a new tab.

Diagnostics go the other way. `Editor.tsx` listens for `"diagnostics"`, finds the file by URI, and
applies `diagnosticToTransaction` (`diagnostics.ts`) to that file's stored `EditorState`. Only the
visible file is dispatched to the view. `diagnosticFilter` hides "is not accessed" hints.

## What R gets

R files get syntax highlighting (legacy R mode), 2-space indent, the `<-` and `|>` keys, and the
same run keys. There is no completion, hover, diagnostics, or formatting, because the R engine uses
the null client and `languageServerExtensions` skips non-Python files anyway.
