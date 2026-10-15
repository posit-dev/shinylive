"""Run with: python3 -m unittest scripts.test_check_shiny_bundle"""

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_shiny_bundle import check_python


def write_lock(dir: Path, name: str, packages: dict) -> None:
    (dir / name).write_text(json.dumps({"info": {}, "packages": packages}))


class CheckPythonTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.versions = {"1.8": "1.8.0", "1.7": "1.7.0"}
        for minor, exact in self.versions.items():
            write_lock(self.dir, f"pyodide-lock-shiny-{minor}.json", {
                "shiny": {"name": "shiny", "version": exact, "file_name": f"shiny-{exact}-py3-none-any.whl", "depends": ["htmltools"]},
                "htmltools": {"name": "htmltools", "version": "0.7.0", "file_name": "htmltools-0.7.0-py3-none-any.whl", "depends": []},
            })
            (self.dir / f"shiny-{exact}-py3-none-any.whl").write_bytes(b"")
        (self.dir / "htmltools-0.7.0-py3-none-any.whl").write_bytes(b"")
        write_lock(self.dir, "pyodide-lock.json", json.loads((self.dir / "pyodide-lock-shiny-1.8.json").read_text())["packages"])

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_consistent_bundle_has_no_problems(self):
        self.assertEqual(check_python(self.versions, self.dir), [])

    def test_missing_lock(self):
        (self.dir / "pyodide-lock-shiny-1.7.json").unlink()
        self.assertEqual(check_python(self.versions, self.dir), ["pyodide-lock-shiny-1.7.json is missing"])

    def test_wrong_shiny_version_in_a_lock(self):
        self.versions["1.7"] = "1.7.1"
        self.assertEqual(
            check_python(self.versions, self.dir),
            ["pyodide-lock-shiny-1.7.json: shiny is 1.7.0, shiny_versions.json says 1.7.1"],
        )

    def test_missing_wheel(self):
        (self.dir / "htmltools-0.7.0-py3-none-any.whl").unlink()
        problems = check_python(self.versions, self.dir)
        self.assertIn("pyodide-lock-shiny-1.8.json: htmltools-0.7.0-py3-none-any.whl is not in the pyodide directory", problems)

    def test_unresolved_dependency(self):
        lock = json.loads((self.dir / "pyodide-lock-shiny-1.8.json").read_text())
        lock["packages"]["shiny"]["depends"].append("ghost")
        (self.dir / "pyodide-lock-shiny-1.8.json").write_text(json.dumps(lock))
        self.assertIn("pyodide-lock-shiny-1.8.json: shiny depends on ghost, which the lock does not list", check_python(self.versions, self.dir))

    def test_default_lock_must_be_the_newest(self):
        write_lock(self.dir, "pyodide-lock.json", json.loads((self.dir / "pyodide-lock-shiny-1.7.json").read_text())["packages"])
        self.assertIn("pyodide-lock.json: shiny is 1.7.0, but the newest bundled version is 1.8.0", check_python(self.versions, self.dir))

    def test_test_tarballs_the_build_excludes_need_not_be_on_disk(self):
        lock = json.loads((self.dir / "pyodide-lock-shiny-1.8.json").read_text())
        lock["packages"]["htmltools-tests"] = {"name": "htmltools-tests", "version": "0.7.0", "file_name": "htmltools-tests.tar", "depends": ["htmltools"]}
        (self.dir / "pyodide-lock-shiny-1.8.json").write_text(json.dumps(lock))
        self.assertEqual(check_python(self.versions, self.dir), [])

    def test_a_lock_for_a_minor_outside_the_window(self):
        write_lock(self.dir, "pyodide-lock-shiny-1.3.json", {})
        self.assertEqual(
            check_python(self.versions, self.dir),
            ["pyodide-lock-shiny-1.3.json: 1.3 is not in shiny_versions.json"],
        )


if __name__ == "__main__":
    unittest.main()
