---
phase: 03-recoverable-deployment-browser-verification
plan: "01"
subsystem: recovery
tags: [sqlite, backup, restore, powershell, bash]
requires: [Phase 2 automatic verification]
provides:
  - Cross-platform timestamped SQLite/config snapshots with manifest hashes and sizes.
  - Verified restore with staged replacement, sidecar handling, Compose lifecycle, and health check.
  - Isolated backup/restore regression fixtures that never touch repository data.
affects: [deployment, release, operator-runbooks]
tech-stack:
  added: []
key-decisions:
  - "A snapshot is a directory containing database/config plus optional WAL/SHM sidecars and one manifest."
  - "Manifest verification checks file names, byte sizes, and SHA-256 before restore changes live files."
  - "STOP_APP=0 fails closed when the Compose app is running; auto/explicit stop only restarts a service that was running."
metrics:
  tasks_completed: 2
  files_modified: 5
completed: 2026-07-19
status: complete
---

# Phase 03 Plan 01: Recovery Workflow Summary

The backup helper is now an auditable recovery workflow rather than a best-effort file copy. Bash and PowerShell expose the same `backup`, `verify`, `list`, and `restore` commands. Each snapshot has a timestamp/tag directory and a manifest with database/config names, sizes, SHA-256 hashes, mode, and creation time. SQLite WAL/SHM files are preserved when present and stale sidecars are removed before restoration.

Restore validates the manifest and source files before creating staged temporary replacements. The live database/config are changed only after validation succeeds. Compose is stopped and restarted only when the app was running, and restore requires a successful `/healthz` request through `curl` or PowerShell web request. Unsafe tags, missing files, checksum mismatches, and size mismatches fail before touching live files.

## Verification

- `go test ./scripts -run 'Backup|Restore' -count=1 -v` passed.
- `go test ./scripts -count=1` passed.
- `go test ./... -count=1` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm test` passed: 23 tests.
- `corepack pnpm build` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall` passed.
- `docker compose config --quiet` passed with a verification-only APP_SECRET.
- PowerShell parser validation passed for `scripts/backup-data.ps1`.
- Bash syntax validation is covered by CI/Git Bash; the current Windows `bash.exe` delegates to a WSL instance without `/bin/bash` and cannot run local Bash commands.

## Test Coverage

`scripts/backup_data_test.go` uses temporary SQLite/config fixtures and an in-process healthy HTTP endpoint. It covers sidecar capture and restoration, manifest verification, tampered snapshot rejection, unsafe restore tags, and live-file immutability after failed restore. No repository `data/` content or real credentials are read.
