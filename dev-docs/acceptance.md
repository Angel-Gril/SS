# SS ERP 接管与加固验收

## 验收门禁

| 门禁 | 需要的证据 | 状态 |
| --- | --- | --- |
| 当前状态审计 | `current-state-audit.md` 与当前 Git/命令一致 | 已确认 |
| 文档索引 | active、stale、public、internal 已区分 | 已确认 |
| agent 宪法 | `AGENTS.md` 绑定真实 owner 和命令 | 已确认 |
| owner map | `architecture.md` 记录当前与目标 owner | 已确认 |
| 启动基线 | local env 校验、DB/Redis、Web/API 首屏 | 部分：local env 校验与本地 Redis/Chrome CDP Web smoke 已通过；本轮未重启完整 API/Worker |
| Git 隐私 | `.env` 未跟踪，阶段按路径提交 | 已确认；远端 visibility 未验证 |
| AI 债务 | 超大 owner、静态 UI 合同、preflight 成本已分类 | 已确认 |
| 第一个安全任务 | 范围、owner、RED/GREEN 和停止条件明确 | 已确认 |

## 证据记录

- 文件路径：根 manifests、`apps/`、`extensions/`、Prisma、CI、公开 docs 和本目录。
- 命令：`pnpm typecheck`、server typecheck、server build、Web build 通过；server tests `5160 passed / 223 skipped`；扩展 CDP 合同 29 条通过。
- 格式：server lint `0 errors / 0 warnings`；Prisma `validate` 与 `format --check` 通过。
- 环境：先复现 local env 8 项失败；运行 bootstrap 后 `pnpm env:check -- --profile local --env .env` 为 0 failure。
- 供应链：npm 官方 audit 已降为 `0 high`，剩余 `2 moderate / 2 low`；CI audit/Semgrep 为阻断门。
- 数据库证据：146 migrations；隔离 PostgreSQL runner replay 全部迁移并通过 103 个物流/设备/来源/发布测试；普通 suite 的 PostgreSQL 文件按显式 runner 执行。
- 已运行本地 Chrome CDP `/login` smoke；未运行远端/生产 smoke、Provider/Ozon 写入、部署和扩展 live worker smoke，因为这些仍需独立环境/授权。

## 第一个安全任务

- 任务目标：建立内部真源和阶段边界，使后续 P0 修复可以按独立 owner 验证、提交和回滚。
- 为什么足够小：只新增项目规则和内部文档，不改变产品、API、schema 或运行行为。
- 触碰 owner：`AGENTS.md`、`dev-docs/`。
- 不触碰内容：用户当前验证码/CDP 改动、公开文档、生产状态和凭据。
- 验证方法：adoption/constitution/stage guardrail、链接与 diff 检查。
- 停止条件：guardrail 发现占位、owner 冲突、私密内容或当前用户改动混入 staged scope。

## 分层完成标准

- 阶段 1：已完成，内部真源 guardrail 与 local env 校验通过。
- 阶段 2：已完成。固定 seed 凭据删除；cloud/production 禁止 Noop Redis；水印/上传/缩放 URL 统一受公网或受控本地 reader 限制；负例与全量后端回归通过。
- 阶段 3：已完成，高危生产依赖已降为 0 high 并阻断，CI audit 可执行且阻断，关键 PostgreSQL integration 有隔离 runner，schema format 检查通过。
- 阶段 4：已完成，`collect.ts` 标题 owner 已拆分；本地 Chrome CDP Web 最小 smoke 通过。
- 阶段 5：已完成，Redis 上传限流原子化、故障失败关闭、生产审计默认开启，支付配置/人工充值审计覆盖已补齐。
- 阶段 6：已完成，server lint 为 0 errors / 0 warnings。

## 当前发布边界

- 当前结果：`可继续开发`，不是 `可发布`。
- 本地代码、CI、隔离数据库和 server/Web 构建证据已收口。
- 生产部署、真实 Provider/Ozon、线上健康、Redis 集群与外部告警、完整浏览器回归仍未验证。

## 停止条件

- 接管完成条件：adoption 与 constitution guardrail 通过，owner/验证/阶段真相可由后续 Agent 直接消费。
- 不能继续开发的条件：P0 负例无法先 RED、owner 不清、测试与代码事实冲突，或不能隔离用户现有改动。
- 必须问用户的条件：需要产品行为改变、生产访问、真实费用、凭据、数据迁移、停机、公开发布或删除旧接口/文档。
- 不能发布的条件：高危供应链门禁失败、集成测试/构建未完成、Git scope 不清、生产/浏览器/Provider/Ozon 证据缺失。

## 漂移检查

- 是否把现有项目当空项目重写：否，沿用当前组合与 owner。
- 是否跳过了内部真源：否，本目录为当前索引。
- 是否无确认改写了宪法或文档结构：否，用户明确要求按审计流程实施。
- 是否保留了旧概念污染当前主线：历史计划保留但不作为当前状态 owner。
- 是否出现多个 owner：未发现新的重复 owner；后续拆分必须保持薄 route/adapter。
- 是否用测试通过冒充用户验收或发布准备：否，生产、浏览器、Provider/Ozon 与发布均标记未验证。
