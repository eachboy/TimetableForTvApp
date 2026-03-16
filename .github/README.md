# GitHub Automation Guide

This repository uses a monorepo release process for:

- `frontend` + `frontend/src-tauri`
- `admin-panel` + `admin-panel/src-tauri`

## What is configured

- Dependabot updates for `npm`, `cargo`, and GitHub Actions.
- PR template and Issue Forms (bug, feature, regression).
- Release Drafter for categorized draft release notes.
- Release Please for changelog and version automation.
- CI/CD retention and caching tuning.
- Sticky PR comment with CI build summary and artifacts.

## Workflows

- `CI — Feature Branches` (`.github/workflows/ci-feature.yml`)
  - Runs typecheck, lint, tests, Rust check, Next build.
  - Uploads lightweight build metadata artifacts (short retention).
- `CD — Release (main)` (`.github/workflows/cd-main.yml`)
  - Builds Tauri bundles for both apps on Windows and Linux.
  - Publishes GitHub release with artifacts.
  - Uses Release Drafter body when available.
- `Release Drafter` (`.github/workflows/release-drafter.yml`)
  - Maintains draft release notes from merged PR labels.
- `Release Please` (`.github/workflows/release-please.yml`)
  - Creates release PRs and updates changelogs/versions.
- `PR Build Summary` (`.github/workflows/pr-build-summary.yml`)
  - Adds/updates a sticky PR comment with build status and artifacts.

## Labels used by automation

Recommended labels:

- `feature`, `enhancement`
- `fix`, `bug`, `regression`
- `chore`, `refactor`
- `dependencies`
- `ci`, `ci/cd`
- `major`, `breaking-change`
- `skip-changelog`

## Dry-run checklist

1. Open a test PR from `feature/*` and confirm:
   - CI jobs run successfully.
   - `PR Build Summary` comment appears/updates.
2. Merge a small labeled PR to `main` and confirm:
   - `Release Drafter` draft is updated and categorized.
3. Trigger `Release Please` (push to `main` or manual dispatch) and confirm:
   - Release PR is created/updated.
   - `frontend/CHANGELOG.md` and `admin-panel/CHANGELOG.md` are updated.
4. Run `CD — Release (main)` and confirm:
   - Artifacts are uploaded with expected retention.
   - Final release body uses Release Drafter notes (or fallback body).
