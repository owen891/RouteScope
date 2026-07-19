---
phase: 04-auditable-release-candidate
plan: "02"
subsystem: release-documentation
tags: [release, rollback, backup, fork]
requires: [04-01]
provides:
  - Operator-facing release, upgrade, verification, and rollback runbook.
affects: [operations, release]
metrics:
  tasks_completed: 1
  files_modified: 2
completed: 2026-07-19
status: complete
---

# Phase 04 Plan 02 Summary

Added `docs/RELEASE.md` and linked it from README. The runbook defines fork remotes, candidate/tag naming, fixed `APP_SECRET`, backup-before-change, Compose deployment, production/auth/browser checks, rollback to official `v0.0.6`, and the explicit real-OneBot prerequisite. It forbids committing runtime data, secrets, traces, or generated candidate artifacts.
