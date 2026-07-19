---
phase: 04-auditable-release-candidate
plan: "04"
subsystem: external-onebot-uat
tags: [onebot, uat, evidence, release]
requires: [04-03]
provides:
  - Cross-platform external OneBot runner evidence output with an explicit real-endpoint gate.
  - Message-ID, HTTP-status, and nonzero-retcode assertions for release UAT.
  - Token-free, target-free evidence boundary and updated release instructions.
affects: [release, operations, security]
metrics:
  tasks_completed: 2
  files_modified: 8
completed: 2026-07-19
status: implemented_external_delivery_pending
---

# Phase 04 Plan 04 Summary

Implemented the RELS-03 gap-closure boundary. Both external OneBot runners now require successful group/private responses with `message_id`, preserve HTTP/business failure status for diagnosis, and can write a token-free evidence JSON only when `ONEBOT_REAL_ENDPOINT=1` / `-RealEndpoint` is explicitly set. Evidence excludes access tokens, message bodies, and target IDs. Synthetic fixture and Compose-network runs remain protocol evidence only.

Verification: PowerShell and Git Bash rehearsals against the disposable fixture passed group/private/error paths and generated synthetic evidence only when the real-endpoint gate was explicitly enabled for the rehearsal. Real QQ delivery remains pending because no reachable OneBot endpoint is configured.
