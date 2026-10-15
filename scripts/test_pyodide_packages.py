"""Run with: python3 -m unittest scripts.test_pyodide_packages

Only the pure parts: the uv input, the uv output parser, and the migration of
an old flat lock. Resolution itself needs the network and runs under
`make update_packages_lock`.
"""

import unittest
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


if __name__ == "__main__":
    unittest.main()
