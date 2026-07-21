---
phase: 01-automated-gates-production-safety
reviewed: 2026-07-19T16:37:00+08:00
source_review: 01-REVIEW.md
status: fixed
fixed:
  critical: 3
  warning: 1
---

# Phase 01: Review Fixes

All actionable findings from `01-REVIEW.md` were fixed and covered by regression tests.

| Finding | Resolution | Regression coverage |
| --- | --- | --- |
| CR-01 invalid auth could be written | Settings now validate the candidate file configuration after applying the same environment overrides used at runtime; invalid enabled authentication returns HTTP 400 before `config.Save`. | `TestSaveSettingsRejectsInvalidEnabledAuthenticationWithoutWriting`; existing environment-only credential test remains green. |
| CR-02 non-atomic config writes | Config writes now use a same-directory 0600 temporary file, file sync, atomic rename, and POSIX directory sync. | `TestSaveRenameFailurePreservesExistingConfig` proves the prior configuration survives a replacement failure. |
| CR-03 partial runtime apply | A replacement scheduler is fully started before policy, proxy, upstream, auth, and manager state are committed. Applies are serialized to prevent scheduler replacement races. | `TestApplyFromFileInvalidSchedulerPreservesCollaborators` verifies channel, dispatcher, manager, and scheduler state remain unchanged after an invalid cron. |
| WR-01 incorrect probe port | Both production probe scripts default to the Docker Compose port `8080` while retaining their explicit override parameters. | `TestProductionProbeDefaultsToComposePort` plus cross-platform probe contract tests. |

## Verification

- `go test ./... -count=1`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`
- `SKIP_INSTALL=true ./scripts/verify.sh` (Git Bash)

All commands passed on 2026-07-19.
