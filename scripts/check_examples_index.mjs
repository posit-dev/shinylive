// Verify that examples/index.json and the examples/ directories agree.
//
// examples/index.json drives which apps get built into examples.json, and
// build_examples_json.ts already errors if an indexed app is missing from disk.
// This script checks the other direction: an app directory that nobody lists is
// never built or loaded, so it silently rots as the Shiny API moves on.
//
// Deliberately dependency-free (node builtins only, no TypeScript) so CI can
// run it straight from a checkout without `npm ci`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
);

/**
 * @type {{engine: string, examples: {category: string, apps: string[]}[]}[]}
 */
const ordering = JSON.parse(
  fs.readFileSync(path.join(examplesDir, "index.json"), "utf8"),
);

let problems = 0;

function report(message, items) {
  console.error(`✖ ${items.length} ${message}`);
  for (const item of items) console.error(`    ${item}`);
  problems += items.length;
}

for (const { engine, examples } of ordering) {
  const engineDir = path.join(examplesDir, engine);
  if (!fs.existsSync(engineDir)) {
    report(`engine directory named in index.json does not exist:`, [engineDir]);
    continue;
  }

  const indexed = new Set(examples.flatMap(({ apps }) => apps));
  const onDisk = fs
    .readdirSync(engineDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const orphans = onDisk.filter((dir) => !indexed.has(dir)).sort();
  if (orphans.length > 0) {
    report(
      `example(s) in examples/${engine}/ are missing from examples/index.json:`,
      orphans.map((o) => `examples/${engine}/${o}`),
    );
  }

  // build_examples_json.ts throws on these too, but failing here lists every
  // offender at once instead of dying on the first one.
  const missing = [...indexed].filter((dir) => !onDisk.includes(dir)).sort();
  if (missing.length > 0) {
    report(
      `example(s) in examples/index.json do not exist in examples/${engine}/:`,
      missing,
    );
  }

  // An app with no about.txt has no title, and parseApp() reads it unchecked.
  const noAbout = onDisk
    .filter((dir) => indexed.has(dir))
    .filter((dir) => !fs.existsSync(path.join(engineDir, dir, "about.txt")))
    .sort();
  if (noAbout.length > 0) {
    report(
      `indexed example(s) have no about.txt:`,
      noAbout.map((n) => `examples/${engine}/${n}`),
    );
  }

  console.log(`${engine}: ${indexed.size} indexed, ${onDisk.length} on disk`);
}

if (problems > 0) {
  console.error(
    `\nFound ${problems} problem(s). Every example directory must be listed in ` +
      `examples/index.json — add it to a category, or delete the directory if ` +
      `it is obsolete.`,
  );
  process.exit(1);
}

console.log("All examples are listed in examples/index.json.");
