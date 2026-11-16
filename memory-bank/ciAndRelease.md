---
title: CI and Release
description: What each GitHub Actions workflow in .github/workflows/ runs and when, which tests gate the deploys to shinylive.io (from `deploy`) and GitHub Pages (from `main`), how the weekly update_shiny.yml moves the bundled shiny versions through a pull request, and how a release is cut and its bundle uploaded. Read before changing a workflow, debugging a red check, or making a release.
---

# CI and Release

There are four workflows. Only `build.yml` deploys anything. The two test workflows build their
own copy of shinylive and have no link to `build.yml`, so they can fail without blocking a deploy.

| Workflow (file) | Triggers | Gates a deploy? |
| --- | --- | --- |
| Build and deploy shinylive (`build.yml`) | push to `main` or `deploy`, PR to `main`, release published | yes, it is the deploy |
| Test example apps (`test-apps.yml`) | push to `main`, any PR | no |
| Test the loader (`test-loader.yml`) | push to `main`, any PR | no |
| Update shiny versions (`update_shiny.yml`) | weekly and manual (`workflow_dispatch`) | no; it opens a PR |

`test-apps.yml` and `test-loader.yml` have a `concurrency` group that cancels the run for an older
commit on the same PR. `build.yml` has none.

## build.yml

Three jobs, in order: `test-unit` → `build` → `deploy-gh-pages`.

**`test-unit`** needs no build. It runs `npm ci`, `npm run type-check` (`tsc --noEmit`),
`npm run test:unit` (jest), and, on Python 3.11, `make test-scripts` (the `unittest` suites for the
build scripts in `scripts/`). A failure here stops everything after it.

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
static export, or shiny version selection (`tests/test_site_shiny_version.py`) stops the deploy.
`make all` here leaves `R_SHINY_IMAGE_BASE_URL` empty, so the deployed R site has one shiny
version. Test results upload as the `test-site-report` artifact even on
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

Runs weekly and on demand. It never pushes to `main`. Steps:

1. Records the tip of the `update-shiny-versions` branch (empty if it does not exist).
2. `make submodules`, then `scripts/update_shiny_versions.py` rewrites `shiny_versions.json`.
3. Checks out `packages/py-shiny` at `v<newest bundled Python version>`.
4. `make update_packages_lock` (a full re-resolution, since `make all` only refreshes the local
   entries), then `make all`, which includes `check_shiny_bundle`.
5. If `shiny_versions.json`, `shinylive_lock.json`, or `packages/py-shiny` changed, commits them
   to `update-shiny-versions` and force-pushes with a lease on the tip from step 1, so the push
   fails if someone pushed to the branch during the run. It then edits the title and body of the
   open PR from that branch, or creates one against `main`. The title says whether the shiny
   window moved or only the Python packages changed.
6. While the PR from that branch is open, the run stops before step 5 rewrites the branch when the
   branch has a commit the workflow did not make, such as a maintainer's fix or amend on the PR.
   It logs a warning. Once the PR is merged or closed, the next run rebuilds the branch.

The checkout sets `persist-credentials: false`; only the push and the `gh` calls use a token. A PR
opened with the default `github.token` triggers no `pull_request` workflows, so the workflow uses
the repository secret `UPDATE_SHINY_TOKEN` (a fine-grained PAT with contents and pull-requests
write) when it exists, and falls back to `github.token`, in which case the PR has no checks.

## Release

The external Python and R `shinylive` packages and the Quarto extension use a versioned bundle
attached to a GitHub release (what is in it: `quartoAndExport.md`).

A release PR is titled `release: vX.Y.Z` (for example
[posit-dev/shinylive#253](https://github.com/posit-dev/shinylive/issues/253) for v0.10.16). It
always bumps `"version"` in `package.json` and the matching lines in `package-lock.json`. Some
also move the shinywidgets or faicons submodules, regenerate `shinylive_lock.json`, or update
examples and tests for a new Shiny version (for example
[posit-dev/shinylive#249](https://github.com/posit-dev/shinylive/issues/249)). The bundled shiny
versions change through `shiny_versions.json`, usually in an `update_shiny.yml` PR. There is no
changelog file.

After the PR merges, publishing a GitHub release runs `build.yml` with `event_name == 'release'`. In
the `build` job, after `make all` and `make test-site`:

1. **Check that version number matches release tag**: `github.ref` must equal
   `refs/tags/v<package.json version>`, so tag `v0.10.16` needs `"version": "0.10.16"`. A mismatch
   fails the job.
2. `make dist`: symlinks `build/` as `shinylive-<version>/` and writes
   `dist/shinylive-<version>.tar.gz` with `tar -h` (follows symlinks). `dist` only depends on
   `buildjs`, so it relies on the `make all` that ran earlier for Pyodide, webR, the wheels, and the
   per-version locks. The tarball also contains `shinylive/shiny_versions.json` and
   `shinylive/shiny_version_cases.json`.
3. `svenstaro/upload-release-action` uploads `dist/*.tar.gz` to the release, overwriting any file
   with the same name.

A release does not deploy shinylive.io. That happens only when the `deploy` branch is pushed.
