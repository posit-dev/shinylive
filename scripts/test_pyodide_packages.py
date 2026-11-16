"""Run with: python3 -m unittest scripts.test_pyodide_packages

The parts that need no network: the uv input, the uv output parser, the lock
format, and the per-minor Pyodide locks written from a lock. Resolution itself
needs the network and runs under `make update_packages_lock`.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import pyodide_packages as pp


class CompiledOutputTest(unittest.TestCase):
    def test_parses_name_and_version_and_normalizes_names(self):
        text = "Typing_Extensions==4.12.2\nshiny==1.6.4\n# a comment\n\n"
        self.assertEqual(pp.parse_compiled(text), {"typing-extensions": "4.12.2", "shiny": "1.6.4"})

    def test_rejects_anything_that_is_not_a_pin(self):
        with self.assertRaises(ValueError):
            pp.parse_compiled("shiny>=1.0\n")


class UvInputTest(unittest.TestCase):
    def test_requirements_input_pins_shiny_and_leaves_latest_unpinned(self):
        required = [
            {"name": "shiny", "source": "pypi", "version": "bundled"},
            {"name": "plotly", "source": "pypi", "version": "latest"},
            {"name": "qrcode", "source": "pypi", "version": "7.4.2"},
            {"name": "libsass", "source": "local", "version": "latest"},
        ]
        self.assertEqual(
            pp.uv_requirements(required, shiny_exact="1.6.4"),
            ["shiny==1.6.4", "plotly", "qrcode==7.4.2"],
        )

    def test_constraints_pin_every_stock_package_and_every_local_wheel(self):
        stock = {"numpy": {"name": "numpy", "version": "2.0.2"}}
        local = {"htmltools": "0.7.0"}
        self.assertEqual(
            pp.uv_constraints(stock, local, extra=["narwhals<2"]),
            ["numpy==2.0.2", "htmltools==0.7.0", "narwhals<2"],
        )

    def test_constraints_skip_stock_entries_that_are_not_python_packages(self):
        stock = {
            "numpy": {"name": "numpy", "version": "2.0.2", "package_type": "package"},
            "openssl": {"name": "openssl", "version": "1.1.1w", "package_type": "shared_library"},
            "ssl": {"name": "ssl", "version": "1.0.0", "package_type": "cpython_module"},
        }
        self.assertEqual(pp.uv_constraints(stock, {}, extra=[]), ["numpy==2.0.2"])

    def test_stock_overrides_move_from_constraints_to_overrides(self):
        stock = {
            "numpy": {"name": "numpy", "version": "2.0.2"},
            "orjson": {"name": "orjson", "version": "3.10.1"},
            "typing-extensions": {"name": "typing-extensions", "version": "4.11.0"},
        }
        self.assertEqual(pp.uv_constraints(stock, {}, extra=[]), ["numpy==2.0.2"])
        self.assertEqual(
            pp.uv_overrides(stock), ["orjson==3.10.1", "typing-extensions==4.11.0"]
        )


class LockFormatTest(unittest.TestCase):
    def test_reads_format_2(self):
        data = {"format": 2, "locks": {"1.8": {"shiny": {"name": "shiny"}}}}
        self.assertEqual(pp.locks_from_json(data), {"1.8": {"shiny": {"name": "shiny"}}})

    def test_refuses_the_old_flat_format(self):
        with self.assertRaises(ValueError):
            pp.locks_from_json({"shiny": {"name": "shiny"}})


class LockEntriesTest(unittest.TestCase):
    def _pypi_info(self, version):
        return {
            "name": "siuba",
            "version": version,
            "filename": f"siuba-{version}-py3-none-any.whl",
            "sha256": "0" * 64,
            "url": "https://example.invalid/siuba.whl",
            "depends": [],
            "imports": ["siuba"],
        }

    def test_raises_when_pypi_version_differs_from_uv_pin(self):
        with mock.patch.object(pp, "_get_pypi_package_info", return_value=self._pypi_info("0.4.2")):
            with self.assertRaisesRegex(RuntimeError, "siuba.*0.4.4.*0.4.2"):
                pp._lock_entries_for({"siuba": "0.4.4"}, [], {})

    def test_keeps_entry_when_pypi_version_matches_uv_pin(self):
        with mock.patch.object(pp, "_get_pypi_package_info", return_value=self._pypi_info("0.4.4")):
            entries = pp._lock_entries_for({"siuba": "0.4.4"}, [], {})
        self.assertEqual(entries["siuba"]["version"], "0.4.4")


def _stock_entry(name, depends):
    return {"name": name, "version": "1.0", "file_name": f"{name}.whl",
            "install_dir": "site", "sha256": "x", "depends": depends, "imports": [name]}


def _lock_entry(name, version, depends):
    return {"name": name, "version": version, "filename": f"{name}-{version}.whl",
            "sha256": "x", "depends": [{"name": d} for d in depends], "imports": [name]}


class PyodideLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "pyodide-lock-shiny-1.4.json").write_text("{}")
        stock = {"info": {}, "packages": {
            "numpy": _stock_entry("numpy", []),
            "jinja2": _stock_entry("jinja2", []),
            "pandas": _stock_entry("pandas", ["numpy"]),
        }}
        self.locks = {
            "1.8": {
                # colorama stands for a dependency uv excluded for this platform.
                "shiny": _lock_entry("shiny", "1.8.0", ["htmltools", "colorama"]),
                "htmltools": _lock_entry("htmltools", "0.7.0", []),
            },
            "1.7": {
                "shiny": _lock_entry("shiny", "1.7.0", ["htmltools"]),
                "htmltools": _lock_entry("htmltools", "0.6.0", []),
            },
        }
        minors = {"1.8": "1.8.0", "1.7": "1.7.0"}
        for patch in (
            mock.patch.object(pp, "pyodide_dir", self.dir),
            mock.patch.object(pp, "pyodide_lock_json_file", self.dir / "pyodide-lock.json"),
            mock.patch.object(pp, "orig_pyodide_lock", return_value=stock),
            mock.patch.object(pp, "load_lock", side_effect=lambda: self.locks),
            mock.patch.object(pp, "bundled_python_minors", return_value=minors),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.tmp.cleanup)

    def read(self, name):
        return json.loads((self.dir / name).read_text())["packages"]

    def test_writes_one_lock_per_minor_from_the_same_stock(self):
        with mock.patch("builtins.print"):
            pp.update_pyodide_pyodide_lock_json()
        old = self.read("pyodide-lock-shiny-1.7.json")
        new = self.read("pyodide-lock-shiny-1.8.json")
        self.assertEqual((old["shiny"]["version"], old["htmltools"]["version"]), ("1.7.0", "0.6.0"))
        self.assertEqual((new["shiny"]["version"], new["htmltools"]["version"]), ("1.8.0", "0.7.0"))
        # The extra dependency is added once per lock, so the stock entry was
        # copied rather than shared between minors.
        self.assertEqual(old["pandas"]["depends"], ["numpy", "jinja2"])
        self.assertEqual(new["pandas"]["depends"], ["numpy", "jinja2"])
        self.assertEqual(new["shiny"]["depends"], ["htmltools"])
        self.assertEqual(self.read("pyodide-lock.json"), new)
        self.assertFalse((self.dir / "pyodide-lock-shiny-1.4.json").exists())

    def test_refuses_a_lock_whose_minors_differ_from_shiny_versions(self):
        del self.locks["1.7"]
        with self.assertRaises(SystemExit) as raised:
            pp.update_pyodide_pyodide_lock_json()
        self.assertIn("make update_packages_lock", str(raised.exception))
        self.assertTrue((self.dir / "pyodide-lock-shiny-1.4.json").exists())

    def test_local_refresh_refuses_a_lock_whose_minors_differ(self):
        del self.locks["1.7"]
        with mock.patch.object(pp, "write_lock") as write_lock, mock.patch("builtins.print"):
            with self.assertRaises(SystemExit):
                pp.update_lockfile_local()
        write_lock.assert_not_called()

if __name__ == "__main__":
    unittest.main()
