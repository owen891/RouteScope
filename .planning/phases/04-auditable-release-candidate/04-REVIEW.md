---
phase: 04-auditable-release-candidate
reviewed: 2026-07-19
depth: deep
status: passed_with_external_prerequisite
---

# Phase 04 Code Review

## Scope

Reviewed the Phase 4 gap-closure implementation: `scripts/onebot-uat.sh`, `scripts/onebot-uat.ps1`, `scripts/onebot_uat_test.go`, `.gitignore`, release notes, UAT records, and the `04-04` planning artifacts.

## Findings

No BLOCKER or WARNING findings remain after the review fixes.

The review caught and fixed two correctness/security issues during the pass:

- URL userinfo is stripped from evidence endpoints, preventing credentials embedded in a base URL from being persisted.
- Successful group/private responses require a non-empty `message_id`; HTTP 200 plus `status=ok` alone is insufficient for delivery evidence.

Evidence writes now use a temporary file followed by replacement and clean the temporary path on exit, reducing partial-file and residue risk on interruption. The runner contract tests assert the real-endpoint gate, redaction boundary, message-ID requirement, and evidence fields.

## Residual External Prerequisite

No reachable real OneBot v11 endpoint or QQ target is available in this environment. The disposable fixture and Compose network prove protocol/container behavior only. `RELS-03` and final `v0.0.6-ops.1` sign-off remain pending until a real endpoint produces group/private message IDs and one deliberate failure record.

## Verification

- `go test ./scripts -run 'OneBot.*UAT' -count=1`: passed.
- `go test ./... -count=1`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipInstall -SkipE2E`: passed.
- `docker compose config --quiet`: passed.
- Git Bash and PowerShell fixture rehearsals: passed with synthetic message IDs and token-free evidence.
- Negative real-endpoint gate: evidence generation rejected without explicit real-endpoint confirmation.
