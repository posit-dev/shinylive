import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import type { ExampleIndexJson } from "../src/examples";

/**
 * Kept in sync by hand with sanitizeTitleForUrl() in src/examples.ts. Importing
 * it would pull src/utils.ts into the test runner, and that module graph is
 * compiled for the browser, not for playwright's CommonJS loader.
 *
 * openExample() asserts that the example the site actually selected is the one
 * we asked for, so drift here fails loudly rather than silently testing the
 * wrong app.
 */
function sanitizeTitleForUrl(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s/]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export const APP_ENGINES = ["py", "r"] as const;
export type SmokeEngine = (typeof APP_ENGINES)[number];

/** Where `make _shinylive` puts the built sites. */
const SHINYLIVE_DIR = path.join(__dirname, "..", "_shinylive");

/**
 * Categories whose entries are not Shiny apps and so have nothing to smoke
 * test -- selecting them loads a plain script into the editor and never starts
 * an app.
 */
const NON_APP_CATEGORIES = ["Non-Apps"];

/**
 * Read the examples.json that shipped in the built site. Reading the built file
 * rather than examples/index.json means the test list matches exactly what the
 * site serves, and `examples-check-index` already guarantees the two agree.
 */
export function readExamplesJson(engine: SmokeEngine): ExampleIndexJson {
  const file = path.join(SHINYLIVE_DIR, engine, "shinylive", "examples.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} not found. Run \`make all\` before the examples smoke test.`,
    );
  }
  const all = JSON.parse(fs.readFileSync(file, "utf-8")) as ExampleIndexJson[];
  const engineName = engine === "py" ? "python" : "r";
  const forEngine = all.find((e) => e.engine === engineName);
  if (!forEngine) {
    throw new Error(`No ${engineName} examples found in ${file}`);
  }
  return forEngine;
}

/** Titles of every app worth smoke testing, in the order the site lists them. */
export function exampleAppTitles(examples: ExampleIndexJson): string[] {
  return examples.examples
    .filter((c) => !NON_APP_CATEGORIES.includes(c.category))
    .flatMap((c) => c.apps.map((a) => a.title));
}

/** The URL for an example, as ExampleSelector.tsx builds it. */
function exampleUrl(engine: SmokeEngine, title: string): string {
  return `/${engine}/examples/#${sanitizeTitleForUrl(title)}`;
}

// ---------------------------------------------------------------------------
// Loading an example
// ---------------------------------------------------------------------------

/**
 * Open one example in a fresh page and wait for its app to render.
 *
 * Every example gets its own page rather than sharing one warm engine session.
 * A warm session is faster in principle, but switching examples inside one
 * races against the outgoing app: pending proxied requests hit a
 * `_shiny_app_registry` key that has already been swapped (Python) or get a null
 * channel response (webR), both of which surface as console errors that have
 * nothing to do with the example. Serving from a local static file server makes
 * a cold boot cheap enough -- a couple of seconds for Pyodide, a few for webR --
 * that isolation is the better trade.
 */
export async function openExample(
  page: Page,
  engine: SmokeEngine,
  title: string,
): Promise<void> {
  await page.goto(exampleUrl(engine, title), {
    waitUntil: "domcontentloaded",
  });

  await waitForPrompt(page, engine);

  // App.tsx falls back to the first example when a hash does not resolve, so
  // without this a typo would silently test the same app over and over.
  await expect(
    page.locator(".shinylive-example-selector .example.selected h4.title"),
    `expected the "${title}" example to be selected`,
  ).toHaveText(title);

  await waitForAppRendered(page);
}

/** Wait for the REPL prompt, which means the engine has finished booting. */
async function waitForPrompt(page: Page, engine: SmokeEngine): Promise<void> {
  // Python's prompt is ">>>", R's is ">".
  const prompt = engine === "py" ? ">>>" : ">";
  await page.waitForFunction(
    (prompt) => {
      const div = document.querySelector(".shinylive-terminal");
      // @ts-expect-error: xterm is attached to the element by Terminal.tsx.
      const xterm = div?.xterm;
      if (!xterm) return false;
      for (let i = 0; ; i++) {
        const line = xterm.buffer.normal.getLine(i);
        if (!line) return false;
        if (line.translateToString().includes(prompt)) return true;
      }
    },
    prompt,
    // webR is a much bigger download than Pyodide and boots correspondingly
    // slower, especially on a cold CI runner.
    { timeout: 5 * 60 * 1000 },
  );
}

/** Wait for the app iframe to render something. */
async function waitForAppRendered(page: Page): Promise<void> {
  const body = page.frameLocator(".app-frame").locator("body");
  await expect
    .poll(
      async () => {
        // Surface shinylive's own "Error starting app!" panel as soon as it
        // appears instead of waiting out the full timeout on an empty iframe.
        const errorLog = page.locator(
          ".shinylive-viewer .loading-wrapper-error .error-log pre",
        );
        if ((await errorLog.count()) > 0) {
          return `shinylive failed to start the app: ${await errorLog.innerText()}`;
        }
        try {
          return (await body.innerText({ timeout: 1000 })).trim().length > 0;
        } catch {
          return false;
        }
      },
      {
        message: "app iframe never rendered anything",
        timeout: 3 * 60 * 1000,
        intervals: [250],
      },
    )
    .toBe(true);

  // Outputs render after the initial UI, and warnings reach the terminal later
  // still, so give both a moment to land.
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

/**
 * Everything the engine has written to the shinylive terminal.
 *
 * The body runs inside the page, so it cannot reference anything else in this
 * file. Components/Terminal.tsx attaches the xterm object to the container
 * element, which is the only handle we have on the buffer.
 *
 * xterm hard-wraps long lines, so one message can span several buffer lines.
 * The continuations get rejoined here, otherwise we would be pattern-matching
 * against half a warning at a time.
 */
export async function terminalText(page: Page): Promise<string> {
  const lines = await page.evaluate(() => {
    const div = document.querySelector(".shinylive-terminal");
    // @ts-expect-error: xterm is attached to the element by Terminal.tsx.
    const xterm = div?.xterm;
    if (!xterm) return [] as string[];
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const line = xterm.buffer.normal.getLine(i);
      if (!line) break;
      const text: string = line.translateToString(true);
      if (line.isWrapped && out.length > 0) {
        out[out.length - 1] += text;
      } else {
        out.push(text);
      }
    }
    return out;
  });
  return lines.join("\n");
}

/**
 * Terminal output worth a human looking at.
 *
 * This is a deny-list rather than an allow-list of benign output: normal
 * shinylive chatter (package loading, R startup banners, an app's own print()
 * calls) is open-ended, but the failure signatures we care about are not.
 *
 * Note that this carries much less weight for R than for Python. Pyodide wires
 * Python's stderr to the terminal (see App.tsx), so warnings and tracebacks land
 * here; webR apps write nothing to it at all. R coverage comes from the output
 * error and console error assertions instead.
 */
const SUSPECT_PATTERNS = [
  /Traceback/,
  /Exception/,
  /\bError\b/i,
  /Warning\b/,
  /Deprecat/i,
];

/** Lines matching SUSPECT_PATTERNS that are known to be benign. */
const ALLOWED_TERMINAL_PATTERNS = [
  // Several examples run with `App(..., debug=True)`, which echoes every
  // websocket frame to the terminal. Those frames carry an `"errors": {}` key
  // and arbitrary app values, so they match the deny-list on content rather
  // than on any real problem.
  /^SEND: /,
  /^RECV: /,
];

export function suspectTerminalLines(terminal: string): string[] {
  return terminal
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => SUSPECT_PATTERNS.some((re) => re.test(line)))
    .filter((line) => !ALLOWED_TERMINAL_PATTERNS.some((re) => re.test(line)));
}
