#!/usr/bin/env python3

import copy
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
pyodide_lock_json_file = pyodide_dir / "pyodide-lock.json"

usage_info = f"""
This script is a tool to find the versions of htmltools, shiny, and their dependencies
that are needed to add to the base Pyodide distribution.

It proceeds in three steps:

1. It reads shinylive_requirements.json to find the set of packages that we want to add
   to pyodide. It resolves one package set per minor version in shiny_versions.json
   with `uv pip compile` against the Pyodide platform, and writes shinylive_lock.json
   (format 2).

2. It retrieves the packages listed in shinylive_lock.json, from local directories, and
   from PyPI.

3. It updates Pyodide's pyodide-lock.json file to include the new packages (the ones
   listed in shinylive_lock.json).

Usage:
  pyodide_packages.py generate_lockfile
    Create/replace shinylive_lock.json file, based on shinylive_requirements.json.

  pyodide_packages.py update_lockfile_local
    Update shinylive_lock.json file, based on shinylive_requirements.json, but only with
    local packages (not those from PyPI). This should be run whenever the local package
    versions change.

  pyodide_packages.py retrieve_packages
    Gets packages listed in lockfile, from local sources and from PyPI. Saves packages
    to {os.path.relpath(pyodide_dir)}.

  pyodide_packages.py update_pyodide_lock_json
    Modifies pyodide's package-lock.json to include Shiny-related packages. Modifies
    {os.path.relpath(pyodide_lock_json_file)}
"""

# Packages that shouldn't be listed in "depends" in Pyodide's pyodide-lock.json file.
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
    # palmerpenguins imports pkg_resources, which is part of setuptools.
    "palmerpenguins": ["setuptools"],
}

# Some packages may have a circular dependency. For example, shiny (v1.5.0) depends on
# shinychat, and shinychat depends on shiny. Python is okay with this (as long
# as the imports aren't circular at runtime), but pyodide has trouble with it.
# This hack breaks the circularity by removing shiny from shinychat's dependencies,
# which is okay since shinylive will always come with shiny already installed.
OMIT_DEPENDENCIES = {
    "shinychat": ["shiny"],
}

# =============================================
# Data structures used in our shinylive_requirements.json
# =============================================
class RequirementsPackage(TypedDict):
    name: str
    source: Literal["local", "pypi"]
    version: Union[Literal["latest"], str]


# ====================================================
# Data structures used in our shinylive_lock.json
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


# =================================================
# Data structures used in pyodide/pyodide-lock.json
# =================================================
class PyodidePackageInfo(TypedDict):
    name: str
    version: str
    file_name: str
    install_dir: Literal["lib", "site"]
    sha256: str
    depends: list[str]
    imports: list[str]
    unvendored_tests: NotRequired[bool]


# The package information structure used by Pyodide's pyodide-lock.json.
class PyodidePackagesFile(TypedDict):
    info: dict[str, str]
    packages: dict[str, PyodidePackageInfo]


# =================================================
# Internal data structures
# =================================================
# =============================================================================
# Resolving one package set per shiny minor version with uv.
# =============================================================================
shiny_versions_file = top_dir / "shiny_versions.json"

# Pyodide 0.27.7 uses Python 3.12 and the pyodide_2024_0 platform tag.
PYODIDE_PYTHON_VERSION = "3.12"
UV_PYTHON_PLATFORM = "wasm32-pyodide2024"

# Extra constraints per minor version, for when the newest allowed dependency
# breaks an older shiny at runtime. Lines in requirements syntax. An entry is
# removed when its minor leaves shiny_versions.json.
#
# shiny 1.5.1 requires htmltools>=0.6.0 with no upper bound, so uv resolves
# htmltools 0.7.0 for it. Shiny Express apps on that pairing fail at startup
# with a TypeError from htmltools' tagify(), which rejects the un-tagified Tag
# that shiny returns. shiny 1.6.4 and later require htmltools>=0.7.0 and run
# on it.
VERSION_CONSTRAINTS: dict[str, list[str]] = {
    "1.5": ["htmltools<0.7"],
}

# Constraints applied to every minor version, ahead of VERSION_CONSTRAINTS.
# starlette 1.3 and later call .decode() on scope["query_string"], and
# shinylive's HTTP bridge in src/messageporthttp.ts sends it as a str, so page
# loads fail. The cap stays until the bridge sends bytes.
SHARED_CONSTRAINTS: list[str] = ["starlette<1.3"]

# Stock Pyodide packages passed to uv as overrides instead of constraints.
# htmltools 0.7.0 requires typing-extensions>=4.12.0 while Pyodide 0.27.7
# includes 4.11.0, shiny requires orjson>=3.10.7 while Pyodide includes
# 3.10.1, and shiny 1.9.0 requires narwhals>=2.26.0 while Pyodide includes
# 1.41.0. shiny 1.9.0 uses only narwhals.stable.v1 APIs that 1.41.0 has, and
# checks for nw.Map with hasattr. The bundle runs with the stock versions, so
# the override keeps uv from rejecting them, and any other conflict with a
# stock version still fails the resolution.
STOCK_OVERRIDES = {"typing-extensions", "orjson", "narwhals"}

# Local wheels whose platform tag uv may not accept for the pyodide target.
# They are added to each lock directly; none of them has dependencies that
# need resolving.
LOCAL_NOT_RESOLVED = {"libsass"}


def bundled_python_minors() -> dict[str, str]:
    """minor -> exact, newest first, from shiny_versions.json."""
    with open(shiny_versions_file) as f:
        return json.load(f)["python"]


def normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def uv_requirements(required: list[RequirementsPackage], shiny_exact: str) -> list[str]:
    """The requirements.in lines for one minor version."""
    lines: list[str] = []
    for pkg in required:
        if pkg["name"] in LOCAL_NOT_RESOLVED:
            continue
        if pkg["name"] == "shiny":
            lines.append(f"shiny=={shiny_exact}")
        elif pkg["version"] == "latest":
            lines.append(pkg["name"])
        else:
            lines.append(f"{pkg['name']}=={pkg['version']}")
    return lines


def uv_constraints(
    stock: dict[str, Any], local: dict[str, str], extra: list[str]
) -> list[str]:
    """Constraint lines: every stock Pyodide package at its version, every
    local wheel at its version, then the per-minor extras. Stock entries that
    are shared libraries or CPython modules are skipped; they are not PyPI
    distributions, and some (openssl 1.1.1w) have versions uv cannot parse.
    STOCK_OVERRIDES go to uv_overrides instead."""
    lines = [
        f"{info['name']}=={info['version']}"
        for info in _stock_python_packages(stock)
        if normalize_name(info["name"]) not in STOCK_OVERRIDES
    ]
    lines += [f"{name}=={version}" for name, version in local.items()]
    return lines + list(extra)


def uv_overrides(stock: dict[str, Any]) -> list[str]:
    """Override lines: the stock packages in STOCK_OVERRIDES at their stock
    version."""
    return [
        f"{info['name']}=={info['version']}"
        for info in _stock_python_packages(stock)
        if normalize_name(info["name"]) in STOCK_OVERRIDES
    ]


def _stock_python_packages(stock: dict[str, Any]) -> list[Any]:
    return [
        info
        for info in stock.values()
        if info.get("package_type", "package") == "package"
    ]


PIN_LINE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)$")


def parse_compiled(text: str) -> dict[str, str]:
    """normalized name -> version, from `uv pip compile` output."""
    pinned: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.split("#")[0].strip()
        if not line:
            continue
        m = PIN_LINE.match(line)
        if not m:
            raise ValueError(f"unexpected line in uv output: {raw!r}")
        pinned[normalize_name(m.group(1))] = m.group(2)
    return pinned


def local_wheel_versions(required: list[RequirementsPackage]) -> dict[str, str]:
    """name -> version for every wheel in packages/ whose package has source
    "local" in shinylive_requirements.json. Other wheels in packages/ (such as
    a shiny or htmltools wheel built from its submodule) are ignored."""
    local_names = {normalize_name(x["name"]) for x in required if x["source"] == "local"}
    versions: dict[str, str] = {}
    for file in os.listdir(package_source_dir):
        if file.endswith(".whl"):
            info: Any = pkginfo.Wheel(os.path.join(package_source_dir, file))  # type: ignore
            name = normalize_name(info.name)
            if name in local_names:
                versions[name] = info.version
    return versions


def resolve_with_uv(
    required: list[RequirementsPackage],
    shiny_exact: str,
    stock: dict[str, Any],
    extra_constraints: list[str],
) -> dict[str, str]:
    """Resolve the package set for one shiny version against the Pyodide
    platform. Returns normalized name -> version for every package uv pinned,
    including the stock ones."""
    import subprocess
    import tempfile

    local = local_wheel_versions(required)
    with tempfile.TemporaryDirectory() as tmp:
        reqs = Path(tmp) / "requirements.in"
        cons = Path(tmp) / "constraints.txt"
        overrides = Path(tmp) / "overrides.txt"
        reqs.write_text("\n".join(uv_requirements(required, shiny_exact)) + "\n")
        cons.write_text(
            "\n".join(uv_constraints(stock, local, extra_constraints)) + "\n"
        )
        overrides.write_text("\n".join(uv_overrides(stock)) + "\n")
        cmd = [
            sys.executable, "-m", "uv", "pip", "compile", str(reqs),
            "--constraints", str(cons),
            "--overrides", str(overrides),
            # Lets uv use the wheels in the build directories. The PyPI
            # cross-check fails the lock on any mismatch with them.
            "--find-links", str(package_source_dir),
            "--find-links", str(pyodide_dir),
            "--python-platform", UV_PYTHON_PLATFORM,
            "--python-version", PYODIDE_PYTHON_VERSION,
            "--only-binary", ":all:",
            "--no-header", "--no-annotate", "--quiet",
        ]  # fmt: skip
        print("  " + " ".join(cmd[1:]))
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(
                f"uv pip compile failed for shiny {shiny_exact}:\n{result.stderr}"
            )
        return parse_compiled(result.stdout)


def locks_from_json(data: Any) -> dict[str, dict[str, LockfilePackageInfo]]:
    if not isinstance(data, dict) or data.get("format") != 2 or "locks" not in data:
        raise ValueError(
            f"{package_lock_file.name} is not in format 2 (one package set per minor "
            "version). Run `make update_packages_lock` to regenerate it."
        )
    return data["locks"]


def load_lock() -> dict[str, dict[str, LockfilePackageInfo]]:
    with open(package_lock_file) as f:
        return locks_from_json(json.load(f))


def write_lock(locks: dict[str, dict[str, LockfilePackageInfo]]) -> None:
    print(f"Writing {package_lock_file}")
    with open(package_lock_file, "w") as f:
        json.dump(
            {"format": 2, "locks": _mark_no_indent(locks, _is_lockfile_dependency)},
            f,
            indent=2,
            cls=NoIndentEncoder,
        )
        f.write("\n")


# =============================================================================
# Functions for generating the lockfile from the requirements file.
# =============================================================================
def _lock_entries_for(
    pinned: dict[str, str], required: list[RequirementsPackage], stock: dict[str, Any]
) -> dict[str, LockfilePackageInfo]:
    """Lock entries for every pinned package that Pyodide does not already
    include. Local wheels are read from packages/, the rest from PyPI at the
    pinned version."""
    stock_names = {normalize_name(name) for name in stock}
    local = local_wheel_versions(required)
    entries: dict[str, LockfilePackageInfo] = {}
    for name, version in pinned.items():
        if name in stock_names:
            continue
        if name in local:
            info = _find_package_info_lockfile_one(
                {"name": name, "source": "local", "version": "latest"}
            )
        else:
            info = _get_pypi_package_info(name, version)
            # _get_pypi_package_info falls back to the newest release with a
            # pure Python wheel, which can differ from the release uv pinned.
            if Version(info["version"]) != Version(version):
                raise RuntimeError(
                    f"{name}: uv pinned {version}, but PyPI metadata produced "
                    f"{info['version']}. The pinned release has no py3-none-any wheel."
                )
        entries[info["name"]] = info
    for pkg in required:
        if pkg["name"] in LOCAL_NOT_RESOLVED:
            info = _find_package_info_lockfile_one(pkg)
            entries[info["name"]] = info
    return entries


def generate_lockfile() -> None:
    print(
        f"Loading requirements package list from {os.path.relpath(requirements_file)}:"
    )
    with open(requirements_file) as f:
        required_packages: list[RequirementsPackage] = json.load(f)
    print("  " + " ".join([x["name"] for x in required_packages]))

    stock = orig_pyodide_lock()["packages"]
    locks: dict[str, dict[str, LockfilePackageInfo]] = {}
    for minor, exact in bundled_python_minors().items():
        print(f"Resolving shiny {exact} (minor {minor}) with uv...")
        pinned = resolve_with_uv(
            required_packages,
            exact,
            stock,
            SHARED_CONSTRAINTS + VERSION_CONSTRAINTS.get(minor, []),
        )
        locks[minor] = _lock_entries_for(pinned, required_packages, stock)
        print("  " + " ".join(sorted(locks[minor])))
    write_lock(locks)


def check_lock_matches_versions(
    locks: dict[str, dict[str, LockfilePackageInfo]], minors: dict[str, str]
) -> None:
    """Raise when the lockfile's shiny minors differ from shiny_versions.json."""
    if set(locks) != set(minors):
        raise SystemExit(
            f"{package_lock_file.name} has shiny minors {sorted(locks)}, but "
            f"{shiny_versions_file.name} lists {sorted(minors)}. "
            "Run `make update_packages_lock`."
        )


def update_lockfile_local() -> None:
    """Refresh the entries for local wheels in every minor version's lock.
    Dependencies are not re-resolved; run generate_lockfile for that."""
    with open(requirements_file) as f:
        required_packages: list[RequirementsPackage] = json.load(f)
    local_packages = [x for x in required_packages if x["source"] == "local"]
    print("Updating local packages: " + " ".join(x["name"] for x in local_packages))

    locks = load_lock()
    check_lock_matches_versions(locks, bundled_python_minors())
    for entries in locks.values():
        for pkg in local_packages:
            info = _find_package_info_lockfile_one(pkg)
            entries[info["name"]] = info
    write_lock(locks)


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
    """Download or copy every wheel any minor version's lock names. A wheel
    shared by several locks is fetched once."""
    locks = load_lock()
    seen: set[str] = set()
    print(f"Copying packages to {os.path.relpath(pyodide_dir)}")
    for entries in locks.values():
        for pkg_info in entries.values():
            if pkg_info["filename"] in seen:
                continue
            seen.add(pkg_info["filename"])
            _retrieve_one(pkg_info)


def _retrieve_one(pkg_info: LockfilePackageInfo) -> None:
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
                return
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
                + f"  Expected {pkg_info['sha256']}\n  Actual   {sha256}"
            )


def _sha256_file(filename: str) -> str:
    with open(filename, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# ===================================================================================
# Functions for modifying the pyodide/pyodide-lock.json file with the extra packages.
# ===================================================================================
def pyodide_lock_path(minor: str) -> Path:
    return pyodide_dir / f"pyodide-lock-shiny-{minor}.json"


def update_pyodide_pyodide_lock_json():
    locks = load_lock()
    minors = bundled_python_minors()
    newest = next(iter(minors))
    check_lock_matches_versions(locks, minors)
    stock = orig_pyodide_lock()

    # A minor that left the window must not leave a lock behind, because
    # check_shiny_bundle reports it.
    for old in pyodide_dir.glob("pyodide-lock-shiny-*.json"):
        old.unlink()

    for minor, entries in locks.items():
        out = pyodide_lock_path(minor)
        print(f"Writing {os.path.relpath(out)} (shiny {minors[minor]})")
        # A deep copy, because the dependency edits below change the stock
        # packages' depends lists and every minor starts from the same stock.
        merged = copy.deepcopy(stock)
        for name, pkg_info in entries.items():
            key = normalize_name(name)
            if key in merged["packages"]:
                # Pyodide ships this package too. The lockfile's version replaces it.
                pyodide_version = merged["packages"][key]["version"]
                print(f"  {name} (replaces Pyodide's {pyodide_version})")
            p_pkg_info = _lockfile_to_pyodide_package_info(pkg_info)
            # A sha256 of "" marks a local wheel, whose hash is computed here.
            if p_pkg_info["sha256"] == "":
                p_pkg_info["sha256"] = _sha256_file(
                    str(package_source_dir / p_pkg_info["file_name"])
                )
            merged["packages"][key] = p_pkg_info

        for name, extra in EXTRA_DEPENDENCIES.items():
            if name in merged["packages"]:
                merged["packages"][name]["depends"].extend(extra)
        for name, omit in OMIT_DEPENDENCIES.items():
            if name in merged["packages"]:
                depends = set(merged["packages"][name]["depends"])
                merged["packages"][name]["depends"] = sorted(depends.difference(omit))

        # A dependency that uv excluded for this platform (an environment
        # marker) is not in the lock, and Pyodide refuses a lock that names
        # a package it does not have. Keep only the ones present.
        present = set(merged["packages"])
        for pkg in merged["packages"].values():
            dropped = [d for d in pkg["depends"] if normalize_name(d) not in present]
            if dropped:
                print(f"    {pkg['name']}: dropping platform-excluded depends {dropped}")
            # Normalized as well: PyPI metadata may spell a name typing_extensions
            # while the lock keys it typing-extensions.
            pkg["depends"] = [
                normalize_name(d) for d in pkg["depends"] if normalize_name(d) in present
            ]

        with open(out, "w") as f:
            json.dump(merged, f)

    print(f"Copying the newest lock (shiny {minors[newest]}) to pyodide-lock.json")
    shutil.copy(pyodide_lock_path(newest), pyodide_lock_json_file)


def _lockfile_to_pyodide_package_info(pkg: LockfilePackageInfo) -> PyodidePackageInfo:
    """
    Given the information about a package from the lockfile, translate it to the format
    used by pyodide/pyodide-lock.json.
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


def orig_pyodide_lock() -> PyodidePackagesFile:
    """
    Read in the original Pyodide pyodide-lock.json from the Pyodide directory. If it
    doesn't already exist, this will make a copy, named pyodide-lock.orig.json. Then it
    will read in pyodide-lock.orig.json and return the "packages" field.
    """

    orig_pyodide_lock_json_file = os.path.join(
        os.path.dirname(pyodide_lock_json_file), "pyodide-lock.orig.json"
    )

    if not os.path.isfile(orig_pyodide_lock_json_file):
        print(
            f"{os.path.relpath(orig_pyodide_lock_json_file)} does not exist. "
            + f" Copying {os.path.relpath(pyodide_lock_json_file)} to {os.path.relpath(orig_pyodide_lock_json_file)}."
        )
        shutil.copy(pyodide_lock_json_file, orig_pyodide_lock_json_file)
    else:
        try:
            with open(pyodide_lock_json_file, "r") as f_new, open(orig_pyodide_lock_json_file, "r") as f_orig:
                new_info = json.load(f_new).get("info", {})
                orig_info = json.load(f_orig).get("info", {})
                if new_info.get("version") != orig_info.get("version"):
                    shutil.copy(pyodide_lock_json_file, orig_pyodide_lock_json_file)
        except Exception:
            shutil.copy(pyodide_lock_json_file, orig_pyodide_lock_json_file)

    with open(orig_pyodide_lock_json_file, "r") as f:
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
        super(NoIndentEncoder, self).__init__(
            **kwargs  # pyright: ignore[reportArgumentType]
        )

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
                json_repr = json.dumps(
                    no_indent_obj.value,
                    **self._kwargs,  # pyright: ignore[reportArgumentType]
                )
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

    elif sys.argv[1] == "update_pyodide_lock_json":
        update_pyodide_pyodide_lock_json()

    else:
        print(usage_info)
        sys.exit(1)
