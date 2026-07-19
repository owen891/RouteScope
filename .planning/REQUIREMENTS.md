# Requirements: UpstreamOps Local Ops Edition

**Defined:** 2026-07-18
**Core Value:** 运维者能够安全、快速地发现上游渠道故障，批量修复或同步，并在变更前后可靠地验证与恢复数据。

## User Stories

- 作为上游运维者，我希望从 all-api-hub 备份中预览并导入渠道，这样无需手工逐个录入凭据。
- 作为值班人员，我希望失败渠道按原因聚合并提供修复入口，这样可以在一次操作中恢复一批渠道。
- 作为自托管用户，我希望通过 QQ 收到告警，并在发送失败时看到可执行的排查提示。
- 作为发布负责人，我希望部署前自动验证鉴权、备份、测试和镜像构建，这样升级失败时可以安全回退。

## v1 Requirements

Requirements for `v0.0.6-ops.1`. Each maps to exactly one roadmap phase.

### Import

- [ ] **IMPT-01**: 运维者可以在浏览器中读取并预览 all-api-hub v2 JSON 备份，原始备份不会上传到新的高权限导入端点
- [ ] **IMPT-02**: 运维者可以对名称或标准化站点 URL 冲突选择重命名、跳过或更新，并在写入前看到每行决策和错误
- [ ] **IMPT-03**: 运维者可以只同步本次成功写入的渠道，单行失败不会中止其余导入，结果会区分成功、跳过和失败
- [ ] **IMPT-04**: 导入使用的密码、Token 与 Cookie 进入现有加密凭据字段，`login_extra_params` 不保存备注中的明文密码

### Failure Operations

- [ ] **FAIL-01**: 运维者可以按指纹、Token 过期、Turnstile、鉴权和网络等失败类型筛选渠道，默认列表将失败渠道优先展示
- [ ] **FAIL-02**: 运维者可以对失败渠道执行仅同步失败、批量切换密码模式和批量更新密码，并得到逐项成功或失败反馈
- [ ] **FAIL-03**: 运维者可以从失败卡片直接进入清理登录信息、重贴 Token、修改密码或验证码处理入口

### QQ Notification

- [ ] **QQNT-01**: 运维者可以配置 OneBot HTTP 群聊或私聊目标、Base URL、Access Token 和查询鉴权模式，并通过设置页发送测试消息
- [ ] **QQNT-02**: OneBot 发送正确处理群号/用户号、Bearer/查询鉴权、HTTP 错误和非零 retcode，并对 Docker 连通性、鉴权及目标错误给出可操作提示

### Security

- [x] **SECU-01**: 生产运维者可以生成但由自己保存的管理员密码与 Token 签名密钥，辅助脚本不会静默改写真实 `.env`
- [x] **SECU-02**: 生产部署健康检查返回 200，同时未登录访问 `/api/channels` 返回 401；不满足时发布前检查必须失败
- [x] **SECU-03**: 鉴权服务拒绝错误凭据、篡改 Token 和匿名受保护请求，同时保持健康、版本和登录端点可访问

### Recovery

- [x] **RECV-01**: 运维者可以为 SQLite 数据库及配置创建同一时间戳的备份，并列出可恢复快照
- [x] **RECV-02**: 运维者可以按时间戳执行恢复演练，应用会停止、恢复数据、清理旧 WAL/SHM、重新启动并通过健康检查
- [x] **RECV-03**: 升级、批量导入和正式发布文档明确要求先备份，并提供回退官方 v0.0.6 的可执行路径

### Quality Gates

- [x] **QUAL-01**: 开发者可以通过单一跨平台命令运行锁文件校验、前端 lint/test/build、Go 全量测试和 Compose 配置校验
- [x] **QUAL-02**: GitHub Actions 在功能分支和 PR 上执行质量门禁，镜像发布作业必须等待同一门禁通过
- [x] **QUAL-03**: 自动测试覆盖导入冲突与凭据边界、QQ 群聊/私聊与业务错误、鉴权签名与中间件边界
- [x] **QUAL-04**: 浏览器级自动化覆盖登录保护、导入预览与冲突策略、QQ 通知表单和生产检查关键路径

### Release

- [x] **RELS-01**: Docker 构建使用冻结的 pnpm lockfile，并从干净检出生成可启动且健康的 `upstream-ops:local` 镜像
- [x] **RELS-02**: 发布文档说明自有 fork remote、版本命名、备份、升级、验证和回滚步骤，不依赖未跟踪的私有文件
- [ ] **RELS-03**: `v0.0.6-ops.1` 候选版本通过全部自动门禁和人工 UAT，且分支处于可推送、可审查状态

## Acceptance Criteria

- 所有 v1 requirement 都有自动测试、脚本输出或记录在 UAT 中的人工证据。
- `scripts/verify.sh` 与 `scripts/verify.ps1` 在受支持环境中通过，CI 工作流语法有效。
- 生产检查只在 `/healthz = 200` 且匿名 `/api/channels = 401` 时通过。
- 使用脱敏样本完成所有导入冲突策略，且失败行不会阻断成功行。
- QQ 群聊和私聊至少各完成一次真实 OneBot 测试，错误场景能定位网络、鉴权或目标配置。
- 完成一次备份和恢复演练，恢复后的容器健康且关键渠道数据存在。
- 从干净检出构建镜像并完成启动冒烟；发布说明包含回滚官方 v0.0.6 的命令。

## Definition of Done

- 需求实现已提交，工作区无意外生成物或敏感文件。
- 自动质量门禁全部通过；高风险安全检查无未解决项。
- 人工 UAT 证据记录在对应阶段，所有阻塞项已解决或明确移出 v1。
- `PROJECT.md`、`REQUIREMENTS.md`、`ROADMAP.md` 和 `STATE.md` 与实际代码及发布状态一致。
- 候选提交可以推送到自有 fork，并可创建 `v0.0.6-ops.1` 标签。

## v2 Requirements

Deferred until after the first local-ops release.

### Operational Reliability

- **OPRL-01**: 批量导入提供持久化审计记录和一键回滚本次变更
- **OPRL-02**: 通知渠道提供投递历史、可观测错误和有上限的自动重试
- **OPRL-03**: 备份支持校验和、保留策略、定时执行和恢复结果记录
- **OPRL-04**: 渠道同步和批量操作使用可配置、有界并发并支持取消

### Maintainability and Performance

- **MAIN-01**: 大型同步服务和前端页面按用例边界拆分，同时保持现有 API 合同
- **MAIN-02**: 前端路由和重依赖按需加载，主 JavaScript chunk 不再触发 500 KB 警告
- **MAIN-03**: 依赖和容器镜像加入漏洞扫描与可追溯供应链元数据

## Out of Scope

| Feature | Reason |
|---------|--------|
| 请求转发或模型网关 | 运维控制台不承载业务推理流量 |
| 自有支付结算 | 只操作上游已有充值和订阅 API |
| 服务端读取浏览器扩展 LevelDB | 高隐私、高耦合，仅允许仓外离线处理 |
| 多租户和复杂 RBAC | 当前面向单一可信运维者，超出首版安全模型 |
| 自动上传备份或凭据到外部服务 | 数据保护优先，所有敏感数据留在自托管环境 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| IMPT-01 | Phase 2 | Pending |
| IMPT-02 | Phase 2 | Pending |
| IMPT-03 | Phase 2 | Pending |
| IMPT-04 | Phase 2 | Pending |
| FAIL-01 | Phase 2 | Pending |
| FAIL-02 | Phase 2 | Pending |
| FAIL-03 | Phase 2 | Pending |
| QQNT-01 | Phase 2 | Pending |
| QQNT-02 | Phase 2 | Pending |
| SECU-01 | Phase 1 | Complete |
| SECU-02 | Phase 1 | Complete |
| SECU-03 | Phase 1 | Complete |
| RECV-01 | Phase 3 | Complete |
| RECV-02 | Phase 3 | Complete |
| RECV-03 | Phase 3 | Complete |
| QUAL-01 | Phase 1 | Complete |
| QUAL-02 | Phase 1 | Complete |
| QUAL-03 | Phase 1 | Complete |
| QUAL-04 | Phase 3 | Complete |
| RELS-01 | Phase 4 | Complete |
| RELS-02 | Phase 4 | Complete |
| RELS-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-07-18*
*Last updated: 2026-07-18 after roadmap creation*
