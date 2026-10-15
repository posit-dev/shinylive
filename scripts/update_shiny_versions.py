#!/usr/bin/env python3
"""Compute shiny_versions.json: the newest patch release of each of the last
WINDOW minor versions of shiny, for Python (PyPI) and R (CRAN).

Usage:
  update_shiny_versions.py          # rewrite shiny_versions.json
  update_shiny_versions.py --check  # exit 1 if shiny_versions.json is stale

Deliberately stdlib-only so CI can run it from a bare checkout.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

WINDOW = 5
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shiny_versions.json"

# Release versions only: dev builds (1.2.0.9000) and pre-releases (1.3.0rc1)
# are never bundled.
RELEASE = re.compile(r"^\d+\.\d+\.\d+$")


def _fetch_json(url: str) -> dict:
    # crandb.r-pkg.org sits behind Cloudflare, which answers the default
    # Python-urllib User-Agent with 403 (error 1010).
    request = urllib.request.Request(
        url, headers={"User-Agent": "shinylive-update-shiny-versions"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def pypi_versions() -> list[str]:
    data = _fetch_json("https://pypi.org/pypi/shiny/json")
    return [
        version
        for version, files in data["releases"].items()
        if files and not all(f.get("yanked") for f in files)
    ]


def cran_versions() -> list[str]:
    data = _fetch_json("https://crandb.r-pkg.org/shiny/all")
    return list(data["timeline"])


def window(versions: list[str], n: int = WINDOW) -> dict[str, str]:
    """Map the last `n` minor versions to their newest patch, newest first."""
    newest: dict[tuple[int, int], tuple[int, int, int]] = {}
    for version in versions:
        if not RELEASE.match(version):
            continue
        major, minor, patch = (int(x) for x in version.split("."))
        key = (major, minor)
        if key not in newest or (major, minor, patch) > newest[key]:
            newest[key] = (major, minor, patch)
    keys = sorted(newest, reverse=True)[:n]
    return {f"{k[0]}.{k[1]}": ".".join(str(x) for x in newest[k]) for k in keys}


def compute() -> dict[str, dict[str, str]]:
    return {"python": window(pypi_versions()), "r": window(cran_versions())}


def main(argv: list[str]) -> int:
    computed = compute()
    text = json.dumps(computed, indent=2) + "\n"
    current = OUT.read_text() if OUT.exists() else ""
    if "--check" in argv:
        if current == text:
            print(f"{OUT.name} is up to date")
            return 0
        print(f"{OUT.name} is stale; run scripts/update_shiny_versions.py", file=sys.stderr)
        return 1
    OUT.write_text(text)
    print("unchanged" if current == text else "updated", OUT.name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
