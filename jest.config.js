/**
 * Jest config for the TypeScript unit tests in `src/`.
 *
 * Run with `npm run test:unit`. This suite covers pure logic only; anything
 * that needs a real browser, a running app, or the pyodide/webR engines is
 * tested with Playwright driven from pytest, in `tests/`.
 *
 * @type {import("jest").Config}
 */
module.exports = {
  testEnvironment: "jsdom",

  testEnvironmentOptions: {
    // jest-environment-jsdom resolves package `exports` with the "browser"
    // condition, which for some dependencies (vscode-languageserver-types, for
    // one) points at an ESM build that jest's CJS loader can't parse. The empty
    // condition falls back to "require", which is what the rest of the config
    // assumes.
    customExportConditions: [""],
  },

  // Only look inside src/. That keeps jest away from the Playwright specs and
  // from anything under the build output directories.
  roots: ["<rootDir>/src"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/playwright/"],

  // Vendored third-party bundles. Neither is ours to test, and both are large.
  modulePathIgnorePatterns: ["<rootDir>/src/pyodide", "<rootDir>/src/pyright"],

  // Browser globals that jsdom doesn't implement.
  setupFiles: ["<rootDir>/testing-helpers/jest.setup.js"],

  // swc rather than ts-jest: nothing to configure, and no type-checking in the
  // test path. Types are checked separately by `tsc --noEmit`.
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
          target: "es2022",
        },
      },
    ],
  },

  // V8's built-in coverage rather than jest's default, which instruments via
  // babel-plugin-istanbul inside babel-jest — a transform this config doesn't
  // use. With @swc/jest, the istanbul provider silently reports nothing.
  coverageProvider: "v8",

  // Deliberately no `collectCoverageFrom`: coverage is reported for the files
  // the tests actually load. Widening it to all of src/ looks more honest but
  // isn't — the v8 provider gives files it never loaded a placeholder count of
  // one branch and one function, so the branch and function percentages come
  // out meaningless. Statements would be accurate and would read as ~15%, which
  // mostly measures how much of src/ is React that `tests/` covers instead.
  //
  // No `coverageThreshold` either. Coverage is a signal on pull requests, not a
  // gate; see the note in README.md.

  // esbuild resolves these at build time; jest has no loader for them.
  moduleNameMapper: {
    "\\.(css|less|sass|scss)$":
      "<rootDir>/testing-helpers/__mocks__/styleMock.js",
    "\\.(gif|jpg|jpeg|png|ttf|eot|woff|woff2|svg)$":
      "<rootDir>/testing-helpers/__mocks__/fileMock.js",
  },
};
