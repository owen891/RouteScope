---
phase: 03-recoverable-deployment-browser-verification
plan: "02"
subsystem: browser-verification
tags: [playwright, vite, auth, import, onebot, quality-gates]
requires: [03-01]
provides:
  - Deterministic Playwright Chromium harness against the real Vite SPA.
  - Browser regression coverage for auth, import preview, QQ form, and production probe.
  - Blocking local/CI browser quality gate with explicit local-only opt-out.
affects: [frontend, ci, release]
tech-stack:
  added: ["@playwright/test 1.61.0"]
key-decisions:
  - "Browser tests intercept API responses at the page boundary, keeping real routes/components while avoiding credentials and external services."
  - "CI installs Chromium with dependencies and runs browser tests as a blocking quality step."
  - "SKIP_E2E=true or verify.ps1 -SkipE2E is an explicit local escape hatch only; CI does not set it."
metrics:
  tasks_completed: 2
  files_modified: 8
completed: 2026-07-19
status: complete
---

# Phase 03 Plan 02: Browser Verification Summary

Added a pinned Playwright 1.61.0 dependency and a Chromium project that launches the actual Vite development SPA on an isolated local port. The fixture intercepts `/api` calls in the browser, so AuthGate, routing, dialogs, forms, and production checklist state render through the production component tree without a live database, OneBot instance, or secret-bearing environment.

Covered workflows:

- AuthGate anonymous login screen, login submission, and authenticated shell.
- all-api-hub import preview with existing-channel conflict and malformed-row feedback.
- Notification form QQ OneBot group/private target switching and query-auth control.
- Production checklist anonymous API probe showing protected/401 state.

## Verification

- `corepack pnpm test:e2e` passed: 4 Chromium tests.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall` passed, including E2E.
- `corepack pnpm lint` passed.
- `corepack pnpm test` passed: 23 tests.
- `corepack pnpm build` passed.
- `go test ./scripts -run '^TestWorkflowContracts$' -count=1` passed.
- CI quality workflow now installs `playwright install --with-deps chromium` and runs `pnpm test:e2e`.
