---
phase: 03-recoverable-deployment-browser-verification
plan: "03"
subsystem: uat
tags: [recovery-drill, playwright, onebot, evidence]
requires: [03-01, 03-02]
provides:
  - Reproducible isolated recovery and browser UAT evidence.
  - Explicit separation between automatic proof and unavailable external OneBot delivery.
affects: [release, operations]
metrics:
  tasks_completed: 1
  files_modified: 1
completed: 2026-07-19
status: complete
---

# Phase 03 Plan 03: Recovery and Browser Drill Summary

Recorded the recovery drill and browser verification evidence in `03-UAT.md`. The drill uses temporary SQLite/config fixtures, verifies manifest hashes and sizes, mutates and restores known data, checks sidecar behavior, rejects tampered/unsafe restore inputs, and confirms `/healthz = 200`. The browser run uses the real Vite SPA with deterministic API interception and passed all four Chromium workflows.

The record intentionally does not claim real OneBot delivery. Phase 2 remains externally pending until a reachable OneBot v11 endpoint is provided for group and private message tests plus one deliberate failure case.

## Verification

- `go test ./scripts -run 'Backup|Restore' -count=1 -v` passed.
- `corepack pnpm --dir frontend test:e2e` passed: 4 Chromium tests.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall` passed.
- `.planning/phases/03-recoverable-deployment-browser-verification/03-UAT.md` contains commands, outcomes, and residual prerequisites.
