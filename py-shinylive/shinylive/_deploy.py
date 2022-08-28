import os
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

    assets_dir = Path(shinylive_assets_dir())

    # =========================================================================
    # Copy the base dependencies for shinylive/ distribution. This does not include the
    # Python package files.
    # =========================================================================
    print(f"Copying base Shinylive files from {assets_dir}/ to {destdir}/")
    base_files = _deps.shinylive_base_files()
    for file in base_files:
        src_path = assets_dir / file
        dest_path = destdir / Path(file)

        if not dest_path.parent.exists():
            os.makedirs(dest_path.parent)

        copy_fn(src_path, dest_path)

    # =========================================================================
    # Load each app's contents into a list[FileContentJson]
    # =========================================================================
    app_info: AppInfo = {
        "appdir": str(appdir),
        "subdir": str(subdir),
        "files": read_app_files(appdir, destdir),
    }

    # =========================================================================
    # Copy dependencies from shinylive/pyodide/
    # =========================================================================
    if full_shinylive:
        package_files = _utils.listdir_recursive(assets_dir / "shinylive" / "pyodide")
        # Some of the files in this dir are base files; don't copy them.
        package_files = [
            file
            for file in package_files
            if os.path.join("shinylive", "pyodide", file) not in base_files
        ]

    else:
        deps = _deps.base_package_deps() + _deps.find_package_deps(app_info["files"])

        package_files: List[str] = [dep["file_name"] for dep in deps]

        print(
            f"Copying imported packages from {assets_dir}/shinylive/pyodide/ to {destdir}/shinylive/pyodide/"
        )
        verbose_print(" ", ", ".join(package_files))

    for filename in package_files:
        src_path = assets_dir / "shinylive" / "pyodide" / filename
        dest_path = destdir / "shinylive" / "pyodide" / filename
        if not dest_path.parent.exists():
            os.makedirs(dest_path.parent)

        copy_fn(src_path, dest_path)

    # =========================================================================
    # For each app, write the index.html, edit/index.html, and app.json in
    # destdir/subdir.
    # =========================================================================
    write_app_json(
        app_info,
        destdir,
        html_source_dir=Path(shinylive_assets_dir()) / "shinylive" / "shiny_static",
    )

    print(
        f"\nRun the following to serve the app:\n  python3 -m http.server --directory {destdir} 8008"
    )
