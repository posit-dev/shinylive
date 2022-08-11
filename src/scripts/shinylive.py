import ast
import base64
import json
import os
import shutil
import sys
from pathlib import Path
from textwrap import dedent
from typing import Callable, Dict, List, Literal, Set, Tuple, TypedDict, Union

from typing_extensions import NotRequired

shinylive_dir = Path(__file__).parent.parent
repodata_json_file = shinylive_dir / "shinylive" / "pyodide" / "repodata.json"


# Files in Pyodide that should always be included.
BASE_PYODIDE_FILES = {
    "pyodide_py.tar",
    "pyodide.asm.js",
    "pyodide.asm.data",
    "pyodide.asm.wasm",
    "repodata.json",
}

# Packages that should always be included in a deployment.
BASE_PYODIDE_PACKAGES = {"distutils", "micropip"}


# =============================================================================
# Data structures used in pyodide/repodata.json
# =============================================================================
# Note: This block of code is copied from /scripts/pyodide_packages.py
class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    file_name: str
    install_dir: Literal["lib", "site"]
    sha256: str
    depends: List[str]
    imports: List[str]
    unvendored_tests: NotRequired[bool]


# The package information structure used by Pyodide's repodata.json.
class PyodidePackagesFile(TypedDict):
    info: Dict[str, str]
    packages: Dict[str, PyodidePackageInfo]


# =============================================================================
# More types
# =============================================================================
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
# Deployment
# =============================================================================
def deploy(
    appdirs: Tuple[Union[str, Path], ...],
    destdir: Union[str, Path],
    *,
    overwrite: bool = False,
    subdirs: Tuple[Union[str, Path], ...] = (),
    verbose: bool = False,
    full_shinylive: bool = False,
    **kwargs,
):
    if sys.version_info < (3, 8):
        raise RunTimeError("Shiny static deployment requires Python 3.8 or higher.")

    if len(kwargs) != 0:
        raise RuntimeError(
            f"""Shinylive received unexpected arguments: {kwargs}. This is probably because of a version mismatch between shiny and shinylive.
Perhaps you need to update your version of shiny or shinylive?

To upgrade shinylive, run these commands:
    shiny static-assets remove
    shiny static-assets download
"""
        )

    def verbose_print(*args: object) -> None:
        if verbose:
            print(*args)

    appdirs = tuple(Path(x) for x in appdirs)
    destdir = Path(destdir)

    for appdir in appdirs:
        if not (appdir / "app.py").exists():
            raise ValueError(f"Directory {appdir}/ must contain a file named app.py.")

    if len(subdirs) == 0:
        if len(appdirs) == 1:
            subdirs = (".",)
        else:
            raise RuntimeError("Must specify subdirs when deploying multiple apps.")
    if len(appdirs) != len(subdirs):
        raise RuntimeError("appdirs and subdirs must be the same length.")
    if len(subdirs) != len(set(subdirs)):
        raise RuntimeError("subdirs must be unique.")

    subdirs = tuple(Path(x) for x in subdirs)
    for subdir in subdirs:
        if subdir.is_absolute():
            raise ValueError(
                f"subdir {subdir} is absolute, but only relative paths are allowed."
            )

    if not destdir.exists():
        print(f"Creating {destdir}/")
        destdir.mkdir()

    # =============================================
    # Copy the shinylive/ distribution _except_ for the shinylive/pyodide/ directory.
    # =============================================
    def ignore_pyodide_dir(path: str, names: List[str]) -> List[str]:
        if path == str(shinylive_dir / "shinylive" / "pyodide"):
            return names
        else:
            return []

    if full_shinylive:
        ignore_filter = None
    else:
        ignore_filter = ignore_pyodide_dir

    print(f"Copying {shinylive_dir}/ to {destdir}/")
    shutil.copytree(
        shinylive_dir,
        destdir,
        ignore=ignore_filter,
        copy_function=_copy_fn(overwrite, verbose_print=verbose_print),
        dirs_exist_ok=True,
    )

    # =============================================
    # Load each app's contents into a list[FileContentJson]
    # =============================================
    all_app_info: List[AppInfo] = []
    for appdir, subdir in zip(appdirs, subdirs):
        all_app_info.append(
            {
                "appdir": str(appdir),
                "subdir": str(subdir),
                "files": _read_app_files(appdir, destdir),
            }
        )

    # =============================================
    # Copy dependencies from shinylive/pyodide/
    # =============================================
    if not full_shinylive:
        # Get contents of all files in all apps, and flatten the nested list.
        all_app_file_contents = sum([app["files"] for app in all_app_info], [])
        pyodide_files = _find_pyodide_files(all_app_file_contents)
        print(f"Copying files in shinylive/pyodide/:\n ", ", ".join(pyodide_files))

        for filename in pyodide_files:
            shutil.copy(
                shinylive_dir / "shinylive" / "pyodide" / filename,
                destdir / "shinylive" / "pyodide" / filename,
            )

    # =============================================
    # For each app, write the index.html, edit/index.html, and app.json in
    # destdir/subdir.
    # =============================================

    for app_info in all_app_info:
        print(f"\nWriting {str(destdir / app_info['subdir'])}")
        _write_app_json(
            app_info,
            destdir,
            html_source_dir=shinylive_dir / "shinylive" / "shiny_static",
        )

    print(
        f"\nRun the following to serve the app:\n  python3 -m http.server --directory {destdir} 8008"
    )


# =============================================================================
# Utility functions
# =============================================================================


def _read_app_files(appdir: Path, destdir: Path) -> List[FileContentJson]:
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

        if _is_relative_to(Path(root), destdir):
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


def _write_app_json(app_info: AppInfo, destdir: Path, html_source_dir: Path) -> None:
    """
    Write index.html, edit/index.html, and app.json for an application in the destdir.
    """
    app_destdir = destdir / app_info["subdir"]

    # For a subdir like a/b/c, this will be ../../../
    subdir_inverse = "/".join([".."] * _path_length(app_info["subdir"]))
    if subdir_inverse != "":
        subdir_inverse += "/"

    if not app_destdir.exists():
        app_destdir.mkdir()

    _copy_file_and_substitute(
        src=html_source_dir / "index.html",
        dest=app_destdir / "index.html",
        search_str="{{REL_PATH}}",
        replace_str=subdir_inverse,
    )

    editor_destdir = app_destdir / "edit"
    if not editor_destdir.exists():
        editor_destdir.mkdir()
    _copy_file_and_substitute(
        src=html_source_dir / "edit" / "index.html",
        dest=(editor_destdir / "index.html"),
        search_str="{{REL_PATH}}",
        replace_str=subdir_inverse,
    )

    app_json_output_file = app_destdir / "app.json"

    print("Writing to " + str(app_json_output_file), end="")
    json.dump(app_info["files"], open(app_json_output_file, "w"))
    print(":", app_json_output_file.stat().st_size, "bytes")


def _find_pyodide_files(app_contents: List[FileContentJson]) -> List[str]:
    dep_files = _find_package_deps(app_contents)
    keep_files = list(BASE_PYODIDE_FILES) + dep_files
    return keep_files


def _find_package_deps(app_contents: List[FileContentJson]) -> List[str]:
    """
    Find package dependencies from an app.json file.
    """

    imports: set[str] = BASE_PYODIDE_PACKAGES
    imports = imports.union(_find_import_app_contents(app_contents))

    # TODO: Need to also add in requirements.txt, and find dependencies of those
    # packages, in case any of those dependencies are included as part of pyodide.
    print("Imports detected in app:\n ", ", ".join(sorted(imports)))

    repodata = _pyodide_repodata()
    deps = list(imports)
    i = 0
    while i < len(deps):
        dep = deps[i]
        if dep not in repodata["packages"]:
            # TODO: Need to distinguish between built-in packages and external ones in
            # requirements.txt.
            print(
                f"  {dep} not in repodata.json. Assuming it is in base Pyodide or in requirements.txt."
            )
            deps.remove(dep)
            continue

        dep_deps = set(repodata["packages"][dep]["depends"])
        new_deps = dep_deps.difference(deps)
        deps.extend(new_deps)
        i += 1

    deps.sort()
    print("Imports and dependencies:\n ", ", ".join(deps))

    dep_files = [repodata["packages"][x]["file_name"] for x in deps]

    return dep_files


def _find_import_app_contents(app_contents: List[FileContentJson]) -> set[str]:
    """
    Given an app.json file, find packages that are imported.
    """
    imports: set[str] = set()
    for file_content in app_contents:
        if not file_content["name"].endswith(".py"):
            continue

        imports = imports.union(_find_imports(file_content["content"]))

    return imports


def _copy_fn(
    overwrite: bool, verbose_print: Callable[..., None] = lambda x: None
) -> Callable[..., None]:
    """Returns a function that can be used as a copy_function for shutil.copytree.

    If overwrite is True, the copy function will overwrite files that already exist.
    If overwrite is False, the copy function will not overwrite files that already exist.
    """

    def mycopy(src: str, dst: str, **kwargs: object) -> None:
        if os.path.exists(dst):
            if overwrite:
                verbose_print(f"Overwriting {dst}")
                os.remove(dst)
            else:
                verbose_print(f"Skipping {dst}")
                return

        shutil.copy2(src, dst, **kwargs)

    return mycopy


def _is_relative_to(path: Path, base: Path) -> bool:
    """
    Wrapper for `PurePath.is_relative_to`, which was added in Python 3.9.
    """
    if sys.version_info >= (3, 9):
        return path.is_relative_to(base)
    else:
        try:
            path.relative_to(base)
            return True
        except ValueError:
            return False


def _path_length(path: Union[str, Path]) -> int:
    """Returns the number of elements in a path.

    For example 'a' has length 1, 'a/b' has length 2, etc.
    """

    path = str(path)
    if os.path.isabs(path):
        raise ValueError("path must be a relative path")

    # Unfortunately, there's no equivalent of os.path.normpath for Path objects.
    path = os.path.normpath(path)
    if path == ".":
        return 0

    # On Windows, replace backslashes with forward slashes.
    if os.name == "nt":
        path.replace("\\", "/")

    return len(path.split("/"))


def _copy_file_and_substitute(
    src: Union[str, Path], dest: Union[str, Path], search_str: str, replace_str: str
) -> None:
    with open(src, "r") as fin:
        in_content = fin.read()
        in_content = in_content.replace(search_str, replace_str)
        with open(dest, "w") as fout:
            fout.write(in_content)


def _pyodide_repodata() -> PyodidePackagesFile:
    """Read in the Pyodide repodata.json file and return the contents."""
    with open(repodata_json_file, "r") as f:
        return json.load(f)


# From pyodide._base.find_imports
def _find_imports(source: str) -> List[str]:
    """
    Finds the imports in a Python source code string

    Parameters
    ----------
    source : str
       The Python source code to inspect for imports.

    Returns
    -------
    ``List[str]``
        A list of module names that are imported in ``source``. If ``source`` is not
        syntactically correct Python code (after dedenting), returns an empty list.

    Examples
    --------
    >>> from pyodide import find_imports
    >>> source = "import numpy as np; import scipy.stats"
    >>> find_imports(source)
    ['numpy', 'scipy']
    """
    # handle mis-indented input from multi-line strings
    source = dedent(source)

    try:
        mod = ast.parse(source)
    except SyntaxError:
        return []
    imports: set[str] = set()
    for node in ast.walk(mod):
        if isinstance(node, ast.Import):
            for name in node.names:
                node_name = name.name
                imports.add(node_name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module
            if module_name is None:
                continue
            imports.add(module_name.split(".")[0])
    return list(sorted(imports))
