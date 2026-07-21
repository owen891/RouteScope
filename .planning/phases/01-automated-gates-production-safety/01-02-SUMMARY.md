---
phase: 01-automated-gates-production-safety
plan: "02"
subsystem: release-gates
tags: [go, pnpm, docker, github-actions, powershell, bash]
requires: [01-01]
provides:
  - Frozen cross-platform local, Docker, and CI quality gates.
  - Deterministic import and QQ notification regression coverage.
  - Reusable least-privilege quality workflow that blocks image publication.
affects: [deployment, release, ci]
tech-stack:
  added: []
  patterns:
    - yaml.v3 workflow contracts enforce CI semantics independently of actionlint.
    - Corepack prepares the repository-pinned pnpm version before local gates.
key-files:
  created:
    - scripts/workflow_contract_test.go
    - scripts/verify.sh
    - scripts/verify.ps1
    - .github/workflows/quality.yml
  modified:
    - Dockerfile
    - frontend/lib/all-api-hub-import.ts
    - frontend/lib/import-and-error.test.ts
    - backend/notify/qqbot_test.go
    - .github/workflows/publish.yml
key-decisions:
  - "Corepack prepares pnpm 10.4.0 before local gates, avoiding unrelated global pnpm versions."
  - "A yaml.v3 repository test is the mandatory workflow semantic gate; actionlint remains additional evidence."
  - "GHCR package write permission is scoped to build-and-push after reusable quality succeeds."
metrics:
  tasks_completed: 3
  files_modified: 9
completed: 2026-07-19
status: complete
---

# Phase 01 Plan 02: Authoritative Release Gates Summary

**Frozen pnpm, frontend, Go, Compose, security-harness, and workflow-contract gates now match across local scripts, Docker, CI, and publication.**

## Task Commits

1. **Task 1: Align local and Docker quality gates** - `d6da365` (feat)
2. **Task 2: Complete deterministic import, QQ, and auth regression coverage** - `bbd8520` (test)
3. **Task 3: Make reusable CI Quality Gates a hard publish prerequisite** - `779ed62` (ci)
4. **Task 1 follow-up: Prefer pinned Corepack pnpm** - `b3fce57` (fix)

## Accomplishments

- Added Bash and PowerShell release entrypoints that run their native Plan 01 security harness plus the workflow contract before frozen frontend, uncached Go, and Compose gates. `SKIP_INSTALL` and `-SkipInstall` skip only dependency installation.
- Added `TestWorkflowContracts`, a yaml.v3 semantic validator for triggers, commands, permissions, secret boundaries, reusable linkage, and the publication dependency.
- Changed Docker to use `pnpm install --frozen-lockfile`; local scripts prepare the repository-pinned pnpm 10.4.0 through Corepack.
- Extended synthetic import fixtures for rename/skip/update decisions, bounded generated names, malformed backups, credential fallback boundaries, NewAPI user IDs, and plaintext notes-password exclusion from metadata.
- Added QQ OneBot coverage for private URL-encoded query auth, group Bearer auth, target validation, nonzero retcodes, and HTTP 502 failures.
- Added a reusable, read-only Quality Gates workflow for feature pushes, pull requests, manual dispatch, and reusable calls; the publish job requires it before login/build/push and scopes `packages: write` to `build-and-push` only.

## Verification

- `go test ./scripts -run '^TestWorkflowContracts$' -count=1` passed.
- `pnpm.cmd --dir frontend lint` passed.
- `pnpm.cmd --dir frontend test` passed: 23 tests.
- `pnpm.cmd --dir frontend build` passed.
- `go test ./... -count=1` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall` passed, including the native PowerShell harness, frozen pnpm 10.4.0 resolution, lint/test/build, all Go tests, and Compose validation.
- `APP_SECRET=verification-only-placeholder-not-for-production docker compose config --quiet` passed through the PowerShell contract check.
- `git diff --check` passed.
- `actionlint` was not installed locally; `TestWorkflowContracts` passed and remains unconditional in the local and CI gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prefer Corepack over an unrelated global pnpm**
- **Found during:** Final PowerShell release-gate verification.
- **Issue:** The host `pnpm.cmd` was 11.14.0, so the initial exact-version check rejected a machine that had Corepack available to prepare the pinned project version.
- **Fix:** Both entrypoints now run `corepack prepare pnpm@10.4.0 --activate` when Corepack is available, then verify the exact version before running gates.
- **Files modified:** `scripts/verify.sh`, `scripts/verify.ps1`
- **Commit:** `b3fce57`

## Issues Encountered

- This Windows host's `bash.exe` delegates to WSL, but that WSL instance has no `/bin/bash`; therefore `bash -n scripts/verify.sh` could not run locally. The Bash harness is required by the Ubuntu CI lane, while the native PowerShell harness and all shared workflow-contract checks passed locally.

## Known Stubs

None - all gates invoke concrete commands and regression fixtures are local and synthetic.

## Self-Check: PASSED

- All listed implementation files and `01-02-SUMMARY.md` exist.
- Task commits `d6da365`, `bbd8520`, `779ed62`, and `b3fce57` exist in git history.
