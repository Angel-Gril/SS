# SS ERP 接管与加固验收

## 验收门禁

| 门禁 | 需要的证据 | 状态 |
| --- | --- | --- |
| 当前状态审计 | `current-state-audit.md` 与当前 Git/命令一致 | 已确认 |
| 文档索引 | active、stale、public、internal 已区分 | 已确认 |
| agent 宪法 | `AGENTS.md` 绑定真实 owner 和命令 | 已确认 |
| owner map | `architecture.md` 记录当前与目标 owner | 已确认 |
| 启动基线 | local env 校验、DB/Redis、Web/API 首屏 | 部分：local env 校验已通过；本轮未重启 Web/API |
| Git 隐私 | `.env` 未跟踪，阶段按路径提交 | 已确认；远端 visibility 未验证 |
| AI 债务 | 超大 owner、静态 UI 合同、preflight 成本已分类 | 已确认 |
| 第一个安全任务 | 范围、owner、RED/GREEN 和停止条件明确 | 已确认 |

## 证据记录

- 文件路径：根 manifests、`apps/`、`extensions/`、Prisma、CI、公开 docs 和本目录。
- 命令：`pnpm typecheck` 通过；server tests `5136 passed / 223 skipped`；Web build 与 extension verifier 通过。
- 格式：lint `0 errors / 20 warnings`；`prisma format --check` 失败。
- 环境：先复现 local env 8 项失败；运行 bootstrap 后 `pnpm env:check -- --profile local --env .env` 为 0 failure。
- 供应链：npm 官方 audit 返回 43 个生产依赖漏洞，其中 24 高危；当前 npmmirror audit endpoint 不存在。
- 数据库证据：146 migrations，`prisma migrate status` 为 up to date；普通 suite 跳过 PostgreSQL integration。
- 未运行原因：未授权生产、Provider/Ozon 写入、远端 smoke、部署与真实浏览器控制。

## 第一个安全任务

- 任务目标：建立内部真源和阶段边界，使后续 P0 修复可以按独立 owner 验证、提交和回滚。
- 为什么足够小：只新增项目规则和内部文档，不改变产品、API、schema 或运行行为。
- 触碰 owner：`AGENTS.md`、`dev-docs/`。
- 不触碰内容：用户当前验证码/CDP 改动、公开文档、生产状态和凭据。
- 验证方法：adoption/constitution/stage guardrail、链接与 diff 检查。
- 停止条件：guardrail 发现占位、owner 冲突、私密内容或当前用户改动混入 staged scope。

## 分层完成标准

- 阶段 1：内部真源 guardrail 通过；当前 local env 校验可复现或有明确修复入口。
- 阶段 2：固定 seed 凭据删除；cloud/production 禁止 Noop Redis；所有用户 URL 图片读取统一受限；负例测试通过。
- 阶段 3：高危生产依赖修复或显式阻断；CI audit 可执行且阻断；关键 PostgreSQL integration 有隔离 runner；schema format 检查通过。
- 阶段 4：至少一个高冲突 owner 完成无行为变化的渐进拆分；Web 真实浏览器最小 smoke 有可执行入口；lint 本轮不新增 warning。

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
