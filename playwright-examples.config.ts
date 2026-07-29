import type { PlaywrightTestConfig } from "@playwright/test";
import { devices } from "@playwright/test";

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
  // rather than CPU-bound. One at a time keeps them well clear of the runner's
  // limits; the whole suite still finishes in a few minutes.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  // A cold engine boot can genuinely time out on a loaded runner.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",

  use: {
    baseURL: "http://127.0.0.1:8100",
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

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
