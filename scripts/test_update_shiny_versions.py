"""Run with: python3 -m unittest scripts.test_update_shiny_versions"""

import unittest

from scripts.update_shiny_versions import window


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


if __name__ == "__main__":
    unittest.main()
