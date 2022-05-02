#!/usr/bin/env python3

DEFAULT_PYODIDE_DIR = "shinylive/pyodide"

usage_info = f"""
Find the versions of htmltools, shiny, and their dependencies that are needed to add to
the base Pyodide distribution.

Usage:
  py_package_versions.py download_pypi_packages [destdir]
    Downloads needed packages from PyPI.
    [destdir] defaults to {DEFAULT_PYODIDE_DIR}.

  py_package_versions.py insert_into_pyodide_packages [pyodide_dir]
    Modifies pyodide's package.json to include Shiny-related packages.
    [pyodide_dir] defaults to {DEFAULT_PYODIDE_DIR}.
"""


import json
import os
import re
import sys
from typing import Any, Literal, TypedDict
from typing_extensions import NotRequired

# The package information structure we use.
class PackageInfo(TypedDict):
    name: str
    version: str
    # For some packages, the name of the package (like "foo-bar") differs from the imported
    # module name (like "foo_bar"). Also, some can have multiple imported modules.
    imports: NotRequired[list[str]]

    # source: Literal["pypi", "local"]


# The package information structure used by Pyodide's packages.json.
class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    file_name: str
    install_dir: Literal["lib", "site"]
    depends: list[str]
    imports: list[str]
    unvendored_tests: NotRequired[bool]


# TODO:
# * This data should probably live in a separate file.
# * There should also be a way to automatically get these package names and versions.
#   Currently they are obtained by loading the base pyodide installation, then running
#   micropip.install("htmltools") and micropip.install("shiny"), and inspecting the
#   browser's network traffic to see what packages are downloaded from PyPI.
pypi_packages_info: dict[str, PackageInfo] = {
    "anyio": {
        "name": "anyio",
        "version": "3.4.0",
    },
    "idna": {
        "name": "idna",
        "version": "3.3",
    },
    "sniffio": {
        "name": "sniffio",
        "version": "1.2.0",
    },
    "starlette": {
        "name": "starlette",
        "version": "0.17.1",
    },
    "linkify-it-py": {
        "name": "linkify-it-py",
        "version": "1.0.3",
        "imports": ["linkify_it"],
    },
    "uc-micro-py": {
        "name": "uc-micro-py",
        "version": "1.0.1",
        "imports": ["uc_micro"],
    },
    "click": {
        "name": "click",
        "version": "8.1.3",
    },
    "markdown-it-py": {
        "name": "markdown-it-py",
        "version": "2.1.0",
        "imports": ["markdown_it"],
    },
    "mdurl": {
        "name": "mdurl",
        "version": "0.1.1",
    },
    "fastapi": {
        "name": "fastapi",
        "version": "0.75.2",
    },
    "uvicorn": {
        "name": "uvicorn",
        "version": "0.17.6",
    },
    "asgiref": {
        "name": "asgiref",
        "version": "3.5.0",
    },
    "h11": {
        "name": "h11",
        "version": "0.13.0",
    },
    "python-multipart": {
        "name": "python-multipart",
        "version": "0.0.4",
        "imports": ["multipart"],
    },
}

this_dir = os.path.dirname(os.path.abspath(__file__))
package_source_dir = os.path.join(this_dir, "packages")


def download_pypi_packages(package_output_dir: str = DEFAULT_PYODIDE_DIR):
    packages: str = " ".join(
        [
            f'{pypi_packages_info[k]["name"]}=={pypi_packages_info[k]["version"]}'
            for k in pypi_packages_info
        ]
    )
    command = f"pip download --no-deps --dest {package_output_dir} {packages}"
    print(command)
    os.system(command)


def insert_into_pyodide_packages(pyodide_dir: str = DEFAULT_PYODIDE_DIR):
    orig_packages_file = os.path.join(pyodide_dir, "packages.orig.json")
    packages_file = os.path.join(pyodide_dir, "packages.json")

    if not os.path.isfile(orig_packages_file):
        import shutil

        print(
            f"{orig_packages_file} does not exist. Copying {packages_file} to {orig_packages_file}."
        )
        shutil.copy(packages_file, orig_packages_file)

    print(f"Inserting package versions into {packages_file}")

    with open(orig_packages_file, "r") as f:
        pyodide_packages = json.load(f)

    # Packages that we're going to add to pyodide's package.json.
    all_packages_info = _get_all_packages_info()
    new_pyodide_packages = all_packages_info.keys()
    # Filter it to keep only packages that are in new_pyodide_packages, like shiny
    # and uc-micro-py. For packages with hyphens (uc-micro-py), the corresponding files
    # have underscores (uc-micro_py).
    new_pyodide_packages_filenames = [
        os.path.join(pyodide_dir, x)
        for x in os.listdir(pyodide_dir)
        # Trim off version numbers (and everything after) and replace "-" with "_".
        if re.sub("-.*", "", x).replace("_", "-") in new_pyodide_packages
    ]

    print(new_pyodide_packages_filenames)

    new_pyodide_package_info_list: list[PyodidePackageInfo] = [
        _get_pyodide_package_info(x, all_packages_info)
        for x in new_pyodide_packages_filenames
    ]
    new_pyodide_package_info_dict: dict[str, PyodidePackageInfo] = {
        x["name"]: x for x in new_pyodide_package_info_list
    }
    print(json.dumps(new_pyodide_package_info_dict, indent=2))

    pyodide_packages["packages"].update(new_pyodide_package_info_dict)

    with open(packages_file, "w") as f:
        json.dump(pyodide_packages, f)


def _get_pyodide_package_info(
    wheel_file: str, all_packages_info: dict[str, PackageInfo]
) -> PyodidePackageInfo:
    import pkginfo

    info: Any = pkginfo.Wheel(wheel_file)  # type: ignore
    res: PyodidePackageInfo = {
        "name": info.name,
        "version": info.version,
        "file_name": os.path.basename(wheel_file),
        "install_dir": "site",
        "depends": _filter_requires(info.requires_dist),
        "imports": [info.name],
    }

    # If imports was specified, use it; otherwise just use the package name.
    package_info = all_packages_info[info.name]
    if "imports" in package_info:
        res["imports"] = package_info["imports"]

    return res


# Given input like this:
# [
#   "mdurl~=0.1",
#   "h11 (>=0.8)",
#   "foo",
#   "typing_extensions>=3.7.4;python_version<'3.8'",
#   "psutil ; extra == \"benchmarking\"",
#   "coverage ; extra == \"testing\"",
#   "pytest ; extra == \"testing\"",
# ]
#
# Return this:
# ["mdurl", "h11", "foo"]
#
# It's a little dumb in that it ignores python_version, but it's sufficient for our use.
def _filter_requires(requires: list[str]) -> list[str]:
    # Packages that don't need to be listed in "depends".
    IMPLICIT_PACKAGES = ["typing", "python"]

    res = [x for x in requires if ";" not in x]
    res = [re.sub("([a-zA-Z0-9_-]+).*", "\\1", x) for x in res]
    res = [x for x in res if x not in IMPLICIT_PACKAGES]
    return list(res)


# Reads htmltools and shiny package versions from their subdirs, and then merges them
# with the pypi_package_versions
def _get_all_packages_info() -> dict[str, PackageInfo]:
    sys.path.insert(0, os.path.join(package_source_dir, "./py-htmltools"))
    sys.path.insert(0, os.path.join(package_source_dir, "./py-shiny"))

    import htmltools
    import shiny

    all_package_versions = pypi_packages_info.copy()
    all_package_versions.update(
        {
            "htmltools": {"name": "htmltools", "version": htmltools.__version__},
            "shiny": {"name": "shiny", "version": shiny.__version__},
        }
    )

    return all_package_versions


if __name__ == "__main__":

    if len(sys.argv) < 2:
        print(usage_info)
        sys.exit(1)

    if sys.argv[1] == "download_pypi_packages":
        if len(sys.argv) >= 3:
            package_source_dir = sys.argv[2]
        else:
            package_source_dir = "."
        download_pypi_packages(package_source_dir)

    elif sys.argv[1] == "insert_into_pyodide_packages":
        insert_into_pyodide_packages()

    else:
        print(usage_info)
        sys.exit(1)
