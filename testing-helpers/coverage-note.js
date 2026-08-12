// Runs jest with coverage, then prints a note saying what the table above it
// does and does not include.
//
// The percentages are over the modules the unit tests import -- a few thousand
// statements of pure logic. They say nothing about the React components, the
// hooks, the engine proxies or the service worker, which are most of src/ and
// are covered by the pytest suites in tests/ instead. Without the note, a green
// 100% reads as "shinylive is fully tested", which is not what it means.
//
// This is a wrapper rather than a jest reporter because custom reporters run
// before jest's coverage reporter, so a note from one lands above the table and
// scrolls away.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

const NOTE = [
  "",
  `${BOLD}Unit test coverage only.${RESET} ${DIM}This covers the pure-logic modules these`,
  "tests import -- parsing, encoding, paths, grid maths and the like.",
  "",
  "It excludes most of src/: the React components, the hooks, the engine proxies",
  "and the service worker. Those need a real browser and a running app, and are",
  "covered by the pytest + Playwright suites in tests/, whose coverage is not",
  "measured here. A figure near 100% above does not mean shinylive is fully",
  "tested.",
  "",
  `See the Coverage section of README.md.${RESET}`,
  "",
];

const jest = path.join(__dirname, "..", "node_modules", ".bin", "jest");
const { status, error } = spawnSync(
  jest,
  ["--coverage", ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (error) {
  throw error;
}

// Whether or not the tests passed, the table above needs its caveat.
process.stderr.write(NOTE.join("\n") + "\n");

process.exit(status ?? 1);
