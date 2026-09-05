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
- authorization_substage: stage-3-supply-chain-ci-data-gates
- product_decision: confirmed: 保持现有产品行为和技术/部署组合，执行局部加固；生产与真实外部写入不在范围内
- active_substage: stage-3-supply-chain-ci-data-gates
- result_status: completed
- truth_writeback: complete
- migration_state: not_applicable
- evidence_refs: ["pnpm audit --registry=https://registry.npmjs.org --audit-level=high --prod: 0 high, 2 moderate, 2 low", "node --test scripts/ci-supply-chain-gates.test.mjs scripts/vps-origin-mode-contract.test.mjs: 15 passed, 1 skipped", "pnpm --filter server test:logistics:postgres: 12 files, 103 passed", "pnpm --filter server test: 391 files passed, 5154 tests passed, 223 skipped", "pnpm typecheck: passed", "pnpm lint: 0 errors, 20 existing warnings", "pnpm --filter server exec prisma validate && prisma format --check: passed", "pnpm --filter server build: passed", "pnpm --filter web build: passed"]

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

## 实施回写

本节随 active_substage 收尾更新；结构通过不替代真实命令证据。

- actual_result: stage-3-supply-chain-ci-data-gates 已完成；直接依赖与传递依赖高危项已收敛到 0 high，CI audit/Semgrep/Prisma/integration gate 已改为阻断式，物流 PostgreSQL runner 在随机隔离 schema 中完整 replay 146 migrations 并通过 12 个文件 103 tests，schema 已格式化。
- changed_owners: `apps/server/package.json`、`apps/web/package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`.github/workflows/ci.yml`、`apps/server/scripts/logistics-postgres-integration.mjs`、`scripts/ci-supply-chain-gates.test.mjs`、`apps/server/prisma/schema.prisma`、Fastify trustProxy/Sharp 类型适配和 `source-listing-workflow.postgres.integration.test.ts` fixture。
- plan_deviation: PostgreSQL integration fixture 原先缺少当前强制的 Ozon import readiness contract，首次 runner 2 tests 失败；按现有单元测试 owner 补齐完整 category/copy/media/pricing/readiness 流程，并把 revision 断言改为数据库不变量 `revision rows === current revision`，第三次 runner 全绿。未修改生产 schema/migration。
- fresh_evidence: official npm audit 0 high（2 moderate/2 low）；CI/VPS contract 15 passed/1 skipped；server 391 files/5154 passed/223 skipped；logistics PostgreSQL 12 files/103 passed；typecheck/build/web build/Prisma validate+format 均通过；lint 0 errors、20 个既有 warnings。
- remaining_risk: 2 个 moderate 与 2 个 low 传递依赖公告仍待上游修复或后续专门评估；20 个 lint warnings 未在本阶段扩大处理；Semgrep 由 CI 阻断但本地未执行；真实浏览器全流程、线上健康、真实 Provider/Ozon、生产部署和公开仓库隐私仍未验证。
- next_substage: stage-4-maintainability-browser-quality
- git_checkpoint: stage-3 已通过 closeout；随后以单一目的 commit 提交并 push 当前分支，commit hash 在交付回执中记录。
