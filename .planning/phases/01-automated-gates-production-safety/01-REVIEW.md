---
phase: 01-automated-gates-production-safety
reviewed: 2026-07-19T14:47:00+08:00
depth: standard
files_reviewed: 25
files_reviewed_list:
  - backend/config/config.go
  - backend/config/config_test.go
  - backend/runtimeconfig/runtime.go
  - backend/runtimeconfig/runtime_test.go
  - cmd/server/main.go
  - backend/api/settings.go
  - backend/api/settings_test.go
  - frontend/app/settings-page.tsx
  - frontend/lib/api-types.ts
  - backend/auth/auth_test.go
  - scripts/print-auth-env.sh
  - scripts/print-auth-env.ps1
  - scripts/check-production.sh
  - scripts/check-production.ps1
  - scripts/security_tools_test.go
  - scripts/verify.sh
  - scripts/verify.ps1
  - scripts/workflow_contract_test.go
  - Dockerfile
  - frontend/lib/all-api-hub-import.ts
  - frontend/lib/import-and-error.test.ts
  - backend/notify/qqbot_test.go
  - .github/workflows/quality.yml
  - .github/workflows/publish.yml
findings:
  critical: 3
  warning: 1
  info: 0
  total: 4
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-19T14:47:00+08:00
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The authentication, redaction, credential-helper, frozen-install, and workflow changes were reviewed in their runtime context. Focused Go tests, `pnpm.cmd --dir frontend exec tsc --noEmit --incremental false`, and the import test suite pass. The implementation still has three blocking failure modes in configuration persistence and runtime application, plus a default production-probe endpoint that does not match the supported Compose default.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Settings can persist an auth-enabled configuration that cannot start

**File:** `backend/api/settings.go:122`
**Issue:** `saveSettingsConfig` accepts `auth.enabled=true` with an empty file-backed password (and no non-empty replacement). The UI only warns in `frontend/app/settings-page.tsx:264`, then sends the request anyway. `ApplyFromFile` rejects it at runtime via `auth.New`, but the invalid YAML has already been saved. A restart then fails during auth initialization, causing an operator-created outage and requiring manual config repair.

**Fix:** Validate the merged file configuration before calling `config.Save`. When auth is enabled, require a non-empty username/password after applying replacements, and require a usable token secret or app secret. Return `400` without writing if invalid. Add an API test that enables auth without an existing/replacement password and asserts the file is unchanged.

### CR-02: Config saves are non-atomic and can destroy the only recoverable configuration

**File:** `backend/config/config.go:236`
**Issue:** `Save` changes permissions, truncates the live `config.yaml` at line 244, then writes the replacement directly. A crash, disk-full condition, or short write after truncation leaves an empty or partial YAML file. This is a data-loss/recovery failure precisely on the Settings and startup persistence path.

**Fix:** Marshal to a same-directory temporary file opened `0600`, write and `Sync` it, close it, then atomically rename it over the target and sync the parent directory on POSIX. Preserve the existing file mode policy. Add fault-injection coverage for write/rename failures or move the file I/O behind a testable helper that proves the prior file survives a failed save.

### CR-03: Failed scheduler startup leaves runtime collaborators partially applied

**File:** `backend/runtimeconfig/runtime.go:132`
**Issue:** `ApplyFromFile` updates the dispatcher and channel service proxy/upstream settings before it creates and starts the replacement scheduler at lines 152-154. An invalid cron expression makes `Start` fail, returns an error to the caller, and leaves `CurrentProxy`, `CurrentUpstream`, auth, and scheduler pointing at the old state while active connector/notification consumers already use the new proxy/upstream state. The failed apply is therefore not rolled back and runtime state becomes internally inconsistent.

**Fix:** Build and start all replacement objects first. Only after successful validation/start should the method acquire its write lock and update all dependent consumers and manager fields as one committed operation. Alternatively snapshot and restore every mutated collaborator on failure. Add a regression test with an invalid cron and changed proxy/upstream values that asserts neither `channelSvc` nor `dispatcher` was changed.

## Warnings

### WR-01: Production probe default does not target the default Compose endpoint

**File:** `scripts/check-production.sh:4`
**Issue:** Both probe scripts default to `http://localhost:8088` (`scripts/check-production.ps1:2`), but the supported Compose configuration publishes `${HTTP_PORT:-8080}:8418`. Invoking the advertised helper without an argument against a standard Compose deployment fails with connection refusal even when health and anonymous authentication are correct.

**Fix:** Default both scripts to `http://localhost:8080`, or derive the port from an explicitly documented environment variable. Keep an explicit `BaseUrl`/positional override for deployments using a non-default host port, and add a fixture assertion for the default URL.

---

_Reviewed: 2026-07-19T14:47:00+08:00_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
