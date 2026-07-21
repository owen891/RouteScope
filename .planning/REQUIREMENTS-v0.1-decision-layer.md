# Requirements: UpstreamOps Decision Layer (v0.1.0)

**Defined:** 2026-07-21  
**Base:** UpstreamOps local-ops edition (`v0.0.6-ops.1`) at `E:\www\upstream-ops`  
**Source of product intent:** historical UR plan in `E:\www\UR\PROJECT_PLAN.md`  
**Decisions source:** `.planning/DECISIONS.md`

## Positioning

Next milestone is **not** a rewrite of ratio-watch.  
It is a decision-assist layer **on top of UpstreamOps**:

1. keep existing ops capabilities (import / failure recovery / auth / backup / QQ notify)
2. add observation facts, comparisons, route advice, adjustment audit
3. stay self-hosted, SQLite-first, single operator

### Core value

运维者不仅能发现上游故障并修复，还能基于统一观测事实做对比、路由建议和受控调价决策。

## User Stories

- 作为值班人员，我希望所有余额/倍率/健康/公告采集都沉淀为可查询的 observations，而不是只有瞬时状态。
- 作为运营，我希望按模型/分组横向比较多个上游的倍率与稳定性，快速判断谁更划算、谁更稳。
- 作为调度人员，我希望系统给出路由建议（优先候选与风险说明），而不是只报“有变化”。
- 作为负责人，我希望调价建议可预览、可审计、默认可 dry-run，必要时再执行并支持回滚。

## Out of Scope (this milestone)

| Feature | Reason |
|---------|--------|
| 通用请求转发网关 | UpstreamOps / UR 不做流量面 |
| 自动无人值守调价全开 | 默认保守，必须预览/审计 |
| 多租户 / 复杂 RBAC | 仍面向单一可信运维者 |
| 浏览器扩展 LevelDB 服务端直读 | 高隐私，仅允许仓外离线处理 |
| 完整支付中台 | 只对接上游已有充值/兑换能力 |

## v0.1 Requirements

Each requirement maps to exactly one phase below.

### Observation Facts

- [ ] **OBS-01**: 系统把服务端定时采集结果沉淀为统一 observation 记录（至少 balance / rate / health / announcement）
- [ ] **OBS-02**: 每条 observation 带 channel_id、source、sampled_at、payload 摘要与原始引用，可按渠道/时间查询
- [ ] **OBS-03**: 手动刷新与定时扫描共用同一 normalizer，避免“页面上看到的”和“库里沉淀的”两套口径
- [ ] **OBS-04**: 支持手动健康探测配置与探测运行记录（成功/失败/延迟/错误分类）

### Comparisons

- [ ] **CMP-01**: 运维者可按模型名/分组名聚合，比较多个上游当前倍率与最近变化
- [ ] **CMP-02**: 对比结果展示最低/最高/中位倍率，并标记异常偏离（可配置阈值）
- [ ] **CMP-03**: 对比页可下钻到某渠道详情与对应 observation / rate history
- [ ] **CMP-04**: 对比结果可导出为只读 JSON/CSV（不含敏感凭据）

### Route Advice

- [ ] **RTE-01**: 系统基于健康状态、余额风险、倍率水平生成 route candidate 列表
- [ ] **RTE-02**: 每个候选包含优先级、推荐理由、主要风险（登录失败/余额低/倍率偏高/探测失败）
- [ ] **RTE-03**: 运维者可把某模型/分组的首选路由标记为 primary route（人工确认，不自动切流量）
- [ ] **RTE-04**: route advice 变更写入审计日志，可回看“为何推荐/为何改选”

### Adjustment Audit

- [ ] **ADJ-01**: 运维者可对目标渠道/分组生成调价预览（dry-run），展示变更前后倍率与影响范围
- [ ] **ADJ-02**: 调价执行默认关闭自动模式；执行前必须二次确认，并记录操作者、时间、输入参数
- [ ] **ADJ-03**: 每次调价执行产生 adjustment_audit 记录，成功/失败与上游返回摘要可查
- [ ] **ADJ-04**: 支持按 audit id 发起回滚预览；在上游仍支持写回时执行回滚
- [ ] **ADJ-05**: 调价与回滚结果可通过现有通知通道发送摘要（沿用官方 QQ / 其他 notifier）

### Delivery / UX Guardrails

- [ ] **UX-01**: 新增“决策”导航区（或等价入口），与现有运维页分离，不破坏现有渠道监控主路径
- [ ] **UX-02**: 长任务（探测/对比刷新/调价预览）有进度与可取消边界；失败显示可执行原因
- [ ] **UX-03**: 决策层 API 全部走现有鉴权；导出与审计接口禁止输出 token/password/cookie

## Phases (next milestone)

### Phase 5: Observation Foundation

**Goal**: 运维者能查询统一观测事实，而不仅是瞬时状态  
**Depends on**: v0.0.6-ops.1 deployed  
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04  
**Success criteria**:
1. 定时扫描与手动刷新都会写入 observation。
2. 可按渠道/时间过滤查询。
3. 健康探测配置与运行记录可用。

### Phase 6: Comparisons

**Goal**: 运维者能横向比较多上游倍率与变化  
**Depends on**: Phase 5  
**Requirements**: CMP-01, CMP-02, CMP-03, CMP-04  
**Success criteria**:
1. 选定模型/分组后看到多渠道对比表。
2. 异常偏离有标记。
3. 可导出只读结果。

### Phase 7: Route Advice

**Goal**: 运维者能获得并确认路由建议  
**Depends on**: Phase 6  
**Requirements**: RTE-01, RTE-02, RTE-03, RTE-04  
**Success criteria**:
1. 每个目标模型/分组至少给出排序候选。
2. 推荐理由与风险可读。
3. primary route 人工确认后可回看审计。

### Phase 8: Adjustment Audit

**Goal**: 调价建议可预览、可审计、可回滚  
**Depends on**: Phase 7  
**Requirements**: ADJ-01 … ADJ-05, UX-01, UX-02, UX-03  
**Success criteria**:
1. dry-run 预览与真实执行分离。
2. 每次执行有 audit。
3. 可回滚预览；在上游支持时完成回滚。
4. 决策入口不破坏现有运维主路径。

## Acceptance Criteria (milestone)

- 所有 v0.1 requirement 都有自动测试、脚本输出或 UAT 证据。
- 决策层功能不要求停机迁移现有渠道数据。
- 任何导出/日志/通知都不包含明文 secret。
- 默认 SQLite + Docker Compose 可完整演示：观测 → 对比 → 路由建议 → 调价预览。
- 调价执行默认关闭或强制 dry-run，除非运维者显式确认。

## Definition of Done

- 需求已映射到 Phase 5–8，并写入 ROADMAP。
- PROJECT/STATE/DECISIONS 指向本文件作为下一阶段需求源。
- 不与 v0.0.6-ops.1 热修（群聊通知、镜像发布）抢主线，除非明确插队。

## Relationship to old UR docs

| Old UR concept | New requirement home |
|----------------|----------------------|
| 观测层 observations | OBS-01 … OBS-04 |
| comparisons | CMP-01 … CMP-04 |
| route candidates / primary routes | RTE-01 … RTE-04 |
| adjustment preview / execute / rollback / audit | ADJ-01 … ADJ-05 |
| ratio-watch as product base | **Rejected** — base is UpstreamOps |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | 5 | Planned |
| OBS-02 | 5 | Planned |
| OBS-03 | 5 | Planned |
| OBS-04 | 5 | Planned |
| CMP-01 | 6 | Planned |
| CMP-02 | 6 | Planned |
| CMP-03 | 6 | Planned |
| CMP-04 | 6 | Planned |
| RTE-01 | 7 | Planned |
| RTE-02 | 7 | Planned |
| RTE-03 | 7 | Planned |
| RTE-04 | 7 | Planned |
| ADJ-01 | 8 | Planned |
| ADJ-02 | 8 | Planned |
| ADJ-03 | 8 | Planned |
| ADJ-04 | 8 | Planned |
| ADJ-05 | 8 | Planned |
| UX-01 | 8 | Planned |
| UX-02 | 8 | Planned |
| UX-03 | 8 | Planned |

**Coverage:** 20 requirements, all mapped.

---
*Created: 2026-07-21*
