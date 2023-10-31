#!/usr/bin/env python3

import functools
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterator, Literal, Optional, TypedDict, Union, cast

import pkginfo
import requirements
from packaging.version import Version
from typing_extensions import NotRequired

BUILD_DIR = "build"


top_dir = Path(__file__).resolve().parent.parent
package_source_dir = top_dir / "packages"
requirements_file = top_dir / "shinylive_requirements.json"
package_lock_file = top_dir / "shinylive_lock.json"

pyodide_dir = top_dir / "build" / "shinylive" / "pyodide"
repodata_json_file = pyodide_dir / "repodata.json"

usage_info = f"""
This script is a tool to find the versions of htmltools, shiny, and their dependencies
that are needed to add to the base Pyodide distribution.

It proceeds in three steps:

1. It reads shinylive_requirements.json to find the set of packages that we want to add
   to pyodide. It finds all the dependencies for these packages, excluding packages that
   are already included in Pyodide, and writes a new shinylive_lock.json file.

2. It retrieves the packages listed in shinylive_lock.json, from local directories, and
   from PyPI.

3. It updates Pyodide's repodata.json file to include the new packages (the ones listed
   in shinylive_lock.json).

Note that the dependency resolution in step 1 is not very smart about versions. The
version for packages in shinylive_requirements.json can be either "latest" or a specific
version like "1.2.1", but not constraints like "<1.2.1". Also, if a package depends on a
constrained version of a package like "<1.2.1", then the constraint will be ignored for
the dependency when generating the lockfile. It will simply use the most recent version
for which there is a pure Python wheel.

Usage:
  pyodide_packages.py generate_lockfile
    Create/replace shinylive_lock.json file, based on shinylive_requirements.json.

  pyodide_packages.py update_lockfile_local
    Update shinylive_lock.json file, based on shinylive_requirements.json, but only
    with local packages (not those from PyPI). This should be run whenever the local
    package versions change.

  pyodide_packages.py retrieve_packages
    Gets packages listed in lockfile, from local sources and from PyPI. Saves packages
    to {os.path.relpath(pyodide_dir)}.

  pyodide_packages.py update_pyodide_repodata_json
    Modifies pyodide's package.json to include Shiny-related packages. Modifies
    {os.path.relpath(repodata_json_file)}
"""

# Packages that shouldn't be listed in "depends" in Pyodide's repodata.json file.
AVOID_DEPEND_PACKAGES = [
    "typing",
    "python",
    # The next two are dependencies for Shiny, but they cause problems.
    # contextvars causes "NameError: name 'asyncio' is not defined". Not sure why. It's
    # already present anyway, as a built-in package.
    "contextvars",
    # websockets isn't used by Shiny when running in the browser.
    "websockets",
    # ipykernel is needed by ipywidgets. We've created a mock for it.
    "ipykernel",
    # This brings in IPython and a lot of unneeded dependencies with compiled code.
    "widgetsnbextension",
]

# Some packages need extra dependencies to be installed or loaded. We'll specify
# these extra dependencies here so that users don't have to put them in
# requirements.txt.
EXTRA_DEPENDENCIES = {
    "pandas": [
        # Pandas doesn't list jinja2 as a hard depedency, but it is needed when
        # doing table styling.
        "jinja2",
    ],
    # Can be removed when we moved to pyodide w/ python 3.11
    "anyio": ["exceptiongroup"],
}


# =============================================
# Data structures used in our requirements.json
# =============================================
class RequirementsPackage(TypedDict):
    name: str
    source: Literal["local", "pypi"]
    version: Union[Literal["latest"], str]


# ====================================================
# Data structures used in our extra_packages_lock.json
# ====================================================
class LockfileDependency(TypedDict):
    name: str
    specs: list[tuple[str, str]]
    # version: Union[str, None]
    # operator: Union[Literal["~=", "==", "!=", ">=", "<=", ">", "<"], None]


class LockfilePackageInfo(TypedDict):
    name: str
    version: str
    filename: str
    # The lockfile will store a sha256:null for local packages. This is because the
    # local packages builds may not be perfectly reproducible, so building on the dev
    # machine might result in one hash, while building on the production machine might
    # result in another.
    sha256: Optional[str]
    url: Optional[str]
    depends: list[LockfileDependency]
    imports: list[str]


# =============================================
# Data structures returned by PyPI's JSON API
# =============================================
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


# =============================================
# Data structures used in pyodide/repodata.json
# =============================================
class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    file_name: str
    install_dir: Literal["lib", "site"]
    sha256: str
    depends: list[str]
    imports: list[str]
    unvendored_tests: NotRequired[bool]


# The package information structure used by Pyodide's repodata.json.
class PyodidePackagesFile(TypedDict):
    info: dict[str, str]
    packages: dict[str, PyodidePackageInfo]


# =============================================================================
# Functions for generating the lockfile from the requirements file.
# =============================================================================
def update_lockfile_local() -> None:
    """
    Update the lockfile with local packages only (none from PyPI). This is
    useful when the local package versions change. It will not recurse into
    dependencies.
    """
    print(
        f"Loading requirements package list from {os.path.relpath(requirements_file)}:"
    )
    with open(requirements_file) as f:
        required_packages: list[RequirementsPackage] = json.load(f)

    required_packages = [x for x in required_packages if x["source"] == "local"]

    print("  " + " ".join([x["name"] for x in required_packages]))

    required_package_info = _find_package_info_lockfile(required_packages)

    print(f"Updating {package_lock_file}")
    with open(package_lock_file) as f:
        lockfile_info: dict[str, LockfilePackageInfo] = json.load(f)

    lockfile_info.update(required_package_info)

    with open(package_lock_file, "w") as f:
        json.dump(
            _mark_no_indent(lockfile_info, _is_lockfile_dependency),
            f,
            indent=2,
            cls=NoIndentEncoder,
        )


def generate_lockfile() -> None:
    print(
        f"Loading requirements package list from {os.path.relpath(requirements_file)}:"
    )
    with open(requirements_file) as f:
        required_packages: list[RequirementsPackage] = json.load(f)

    print("  " + " ".join([x["name"] for x in required_packages]))

    print("Finding dependencies...")
    required_package_info = _find_package_info_lockfile(required_packages)
    _recurse_dependencies_lockfile(required_package_info)
    print("All required packages and dependencies:")
    print("  " + " ".join(required_package_info.keys()))

    print(f"Writing {package_lock_file}")
    with open(package_lock_file, "w") as f:
        json.dump(
            _mark_no_indent(required_package_info, _is_lockfile_dependency),
            f,
            indent=2,
            cls=NoIndentEncoder,
        )


def _recurse_dependencies_lockfile(
    pkgs: dict[str, LockfilePackageInfo],
) -> None:
    """
    Recursively find all dependencies of the given packages. This will mutate the object
    passed in.
    """
    pyodide_packages_info = orig_pyodide_repodata()["packages"]
    i = 0
    while i < len(pkgs):
        pkg_info = pkgs[list(pkgs.keys())[i]]
        i += 1

        print(f"  {pkg_info['name']}:", end="")
        for dep in pkg_info["depends"]:
            dep_name = dep["name"]
            print(" " + dep_name, end="")
            if dep_name in pkgs or dep_name.lower() in pyodide_packages_info:
                # We already have it, either in our extra packages, or in the original
                # set of pyodide packages. Do nothing.
                # Note that the keys in pyodide_packages_info are all lower-cased, even
                # if the package name has capitals.
                pass
            else:
                pkgs[dep_name] = _find_package_info_lockfile_one(
                    {
                        "name": dep_name,
                        "source": "pypi",
                        # TODO: Use version from dependencies
                        "version": "latest",
                    }
                )
        print("")


def _find_package_info_lockfile(
    pkgs: list[RequirementsPackage],
) -> dict[str, LockfilePackageInfo]:
    """
    Given a dict of RequirementsPackage objects, find package information that will be
    inserted into the package lock file. For PyPI packages, this involves fetching
    package metadata from PyPI.
    """
    res: dict[str, LockfilePackageInfo] = {}

    for pkg in pkgs:
        res[pkg["name"]] = _find_package_info_lockfile_one(pkg)
    return res


def _find_package_info_lockfile_one(
    pkg_info: RequirementsPackage,
) -> LockfilePackageInfo:
    """
    Given a RequirementsPackage object, find package information for it that will be
    inserted into the package lock file. For PyPI packages, this involves fetching
    package metadata from PyPI.
    """
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
) -> LockfilePackageInfo:
    """
    Get the package info for a package from PyPI, and return it in our lockfile
    format.
    """

    (pkg_meta, wheel_url_info) = _find_pypi_meta_with_wheel(name, version)

    # Some packages have a different package name from the import (module) name.
    # "linkify-it-py" -> "linkify_it"
    # "python-multipart" -> "multipart"
    # There's no way to be certain of the import name from the package name, so it's
    # possible that in the future we'll need to special-case some packages.
    # https://stackoverflow.com/questions/11453866/given-the-name-of-a-python-package-what-is-the-name-of-the-module-to-import
    import_name = name.removeprefix("python-").removesuffix("-py").replace("-", "_")

    return {
        "name": name,
        "version": pkg_meta["info"]["version"],
        "filename": wheel_url_info["filename"],
        "sha256": wheel_url_info["digests"]["sha256"],
        "url": wheel_url_info["url"],
        "depends": _filter_requires(pkg_meta["info"]["requires_dist"]),
        "imports": [import_name],
    }


# Memoize this function because there may be many duplicate requests for the same
# package and version combination.
@functools.cache
def _find_pypi_meta_with_wheel(
    name: str, version: Union[Literal["latest"], str]
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


def _get_local_wheel_info(file: str) -> LockfilePackageInfo:
    """
    Get package info from a local wheel file.
    """
    info: Any = pkginfo.Wheel(file)  # type: ignore
    res: LockfilePackageInfo = {
        "name": info.name,
        "version": info.version,
        "filename": os.path.basename(file),
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
def _filter_requires(requires: Union[list[str], None]) -> list[LockfileDependency]:
    if requires is None:
        return []

    def _get_dep_info(dep_str: str) -> LockfileDependency:
        reqs = requirements.parse(dep_str)
        req = next(reqs)
        if next(reqs, None) is not None:
            raise Exception(f"More than one requirement in {dep_str}")

        return {
            "name": req.name,  # type: ignore
            # req.specs will be something [["!=", "0.17.2"], [">=", "0.17.1"]], but the
            # order is not consistent between runs. Sort it to make it consistent.
            "specs": sorted(req.specs),  # type: ignore - Due to a type bug in requirements package.
        }

    # Given a dependency string, return whether or not is should be used. This is a bit
    # crude, but it works for our purposes. This drops package descriptions with extras,
    # like "scikit-learn ; extra == 'all'" -- it actually drops any string with a
    # semicolon, _except_ if it contains 'platform_system == "Emscripten"'. (This is a
    # special case to work with mizani, which requires tzdata on Emscripten.)
    def _dep_filter(dep_str: str) -> bool:
        if re.search(";.*platform_system *== *['\"]Emscripten['\"]", dep_str):
            return True
        if re.search(";", dep_str):
            return False
        return True

    # Remove package descriptions with extras, like "scikit-learn ; extra == 'all'"
    res = filter(_dep_filter, requires)
    # Strip off version numbers: "python-dateutil (>=2.8.2)" => "python-dateutil"
    res = map(_get_dep_info, res)
    # Filter out packages that cause problems.
    res = filter(lambda x: x["name"] not in AVOID_DEPEND_PACKAGES, res)
    return list(res)


# =============================================================================
# Functions for copying and downloading the wheel files.
# =============================================================================
def retrieve_packages():
    """
    Download packages listed in the lockfile, either from PyPI, or from local wheels, as
    specified in the lockfile.
    """
    with open(package_lock_file, "r") as f:
        packages: dict[str, LockfilePackageInfo] = json.load(f)

    print(f"Copying packages to {os.path.relpath(pyodide_dir)}")

    for pkg_info in packages.values():
        destfile = os.path.join(pyodide_dir, pkg_info["filename"])

        if pkg_info["url"] is None:
            srcfile = os.path.join(package_source_dir, pkg_info["filename"])
            print("  Copying " + os.path.relpath(srcfile))
            shutil.copyfile(srcfile, destfile)
        else:
            if os.path.exists(destfile):
                print(f"  {destfile} already exists. Checking SHA256... ", end="")
                if _sha256_file(destfile) == pkg_info["sha256"]:
                    print("OK")
                    continue
                else:
                    print("Mismatch! Downloading...")

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


# =============================================================================
# Functions for modifying the pyodide/repodata.json file with the extra packages.
# =============================================================================
def update_pyodide_repodata_json():
    pyodide_packages = orig_pyodide_repodata()

    print(
        f"Adding package information from {package_lock_file} into {repodata_json_file}"
    )

    with open(package_lock_file, "r") as f:
        lockfile_packages = cast(dict[str, LockfilePackageInfo], json.load(f))

    print("Adding packages to Pyodide packages:")
    for name, pkg_info in lockfile_packages.items():
        if name in pyodide_packages:
            raise Exception(f"  {name} already in {repodata_json_file}")

        print(f"  {name}")
        p_pkg_info = _lockfile_to_pyodide_package_info(pkg_info)
        # If the sha256 is "", then that's a signal that this is a local file and we
        # need to compute the sha256 here.
        if p_pkg_info["sha256"] == "":
            p_pkg_info["sha256"] = _sha256_file(
                str(package_source_dir / p_pkg_info["file_name"])
            )
        pyodide_packages["packages"][name] = p_pkg_info

    print("Injecting extra dependencies")
    for name in EXTRA_DEPENDENCIES:
        pyodide_packages["packages"][name]["depends"].extend(EXTRA_DEPENDENCIES[name])

    print("Writing pyodide/repodata.json")
    with open(repodata_json_file, "w") as f:
        json.dump(pyodide_packages, f)


def _lockfile_to_pyodide_package_info(pkg: LockfilePackageInfo) -> PyodidePackageInfo:
    """
    Given the information about a package from the lockfile, translate it to the format
    used by pyodide/repodata.json.
    """
    return {
        "name": pkg["name"],
        "version": pkg["version"],
        "file_name": pkg["filename"],
        "install_dir": "site",
        # If the sha256 is None, put a "" here.
        "sha256": pkg["sha256"] or "",
        "depends": [x["name"] for x in pkg["depends"]],
        "imports": pkg["imports"],
    }


def orig_pyodide_repodata() -> PyodidePackagesFile:
    """
    Read in the original Pyodide repodata.json from the Pyodide directory. If it doesn't
    already exist, this will make a copy, named repodata.orig.json. Then it will read in
    repodata.orig.json and return the "packages" field.
    """

    orig_repodata_json_file = os.path.join(
        os.path.dirname(repodata_json_file), "repodata.orig.json"
    )

    if not os.path.isfile(orig_repodata_json_file):
        print(
            f"{os.path.relpath(orig_repodata_json_file)} does not exist. "
            + f" Copying {os.path.relpath(repodata_json_file)} to {os.path.relpath(orig_repodata_json_file)}."
        )
        shutil.copy(repodata_json_file, orig_repodata_json_file)

    with open(orig_repodata_json_file, "r") as f:
        pyodide_packages_info = cast(PyodidePackagesFile, json.load(f))

    return pyodide_packages_info


# =============================================================================
# JSON encoding tools
# =============================================================================
# The purpose of this custom JSON encoder (and related functions) is to print some
# objects on a single line when ecoded to JSON. With the default JSON formatting,
# LockfileDependency objects use a lot of unnecessary vertical space, even though they
# can easily fit on one line.


def _is_lockfile_dependency(x: object):
    """
    Return True if the object is a LockfileDependency object.
    """
    return isinstance(x, dict) and set(x) == {"name", "specs"}  # type: ignore


def _mark_no_indent(x: Any, check_fn: Callable[[object], bool]) -> Any:
    """
    Traverse a tree-like sctructure with dicts, lists, and tuples, and mark some objects
    to not be indented when the object is JSON-formatted. The function `f` is called on
    each object, and if it returns true, then it is marked to not be indented.
    """
    if check_fn(x):
        return NoIndent(x)
    if isinstance(x, dict):
        return {k: _mark_no_indent(v, check_fn) for k, v in x.items()}  # type: ignore
    if isinstance(x, (list, tuple)):
        return [_mark_no_indent(y, check_fn) for y in x]  # type: ignore
    return x


class NoIndent(object):
    """
    Wrapper class to mark objects to be formatted without line wrapping and indentation.
    """

    def __init__(self, value: object):
        self.value = value


class NoIndentEncoder(json.JSONEncoder):
    """
    A JSON encoder that does not indent objects that are wrapped with the NoIndent
    class.

    To be used with mark_no_indent().
    """

    # For each object to be encoded: First, the default() method is called on it, if the
    # JSONEncoder doesn't already know how to encode it. (default() won't be called for
    # things like numbers, strings, lists, dicts, etc; only for things like custom
    # objects.) In this phase, we look for NoIndent objects, replace them with a string
    # with format like "@@123@@", and store the object in a dictionary.
    #
    # Then, the iterencode() method is called on the object. At this point, we replace
    # the string with a JSON-encoding of the original object, but this JSON does not
    # have any indentation or line-wrapping.
    def __init__(self, **kwargs: object):
        self._obj_registry: dict[int, object] = {}
        self._id_counter = 0

        # Keyword arguments to ignore when encoding NoIndent wrapped values.
        ignore = {"cls", "indent"}

        # Save copy of any keyword argument values needed for use here.
        self._kwargs = {k: v for k, v in kwargs.items() if k not in ignore}
        super(NoIndentEncoder, self).__init__(**kwargs)

    def default(self, o: object) -> object:
        if isinstance(o, NoIndent):
            obj_id = self._id_counter
            self._id_counter += 1
            self._obj_registry[obj_id] = o
            return f"@@{obj_id}@@"
        else:
            return super(NoIndentEncoder, self).default(o)

    def iterencode(
        self, o: object, _one_shot: bool = False, **kwargs: object
    ) -> Iterator[str]:
        regex = re.compile("@@(\\d+)@@")

        # Replace any marked-up NoIndent wrapped values in the JSON repr
        # with the json.dumps() of the corresponding wrapped Python object.
        for encoded in super(NoIndentEncoder, self).iterencode(
            o, _one_shot=_one_shot, **kwargs
        ):
            match = regex.search(encoded)
            if match:
                obj_id = match.group(1)
                no_indent_obj = cast(NoIndent, self._obj_registry[int(obj_id)])
                json_repr = json.dumps(no_indent_obj.value, **self._kwargs)
                # Replace the matched id string with json formatted representation
                # of the corresponding Python object.
                # "@@123@@" -> {"name": "shiny", "specs": [[">=", "0.2.0.9004"]]}
                encoded = encoded.replace(f'"@@{obj_id}@@"', json_repr)

            yield encoded


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(usage_info)
        sys.exit(1)

    if sys.argv[1] == "generate_lockfile":
        generate_lockfile()

    elif sys.argv[1] == "update_lockfile_local":
        update_lockfile_local()

    elif sys.argv[1] == "retrieve_packages":
        retrieve_packages()

    elif sys.argv[1] == "update_pyodide_repodata_json":
        update_pyodide_repodata_json()

    else:
        print(usage_info)
        sys.exit(1)
