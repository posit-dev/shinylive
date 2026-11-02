---
title: CI and Release
description: What each GitHub Actions workflow in .github/workflows/ runs and when, which tests gate the deploys to shinylive.io (from `deploy`) and GitHub Pages (from `main`), and how a release is cut and its bundle uploaded. Read before changing a workflow, debugging a red check, or making a release.
---

# CI and Release

There are four workflows. Only `build.yml` deploys anything. The two test workflows build their
own copy of shinylive and have no link to `build.yml`, so they can fail without blocking a deploy.

| Workflow (file) | Triggers | Gates a deploy? |
| --- | --- | --- |
| Build and deploy shinylive (`build.yml`) | push to `main` or `deploy`, PR to `main`, release published, after "Update py-shiny submodule" completes | yes, it is the deploy |
| Test example apps (`test-apps.yml`) | push to `main`, any PR | no |
| Test the loader (`test-loader.yml`) | push to `main`, any PR | no |
| Update py-shiny submodule (`update_shiny.yml`) | manual (`workflow_dispatch`) only | no |

`test-apps.yml` and `test-loader.yml` have a `concurrency` group that cancels the run for an older
commit on the same PR. `build.yml` has none.

## build.yml

Three jobs, in order: `test-unit` → `build` → `deploy-gh-pages`.

**`test-unit`** needs no build. It runs `npm ci`, `npm run type-check` (`tsc --noEmit`), and
`npm run test:unit` (jest). A failure here stops everything after it.

Coverage is reported, never enforced. The env var `REPORT_COVERAGE` is true only for a
`pull_request` event from a branch in this repo (a fork PR gets a read-only token, so the steps are
skipped instead of failing). When true:

1. `ArtiomTr/jest-coverage-report-action` (pinned by SHA) adds uncovered-line annotations and
   returns the report as markdown;
2. the report is written to the run summary;
3. `marocchino/sticky-pull-request-comment` (pinned by SHA) posts it as one PR comment with header
   `jest-coverage-report`, updated in place on each push.

**`build`** (Python 3.11) runs `make submodules`, `make all` (with `GOOGLE_TAG_MANAGER_ID` set), then
`make test-site`. The site tests run here, before the deploy steps, so a broken editor, URL loading,
or static export stops the deploy. Test results upload as the `test-site-report` artifact even on
failure. Then, depending on the ref and event:

- **`refs/heads/deploy` → shinylive.io.** Assumes the AWS role `ShinyliveDeploy`, gzips
  `_shinylive/r/shinylive/webr/R.wasm`, runs `aws s3 sync _shinylive s3://shinylive.io --delete`,
  fixes the content types of the webR `*.data`, `*.so` (wasm), and `*.js.metadata` files, uploads the
  gzipped `R.wasm` with `content-encoding: gzip`, and invalidates the CloudFront cache.
- **`refs/heads/main` → GitHub Pages artifact.** Uploads `_shinylive/` with
  `actions/upload-pages-artifact`.
- **`release` event → bundle.** See "Release" below.

**`deploy-gh-pages`** runs only on `refs/heads/main`, after `build`, and publishes the artifact with
`actions/deploy-pages` (environment `github-pages`, so posit-dev.github.io/shinylive).

PRs run `test-unit` and `build` (including `make test-site`) but none of the deploy steps.

The `workflow_run` trigger fires after the "Update py-shiny submodule" workflow completes. GitHub
runs `workflow_run` workflows on the default branch, so that run takes the `main` path and redeploys
GitHub Pages.

## test-apps.yml

- **`examples-check-index`** runs `make examples-check-index`: every example on disk must be listed
  in `examples/index.json`. No build needed.
- **`test-examples`** is a matrix of `engine: [py, r]` × `shard: [1, 2, 3, 4]`, eight jobs, with
  `fail-fast: false`. Each job runs `make submodules` and `make all`, then `make test-examples` with
  `EXAMPLES_ENGINE` and `EXAMPLES_SHARD=<n>/4`. The Makefile turns these into
  `-m "examples and <engine>"` and `--shard=<n>/4`; the shard plugin is `_ShardPlugin` in
  `tests/conftest.py`. On CI (`CI` set) failed tests get one rerun, except failures matching
  "shinylive socket shim missing". Reports upload as `test-examples-report-<engine>-<shard>`.

The split is by engine first because R examples take much longer than Python ones; sharding a
mixed list would leave one shard much slower than the rest. One job per shard gives each Pyodide or
webR boot a whole runner's memory.

## test-loader.yml

One job, `test-loader`: `make submodules`, `make all`, `make test-loader` (`-m loader`), and the
`test-loader-report` artifact. `make test-site` (`site and not loader`) and `make test-loader`
together cover every `site` test. The loader tests are split out because they are slow, which keeps
them off the deploy path.

## update_shiny.yml

Manual only. Runs `make submodules-pull-shiny` (moves `packages/py-shiny` to its latest remote
commit), `make all` (which regenerates `shinylive_lock.json`), then commits `packages/py-shiny` and
`shinylive_lock.json` as "Pull latest posit-dev/py-shiny@<sha>" and pushes straight to `main`.

## Release

The external Python and R `shinylive` packages and the Quarto extension use a versioned bundle
attached to a GitHub release (what is in it: `quartoAndExport.md`).

A release PR is titled `release: vX.Y.Z` (for example
[posit-dev/shinylive#253](https://github.com/posit-dev/shinylive/issues/253) for v0.10.16). It
always bumps `"version"` in `package.json` and the matching lines in `package-lock.json`. Recent
ones also moved the `packages/` submodules (py-shiny, py-shinywidgets), regenerated
`shinylive_lock.json`, and updated examples and tests for the new Shiny version (for example
[posit-dev/shinylive#249](https://github.com/posit-dev/shinylive/issues/249)). There is no
changelog file.

After the PR merges, publishing a GitHub release runs `build.yml` with `event_name == 'release'`. In
the `build` job, after `make all` and `make test-site`:

1. **Check that version number matches release tag**: `github.ref` must equal
   `refs/tags/v<package.json version>`, so tag `v0.10.16` needs `"version": "0.10.16"`. A mismatch
   fails the job.
2. `make dist`: symlinks `build/` as `shinylive-<version>/` and writes
   `dist/shinylive-<version>.tar.gz` with `tar -h` (follows symlinks). `dist` only depends on
   `buildjs`, so it relies on the `make all` that ran earlier for Pyodide, webR, and the wheels.
3. `svenstaro/upload-release-action` uploads `dist/*.tar.gz` to the release, overwriting any file
   with the same name.

A release does not deploy shinylive.io. That happens only when the `deploy` branch is pushed.
