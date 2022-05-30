#!/usr/bin/env python3

BUILD_DIR = "build"
DEFAULT_PYODIDE_DIR = BUILD_DIR + "/shinylive/pyodide"

usage_info = f"""
Find the versions of htmltools, shiny, and their dependencies that are needed to add to
the base Pyodide distribution.

Usage:
  py_package_versions.py generate_lockfile
    Create shinylive_packages.lock file.

  py_package_versions.py retrieve_packages [destdir]
    Gets packages listed in lockfile, from local sources and from PyPI.
    [destdir] defaults to {DEFAULT_PYODIDE_DIR}.

  py_package_versions.py insert_into_pyodide_packages [pyodide_dir]
    Modifies pyodide's package.json to include Shiny-related packages.
    [pyodide_dir] defaults to {DEFAULT_PYODIDE_DIR}.
"""


import hashlib
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from typing import Any, Literal, Optional, TypedDict, Union, cast

import pkginfo
from packaging.version import Version
from typing_extensions import NotRequired

top_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
package_source_dir = os.path.join(top_dir, "packages")
requirements_file = os.path.join(top_dir, "requirements.json")
package_lock_file = os.path.join(top_dir, "added_packages_lock.json")

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


def generate_lockfile() -> None:
    with open(requirements_file) as f:
        target_packages: dict[str, TargetPackage] = json.load(f)

    target_package_info = find_package_info_lockfile(target_packages)
    recurse_dependencies_lockfile(target_package_info)
    with open(package_lock_file, "w") as f:
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
        return x

    else:
        raise Exception(f"Unknown source {pkg_info['source']}")


def _get_pypi_package_info(
    name: str, version: Union[Literal["latest"], str]
) -> PackageInfoLockfile:
    """
    Get the package info for a package from PyPI, and return it in our lockfile
    format.
    """

    (pkg_meta, wheel_url_info) = _find_pypi_meta_with_wheel(name, version)

    # Some packages have a different package name from the import (module) name.
    # "linkify-it-py" -> "linkify_it"
    # "python-multipart" -> "multipart"
    # There's no to know the import name for sure from the package name, so it's
    # possible that in the future we'll need to special-case some packages.
    # https://stackoverflow.com/questions/11453866/given-the-name-of-a-python-package-what-is-the-name-of-the-module-to-import
    import_name = name.removeprefix("python-").removesuffix("-py").replace("-", "_")

    return {
        "name": name,
        "version": version,
        "file_name": wheel_url_info["filename"],
        "sha256": wheel_url_info["digests"]["sha256"],
        "url": wheel_url_info["url"],
        "depends": _filter_requires(pkg_meta["info"]["requires_dist"]),
        "imports": [import_name],
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


def retrieve_packages(package_output_dir: str = DEFAULT_PYODIDE_DIR):
    """
    Download packages listed in the lockfile, either from PyPI, or from local wheels, as
    specified in the lockfile.
    """
    with open(package_lock_file, "r") as f:
        packages: dict[str, PackageInfoLockfile] = json.load(f)

    print(f"Copying packages to {package_output_dir}")

    for pkg_info in packages.values():
        destfile = os.path.join(package_output_dir, pkg_info["file_name"])

        if pkg_info["url"] is None:
            srcfile = os.path.join(package_source_dir, pkg_info["file_name"])
            print("  " + os.path.relpath(srcfile))
            shutil.copyfile(srcfile, destfile)
        else:
            print("  " + pkg_info["url"])
            req = urllib.request.urlopen(pkg_info["url"])
            with open(destfile, "b+w") as f:
                f.write(req.read())

        if pkg_info["sha256"] is not None:
            sha256 = _sha256_file(destfile)
            if sha256 != pkg_info["sha256"]:
                raise Exception(
                    f"SHA256 mismatch for {pkg_info['url']}.\n"
                    + f"  Expected {pkg_info['sha256']}\n"
                    + f"  Actual   {sha256}"
                )


def _sha256_file(filename: str) -> str:
    with open(filename, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


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
    import ipyshiny
    import shiny

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

    if sys.argv[1] == "retrieve_packages":
        if len(sys.argv) >= 3:
            retrieve_packages(sys.argv[2])
        else:
            retrieve_packages()

    elif sys.argv[1] == "insert_into_pyodide_packages":
        insert_into_pyodide_packages()

    elif sys.argv[1] == "generate_lockfile":
        generate_lockfile()

    else:
        print(usage_info)
        sys.exit(1)
