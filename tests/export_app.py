"""Assembling a static export of an app, the way `shinylive export` would.

That command lives in the Python shinylive package, which depends on *this*
repository -- the circular dependency that kept the playwright job in build.yml
commented out for years, and that this module exists to avoid. Nothing an export
contains has to come from that package: every piece is already sitting in
`build/` once `make all` has run.

An export is small. `runExportedApp()` in src/Components/App.tsx fetches
`./app.json` -- a plain array of `{name, content, type}` -- and reads the app
mode out of the `?_shinylive-mode=` query string. Everything else is the page
template in `export_template/`, and the shinylive bundle itself.
"""

from __future__ import annotations

import json
import re
import shutil
from collections.abc import Mapping
from html import escape
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent.parent / "build"
EXPORT_TEMPLATE_DIR = BUILD_DIR / "export_template"

# One of the modes an exported page can be asked for with `?_shinylive-mode=`.
# `runExportedApp()` defaults to "viewer"; src/Components/App.tsx lists them all.
EDITOR_CELL_MODE = "editor-cell"


def export_app(
    files: Mapping[str, str],
    dest: Path,
    *,
    engine: str = "python",
    title: str | None = None,
) -> Path:
    """Write a static export of `files` to `dest`, and return `dest`.

    `files` maps file name to contents, as `app.json` does. A file named `app.py`
    (or `app.R`) makes it a Shiny app; any other name is a plain script, which is
    what the editor-cell mode runs.

    The shinylive bundle is symlinked rather than copied. It is most of a
    gigabyte, and the only thing that reads it here is a local file server.
    """
    if not (EXPORT_TEMPLATE_DIR / "index.html").exists():
        raise RuntimeError(
            f"{EXPORT_TEMPLATE_DIR} not found. Run `make all` before these tests."
        )

    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    (dest / "app.json").write_text(
        json.dumps(
            [
                {"name": name, "content": content, "type": "text"}
                for name, content in files.items()
            ]
        )
    )
    (dest / "index.html").write_text(_render_index(engine=engine, title=title))

    (dest / "edit").mkdir()
    shutil.copyfile(
        EXPORT_TEMPLATE_DIR / "edit" / "index.html", dest / "edit" / "index.html"
    )

    (dest / "shinylive").symlink_to(BUILD_DIR / "shinylive", target_is_directory=True)
    (dest / "shinylive-sw.js").symlink_to(BUILD_DIR / "shinylive-sw.js")

    return dest


# Mustache's section tag: the `<title>` is only rendered when a title was given,
# and `{{.}}` inside it is the title itself.
_TITLE_SECTION = re.compile(r"\{\{#title\}\}(.*?)\{\{/title\}\}", re.DOTALL)

# Slots an export can inject extra markup into. Nothing here injects any.
_INCLUDE_SLOT = re.compile(r"\{\{\{\s*include_\w+\s*\}\}\}")


def _render_index(*, engine: str, title: str | None, rel_path: str = "") -> str:
    """Fill in export_template/index.html.

    `rel_path` is the path from the page back to the directory holding
    `shinylive/`, which is the export root itself for a single app.
    """
    html = (EXPORT_TEMPLATE_DIR / "index.html").read_text()
    html = html.replace("{{REL_PATH}}", rel_path).replace("{{APP_ENGINE}}", engine)
    if title is None:
        html = _TITLE_SECTION.sub("", html)
    else:
        html = _TITLE_SECTION.sub(
            lambda match: match.group(1).replace("{{.}}", escape(title)), html
        )
    return _INCLUDE_SLOT.sub("", html)
