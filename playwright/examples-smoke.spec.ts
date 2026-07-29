// Smoke test for every app in examples/index.json, for both engines.
//
// This drives the built `_shinylive/` output rather than the esbuild dev
// server, because the dev-server config in playwright.config.ts needs
// `shinylive export` from the Python shinylive package -- which depends on this
// repository. That circular dependency is why the playwright job in build.yml is
// commented out. Serving `_shinylive/` needs nothing but a static file server,
// so this suite can actually run on CI, and it exercises the same bytes we
// deploy.
//
// Each example is loaded by URL hash in its own page; see openExample() for why
// the engine session is not shared between them.

import { expect, test } from "@playwright/test";
import {
  APP_ENGINES,
  exampleAppTitles,
  openExample,
  readExamplesJson,
  suspectTerminalLines,
  terminalText,
} from "./examples-smoke-helpers";

for (const engine of APP_ENGINES) {
  const examples = readExamplesJson(engine);

  // The `engine:` marker is what playwright-examples.config.ts greps on to build
  // a project per engine. It has to be a token that appears nowhere else in a
  // test's grep target, because that target includes the project name and the
  // spec's own path -- so for project "r" a plain "r examples" would also match
  // the "r examples-smoke.spec.ts" in every Python test's target.
  test.describe(`engine:${engine}`, () => {
    for (const title of exampleAppTitles(examples)) {
      test(title, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() !== "error") return;
          // A missing favicon is not an app problem.
          if (msg.location().url.endsWith("favicon.ico")) return;
          consoleErrors.push(msg.text());
        });
        page.on("pageerror", (err) => consoleErrors.push(String(err)));

        await openExample(page, engine, title);

        expect(
          suspectTerminalLines(await terminalText(page)),
          `${title}: unexpected output in the shinylive terminal`,
        ).toEqual([]);

        await expect(
          page.frameLocator(".app-frame").locator(".shiny-output-error"),
          `${title}: app rendered an output error`,
        ).toHaveCount(0);

        expect(consoleErrors, `${title}: browser console errors`).toEqual([]);
      });
    }
  });
}
