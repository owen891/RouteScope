# UpstreamOps Local Ops Edition

## What This Is

UpstreamOps Local Ops Edition 是基于官方 `bejix/upstream-ops` v0.0.6 的自托管上游运维控制台，面向需要日常管理 NewAPI 与 Sub2API 渠道的单一运维者。它把渠道导入、故障定位与修复、同步、通知、鉴权和数据保护集中到一个可审计、可恢复的工作界面中。

当前里程碑是发布 `v0.0.6-ops.1`：不再扩展 P0 功能范围，优先把已实现的二改能力验证、加固并形成可重复发布流程。

## Core Value

运维者能够安全、快速地发现上游渠道故障，批量修复或同步，并在变更前后可靠地验证与恢复数据。

## Requirements

### Validated

- ✓ 管理 NewAPI 与 Sub2API 渠道、登录凭据、余额、倍率、订阅、公告和 API Key — official v0.0.6
- ✓ 定时刷新渠道状态并通过多种通知渠道发送告警 — official v0.0.6
- ✓ 使用 SQLite 或 MySQL 持久化，并使用 `APP_SECRET` 加密敏感凭据 — official v0.0.6
- ✓ 支持可选的单管理员登录鉴权和运行时配置 — official v0.0.6
- ✓ 通过 Docker Compose 部署包含 Go API 与 React SPA 的单体镜像 — official v0.0.6

### Active

- [ ] all-api-hub v2 备份可以预览并按新增、重命名、跳过或更新策略安全导入
- [ ] 渠道失败可以分类、筛选、失败优先展示，并支持批量改密、清理登录信息或仅同步失败渠道
- [ ] QQ OneBot HTTP 通知可以在群聊和私聊场景中可靠发送，并提供可操作的错误提示
- [ ] 生产部署默认经过鉴权、备份、恢复和匿名 API 检查，不会在未知状态下暴露管理接口
- [ ] 本地与 CI 使用同一套 lint、单测、构建和 Compose 门禁，镜像发布必须等待门禁通过
- [ ] 从干净检出可重复构建并发布 `v0.0.6-ops.1`，同时保留回滚到官方 v0.0.6 的路径

### Out of Scope

- 请求转发或模型网关 — 本项目只管理上游，不承载业务请求流量
- 支付中台 — 仅调用上游已有充值/订阅能力，不处理自有支付结算
- 服务端读取浏览器扩展 LevelDB — 浏览器私有数据仅允许离线、仓外脚本处理
- 多租户、注册和复杂权限系统 — 当前部署面向单一可信运维者
- 自动提交或上传包含 Token、Cookie、数据库和真实 `.env` 的本地数据 — 凭据必须留在忽略目录和加密存储中

## Context

- 当前分支 `feat/ops-p0-import-notify` 基于官方 v0.0.6，已有 8 个功能提交，主要实现记录在 `docs/FORK_NOTES.md`。
- P0 已实现 all-api-hub 导入、失败分类与快捷修复、失败筛选与同步、批量改密、备注标签、紧凑列表、QQ OneBot 通知、生产检查和运维脚本。
- 代码地图位于 `.planning/codebase/`；后端为 Go 1.23 + Gin + GORM，前端为 React 19 + TypeScript + Vite。
- 当前未提交收口改动已修复 lint，补充导入、QQ 和鉴权测试，并加入可复用 CI、发布门禁与生产检查脚本。
- 2026-07-18 本地验证：Go 全量测试、前端 lint、23 个 Vitest 测试、生产构建、Compose 配置和 GitHub Actions 语法通过。
- 当前本地容器健康，但 `AUTH_ENABLED=false` 且管理员密码为空；匿名 `/api/channels` 返回 200，因此只能视为开发环境，不能视为生产就绪。

## Constraints

- **Compatibility**: 必须保留官方 v0.0.6 的现有渠道、监控、同步和通知行为，二改不能破坏既有数据库。
- **Deployment**: 主发布形态是 Docker Compose 单体容器，数据继续挂载在 `./data`。
- **Security**: `APP_SECRET` 必须长期固定；生产发布必须启用管理员鉴权，任何日志、文档、测试和导出不得包含真实密钥。
- **Recovery**: 任何升级或批量导入前必须有可验证备份，恢复流程必须能在当前 Compose 环境完成。
- **Upstreamability**: 二改应保持边界清晰，便于以后合并官方新版本；避免无关的大规模重构。
- **Quality**: 发布前必须通过 Go 全量测试、前端 lint/test/build、Compose 校验和关键人工 UAT。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 基于官方 v0.0.6 做窄范围运维二改 | 保留成熟监控能力，把投入集中在日常故障处理 | ✓ Good |
| all-api-hub 备份在浏览器端解析，服务端复用现有渠道 API | 避免新增高权限导入端点和上传原始备份 | — Pending |
| 敏感凭据进入现有加密字段，导入元数据不得保存备注密码 | 保持统一加密边界并降低泄露风险 | ✓ Good |
| 生产鉴权不由脚本静默改写 `.env` | 避免生成运维者不知道的密码或把自己锁在系统外 | ✓ Good |
| 当前里程碑使用粗粒度垂直阶段 | 每个阶段都交付可验证的运维结果，尽快形成可发布版本 | — Pending |
| 规划文档和代码地图进入 Git | 让后续执行、验证和上游合并有可追溯依据 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-18 after initialization*
