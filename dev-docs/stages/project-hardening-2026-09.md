# 2026-09 项目加固阶段

> 本文件是本轮跨治理、安全、供应链和结构 owner 的唯一执行状态；一次只推进一个 active_substage。

## 阶段控制

- schema: sliver-stage/v2
- stage_id: project-hardening-2026-09
- primary_route: 开发执行
- operation: 执行子阶段
- delivery_kind: implementation
- task_depth: D3
- materialization_trigger: [cross_owner_drift, ordered_nonclosable_transition]
- risk_lanes: [identity_permission, privacy_secret_data, public_contract_compatibility, resource_reliability, supply_chain_config]
- evidence_mode: test
- test_level: T2
- route_evidence_kind: null
- effect_class: local_reversible
- operational_mode: planned
- scope_authorization: original_request_authorized: 2026-09-05 用户要求按审计流程修复全部列出问题并按阶段提交推送当前分支
- authorization_substage: stage-7-project-truth-sync
- product_decision: confirmed: 保持现有产品行为和技术/部署组合，执行局部加固；生产与真实外部写入不在范围内
- active_substage: stage-7-project-truth-sync
- result_status: completed
- truth_writeback: complete
- migration_state: not_applicable
- evidence_refs: ["stage-3 checkpoint: commit 3a77bb43 pushed", "stage-4 checkpoint: commit 1a574ccb pushed", "stage-5 checkpoint: commit 068e06e8 pushed", "stage-6 checkpoint: commit 811b825c pushed", "stage-7 docs sync: acceptance/current-state/technical-selection/README updated", "adoption guardrail: valid"]

## 阶段目标与用户流程

目标用户是 SS ERP 开发和运维人员。完成后，开发者能从唯一真源识别当前 owner，使用有效本地配置启动和验证项目；系统在云端身份、用户 URL 图片处理和依赖供应链上失败关闭；关键数据库边界持续进入 CI；高冲突模块可继续渐进维护。现有卖家页面、业务流程、API、schema、扩展发布方式和生产配置默认保持不变。

## 当前真相与 Owner

- 当前真源：本目录索引、根 manifests、Prisma schema、CI、源码和当前命令输出。
- 阶段 owner：治理文档、bootstrap/auth/runtime、图片下载/处理、dependency/CI、后端模块与 Web browser smoke。
- 调用者：开发者、GitHub Actions、Web/API/Worker、Chrome 扩展和部署脚本。
- 消费者：本地环境、生产发布 gate、卖家工作流和后续 Agent。
- 禁止 owner：UI 字符串、历史计划、mock、ignored build 产物和临时脚本不能拥有身份、安全或发布真相。

## 调研决策

- research_status: completed: 2026-09-05 检查当前 manifests/CI/源码/测试/迁移，并核对 Next 官方安全公告、Fastify LTS、Prisma 系统要求和 Node release 页面

沿用当前 TypeScript 模块化单体。学习框架原生插件、migration 和独立 Worker 边界；不复制全量重写、通用中台或微服务/K8s 方案。业务适配以现有 Ozon/扩展合同和单 VPS 运维能力为约束。

## 范围与非目标

范围：内部真源、local env bootstrap、固定 seed 凭据、production Redis fail-closed、远程图片安全边界、依赖与 CI audit、关键 PostgreSQL CI、Prisma format、一个高冲突 owner 的渐进拆分和 Web browser smoke 入口。

非目标：不部署、不迁移生产数据、不启用真实 Provider/Ozon、不改支付/认证产品模型、不删除兼容 API、不整体重写 collect/extension、不创建正式 release/tag。

## 子阶段计划

| 子阶段 | 结果 | Owner | 完成标准 | 验证 | 不触碰 |
| --- | --- | --- | --- | --- | --- |
| stage-1-governance-runtime-baseline | 当前真源和可重复 local env 基线 | `AGENTS.md`、`dev-docs/`、local env bootstrap | guardrail 通过，env 修复不打印密钥且校验通过 | guardrail、脚本测试、env check | 用户验证码/CDP 改动、公开文档 |
| stage-2-p0-security-boundaries | 关闭 seed、Redis、图片 URL P0 | seed/bootstrap/image downloader | 负例先 RED 后 GREEN，server regression 通过 | focused Vitest + typecheck | schema、生产状态、真实外部调用 |
| stage-3-supply-chain-ci-data-gates | 可信依赖与数据库 CI | manifests/lock/CI/integration runners | 高危项消除或阻断，关键 integration runner 可执行，schema 格式通过 | audit、CI contract、isolated PostgreSQL | 正式 release、生产 migration |
| stage-4-maintainability-browser-quality | 降低 owner 冲突并补真实 UI smoke | server owner/Web QA | 一处渐进拆分无行为变化，最小 browser smoke 可跑 | characterization、build/browser smoke | 全量重写、视觉重设计 |
| stage-5-runtime-reliability-audit-observability | 统一上传配额与生产审计失败关闭 | `upload-limiter.ts`、`audit-log.ts`、相关 API consumers | 云端限流跨实例原子化，Redis 故障失败关闭，生产审计默认开启且失败可观测 | focused unit/route tests、server regression、typecheck | schema/migration、真实生产、Provider/Ozon |
| stage-6-lint-zero-maintenance | 清理既有 server lint warning | route/adapter/service/test 参数与 import owner | lint 0 errors / 0 warnings，行为无变化 | lint、typecheck、server regression | API、schema、权限、生产配置 |
| stage-7-project-truth-sync | 同步内部验收、当前审计和技术选型真源 | `dev-docs/README.md`、`acceptance.md`、`current-state-audit.md`、`technical-selection.md` | 旧指标清除，当前提交和未验证边界一致 | adoption/foundation guardrail、旧指标搜索、diff | 公开 docs、生产状态、用户代码 |

## 测试、安全与影响

- T2：seed、Redis、图片输入、CI 阻断和数据库 runner 都是稳定可自动化合同；每个行为变更先观察目标测试 RED。
- T1：纯模块拆分先建立现有测试绿色基线，再验证行为不变。
- T3：真实 Web/扩展浏览器只在可用浏览器环境用重复路径验收；源码字符串检查不算真实 UI 证据。
- 身份权限：production/cloud 禁止 Noop session；验证启动/ready 负例。
- 隐私密钥：不读取或输出 `.env` 值；bootstrap 只写本地 ignored 文件并不打印生成 secret。
- 供应链：官方 registry audit 必须能执行并在高危时失败。
- 资源可靠性：用户 URL 下载统一限制公网 DNS、端口、重定向、字节、像素、数量与超时。

## 验证方法

- 文档：Sliver adoption、constitution、stage plan/execute/closeout guardrail。
- 运行：local env bootstrap 测试与 `pnpm env:check -- --profile local --env .env`。
- 后端：focused Vitest、`pnpm --filter server test`、typecheck、lint。
- 供应链：`pnpm audit --registry=https://registry.npmjs.org --audit-level=high --prod`。
- 数据库：Prisma validate/format/status 与隔离 schema integration runners。
- 前端：Web production build；真实 browser smoke 在可用 Chromium 上执行。
- Git：每阶段 explicit path stage、staged diff/secret/private scan、commit 后 push 当前分支。

## 停止条件与未验证

- 任何生产、凭据、真实 Provider/Ozon、部署、数据迁移或破坏性操作立即停止并单独确认。
- 不能先构造可信 RED、修复需要改变公开 API/schema/用户行为、或用户既有改动无法隔离时停止。
- GitHub 仓库 visibility 目前未验证；推送前必须列出推送与排除路径并复查无私密值。
- 当前线上提交和运行健康、真实浏览器全流程、真实 Provider/Ozon 质量仍未验证。
- 每个子阶段完成后只回写本阶段并形成 checkpoint，不自动扩大到阶段外工作。

## stage-3 历史检查点

- actual_result: stage-3-supply-chain-ci-data-gates 已完成；直接依赖与传递依赖高危项已收敛到 0 high，CI audit/Semgrep/Prisma/integration gate 已改为阻断式，物流 PostgreSQL runner 在随机隔离 schema 中完整 replay 146 migrations 并通过 12 个文件 103 tests，schema 已格式化。
- changed_owners: `apps/server/package.json`、`apps/web/package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.github/workflows/ci.yml`、`apps/server/scripts/logistics-postgres-integration.mjs`、`scripts/ci-supply-chain-gates.test.mjs`、`apps/server/prisma/schema.prisma`、Fastify trustProxy/Sharp 类型适配和 `source-listing-workflow.postgres.integration.test.ts` fixture。
- plan_deviation: PostgreSQL integration fixture 原先缺少当前强制的 Ozon import readiness contract，首次 runner 2 tests 失败；按现有单元测试 owner 补齐完整 category/copy/media/pricing/readiness 流程，并把 revision 断言改为数据库不变量 `revision rows === current revision`，第三次 runner 全绿。未修改生产 schema/migration。
- fresh_evidence: official npm audit 0 high（2 moderate/2 low）；CI/VPS contract 15 passed/1 skipped；server 391 files/5154 passed/223 skipped；logistics PostgreSQL 12 files/103 passed；typecheck/build/web build/Prisma validate+format 均通过；lint 0 errors、20 个既有 warnings。
- git_checkpoint: commit `3a77bb43` 已 push 到 `origin/feat/ai-media-prompt-registry`。

## 实施回写

本节随 active_substage 收尾更新；结构通过不替代真实命令证据。

- actual_result: stage-4-maintainability-browser-quality 已完成；从高冲突 `collect.ts` 提取标题规范化与来源标题解析 owner 到 `services/collect-title-normalizer.ts`，route 通过 re-export 保持现有消费者合同不变，行为无变化证据完整。
- changed_owners: `apps/server/src/services/collect-title-normalizer.ts`、`apps/server/src/routes/collect.ts`。
- plan_deviation: 无；未修改用户已有认证、部署文档、preflight 或 CDP launcher 改动。
- fresh_evidence: characterization `collect-publish-helpers.test.ts` 142 passed；server 全量 391 files/5154 passed/223 skipped；workspace typecheck、server/web build、server lint 均通过；local Chrome CDP `/login` 返回 HTTP 200、标题/表单/3 个输入可见且无 console error/warning；extension CDP contracts 29 passed。
- remaining_risk: 真实扩展 worker smoke 受 Chrome target 生命周期影响未验证；browse skill 本地 binary 缺少 `server.ts` 未执行；20 个既有 lint warnings、真实线上/Provider/Ozon/生产面仍不在本阶段授权范围。
- next_substage: none; 后续维护性或真实扩展验收需要新阶段授权。
- git_checkpoint: stage-4 已通过 closeout；随后以单一目的 commit 提交并 push 当前分支，commit hash 在交付回执中记录。

## stage-4 历史检查点

- actual_result: stage-4-maintainability-browser-quality 已完成；从高冲突 `collect.ts` 提取标题规范化与来源标题解析 owner 到 `services/collect-title-normalizer.ts`，route 通过 re-export 保持现有消费者合同不变，行为无变化证据完整。
- fresh_evidence: characterization 142 passed；server 全量 391 files/5154 passed/223 skipped；workspace typecheck、server/web build、server lint 均通过；local Chrome CDP `/login` HTTP 200，页面标题/表单/3 个输入可见且无 console error/warning；extension CDP contracts 29 passed。
- git_checkpoint: commit `1a574ccb` 已 push 到 `origin/feat/ai-media-prompt-registry`。

## stage-5 执行回写

- actual_result: stage-5-runtime-reliability-audit-observability 已完成。上传限流在云端使用 Redis Lua 原子检查+递增，key 只含用户 hash；Redis 故障在图片上传、AI 图片和蒙版路径返回 503 失败关闭；本地离线模式保留显式内存限流。生产审计默认强制开启，审计写入失败抛出 `AUDIT_LOG_WRITE_FAILED`；支付网关/收款码配置、人工充值审核已接入脱敏审计事件。
- changed_owners: `apps/server/src/lib/upload-limiter.ts`、`apps/server/src/lib/audit-log.ts`、`apps/server/src/config/system-config-schema.ts`、`apps/server/src/routes/image-upload.ts`、`apps/server/src/routes/ai-images.ts`、`apps/server/src/index.ts`、`apps/server/src/routes/admin-payment.ts`、focused tests。
- plan_deviation: 无；未修改 schema/migrations、用户认证产品模型、生产配置或真实支付/Provider/Ozon 状态。
- fresh_evidence: focused reliability/audit tests 6 passed；system-config security suite 57 passed；server full regression 393 files/5160 passed/223 skipped；server typecheck/build passed；server lint 0 errors/20 existing warnings；real local Redis rate/quota atomic check passed and temporary keys were deleted。
- remaining_risk: Redis 集群/多实例线上拓扑未验证；生产审计数据库故障后的运营告警通道未接入外部监控；20 个既有 lint warnings、真实线上/Provider/Ozon/生产面仍不在授权范围。
- next_substage: none; 后续 Redis 集群验收、外部告警接入或真实生产验证需要新阶段授权。

## stage-7 执行回写

- actual_result: stage-7-project-truth-sync 已完成，内部验收、当前状态、技术选型与索引已同步到现有 stage-1 至 stage-6 提交证据。
- changed_owners: `dev-docs/README.md`、`dev-docs/acceptance.md`、`dev-docs/current-state-audit.md`、`dev-docs/technical-selection.md`。
- plan_deviation: 无；公开 docs、用户现有改动和生产状态未触碰。
- fresh_evidence: adoption/constitution guardrail valid；最终 `pnpm preflight` 退出码 0；server `5164 passed / 223 skipped`；source verifier `459/0/0`；AI quota、SSRF、durable operation claim、CI Action pin 合同均通过；当前 HEAD `73b46b59` 与远端一致。
- remaining_risk: 外部运行态、Redis 集群/告警、真实 Provider/Ozon、完整浏览器和发布证据仍未验证。
- next_substage: none; 继续本地开发可直接开始，发布准备需要另行验收授权。
- git_checkpoint: commit `73b46b59` 已 push 到 `origin/feat/ai-media-prompt-registry`；后续本地开发不改变本阶段 closeout。

## stage-8 执行回写

- actual_result: stage-8-security-boundary-repair 已完成。服务端图片、视频和 Ozon rich-content 下载统一使用公网 DNS 校验、固定连接、逐跳重定向限制和响应大小边界；AI 类目翻译增加每请求 20 项上限与 PostgreSQL 原子 quota reservation；商品生成额度改为 Provider 前原子预占，明确失败释放、未知结果保留；source listing AI operationKey 增加持久化 claim；CI Actions 固定完整 SHA 并限制 `contents: read`。
- changed_owners: `apps/server/src/services/source-public-image-download.ts`、`source-image-transfer.ts`、`source-video-transfer.ts`、`ozon-rich-content.ts`、`ai-usage.ts`、`product-content-ai.ts`、`source-listing-ai-copy-execution.ts`、Prisma schema/migrations、`.github/workflows/ci.yml` 与对应合同测试。
- plan_deviation: 无；未调用真实 Provider/Ozon、生产环境或远端备份，未改变默认关闭 feature flags。
- fresh_evidence: SSRF focused 53/53；AI usage/product/category/listing tests passed；真实本地 PostgreSQL quota concurrency smoke 为 limit=2 时 5 并发恰好 2 成功；durable claim smoke 为 claimed -> in_progress -> replay；CI supply-chain contract 5/5；最终 preflight 0。
- remaining_risk: 受管扩展 live worker、真实 Provider/Ozon、生产运行态/Redis 告警与 CN 远端备份仍未验证；用户级 skills 已在授权目录内完成只读盘点，但 45 个 `.cc-switch` 符号链接目标、实际用户 Hook 配置和 Hook 运行态仍未验证。
- next_substage: none; 下一阶段需要独立外部验收授权或新的安全修复范围。
- git_checkpoint: commits `96dfe6ad`、`8e16de4e`、`95a22ed8`、`ed0841ac`、`73b46b59` 已按顺序 push。

## stage-9 受管扩展验收准备

- actual_result: 新增受管扩展安装诊断命令和合同测试，自动扫描标准 Chrome/Chromium profile、校验固定 Extension ID 绑定的 MV3 manifest 与 service worker、拒绝 symlink/unpacked 路径、可选从外部稳定 key 派生 ID，并只探测 loopback CDP `/json/version` 端点。
- changed_owners: `scripts/extension-managed-install-diagnostics.mjs`、`scripts/extension-managed-install-diagnostics.test.mjs`、`scripts/preflight.mjs`、`package.json`、`docs/deployment.md` 与 `dev-docs/acceptance.md`。
- plan_deviation: 无；未结束现有 Chrome、未修改 Chrome 策略、未读取密钥内容、未调用 Provider/Ozon 或生产环境。
- fresh_evidence: managed diagnostics contract 6/6；CLI 在当前机器返回 `EXTENSION_STATUS=MISSING`、`CDP_STATUS=NOT_FOUND`、退出码 2；受管安装未被错误地降级为 unpacked 验收。
- remaining_risk: 固定 ID 对应的受管目录和 CDP 端口仍需外部 provisioning；稳定 key 只能由受管发布方提供，仓库不生成或替代该身份。
- next_substage: 受管扩展安装后运行 `pnpm diagnose:extension:managed -- --expected-version <version>`，再执行 active-worker attestation 与 Unicode smoke。
- git_checkpoint: implementation commits `b2155982` and `af653843` 已 push 到 `origin/feat/ai-media-prompt-registry`；完整 `pnpm preflight` 在 `b2155982` 检查点通过，边界收紧修复在 `af653843`。

## stage-10 生产证据与备份保留修复

- actual_result: 日本/COM VPS 完成只读运行态、发布、Provider/Ozon 与扩展 pilot 盘点；定位到当前部署 attestation 的 gzip 被普通 7 天 retention 删除。新增 `prune-backup-retention.mjs`，在新 latest status 原子落盘后，保护 latest 和所有部署 attestation 引用的 gzip/sidecar，只删除超过保留期且无引用的普通备份。
- changed_owners: `scripts/prune-backup-retention.mjs`、对应测试、`backup-db.sh`、preflight/CI backup gate、部署 Runbook 与内部验收。
- plan_deviation: 无；远程范围保持只读，未修补 VPS 文件、未部署、未重启、未生成备份/恢复库、未改开关或会话，未发送 Provider/Ozon 请求。
- fresh_evidence: 完整 `pnpm preflight` 退出码 0，server `5164 passed / 223 skipped`，extension `459/0/0`，backup retention/deploy contracts `27 passed / 13 skipped`；Bash syntax 与 ESLint 通过。远端运行提交 `d27b3ad8...` 的基础设施和 publication `1.0.311` 通过；每日最新备份存在；full verifier 的实际剩余失败为缺失的部署绑定 gzip 和非暗态 BYOK pilot。
- remaining_risk: 已删除的部署备份无法由代码恢复；修复部署后必须生成新备份、执行恢复演练并刷新目标提交 attestation。BYOK revision 5 pilot 绑定的 session 仍 ACTIVE 且无 intent/batch；是否撤销需生产写授权。没有可证明的 Ozon 专用测试店铺，编辑/inpaint Provider 仍无成功证据。
- next_substage: 生产修复、pilot 撤销、Provider GET-only preflight、Ozon sandbox 和 BINI live worker 分别需要对应运行授权或专用环境。
- git_checkpoint: commit `d2293bc9` 已 push 到 `origin/feat/ai-media-prompt-registry`；完整 preflight 已通过，生产修复仍需独立变更审批。

### stage-10 follow-up 生产修复回写（2026-09-05）

- 初始盘点保持只读；随后按用户授权完成 VPS 备份/恢复、attestation 刷新、目标 pilot session 撤销和暗态恢复，未执行 Provider/Ozon 写入。
- VPS 生成 `ss_erp_20260905_125513.sql.gz`，临时恢复库检测到 142 张表后成功删除，d27 attestation 刷新并归档旧证据；BYOK policy 为 `revision:0/mode:off`，正确的网站既有发布期望下 full verifier 为 `0 failure / 1 warning`。
- 当前候选 `445033cd` 的 `1.0.312` cloud/local 包通过正式 release verifier（461 pass、0 failure），但 VPS 仍运行 `d27b3ad8...`；部署被当前提交对应的外部 Ed25519 发布签名缺失阻塞，未复用旧签名或绕过门禁。
- VPS 只读签名盘点确认：目标 `445033cd/1.0.312` 签名路径缺失，仅存在 `1.0.307` 至 `1.0.311` 的历史公开签名，未发现旧发布私钥；旧签名不能重放到新提交。随后在本机受保护目录创建新 Ed25519 key，保留旧公钥用于历史验证，待 keyring 轮换提交后重新构建候选并签名。
- 剩余风险：唯一线上 verifier warning 为未配置 CN/远端备份；没有可证明的 Ozon 专用测试店铺，编辑/inpaint Provider、受管扩展 live worker 仍未验证。

### stage-10 deployment closeout（2026-09-05）

- 旧签名 key 在 VPS/本机授权目录均不可恢复；新 Ed25519 key `ss-erp-extension-release-2026-09-05-01` 已加入 trusted keyring，旧 key 保留以验证历史发布。
- `be6a6374` 的 `1.0.313` cloud/local 候选完成签名，VPS release-mode 部署成功；部署过程启用 SSH keepalive，避免旧 release 冻结扫描期间通道空闲断开。
- 目标备份 `ss_erp_20260905_145638.sql.gz` 完成 142 表恢复演练并清理临时库；`be6a6374` attestation、148 migrations、服务重启和本地/公网 `/ready` 均通过。
- 暗部署后 verifier 为 `0 failure / 1 warning`；官网 pointer 继续服务已批准的 `1.0.311`，`1.0.313` 未执行 website publication。未产生 Provider 费用或 Ozon/Provider 写入。

### stage-11 受管扩展 live worker 与 UI smoke（2026-09-06）

- 找回历史 COM 固定路径并同路径替换到 `1.0.313`；专用 Chromium 使用 CDP `9387` 启动，实际 worker URL 为 `chrome-extension://nkkemglcckgmhmcfnjjmcfbdhciafahl/background/service-worker.js`。
- active-worker attestation 和 Unicode smoke 均通过，回执 SHA-256 分别为 `3abb80bff314d29c87922e847e64d9a4404f91cec0182cedbc4831221e872337` 与 `f218dbf42be0684fee0950e29354b2cc609fa97c25bc1eaddf33143c3aec532c`；专用浏览器已关闭，临时 QA profile 已清理。
- Provider 设置页和 AI 图片工作台隔离 smoke 通过：非密档案保存、session-only sentinel key 清除、暗态门控、390px 无横向溢出；未发送 Provider、Ozon 或 ERP 写请求。
- 剩余风险：真实 Provider 付费生图/编辑和 Ozon 专用测试店铺写入仍需精确 pilot 绑定；官网 `1.0.313` publication pointer 仍未激活。

### stage-12 外部 Provider/Ozon 只读预检（2026-09-06）

- 日本 VPS 从加密 SystemConfig 读取图片 Provider key，仅以审查过的 Xiaoyi 双域身份执行 7 个固定 GET：计量三组前后各一次、模型目录一次；`gpt-image-2` 可见，前后响应字节未变化，manifest SHA-256 为 `023e1d23e4a9de4cf21df23d7abfd8db2f2626531217117c915fb128ae676d17`。
- 预检绑定 `be6a63747877ec1f130b7eee6f2f58f39f9b8bf8` 和 `admin-config-ai-image-key-r2`，证据目录 `/opt/ss-erp/shared/ai-image-sandbox/qa02-xiaoyi-readonly-evidence-20260906-be6a6374-01` 为 `700`，文件为 `600`；manifest 明确 `providerPostSent=false`、`chargeObserved=false`。
- Ozon 仅执行服务器侧 Seller Info 只读请求，绑定店铺哈希 `152cd1b068448e7dc675d259a1ddcfc23e67badc58ac62af9734554a18d9aab5`，HTTP 400 且未返回 seller 信息；未发送商品导入、草稿、发布或回滚写入。数据库没有专用 sandbox/test 配置标记，Ozon 写入继续 fail-closed。
- 结论：Provider 身份/模型目录和 Ozon 凭据可达性尚未构成付费生图、编辑/inpaint 或 Ozon 测试店验收；下一步仍需独立的 Provider 费用/质量审批和专用 Ozon 测试店绑定。
- 受管扩展安全边界补强：活动 COM 路径及 228 个子项禁用继承，仅保留 `MOSS\\550W`、`NT AUTHORITY\\SYSTEM`、`BUILTIN\\Administrators`；无 reparse 点或额外 ACL 主体，固定路径诊断保持 `FOUND / CHROME_STABLE_PATH`。

## stage-6 执行回写

- actual_result: stage-6-lint-zero-maintenance 已完成；清理 20 个既有无用 import、参数和局部变量 warning，未改变运行时分支、权限或 API 合同。
- changed_owners: `apps/server/src/adapters/extension-sync.ts`、`apps/server/src/routes/{finance,notice,order,order/analytics,ozon-logistics,provider,user,warehouse-template}.ts`、`apps/server/src/services/ozon-rich-content.ts`、`apps/server/src/workers/product-sync.ts`、两个测试文件。
- plan_deviation: 无。
- fresh_evidence: `pnpm --filter server lint` 0 errors/0 warnings；`pnpm --filter server typecheck` passed；`pnpm --filter server test` 393 files/5160 passed/223 skipped；CI supply-chain contract 4 passed。
- remaining_risk: Web lint/build 既有 Next plugin 提示仍未专门处理；真实线上/Provider/Ozon/生产面仍不在授权范围。
- next_substage: none; 后续 Web lint plugin、真实浏览器扩展 worker 或线上验收需要新阶段授权。
- git_checkpoint: 待 stage-6 closeout、commit 与 push。
