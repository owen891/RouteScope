---
gsd_state_version: 1.0
milestone: v0.0.6-ops.1
milestone_name: local-ops-edition
current_phase: 04
current_phase_name: 可审查发布候选
status: deployed_with_followups
stopped_at: Deployed to up.dh891.top; QQ official private notify verified; planning docs partially reconciled
last_updated: "2026-07-21T14:00:00.000Z"
last_activity: 2026-07-21
last_activity_desc: Replaced ratio-watch with upstream-ops; shipped qqofficial notify; forked/pushed/merged/tag; fixed admin password source
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md`  
**Decisions source of truth:** `.planning/DECISIONS.md`

**Core value:** 运维者能够安全、快速地发现上游渠道故障，批量修复或同步，并在变更前后可靠地验证与恢复数据。  
**Current focus:** Follow-ups after v0.0.6-ops.1 deploy (group QQ notify, optional GHCR image, secret rotation)

## Current Position

Phase: 04 (可审查发布候选) — **DEPLOYED**  
Status: Live on `https://up.dh891.top` with auth, 14 channels, and verified QQ official private notification  
Last activity: 2026-07-21 — direction locked to upstream-ops; ratio-watch archived

Progress: [██████████] 100% of planned phases executed; residual follow-ups listed below

## Live deployment

| Item | Value |
|------|-------|
| URL | https://up.dh891.top |
| Host path | `/opt/upstream-ops` |
| Image | `upstream-ops:local` |
| Auth | enabled (`/api/channels` → 401 anonymous) |
| Channels | 14 |
| Notify | `QQ官方-私聊` (`qqofficial`, enabled) |
| NapCat | stopped (abandoned) |
| Ratio-watch | backed up and removed from service |

## Repository

| Item | Value |
|------|-------|
| Main dir | `E:\www\upstream-ops` |
| Fork | https://github.com/owen891/upstream-ops |
| Official upstream | https://github.com/bejix/upstream-ops |
| PR | https://github.com/owen891/upstream-ops/pull/1 (merged) |
| Tag | `v0.0.6-ops.1` |

## Accumulated Context

### Decisions

All standing decisions are in [`.planning/DECISIONS.md`](DECISIONS.md).

High-signal:
- Product base = UpstreamOps, not ratio-watch
- QQ production path = official bot, not NapCat personal login
- Fork/publish under owen891; do not assume bejix merge
- Admin password owned by config.yaml via Settings save+apply

### Open follow-ups

1. Official QQ **group** notification
2. Optional GHCR image publish for `v0.0.6-ops.1`
3. Operator secret rotation (admin password / AppSecret / root)

### Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | OPRL-01 through OPRL-04; MAIN-01 through MAIN-03 | Deferred | Project initialization |
| old UR | observations / comparisons / route / adjustment platform | Deferred | 2026-07-21 direction pivot |

## Session Continuity

Last session: 2026-07-21  
Stopped at: Decisions consolidated; live deploy + private QQ notify working  
Resume file: `.planning/DECISIONS.md`
