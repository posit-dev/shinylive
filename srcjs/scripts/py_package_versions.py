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
from typing import Any, Dict, List, Literal, TypedDict
from typing_extensions import NotRequired

top_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
package_source_dir = os.path.join(top_dir, "packages")


# The package information structure we use.
class PackageInfo(TypedDict):
    name: str
    version: str
    # For some packages, the name of the package (like "foo-bar") differs from the imported
    # module name (like "foo_bar"). Also, some can have multiple imported modules.
    imports: NotRequired[List[str]]

    # source: Literal["pypi", "local"]


# The package information structure used by Pyodide's packages.json.
class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    file_name: str
    install_dir: Literal["lib", "site"]
    depends: List[str]
    imports: List[str]
    unvendored_tests: NotRequired[bool]


# TODO:
# * This data should probably live in a separate file.
# * There should also be a way to automatically get these package names and versions.
#   Currently they are obtained by loading the base pyodide installation, then running
#   micropip.install("htmltools") and micropip.install("shiny"), and inspecting the
#   browser's network traffic to see what packages are downloaded from PyPI.
pypi_packages_info: Dict[str, PackageInfo] = {
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
    "siuba": {
        "name": "siuba",
        "version": "0.2.3",
    },
    "pyllusion": {
        "name": "pyllusion",
        "version": "0.0.12",
    },
}


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
    all_pyodide_package_files = os.listdir(pyodide_dir)

    # Build list of filenames like shinylive/pyodide/shiny-0.2.0.9002-py3-none-any.whl
    new_pyodide_packages_filenames: List[str] = []
    for pkg_name in all_packages_info.keys():
        # Convert package name like "uc-micro-py" to "uc_micro_py"; the latter is used
        # for the package filename.
        pkg_file_prefix = pkg_name.replace("-", "_")
        r = re.compile(f"^{pkg_file_prefix}-.*\\.whl$")
        pkg_file = [
            filename for filename in all_pyodide_package_files if r.match(filename)
        ]

        if len(pkg_file) != 1:
            raise RuntimeError(
                f"""Expected to find exactly one package file in {pyodide_dir} for package {pkg_name}, found {pkg_file}
                You need to copy over the package file first."""
            )
        new_pyodide_packages_filenames.append(os.path.join(pyodide_dir, pkg_file[0]))

    new_pyodide_package_info_list: List[PyodidePackageInfo] = [
        _get_pyodide_package_info(x, all_packages_info)
        for x in new_pyodide_packages_filenames
    ]
    new_pyodide_package_info_dict: Dict[str, PyodidePackageInfo] = {
        x["name"]: x for x in new_pyodide_package_info_list
    }

    pyodide_packages["packages"].update(new_pyodide_package_info_dict)

    with open(packages_file, "w") as f:
        json.dump(pyodide_packages, f)


def _get_pyodide_package_info(
    wheel_file: str, all_packages_info: Dict[str, PackageInfo]
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
def _filter_requires(requires: List[str]) -> List[str]:
    # Packages that don't need to be listed in "depends".
    AVOID_PACKAGES = [
        "typing",
        "python",
        # The next two are dependencies for Shiny, but they cause problems.
        # contextvars causes "NameError: name 'asyncio' is not defined". Not sure why.
        "contextvars",
        # websockets isn't used by Shiny when running in the browser.
        "websockets",
    ]

    res = [x for x in requires if ";" not in x]
    res = [re.sub("([a-zA-Z0-9_-]+).*", "\\1", x) for x in res]
    res = [x for x in res if x not in AVOID_PACKAGES]
    return list(res)


# Reads htmltools and shiny package versions from their subdirs, and then merges them
# with the pypi_package_versions
def _get_all_packages_info() -> Dict[str, PackageInfo]:
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
