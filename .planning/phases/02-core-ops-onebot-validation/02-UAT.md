---
phase: 02-core-ops-onebot-validation
verified: 2026-07-19T18:31:00+08:00
status: partial_external_uat
automatic_checks: passed
external_checks:
  onebot_endpoint: unavailable
  group_message: pending
  private_message: pending
---

# Phase 02 UAT

## Automatic evidence

- `pnpm.cmd --dir frontend test`: passed, 23 tests.
- `pnpm.cmd --dir frontend lint`: passed.
- `pnpm.cmd --dir frontend exec tsc --noEmit --incremental false`: passed.
- `go test ./... -count=1`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`: passed.
- `SKIP_INSTALL=true ./scripts/verify.sh` through Git Bash: passed.
- `go test ./backend/notify ./backend/api -count=1`: passed.

## Verified workflows

- all-api-hub backup parsing remains browser-local and supports deterministic rename, skip, update-by-name, update-by-URL, malformed-row, expired-token, notes-password, and metadata-redaction decisions.
- Import writes continue row-by-row after an individual failure; result rows now identify create/update actions, and `writtenIds` contains only successful writes for the optional sync path.
- Failed-channel filtering supports fingerprint, expired token, Turnstile, password, network, and other categories; failed-only sync continues after individual failures.
- Batch password recovery continues after individual failures and presents per-channel outcomes while preventing overlapping sync/recovery operations.
- OneBot group/private targets, Bearer/query auth configuration, numeric/string target IDs, HTTP errors, nonzero retcodes, and reserved-character query tokens are covered by the form/transport tests.

## External UAT blocker

No real OneBot endpoint is available in the current environment. TCP probes to `127.0.0.1:5700` and `host.docker.internal:5700` both failed. Therefore the required real group and private message tests are intentionally **pending**, not marked passed.

To close Phase 2 external UAT, configure a reachable OneBot v11 HTTP endpoint, create one group target and one private target in Settings, and use the channel Test action once for each with Bearer and query auth as applicable. Record the returned message IDs/status and one deliberate failure for network/auth/target diagnosis.
