# Roadmap: UpstreamOps Local Ops Edition

## Overview

本里程碑把当前分支中已经存在的 P0 二改和未提交的发布收口改动，依次转化为可验证、可恢复、可审查的 `v0.0.6-ops.1` 候选版本。阶段按交付结果组织：先关闭自动化与生产安全门禁，再用脱敏数据和真实 OneBot 验证核心运维流程，随后完成可靠恢复与浏览器 E2E，最后从干净检出复现镜像并整理 fork、发布和标签状态。已有实现只代表阶段起点；没有对应验证证据的阶段均不视为完成。

## Phases

- [x] **Phase 1: 自动门禁与生产安全** - 让本地、CI 和发布作业共享可阻断的质量门禁，并验证生产鉴权边界。 (completed 2026-07-19)
- [ ] **Phase 2: 核心运维与 OneBot 实测** - 用脱敏导入样本、失败渠道和真实 OneBot 完成日常运维工作流。
- [x] **Phase 3: 可恢复部署与浏览器验证** - 证明数据可以一致备份和恢复，并用浏览器 E2E 锁定关键路径。（自动验证完成；真实 OneBot 仍待外部 UAT）
- [ ] **Phase 4: 可审查发布候选** - 从干净检出复现健康镜像，形成可推送、可审查、可打标签的候选版本。（自动候选验证完成；最终 OneBot UAT 待完成）

## Phase Details

### Phase 1: 自动门禁与生产安全

**Goal**: 发布负责人能够依靠自动化门禁阻止质量或鉴权不合格的生产镜像
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SECU-01, SECU-02, SECU-03, QUAL-01, QUAL-02, QUAL-03
**Success Criteria** (what must be TRUE):

  1. 开发者可以在受支持平台通过单一命令完成冻结锁文件校验、前端 lint/test/build、Go 全量测试和 Compose 配置校验，任一检查失败都会阻断流程。
  2. 功能分支和 PR 会运行同一组 GitHub Actions 门禁，镜像发布作业只有在门禁通过后才能执行。
  3. 生产运维者可以生成并自行保管管理员密码与 Token 签名密钥，辅助脚本不会改写真实 `.env`；生产检查只在 `/healthz = 200` 且匿名 `/api/channels = 401` 时通过。
  4. 错误凭据、篡改 Token 和匿名受保护请求会被拒绝，而健康、版本和登录端点仍可匿名访问。
  5. 自动测试可以检测导入冲突与凭据边界、QQ 群聊/私聊与业务错误、鉴权签名与中间件边界的回归。

**Plans**: 2/2 plans complete
**Wave 1**

- [x] 01-01-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md

### Phase 2: 核心运维与 OneBot 实测

**Goal**: 运维者能够在真实操作环境中安全导入渠道、集中修复失败并通过 QQ 收到可诊断通知
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: IMPT-01, IMPT-02, IMPT-03, IMPT-04, FAIL-01, FAIL-02, FAIL-03, QQNT-01, QQNT-02
**Success Criteria** (what must be TRUE):

  1. 运维者可以在浏览器中本地读取并预览脱敏的 all-api-hub v2 备份，在写入前逐行查看名称或标准化 URL 冲突，并选择新增、重命名、跳过或更新，而原始备份不会上传到新的高权限端点。
  2. 导入遇到单行错误时仍会处理其他行，结果会区分成功、跳过和失败；运维者可以只同步本次成功写入的渠道，敏感凭据进入现有加密字段且备注中不保留明文密码。
  3. 运维者可以按失败原因筛选失败优先的渠道列表，对目标渠道执行仅同步失败、批量切换密码模式或批量更新密码，并看到逐项结果。
  4. 运维者可以从失败卡片直接进入清理登录信息、重贴 Token、修改密码或 Turnstile 验证码处理流程。
  5. 运维者可以从设置页配置并实测 OneBot 群聊和私聊目标以及 Bearer/查询鉴权；HTTP、retcode、Docker 连通性、鉴权或目标错误会给出可执行的排查提示。

**Plans**: 3/3 plans implemented; external UAT pending
**UI hint**: yes

### Phase 3: 可恢复部署与浏览器验证

**Goal**: 运维者能够在受保护的 Compose 环境中可靠备份和恢复数据，关键界面流程同时受到浏览器 E2E 保护
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: RECV-01, RECV-02, RECV-03, QUAL-04
**Success Criteria** (what must be TRUE):

  1. 运维者可以为 SQLite 数据库和配置创建同一时间戳的可恢复备份，并列出可用快照。
  2. 运维者可以按时间戳执行恢复演练；应用停止后恢复一致数据、清理旧 WAL/SHM、重新启动并通过健康检查，且演练前的关键渠道数据仍然存在。
  3. 升级、批量导入和正式发布流程会明确要求先备份，并提供可实际执行的官方 v0.0.6 回退路径。
  4. 浏览器级自动化可以验证登录保护、导入预览与冲突策略、QQ 通知表单和生产检查路径，并在这些交互回归时失败。

**Plans**: 3/3 plans complete; automatic evidence recorded, external OneBot UAT pending
**UI hint**: yes

### Phase 4: 可审查发布候选

**Goal**: 发布负责人能够从干净检出复现并审查 `v0.0.6-ops.1` 候选版本，然后安全推送和打标签
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: RELS-01, RELS-02, RELS-03
**Success Criteria** (what must be TRUE):

  1. 从干净检出执行冻结 pnpm 锁文件的 Docker 构建可以生成可启动且健康的 `upstream-ops:local` 镜像。
  2. 发布说明明确自有 fork remote、版本命名、备份、升级、验证和回滚步骤，并且不依赖未跟踪的私有文件。
  3. `v0.0.6-ops.1` 候选版本通过全部自动门禁和人工 UAT，工作区不存在意外生成物或敏感文件，分支处于可推送、可审查且可创建标签的状态。

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 自动门禁与生产安全 | 2/2 | Complete   | 2026-07-19 |
| 2. 核心运维与 OneBot 实测 | 3/3 | Verifying | - |
| 3. 可恢复部署与浏览器验证 | 3/3 | Complete (external OneBot pending) | 2026-07-19 |
| 4. 可审查发布候选 | 3/3 | Verifying (external OneBot pending) | 2026-07-19 |

---
*Roadmap created: 2026-07-18*
