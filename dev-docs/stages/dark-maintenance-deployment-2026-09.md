# 全暗态维护部署（2026-09）

## 阶段目标与用户流程

将本地已完成的管理员模板来源接口部署到 COM/CN，供现有超级管理员只读验收。新增独立维护验收类别，允许完整 QA-02 尚未完成时使用目标提交的完整 offline rehearsal；维护通过不代表正式 QA-04、REL-04、图片能力或官网发布通过。

操作员确认范围 → 实现原生离线回执和维护门禁 → 冻结验证代码 → 生成区域候选及签名 → 目标数据库备份/临时恢复 → 保存旧官网身份与暗态基线 → 原部署入口依次部署 COM/CN → 完整 VPS 验证及维护 GET 探针 → 保存维护结果。API/Worker/Web 重启可能短暂中断。

## 当前真相与 Owner

| 概念 | 唯一 owner | 调用者与消费者 |
| --- | --- | --- |
| 九项离线门禁与原生回执 | `scripts/qa04-offline-gate.mjs` | 原 QA04 CLI、维护验收；旧默认和 list 模式保持 |
| 维护类型、备份绑定、前后基线与只读验收 | `scripts/dark-maintenance-deployment.mjs` | 维护 CLI；仅消费已有候选签名、原生备份验证、完整 VPS 结果 |
| 签名、VPS 候选身份、暗态策略 | 既有 `verify-extension-release-signature.mjs`、shared `rel04-release-evidence.ts`、`verify-ai-media-dark-policy.mjs` | 维护入口复用，不修改正式发布合同 |
| 部署与恢复 | 既有 `deploy.sh`、`deploy-backup-gate.mjs`、`verify-deploy-backup.sh`、`verify-vps-deploy.sh` | 维护操作继续执行现有冻结源码、备份、migration、健康和回滚流程 |
| 来源与权限 | `ai-prompt-template-source.ts`、既有 source route 和 `requireSuperAdmin` | 只读两个 source；禁止模板列表的隐式初始化 |
| 正式发布拒绝边界 | REL04 parser、官网 CLI/API、能力候选 verifier | 仅补充维护证据拒绝用例；不接受新维护类型 |

当前 Git 基线 `4e6bd781` 已推送且 clean；源码 `55b426fb` 完整 offline gate 已通过。历史 QA04 和付费状态见 `../current-state-audit.md`，验收底线见 `../acceptance.md`，公开运维入口见 `../../docs/deployment.md`。新候选必须绑定新实现的精确 clean commit。

## 调研决策

- research_status: completed: 已直接比较原 QA04、REL04、官网消费者、备份 gate、source owner；独立只读审查已回收并由主 Agent 复核。
- 同类参考为本仓库已有签名/VPS/暗态及不可覆盖 artifact 机制，复用身份与持久化合同；不复制 REL04 的配对、refresh、DELETE 或 BYOK POST。
- 新入口不引入第三方 API、Provider、数据库或部署拓扑。当前公有 API 和 VPS 运行证据需在实际操作时刷新，不把历史健康记录当作新部署证据。
- 不改变付费价值、金额、预算、退款或权益；四次 Wanx 的 CNY 1 占位、质量拒绝与待结算状态继续保留。

## 范围与非目标

- 允许范围：原生 offline PASS 回执、独立维护 evidence/CLI、负例与对应运维说明、目标候选和签名准备、既有双区域维护部署及只读验收。
- 非目标：开启 AI/Media/BYOK/Ozon、生成或接收图片、创建模板或工作流、修改 schema/权限、官网 pointer 切换、受管扩展升级、Redis 拓扑与远端备份建设。
- 权限不变：模板 source 仍需超级管理员；匿名与普通 ADMIN 应被拒绝。源模板存在时校验发布/checksum/PASS 链；明确无发布记录时只标记来源不可用，通用 404 不能证明新路由可用。
- 官网保持要求：部署前后比较相同 commit、version、approval 摘要及 cloud/local 下载摘要；另一旧版本或丢失 pointer 都失败。

## 子阶段计划

| 子阶段 | 结果 | Owner | 完成标准 | 验证 | 不触碰 |
| --- | --- | --- | --- | --- | --- |
| MAINT-01 | 独立回执和维护门禁 | QA04/维护 owner | 正式消费者拒绝维护类型，探针不创建业务/设备状态 | T2 RED→GREEN；类型、lint、受影响回归 | 生产、开关和 schema |
| MAINT-02 | 冻结 clean commit 和区域候选 | 既有打包/签名 owner | 完整离线回执、双区域包和签名绑定同一目标 | 完整 QA04、候选/签名和隐私验证 | 官网 pointer 和真实生成 |
| MAINT-03 | 依次部署 COM/CN 并维护验收 | 既有部署/备份及维护 owner | 前一区域通过后进入后一区域，失败恢复原目录 | 当前备份/恢复、完整 VPS、旧官网身份和 source 语义 | 正式 QA、业务开关和商品数据 |
| MAINT-04 | 真实结果回写和阶段推送 | 本阶段与 current-state owner | 证据绑定且私有材料不入 Git | 字节摘要、Git、临时会话/恢复库清理和回执读回 | 历史证据、Provider 质量结论 |

## 测试、安全与影响

- D2：新维护合同与既有离线生产者必须闭合同一证据；沿用现有基础，不设计新的依赖拓扑。只读审查与实现可独立；每个文件只保留一个写入者。
- 本地实现按 T2：先验证缺失回执/错误类型、脏工作树、错 commit/区域/签名、未来或过期备份/VPS、指针漂移、模板权限/来源错误、非 GET/重定向/过大响应及凭据泄漏拒绝，再实现。
- T1：既有原生备份、发布、源模板 parser 的语义保持，先建立原门禁基线；T3：新候选、真实备份/恢复和两地只读路径，以新运行结果验证。
- 维护探针零业务写入与部署副作用分开记录；后者包含停服、备份/临时恢复及既有 migration 检查，不能称为整轮零写入。
- 每个子阶段通过对应验证后按明确文件提交，禁止混入 `.env`、私钥、生产原始回执、构建或浏览器 profile。

## 验证方法

先运行 QA04 producer 与维护 CLI 的真实文件/HTTP fixture 测试，再复核正式消费者拒绝、原备份/签名合同及类型/lint。最终以新 clean commit 运行完整 offline gate，分别验证区域候选；生产只通过现有冻结源码和备份恢复入口，保留新鲜完整 VPS 与维护 GET 回执。

## 停止条件与未验证

只访问批准区域的签名 origin；先验证冻结证据再读取凭据或发起请求；GET 白名单、15 秒超时、响应大小限制、拒绝重定向、脱敏摘要与不可覆盖的私有输出。备份绑定必须由原 verifier 对同一数据库/UUID/目标 commit 验证并保持默认 120 分钟时效。

任何错误候选/签名、失效备份、非暗态、官网身份改变、维护类型进入正式消费者、无法恢复原版本或新的迁移/停机/费用后果均停止相关操作。尚未验证：新门禁实现、签名候选、双区域新部署、真实只读 source；Provider 质量、账单最终性、QA-02/正式 QA-04 仍未完成。

## 阶段控制

- schema: sliver-stage/v2
- stage_id: dark-maintenance-deployment-2026-09
- primary_route: 开发执行
- operation: implement
- delivery_kind: implementation
- task_depth: D2
- materialization_trigger: ["cross_owner_drift"]
- risk_lanes: ["identity_permission", "privacy_secret_data", "resource_reliability", "supply_chain_config"]
- evidence_mode: test
- test_level: T2
- route_evidence_kind: null
- effect_class: local_reversible
- operational_mode: planned
- scope_authorization: confirmed: 用户引用完整维护提案后明确“批准 继续”，覆盖所列维护实现、候选及原部署范围。
- authorization_substage: MAINT-01
- product_decision: confirmed: 允许全暗态维护先于完整 QA-02/正式 QA-04，保持官网和功能关闭。
- active_substage: MAINT-01
- result_status: in_progress
- truth_writeback: pending
- migration_state: not_applicable
- evidence_refs: [dev-docs/current-state-audit.md, scripts/qa04-offline-gate.mjs, scripts/rel04-dark-canary.mjs]
