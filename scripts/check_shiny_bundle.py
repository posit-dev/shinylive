#!/usr/bin/env python3
"""Check that the built bundle agrees with shiny_versions.json.

Python: every bundled minor has a pyodide-lock-shiny-<minor>.json whose shiny
entry is the listed exact version, every dependency a lock names is in that
lock, every wheel a lock names is on disk (apart from the test tarballs the
build excludes), no lock exists for a minor outside the list, and
pyodide-lock.json is the newest lock. R, checked when run with --r: every
bundled minor has both image files under webr/shiny-<minor>/, and the default
image files exist in webr/.

Deliberately stdlib-only, like scripts/check_examples_index.mjs.
"""

from __future__ import annotations

import json
import sys
from fnmatch import fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build" / "shinylive"

# The Makefile extracts the Pyodide distribution with `--exclude "*test*.tar"`,
# so the lock entries for those tarballs have no file on disk by design.
EXCLUDED_FILES = "*test*.tar"


def _load(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def check_python(versions: dict[str, str], pyodide_dir: Path) -> list[str]:
    problems: list[str] = []
    newest_minor = next(iter(versions))

    for minor, exact in versions.items():
        name = f"pyodide-lock-shiny-{minor}.json"
        path = pyodide_dir / name
        if not path.exists():
            problems.append(f"{name} is missing")
            continue
        packages = _load(path)["packages"]
        shiny = packages.get("shiny")
        if shiny is None:
            problems.append(f"{name}: no shiny entry")
        elif shiny["version"] != exact:
            problems.append(f"{name}: shiny is {shiny['version']}, shiny_versions.json says {exact}")
        for pkg in packages.values():
            for dep in pkg["depends"]:
                if dep not in packages:
                    problems.append(f"{name}: {pkg['name']} depends on {dep}, which the lock does not list")
            if fnmatch(pkg["file_name"], EXCLUDED_FILES):
                continue
            if not (pyodide_dir / pkg["file_name"]).exists():
                problems.append(f"{name}: {pkg['file_name']} is not in the pyodide directory")

    for path in sorted(pyodide_dir.glob("pyodide-lock-shiny-*.json")):
        minor = path.name.removeprefix("pyodide-lock-shiny-").removesuffix(".json")
        if minor not in versions:
            problems.append(f"{path.name}: {minor} is not in shiny_versions.json")

    default = pyodide_dir / "pyodide-lock.json"
    if default.exists():
        shiny = _load(default)["packages"].get("shiny")
        newest = versions[newest_minor]
        if shiny is None or shiny["version"] != newest:
            found = "absent" if shiny is None else shiny["version"]
            problems.append(f"pyodide-lock.json: shiny is {found}, but the newest bundled version is {newest}")
    else:
        problems.append("pyodide-lock.json is missing")
    return problems


IMAGE_FILES = ("library.data.gz", "library.js.metadata")


def check_r(versions: dict[str, str], webr_dir: Path) -> list[str]:
    problems: list[str] = []
    for minor in versions:
        for file in IMAGE_FILES:
            if not (webr_dir / f"shiny-{minor}" / file).exists():
                problems.append(f"webr/shiny-{minor}/{file} is missing")
    for file in IMAGE_FILES:
        if not (webr_dir / file).exists():
            problems.append(f"webr/{file} is missing")
    return problems

def main(argv: list[str]) -> int:
    versions = _load(ROOT / "shiny_versions.json")
    problems = check_python(versions["python"], BUILD / "pyodide")
    if "--r" in argv:
        problems += check_r(versions["r"], BUILD / "webr")
    for problem in problems:
        print(f"✖ {problem}", file=sys.stderr)
    if problems:
        print(f"{len(problems)} problem(s) in the shiny bundle", file=sys.stderr)
        return 1
    print("shiny bundle OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
