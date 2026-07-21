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

- [x] v0.0.6-ops.1 local-ops edition deployed on up.dh891.top
- [ ] **Next milestone v0.1.0 Decision Layer** — observations / comparisons / route advice / adjustment audit  
  Formal requirements: `.planning/REQUIREMENTS-v0.1-decision-layer.md`

### Out of Scope

- 请求转发或模型网关 — 本项目只管理上游，不承载业务请求流量
- 支付中台 — 仅调用上游已有充值/订阅能力，不处理自有支付结算
- 服务端读取浏览器扩展 LevelDB — 浏览器私有数据仅允许离线、仓外脚本处理
- 多租户、注册和复杂权限系统 — 当前部署面向单一可信运维者
- 自动提交或上传包含 Token、Cookie、数据库和真实 `.env` 的本地数据 — 凭据必须留在忽略目录和加密存储中

## Context

- **主开发目录：** `E:\www\upstream-ops`。`E:\www\UR` 仅历史/设计参考。
- **线上：** `https://up.dh891.top`，数据 14 渠道，鉴权开启。
- **Fork：** `owen891/upstream-ops`；标签 `v0.0.6-ops.1`；PR #1 已合并到 fork main。
- **QQ：** 生产路径为官方开放平台 `qqofficial`；NapCat 个人扫码路径已放弃。
- **下一阶段需求：** `.planning/REQUIREMENTS-v0.1-decision-layer.md`（观测/对比/路由/调价审计）
- 决策总表：`.planning/DECISIONS.md`。

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
| 主线从 UR/ratio-watch 切到 UpstreamOps | 服务器与开发统一到 up 底座 | ✓ Done 2026-07-21 |
| all-api-hub 备份在浏览器端解析，服务端复用现有渠道 API | 避免新增高权限导入端点和上传原始备份 | ✓ Good |
| 敏感凭据进入现有加密字段，导入元数据不得保存备注密码 | 保持统一加密边界并降低泄露风险 | ✓ Good |
| 生产鉴权不由脚本静默改写 `.env` | 避免生成运维者不知道的密码或把自己锁在系统外 | ✓ Good |
| QQ 生产通知用官方机器人，不用 NapCat 顶个人号 | 稳定性与会话安全 | ✓ Done |
| 当前里程碑使用粗粒度垂直阶段 | 每个阶段都交付可验证的运维结果 | ✓ Done |
| 规划文档和代码地图进入 Git | 可追溯 | ✓ Done |
| 详见 `.planning/DECISIONS.md` | 单一决策源 | ✓ |

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
*Last updated: 2026-07-21 after formalizing decision-layer next milestone*
