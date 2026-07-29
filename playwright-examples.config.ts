import type { PlaywrightTestConfig } from "@playwright/test";
import { devices } from "@playwright/test";
import { APP_ENGINES } from "./playwright/examples-smoke-helpers";

/**
 * Config for the examples smoke test (`make examples-smoke-test`).
 *
 * This is separate from playwright.config.ts because `webServer` is global to a
 * config, and that one starts two servers that need `shinylive export` from the
 * Python shinylive package. That package depends on this repository, and the
 * resulting circular dependency is why the playwright job in build.yml is
 * commented out. This config serves the built `_shinylive/` directory with
 * nothing but a static file server, so it can run on CI.
 */
const config: PlaywrightTestConfig = {
  testDir: "./playwright",
  testMatch: /examples-smoke\.spec\.ts/,

  // Each test boots an engine from scratch, and the assertions inside have
  // their own tighter timeouts.
  timeout: 6 * 60 * 1000,
  expect: { timeout: 30 * 1000 },

  // Each test runs a whole Pyodide or webR instance, so these are memory-hungry
  // rather than CPU-bound. `workers: 1` gives each engine the runner to itself;
  // wall-clock time comes from splitting across CI jobs by engine and shard
  // instead, so a shard never has to share memory with a sibling. See
  // `make examples-smoke-test`.
  //
  // `fullyParallel` is required for that: sharding is file-granular without it,
  // and this suite is a single file, so shard 1 would take every test and the
  // rest would take none.
  fullyParallel: true,
  workers: 1,

  forbidOnly: !!process.env.CI,
  // A cold engine boot can genuinely time out on a loaded runner.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",

  use: {
    baseURL: "http://127.0.0.1:8100",
    trace: "retain-on-failure",
  },

  // One project per engine, so CI can give each its own shard count with
  // `--project`. Pyodide and webR examples cost very different amounts -- around
  // 17s and 29s per test respectively on a CI runner -- and playwright assigns
  // shards in contiguous blocks, so sharding the combined suite dumps every R
  // test into the last shard and leaves it as the long pole.
  //
  // Matching on the `engine:` marker rather than the engine name alone is
  // deliberate: a test's grep target includes the project name and the spec's
  // path, so `r examples` would also match the `r examples-smoke.spec.ts` that
  // appears in every Python test's target under project "r".
  projects: APP_ENGINES.map((engine) => ({
    name: engine,
    grep: new RegExp(`engine:${engine}\\b`),
    use: { ...devices["Desktop Chrome"] },
  })),

  webServer: {
    // Shinylive registers a service worker, which browsers only allow over
    // https or from localhost -- see src/load-shinylive-sw.ts.
    command:
      "python3 -m http.server 8100 --bind 127.0.0.1 --directory _shinylive",
    url: "http://127.0.0.1:8100/py/examples/",
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
  },
};

export default config;
