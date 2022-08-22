import os
import shutil
import sys
from pathlib import Path
from typing import List, Union

from . import _deps
from ._assets import shinylive_assets_dir
from ._app_json import AppInfo, read_app_files, write_app_json
from . import _utils


# =============================================================================
# Deployment
# =============================================================================
def deploy(
    appdir: Union[str, Path],
    destdir: Union[str, Path],
    *,
    subdir: Union[str, Path, None] = None,
    verbose: bool = False,
    full_shinylive: bool = False,
):
    if sys.version_info < (3, 8):
        raise RuntimeError("Shiny static deployment requires Python 3.8 or higher.")

    def verbose_print(*args: object) -> None:
        if verbose:
            print(*args)

    appdir = Path(appdir)
    destdir = Path(destdir)

    if not (appdir / "app.py").exists():
        raise ValueError(f"Directory {appdir}/ must contain a file named app.py.")

    if subdir is None:
        subdir = ""
    subdir = Path(subdir)
    if subdir.is_absolute():
        raise ValueError(
            f"subdir {subdir} is absolute, but only relative paths are allowed."
        )

    if not destdir.exists():
        print(f"Creating {destdir}/")
        destdir.mkdir()

    copy_fn = _utils.create_copy_fn(overwrite=False, verbose_print=verbose_print)

    # =============================================
    # Copy the shinylive/ distribution _except_ for the shinylive/pyodide/ directory.
    # =============================================
    def ignore_pyodide_dir(path: str, names: List[str]) -> List[str]:
        if path == shinylive_assets_dir():
            return ["scripts"]
        elif path == os.path.join(shinylive_assets_dir(), "shinylive"):
            return ["examples.json", "shiny_static"]
        elif not full_shinylive and path == os.path.join(
            shinylive_assets_dir(), "shinylive", "pyodide"
        ):

            return names
        else:
            return []

    print(f"Copying files from {shinylive_assets_dir()}/ to {destdir}/")
    shutil.copytree(
        shinylive_assets_dir(),
        destdir,
        ignore=ignore_pyodide_dir,
        copy_function=copy_fn,
        dirs_exist_ok=True,
    )

    # =============================================
    # Load each app's contents into a list[FileContentJson]
    # =============================================
    app_info: AppInfo = {
        "appdir": str(appdir),
        "subdir": str(subdir),
        "files": read_app_files(appdir, destdir),
    }

    # =============================================
    # Copy dependencies from shinylive/pyodide/
    # =============================================
    if not full_shinylive:
        pyodide_files = _deps._find_pyodide_deps(app_info["files"])
        verbose_print(
            "Copying files in shinylive/pyodide/:\n ", ", ".join(pyodide_files)
        )

        for filename in pyodide_files:
            copy_fn(
                Path(shinylive_assets_dir()) / "shinylive" / "pyodide" / filename,
                destdir / "shinylive" / "pyodide" / filename,
            )

    # =============================================
    # For each app, write the index.html, edit/index.html, and app.json in
    # destdir/subdir.
    # =============================================

    write_app_json(
        app_info,
        destdir,
        html_source_dir=Path(shinylive_assets_dir()) / "shinylive" / "shiny_static",
    )

    print(
        f"\nRun the following to serve the app:\n  python3 -m http.server --directory {destdir} 8008"
    )
