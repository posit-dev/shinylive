#!/usr/bin/env python3

BUILD_DIR = "build"
DEFAULT_PYODIDE_DIR = BUILD_DIR + "/shinylive/pyodide"

usage_info = f"""
Find the versions of htmltools, shiny, and their dependencies that are needed to add to
the base Pyodide distribution.

Usage:
  py_package_versions.py generate_lockfile
    Create shinylive_packages.lock file.

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
from typing import Any, Literal, TypedDict, Union, Optional, cast
from typing_extensions import NotRequired
import urllib.request
import urllib.error
import pkginfo
from packaging.version import Version

top_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
package_source_dir = os.path.join(top_dir, "packages")


# The package information structure we use.
class PackageInfo(TypedDict):
    name: str
    version: str
    # For some packages, the name of the package (like "foo-bar") differs from the imported
    # module name (like "foo_bar"). Also, some can have multiple imported modules.
    imports: NotRequired[list[str]]

    # source: Literal["pypi", "local"]


class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    filename: str
    install_dir: Literal["lib", "site"]
    depends: list[str]
    imports: list[str]
    unvendored_tests: NotRequired[bool]


# The package information structure used by Pyodide's packages.json.
class PyodidePackagesFile(TypedDict):
    info: dict[str, str]
    packages: dict[str, PyodidePackageInfo]


class PackageInfoLockfile(TypedDict):
    name: str
    version: str
    file_name: str
    sha256: Optional[str]
    url: Optional[str]
    depends: list[str]
    imports: list[str]


class TargetPackage(TypedDict):
    name: str
    source: Literal["local", "pypi"]
    version: Union[Literal["latest"], str]


class PypiUrlInfo(TypedDict):
    comment_text: str
    digests: dict[str, str]
    downloads: int
    filename: str
    has_sig: bool
    md5_digest: str
    packagetype: Literal["source", "bdist_wheel"]
    python_version: Union[str, None]
    requires_python: Union[str, None]
    size: int
    upload_time: str
    upload_time_iso_8601: str
    url: str
    yanked: bool
    yanked_reason: Union[str, None]


# It's not clear exactly which of these fields can be None -- these are based on
# observations of a few packages, but might not be exactly right.
class PypiPackageInfo(TypedDict):
    author: str
    author_email: str
    bugtrack_url: Union[str, None]
    classifiers: list[str]
    description: str
    description_content_type: Union[str, None]
    docs_url: Union[str, None]
    download_url: str
    downloads: dict[str, int]
    home_page: str
    keywords: str
    license: str
    maintainer: Union[str, None]
    maintainer_email: Union[str, None]
    name: str
    package_url: str
    platform: str
    project_url: str
    project_urls: dict[str, str]
    release_url: str
    requires_dist: Union[list[str], None]
    requires_python: Union[str, None]
    summary: str
    version: str
    yanked: bool
    yanked_reason: Union[str, None]


class PypiPackageMetadata(TypedDict):
    info: PypiPackageInfo
    last_serial: int
    releases: dict[str, list[PypiUrlInfo]]
    urls: list[PypiUrlInfo]
    vulnerabilities: list[object]


# Maybe this should be a requirements file, which only allows `==` and no version
# specification? Unfortunately, the .whl reference would have to be changed every time a
# shiny version changes.
#
# ../local_wheels/ABC-0.0.2-py3-none-any.whl
# Flask==1.1.2
# flask-restplus==0.13.0
target_packages: dict[str, TargetPackage] = {
    "htmltools": {
        "name": "htmltools",
        "source": "local",
        "version": "latest",
    },
    "shiny": {
        "name": "shiny",
        "source": "local",
        "version": "latest",
    },
    "ipyshiny": {
        "name": "ipyshiny",
        "source": "local",
        "version": "latest",
    },
    "plotnine": {
        "name": "plotnine",
        "source": "pypi",
        "version": "latest",  # Or maybe "latest"?
    },
    "plotly": {
        "name": "plotly",
        "source": "pypi",
        "version": "latest",
    },
    "pyllusion": {
        "name": "pyllusion",
        "source": "pypi",
        "version": "latest",
    },
    "siuba": {
        "name": "siuba",
        "source": "pypi",
        "version": "latest",
    },
}


def generate_lockfile() -> None:
    target_package_info = find_package_info_lockfile(target_packages)
    recurse_dependencies_lockfile(target_package_info)
    with open(os.path.join(top_dir, "added_packages_lock.json"), "w") as f:
        json.dump(target_package_info, f, indent=2)


def recurse_dependencies_lockfile(
    pkgs: dict[str, PackageInfoLockfile],
    pyodide_dir: str = DEFAULT_PYODIDE_DIR,
) -> None:
    """Recursively find all dependencies of the given packages. This will mutate the
    object passed in."""

    pyodide_packages_info = base_pyodide_packages_info(pyodide_dir)
    for pkg_info in list(pkgs.values()):
        for dep_name in pkg_info["depends"]:
            print(f"Looking for dependency: {dep_name}")
            if dep_name in pkgs or dep_name.lower() in pyodide_packages_info:
                # We already have it; do nothing.
                # Note that the keys in pyodide_packages_info are all lower-cased, even
                # if the package name has capitals.
                pass
            else:
                pkgs[dep_name] = find_package_info_lockfile_one(
                    {
                        "name": dep_name,
                        "source": "pypi",
                        # TODO: Use version from dependencies
                        "version": "latest",
                    }
                )


def find_package_info_lockfile(
    pkgs: dict[str, TargetPackage]
) -> dict[str, PackageInfoLockfile]:

    res: dict[str, PackageInfoLockfile] = {}

    for pkg_name, pkg_info in pkgs.items():
        res[pkg_name] = find_package_info_lockfile_one(pkg_info)
    return res


def find_package_info_lockfile_one(pkg_info: TargetPackage) -> PackageInfoLockfile:
    all_wheel_files = os.listdir(package_source_dir)
    all_wheel_files = [f for f in all_wheel_files if f.endswith(".whl")]

    if pkg_info["source"] == "local":
        wheel_file = [
            f for f in all_wheel_files if f.startswith(pkg_info["name"] + "-")
        ]
        if len(wheel_file) != 1:
            raise Exception(
                f"Expected exactly one wheel file for package {pkg_info['name']}, found {wheel_file}"
            )
        wheel_file = os.path.join(package_source_dir, wheel_file[0])
        return _get_local_wheel_info(wheel_file)

    elif pkg_info["source"] == "pypi":
        x = _get_pypi_package_info(pkg_info["name"], pkg_info["version"])
        # print(json.dumps(x, indent=2))
        return x

    else:
        raise Exception(f"Unknown source {pkg_info['source']}")


def _get_pypi_package_info(
    name: str, version: Union[Literal["latest"], str]
) -> PackageInfoLockfile:
    """Get the package info for a package from PyPI."""

    (pkg_meta, wheel_url_info) = _find_pypi_meta_with_wheel(name, version)
    # print(json.dumps(pkg_meta["info"], indent=2))
    return {
        "name": name,
        "version": version,
        "file_name": wheel_url_info["filename"],
        "sha256": wheel_url_info["digests"]["sha256"],
        "url": wheel_url_info["url"],
        "depends": _filter_requires(pkg_meta["info"]["requires_dist"]),
        "imports": [
            name
            # Might need customization here. Can we automate?
        ],
    }


def _find_pypi_meta_with_wheel(
    name: str, version: str
) -> tuple[PypiPackageMetadata, PypiUrlInfo]:
    """
    Find the URL information for the wheel file for a package from PyPI. Returns a tuple
    with version number and the PyPI URL information.
    """
    if version == "latest":
        version = ""
    else:
        version = "/" + version

    pkg_meta: PypiPackageMetadata
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{name}{version}/json") as f:
            pkg_meta = cast(PypiPackageMetadata, json.load(f))
    except urllib.error.HTTPError as e:
        raise Exception(f"Error getting package info for {name} from PyPI: {e}")

    def url_info_is_wheel(x: PypiUrlInfo) -> bool:
        return x["packagetype"] == "bdist_wheel" and x["filename"].endswith(
            "py3-none-any.whl"
        )

    for url_info in pkg_meta["urls"]:
        if url_info_is_wheel(url_info):
            return (pkg_meta, url_info)

    # If we made it here, then we didn't find a wheel in the "urls" section. Iterate
    # backwards through the releases, and find the most recent one that has a wheel.
    all_versions = pkg_meta["releases"].keys()
    all_versions = sorted(all_versions, key=lambda v: Version(v), reverse=True)

    for v in all_versions:
        url_infos: list[PypiUrlInfo] = pkg_meta["releases"][v]
        for url_info in url_infos:
            if url_info_is_wheel(url_info):
                # Now that we've found the version with a wheel, call this function
                # again, but ask for that specific version.
                return _find_pypi_meta_with_wheel(name, v)

    raise Exception(f"No wheel URL found for {name} from PyPI")


def _get_local_wheel_info(file: str) -> PackageInfoLockfile:
    """Get the package info from a local wheel file."""
    info: Any = pkginfo.Wheel(file)  # type: ignore
    res: PackageInfoLockfile = {
        "name": info.name,
        "version": info.version,
        "file_name": os.path.basename(file),
        "sha256": None,
        "url": None,
        "depends": _filter_requires(info.requires_dist),
        "imports": [info.name],
    }
    # Note that it is possible for the imports field to differ from the package name
    # (and it is nontrivial to find the actual modules provided by a package). But for
    # the packages we're using from local wheels, that is not the case. If this changes
    # in the future, we can find a better.

    return res


def base_pyodide_packages_info(
    pyodide_dir: str = DEFAULT_PYODIDE_DIR,
) -> dict[str, PyodidePackageInfo]:
    base_packages_file = os.path.join(pyodide_dir, "packages.orig.json")
    packages_file = os.path.join(pyodide_dir, "packages.json")

    if not os.path.isfile(base_packages_file):
        import shutil

        print(
            f"{base_packages_file} does not exist. Copying {packages_file} to {base_packages_file}."
        )
        shutil.copy(packages_file, base_packages_file)

    print(f"Inserting package versions into {packages_file}")

    with open(base_packages_file, "r") as f:
        pyodide_packages_info = cast(PyodidePackagesFile, json.load(f))

    return pyodide_packages_info["packages"]


# From target_packages, run a script which:
# * Finds the dependency tree (merged with packages.json).
#   * Should error if a requested package is already in packages.json.
# * Generate a lock file, with name, source, and version.
#   * ???
#
# From the lock file, download the packages and modify pyodide/packages.json


# TODO:
# * This data should probably live in a separate file.
# * There should also be a way to automatically get these package names and versions.
#   Currently they are obtained by loading the base pyodide installation, then running
#   micropip.install("htmltools") and micropip.install("shiny"), and inspecting the
#   browser's network traffic to see what packages are downloaded from PyPI.
pypi_packages_info: dict[str, PackageInfo] = {
    # Packages below are for Shiny
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
    "appdirs": {
        "name": "appdirs",
        "version": "1.4.4",
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
    # Packages below are for siuba
    "siuba": {
        "name": "siuba",
        "version": "0.2.3",
    },
    # Packages below are for plotnine
    "plotnine": {
        "name": "plotnine",
        "version": "0.8.0",
    },
    "descartes": {
        "name": "descartes",
        "version": "1.1.0",
    },
    "mizani": {
        "name": "mizani",
        "version": "0.7.4",
    },
    "palettable": {
        "name": "palettable",
        "version": "3.3.0",
    },
    # Packages below are for pyllusion
    "pyllusion": {
        "name": "pyllusion",
        "version": "0.0.12",
    },
    # Packages below are for ipywidgets (which is needed by ipyshiny)
    "ipywidgets": {
        "name": "ipywidgets",
        "version": "7.7.0",
    },
    # This causes IPython and a lot of other packages to load, many of which have
    # compiled code and can't be installed in pyodide.
    # "widgetsnbextension": {
    #     "name": "widgetsnbextension",
    #     "version": "3.6.0",
    # },
    # "notebook": {
    #     "name": "notebook",
    #     "version": "6.4.11",
    # },
    "ipython-genutils": {
        "name": "ipython-genutils",
        "version": "0.2.0",
        "imports": ["ipython_genutils"],
    },
    "nbformat": {
        "name": "nbformat",
        "version": "5.4.0",
    },
    "jsonschema": {
        "name": "jsonschema",
        "version": "4.5.1",
    },
    "fastjsonschema": {
        "name": "fastjsonschema",
        "version": "2.15.3",
    },
    # Packages below are for ipyshiny
    "jupyter-core": {
        "name": "jupyter-core",
        "version": "4.10.0",
        "imports": ["jupyter_core"],
    },
    "traitlets": {
        "name": "traitlets",
        "version": "5.2.1.post0",
    },
    # For plotly
    "plotly": {
        "name": "plotly",
        "version": "4.8.0",
    },
    "tenacity": {
        "name": "tenacity",
        "version": "8.0.1",
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
    new_pyodide_packages_filenames: list[str] = []
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

    new_pyodide_package_info_list: list[PyodidePackageInfo] = [
        _get_pyodide_package_info(x, all_packages_info)
        for x in new_pyodide_packages_filenames
    ]
    new_pyodide_package_info_dict: dict[str, PyodidePackageInfo] = {
        x["name"]: x for x in new_pyodide_package_info_list
    }

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
def _filter_requires(requires: Union[list[str], None]) -> list[str]:
    if requires is None:
        return []

    # Packages that don't need to be listed in "depends".
    AVOID_PACKAGES = [
        "typing",
        "python",
        # The next two are dependencies for Shiny, but they cause problems.
        # contextvars causes "NameError: name 'asyncio' is not defined". Not sure why.
        "contextvars",
        # websockets isn't used by Shiny when running in the browser.
        "websockets",
        # ipykernel is needed by ipywidgets. We've created a mock for it.
        "ipykernel",
        # This brings in IPython and a lot of unneeded dependencies with compiled code.
        "widgetsnbextension",
    ]

    res = [x for x in requires if ";" not in x]
    res = [re.sub("([a-zA-Z0-9_-]+).*", "\\1", x) for x in res]
    res = [x for x in res if x not in AVOID_PACKAGES]
    return list(res)


# Reads htmltools and shiny package versions from their subdirs, and then merges them
# with the pypi_package_versions
def _get_all_packages_info() -> dict[str, PackageInfo]:
    sys.path.insert(0, os.path.join(package_source_dir, "./py-htmltools"))
    sys.path.insert(0, os.path.join(package_source_dir, "./py-shiny"))

    import htmltools
    import shiny
    import ipyshiny

    all_package_versions = pypi_packages_info.copy()
    all_package_versions.update(
        {
            "htmltools": {"name": "htmltools", "version": htmltools.__version__},
            "shiny": {"name": "shiny", "version": shiny.__version__},
            "ipyshiny": {"name": "ipyshiny", "version": ipyshiny.__version__},
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

    elif sys.argv[1] == "generate_lockfile":
        generate_lockfile()

    else:
        print(usage_info)
        sys.exit(1)
