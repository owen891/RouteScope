# Phase 01 Plan Outline: 自动门禁与生产安全

## Phase Goal

发布负责人能够依靠自动化门禁阻止质量或鉴权不合格的生产镜像。

## Planning Constraints

- Brownfield phase: preserve official v0.0.6 behavior and the current intended dirty implementation; do not create a walking skeleton even though the roadmap records MVP mode.
- Close the confirmed Phase 1 release blockers: runtime Settings apply must preserve environment-variable precedence, Settings must not disclose or persist effective plaintext secrets, sensitive config files must use restrictive permissions, and production authentication must be proven by anonymous endpoint checks.
- Reuse the dirty quality workflow, publish dependency, cross-platform verification/auth helpers, auth tests, import-boundary tests, and QQ transport tests as the implementation baseline. Harden and verify them rather than replacing them wholesale.
- Keep Phase 2 real OneBot/browser operational UAT, Phase 3 SQLite recovery and browser E2E, and Phase 4 clean-checkout image reproduction, fork/release notes, push, and tag work outside this phase.

## Execution Outline

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| 01-01 | Harden production configuration and authentication: preserve environment-owned values through Settings read/save/apply, redact secret-bearing responses and avoid insecure persistence, generate operator-held credentials without editing `.env`, and prove wrong credentials, tampered tokens, public routes, protected routes, and anonymous production probes behave safely. Record explicit v1 dispositions for any confirmed authentication risks not changed by this bounded hardening. | 1 | none | SECU-01, SECU-02, SECU-03 |
| 01-02 | Make the current release checks authoritative across Bash, PowerShell, GitHub Actions, and image publication: run frozen-lockfile install, frontend lint/test/build, uncached Go tests, Compose validation, and regression coverage for import conflict/credential boundaries, QQ group/private/error behavior, and authentication middleware/signatures; ensure every failure blocks publication and rerun the complete gate after Plan 01. | 2 | 01-01 | QUAL-01, QUAL-02, QUAL-03 |

## Coverage Audit

- Goal: Plan 01 establishes the production authentication boundary; Plan 02 makes that boundary and the full quality suite a prerequisite for image publication.
- Dirty implementation: security helpers and auth tests feed Plan 01; reusable/local quality workflows, publish wiring, import tests, QQ tests, and their narrowly required fixes feed Plan 02.
- Scope: all Phase 1 requirement ownership is represented once in the table; later-phase operational validation, recovery, browser automation, and release-candidate work are excluded.

## OUTLINE COMPLETE
