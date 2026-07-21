# Decisions Log — UpstreamOps / UR

Last updated: 2026-07-21

This is the single source of truth for product and deployment decisions.
Do not rediscover these from chat history.

## Active product direction

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| D1 | 主开发底座改为 **UpstreamOps（up）**，不再以 `upstream-ratio-watch` 为主仓 | **Accepted** | Code: `E:\www\upstream-ops` |
| D2 | `E:\www\UR` 仅保留历史方案、UI 设计、旧 ratio-watch 参考 | **Accepted** | See `E:\www\UR\README.md` |
| D3 | 线上入口继续用 `https://up.dh891.top` | **Accepted** | Server replaces ratio-watch |
| D4 | 服务器删除/下线 ratio-watch，换成本地 upstream-ops（含数据库） | **Done** | Backup at `/opt/backups/upstream-ratio-watch-20260720_215942*` |
| D5 | 自有 fork 为 `owen891/upstream-ops`；官方仓 `bejix/upstream-ops` 作 upstream | **Done** | PR #1 merged; tag `v0.0.6-ops.1` |
| D6 | 当前里程碑 `v0.0.6-ops.1`：收口已有运维二改，不扩成完整观测/决策平台 | **Accepted** | v2 features stay deferred |

## Notification decisions

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| N1 | **不用 NapCat 扫码登录个人 QQ**（会顶号） | **Accepted / abandoned path** | NapCat container stopped |
| N2 | QQ 通知改走 **官方开放平台机器人**（AppID/Secret） | **Done** | Type `qqofficial` in code + UI |
| N3 | 私聊通知先落地并实测 | **Done** | Channel `QQ官方-私聊` received test message |
| N4 | 群聊通知后续再配（需 group openid + 群主开主动发言） | **Open** | Not blocking private alerts |
| N5 | OneBot 代码保留兼容，但生产默认走官方机器人 | **Accepted** | `qqbot` remains; `qqofficial` preferred |

## Security / ops decisions

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| S1 | 生产必须鉴权：`/healthz=200` 且匿名 `/api/channels=401` | **Done** | Live verified |
| S2 | 管理员密码以 `data/config.yaml` 为准，设置页「保存+应用」可改 | **Done** | Removed empty `ADMIN_PASSWORD` env override |
| S3 | 不把真实 Secret / 密码 / openid 提交进 Git | **Accepted** | Deploy artifacts gitignored |
| S4 | 聊天中暴露过的 root 密码、AppSecret、后台密码应轮换 | **Open (operator action)** | Not code work |

## Release decisions

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| R1 | 推送到自有 fork，不默认给官方 `bejix` 提 PR | **Done** | Merged inside owen891 fork only |
| R2 | 打标签 `v0.0.6-ops.1` | **Done** | Points at feature commit on branch history |
| R3 | 服务器当前跑本地镜像 `upstream-ops:local` | **Accepted interim** | GHCR publish optional follow-up |
| R4 | 规划文档需与线上真实状态对齐 | **Done** | DECISIONS/STATE/PROJECT/REQUIREMENTS/ROADMAP reconciled 2026-07-21 |

## Explicitly deferred (v2 / old UR roadmap)

Not current work unless re-opened:

- Observations / comparisons / route advice / adjustment audit platform
- Import audit + one-click rollback of an import batch
- Notification delivery history + bounded auto-retry productization
- Backup retention policy + scheduled backups
- Frontend chunk split under 500KB warning
- Supply-chain scanning / SBOM

## Open items only

1. QQ **group** official notification (openid + owner setting + test)
2. Optional: publish `ghcr.io/owen891/upstream-ops:v0.0.6-ops.1`
3. Operator secret rotation (admin password, AppSecret, server root)

## Where things live

| Thing | Location |
|-------|----------|
| Main code | `E:\www\upstream-ops` |
| Online app | `https://up.dh891.top` |
| Fork | https://github.com/owen891/upstream-ops |
| Tag | `v0.0.6-ops.1` |
| UR history workspace | `E:\www\UR` |
| Ratio-watch backup (server) | `/opt/backups/upstream-ratio-watch-20260720_215942*` |
| Live data | `/opt/upstream-ops/data` |
