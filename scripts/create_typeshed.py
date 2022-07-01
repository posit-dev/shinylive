#!/usr/bin/env python3

import json
import os
import shutil
import sys
from pathlib import Path

import pyright

# TODO: Automate version detection
PYODIDE_PYTHON_VERSION = "3.10"

if sys.version_info < (3, 9):
    raise RuntimeError("This script requires Python 3.9+")

# The top-level directory of this repository.
topdir = Path(__file__).parent.parent

destdir = topdir / "build" / "shinylive" / "pyright"
destfile = destdir / "typeshed.en.json"


shutil.rmtree(topdir / "typings/htmltools", ignore_errors=True)
shutil.rmtree(topdir / "typings/shiny", ignore_errors=True)

pyright_args = ("--pythonplatform", "Linux", "--pythonversion", PYODIDE_PYTHON_VERSION)
pyright.run("--createstub", "htmltools", *pyright_args)
pyright.run("--createstub", "shiny", *pyright_args)
pyright.run("--createstub", "ipyshiny", *pyright_args)


TypeshedFileList = dict[str, str]


def dir_to_file_contents(
    dir: str, dir_prefix: str = "", exclude: set[str] = set()
) -> TypeshedFileList:
    file_data: TypeshedFileList = {}

    exclude_names = {"__pycache__"} | exclude

    # Recursively iterate over files in app directory, and collect the files into
    # file_data data structure.
    for root, dirs, files in os.walk(dir, topdown=True):
        dirs[:] = set(dirs) - exclude_names
        dirs.sort()
        rel_dir = os.path.relpath(root, dir)
        files = [f for f in files if not f.startswith(".")]
        files = [f for f in files if f not in exclude_names]
        files.sort()

        # Add the file to file_data.
        for filename in files:
            if rel_dir == ".":
                output_filename = filename
            else:
                output_filename = os.path.join(rel_dir, filename)

            with open(os.path.join(root, filename), "r") as f:
                file_content = f.read()

            file_data[dir_prefix + output_filename] = file_content

    return file_data


extra_files = {
    "/src/pyrightconfig.json": """{
  "pythonVersion": "%s",
  "pythonPlatform": "Linux",
  "typeCheckingMode": "basic",
  "typeshedPath": "/typeshed/",
  "reportMissingModuleSource": false,
  "reportUnusedFunction": false,
  "reportWildcardImportFromLibrary": false,
  "reportMissingImports": false,
  "verboseOutput": true
}
"""
    % PYODIDE_PYTHON_VERSION
}


stdlib_exclude = {
    "@python2",
    "tkinter",
    "argparse.pyi",
    "macpath.pyi",
    "macurl2path.pyi",
    "subprocess.pyi",
    "socket.pyi",
    "winsound.pyi",
    "winreg.pyi",
    "telnetlib.pyi",
    "multiprocessing",
    "unittest",
    "xml",
    "socket",
    "lib2to3",
    "wsgiref",
    "xmlrpc",
}

stdlib = dir_to_file_contents(
    "typeshed/stdlib", dir_prefix="/typeshed/stdlib/", exclude=stdlib_exclude
)


all_contents = (
    stdlib
    | dir_to_file_contents("typings/shiny", dir_prefix="/src/typings/shiny/")
    | dir_to_file_contents("typings/htmltools", dir_prefix="/src/typings/htmltools/")
    | dir_to_file_contents("typings/ipyshiny", dir_prefix="/src/typings/ipyshiny/")
    | extra_files
)


print(f"Writing to {destfile}")
if not destdir.exists():
    destdir.mkdir(parents=True)
with open(destfile, "w") as f:
    json.dump(all_contents, f, indent=2)
