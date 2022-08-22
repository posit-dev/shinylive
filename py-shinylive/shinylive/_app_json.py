import base64
import json
import os
from pathlib import Path
from typing import List, Literal, TypedDict

from . import _utils


# This is the same as the FileContentJson type in TypeScript.
class FileContentJson(TypedDict):
    name: str
    content: str
    type: Literal["text", "binary"]


class AppInfo(TypedDict):
    appdir: str
    subdir: str
    files: List[FileContentJson]


# =============================================================================
def read_app_files(appdir: Path, destdir: Path) -> List[FileContentJson]:
    """
    Load files for a Shiny application.

    Parameters
    ----------
    appdir : str
       Directory containing the application.

    destdir : str
       Destination directory. This is used only to avoid adding deployed shinylive
       assets when they are in a subdir of the application.
    """
    app_files: List[FileContentJson] = []
    # Recursively iterate over files in app directory, and collect the files into
    # app_files data structure.
    exclude_names = {"__pycache__", "venv", ".venv"}
    for root, dirs, files in os.walk(appdir, topdown=True):
        root = Path(root)

        if _utils.is_relative_to(Path(root), destdir):
            # In case destdir is inside of the appdir, don't copy those files.
            continue

        dirs[:] = [d for d in dirs if not d.startswith(".")]
        dirs[:] = set(dirs) - exclude_names
        rel_dir = root.relative_to(appdir)
        files = [f for f in files if not f.startswith(".")]
        files = [f for f in files if f not in exclude_names]
        files.sort()

        # Move app.py to first in list.
        if "app.py" in files:
            app_py_idx = files.index("app.py")
            files.insert(0, files.pop(app_py_idx))

        # Add the file to the app_files list.
        for filename in files:
            if rel_dir == ".":
                output_filename = filename
            else:
                output_filename = str(rel_dir / filename)

            if filename == "shinylive.js":
                print(
                    f"Warning: Found shinylive.js in source directory '{appdir}/{rel_dir}'. Are you including a shinylive distribution in your app?"
                )

            type: Literal["text", "binary"] = "text"
            try:
                with open(root / filename, "r") as f:
                    file_content = f.read()
                    type = "text"
            except UnicodeDecodeError:
                # If text failed, try binary.
                with open(root / filename, "rb") as f:
                    file_content_bin = f.read()
                    file_content = base64.b64encode(file_content_bin).decode("utf-8")
                    type = "binary"

            app_files.append(
                {
                    "name": output_filename,
                    "content": file_content,
                    "type": type,
                }
            )

    return app_files


def write_app_json(app_info: AppInfo, destdir: Path, html_source_dir: Path) -> None:
    """
    Write index.html, edit/index.html, and app.json for an application in the destdir.
    """
    app_destdir = destdir / app_info["subdir"]

    # For a subdir like a/b/c, this will be ../../../
    subdir_inverse = "/".join([".."] * _utils.path_length(app_info["subdir"]))
    if subdir_inverse != "":
        subdir_inverse += "/"

    if not app_destdir.exists():
        app_destdir.mkdir()

    _utils.copy_file_and_substitute(
        src=html_source_dir / "index.html",
        dest=app_destdir / "index.html",
        search_str="{{REL_PATH}}",
        replace_str=subdir_inverse,
    )

    editor_destdir = app_destdir / "edit"
    if not editor_destdir.exists():
        editor_destdir.mkdir()
    _utils.copy_file_and_substitute(
        src=html_source_dir / "edit" / "index.html",
        dest=(editor_destdir / "index.html"),
        search_str="{{REL_PATH}}",
        replace_str=subdir_inverse,
    )

    app_json_output_file = app_destdir / "app.json"

    print("Writing " + str(app_json_output_file), end="")
    json.dump(app_info["files"], open(app_json_output_file, "w"))
    print(":", app_json_output_file.stat().st_size, "bytes")
