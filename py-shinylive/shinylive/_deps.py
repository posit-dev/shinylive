# Needed for NotRequired with Python 3.7 - 3.9
# See https://www.python.org/dev/peps/pep-0655/#usage-in-python-3-11
from __future__ import annotations

import ast
import json
import os
import sys
from pathlib import Path
from textwrap import dedent
from typing import Callable, Dict, List, Literal, Set, Union

# Even though TypedDict is available in Python 3.8, because it's used with NotRequired,
# they should both come from the same typing module.
# https://peps.python.org/pep-0655/#usage-in-python-3-11
if sys.version_info >= (3, 11):
    from typing import NotRequired, TypedDict
else:
    from typing_extensions import NotRequired, TypedDict

from ._assets import shinylive_assets_dir, repodata_json_file, ensure_shinylive_assets
from ._app_json import FileContentJson

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
class PyodideRepodataFile(TypedDict):
    info: Dict[str, str]
    packages: Dict[str, PyodidePackageInfo]


# =============================================================================
# HTML Dependency types
# =============================================================================
class HtmlDepItem(TypedDict):
    name: str
    path: str
    attribs: NotRequired[Dict[str, str]]


class HtmlDependency(TypedDict):
    scripts: List[Union[str, HtmlDepItem]]
    stylesheets: List[Union[str, HtmlDepItem]]
    resources: List[HtmlDepItem]


# =============================================================================


def shinylive_base_deps(path_prefix: str = "shinylive-dist/") -> HtmlDependency:
    """
    Return an HTML dependency object consisting of files that are base dependencies; in
    other words, the files that are always included in a Shinylive deployment.
    """

    ensure_shinylive_assets()

    all_files: List[str] = []
    for root, dirs, files in os.walk(shinylive_assets_dir()):
        root = Path(root)
        rel_root = root.relative_to(shinylive_assets_dir())
        if rel_root == Path("."):
            dirs.remove("scripts")
        elif rel_root == Path("shinylive"):
            dirs.remove("shiny_static")
            files.remove("examples.json")
        elif rel_root == Path("shinylive/pyodide"):
            dirs.remove("fonts")
            files[:] = BASE_PYODIDE_FILES

        for file in files:
            if file.startswith("."):
                continue
            all_files.append(str(rel_root / file))

    scripts: List[Union[str, HtmlDepItem]] = []
    stylesheets: List[Union[str, HtmlDepItem]] = []
    resources: List[HtmlDepItem] = []

    for file in all_files:
        if os.path.basename(file) in [
            "load-serviceworker.js",
            "jquery.min.js",
            "jquery.terminal.min.js",
            "run-python-blocks.js",
        ]:
            script_item: HtmlDepItem = {
                "name": file,
                "path": os.path.join(path_prefix, file),
            }

            if os.path.basename(file) in [
                "load-serviceworker.js",
                "run-python-blocks.js",
            ]:
                script_item["attribs"] = {"type": "module"}

            scripts.append(script_item)

        if os.path.basename(file) in [
            "jquery.terminal.min.css",
            "shinylive.css",
        ]:
            stylesheets.append(
                {
                    "name": file,
                    "path": os.path.join(path_prefix, file),
                }
            )
        else:
            resources.append(
                {
                    "name": file,
                    "path": os.path.join(path_prefix, file),
                }
            )

    # Sort scripts so that load-serviceworker.js is first, and run-python-blocks.js is
    # last.
    def scripts_sort_fun(x: Union[str, HtmlDepItem]) -> int:
        if isinstance(x, str):
            filename = x
        else:
            filename = os.path.basename(x["name"])

        if filename == "load-serviceworker.js":
            return 0
        elif filename == "run-python-blocks.js":
            return 2
        else:
            return 1

    scripts.sort(key=scripts_sort_fun)

    return {
        "scripts": scripts,
        "stylesheets": stylesheets,
        "resources": resources,
    }


def _get_pyodide_deps(
    json_file: Union[str, Path],
    verbose: bool = True,
) -> None:
    def verbose_print(*args: object) -> None:
        if verbose:
            print(*args)

    json_file = Path(json_file)

    with open(json_file) as f:
        file_contents: List[FileContentJson] = json.load(f)

    pyodide_files = _find_pyodide_deps(file_contents)

    print(json.dumps(pyodide_files, indent=2))


def _find_pyodide_deps(app_contents: List[FileContentJson]) -> List[str]:
    dep_files = _find_package_deps(app_contents)
    keep_files = list(BASE_PYODIDE_FILES) + dep_files
    return keep_files


def _find_package_deps(
    app_contents: List[FileContentJson],
    verbose_print: Callable[..., None] = lambda *args: None,
) -> List[str]:
    """
    Find package dependencies from an app.json file.
    """

    imports: Set[str] = BASE_PYODIDE_PACKAGES
    imports = imports.union(_find_import_app_contents(app_contents))

    # TODO: Need to also add in requirements.txt, and find dependencies of those
    # packages, in case any of those dependencies are included as part of pyodide.
    verbose_print("Imports detected in app:\n ", ", ".join(sorted(imports)))

    repodata = _pyodide_repodata()
    deps = list(imports)
    i = 0
    while i < len(deps):
        dep = deps[i]
        if dep not in repodata["packages"]:
            # TODO: Need to distinguish between built-in packages and external ones in
            # requirements.txt.
            verbose_print(
                f"  {dep} not in repodata.json. Assuming it is in base Pyodide or in requirements.txt."
            )
            deps.remove(dep)
            continue

        dep_deps = set(repodata["packages"][dep]["depends"])
        new_deps = dep_deps.difference(deps)
        deps.extend(new_deps)
        i += 1

    deps.sort()
    verbose_print("Imports and dependencies:\n ", ", ".join(deps))

    dep_files = [repodata["packages"][x]["file_name"] for x in deps]

    return dep_files


def _find_import_app_contents(app_contents: List[FileContentJson]) -> Set[str]:
    """
    Given an app.json file, find packages that are imported.
    """
    imports: Set[str] = set()
    for file_content in app_contents:
        if not file_content["name"].endswith(".py"):
            continue

        imports = imports.union(_find_imports(file_content["content"]))

    return imports


def _pyodide_repodata() -> PyodideRepodataFile:
    """Read in the Pyodide repodata.json file and return the contents."""
    with open(repodata_json_file(), "r") as f:
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
    imports: Set[str] = set()
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
