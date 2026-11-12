"""Tests for scripts/pyodide_packages.py. Run them with `make test-scripts`."""

# pyright: reportPrivateUsage=false

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pyodide_packages
import pytest


def _write_lock(path: Path, packages: list[str]) -> None:
    path.write_text(json.dumps({"packages": {name: {} for name in packages}}))


def _orig_package_names() -> set[str]:
    return set(pyodide_packages.orig_pyodide_lock()["packages"])


@pytest.fixture
def lock_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Path, Path]:
    """Pyodide's pyodide-lock.json and the saved pyodide-lock.orig.json, in a temp dir."""
    lock = tmp_path / "pyodide-lock.json"
    monkeypatch.setattr(pyodide_packages, "pyodide_lock_json_file", lock)
    return lock, tmp_path / "pyodide-lock.orig.json"


def test_first_run_saves_a_copy(lock_files: tuple[Path, Path]) -> None:
    lock, orig = lock_files
    _write_lock(lock, ["numpy"])

    assert _orig_package_names() == {"numpy"}
    assert orig.exists()


def test_fresh_lock_replaces_the_saved_copy(lock_files: tuple[Path, Path]) -> None:
    # A newly unpacked Pyodide: its pyodide-lock.json has no shiny in it.
    lock, orig = lock_files
    _write_lock(orig, ["numpy"])
    _write_lock(lock, ["numpy", "pandas"])

    assert _orig_package_names() == {"numpy", "pandas"}


def test_lock_with_shiny_keeps_the_saved_copy(lock_files: tuple[Path, Path]) -> None:
    # A pyodide-lock.json an earlier build already rewrote.
    lock, orig = lock_files
    _write_lock(orig, ["numpy"])
    _write_lock(lock, ["numpy", "shiny"])

    assert _orig_package_names() == {"numpy"}


def test_unreadable_lock_keeps_the_saved_copy(lock_files: tuple[Path, Path]) -> None:
    lock, orig = lock_files
    _write_lock(orig, ["numpy"])
    lock.write_text("{ not json")

    with pytest.raises(json.JSONDecodeError):
        pyodide_packages.orig_pyodide_lock()
    assert set(json.loads(orig.read_text())["packages"]) == {"numpy"}


def _lock_listing(*file_names: str) -> pyodide_packages.PyodidePackagesFile:
    packages = {name: {"file_name": name} for name in file_names}
    return cast(pyodide_packages.PyodidePackagesFile, {"packages": packages})


def test_unlisted_wheels_are_removed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pyodide_packages, "pyodide_dir", tmp_path)
    for name in ["kept-1.0.whl", "old-1.0.whl", "old-1.0.whl.metadata", "lib.zip"]:
        (tmp_path / name).touch()

    pyodide_packages._remove_unlisted_wheels(_lock_listing("kept-1.0.whl"))

    # Only wheels are pruned; lib.zip is left alone even though it is unlisted.
    assert sorted(f.name for f in tmp_path.iterdir()) == ["kept-1.0.whl", "lib.zip"]


def test_missing_listed_file_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pyodide_packages, "pyodide_dir", tmp_path)
    (tmp_path / "here-1.0.whl").touch()

    # Test archives are never unpacked, so their absence is fine.
    pyodide_packages._check_listed_files_exist(
        _lock_listing("here-1.0.whl", "numpy-tests.zip")
    )
    with pytest.raises(Exception, match="gone-1.0.whl"):
        pyodide_packages._check_listed_files_exist(
            _lock_listing("here-1.0.whl", "gone-1.0.whl")
        )
