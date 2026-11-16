"""Run with: python3 -m unittest scripts.test_update_shiny_versions"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import update_shiny_versions as usv
from scripts.update_shiny_versions import CRAN_RELEASE, window


class WindowTest(unittest.TestCase):
    def test_keeps_the_newest_patch_of_the_last_five_minors(self):
        versions = [
            "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.6.0", "1.6.4",
            "1.6.3", "1.7.0", "1.8.0",
        ]
        self.assertEqual(
            window(versions),
            {"1.8": "1.8.0", "1.7": "1.7.0", "1.6": "1.6.4", "1.5": "1.5.1", "1.4": "1.4.0"},
        )

    def test_orders_minors_numerically_not_lexically(self):
        versions = ["1.9.1", "1.10.0", "1.11.1", "1.12.1", "1.13.0", "1.14.0"]
        self.assertEqual(
            list(window(versions)),
            ["1.14", "1.13", "1.12", "1.11", "1.10"],
        )

    def test_window_size_is_a_parameter(self):
        self.assertEqual(window(["1.1.0", "1.2.0", "1.3.0"], n=2), {"1.3": "1.3.0", "1.2": "1.2.0"})

    def test_ignores_versions_that_are_not_three_numbers(self):
        self.assertEqual(window(["1.2.0", "1.2.0.9000", "1.3.0rc1", "1.3.0"]), {"1.3": "1.3.0", "1.2": "1.2.0"})

    def test_cran_four_part_release_is_the_newest_patch_of_its_minor(self):
        versions = ["1.8.0", "1.8.1", "1.8.1.1", "1.7.5.1", "1.7.5"]
        self.assertEqual(
            window(versions, release=CRAN_RELEASE),
            {"1.8": "1.8.1.1", "1.7": "1.7.5.1"},
        )

    def test_pypi_ignores_four_part_versions(self):
        self.assertEqual(window(["1.8.0", "1.8.0.1"]), {"1.8": "1.8.0"})


class PypiVersionsTest(unittest.TestCase):
    def test_drops_a_release_only_when_every_file_is_yanked(self):
        releases = {
            "1.0.0": [{"yanked": True}, {"yanked": True}],
            "1.1.0": [{"yanked": True}, {"yanked": False}],
            "1.2.0": [],
            "1.3.0": [{"yanked": False}],
        }
        with mock.patch.object(usv, "_fetch_json", return_value={"releases": releases}):
            self.assertEqual(usv.pypi_versions(), ["1.1.0", "1.3.0"])


class CheckFlagTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "shiny_versions.json"
        computed = {"python": {"1.8": "1.8.0"}, "r": {"1.10": "1.10.0"}}
        for patch in (
            mock.patch.object(usv, "OUT", self.out),
            mock.patch.object(usv, "compute", return_value=computed),
            mock.patch("builtins.print"),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def test_check_passes_on_a_current_file_and_does_not_write(self):
        usv.main([])
        before = self.out.read_text()
        self.assertEqual(usv.main(["--check"]), 0)
        self.assertEqual(self.out.read_text(), before)

    def test_check_fails_on_a_stale_file_and_does_not_write(self):
        self.out.write_text("{}\n")
        self.assertEqual(usv.main(["--check"]), 1)
        self.assertEqual(self.out.read_text(), "{}\n")


if __name__ == "__main__":
    unittest.main()
