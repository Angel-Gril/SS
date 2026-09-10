# SS ERP 架构真源

本文件只记录当前宏观结构与 owner。选择理由和外部证据见 `technical-selection.md`。

## 当前架构

- technical_selection_source: `technical-selection.md`
- foundation_decision_status: implementation_ready
- 当前产品形态：Web ERP + Fastify API/Worker + Chrome MV3 扩展。
- 当前实施组合：Next.js/React/TypeScript、Fastify、Prisma/PostgreSQL、Redis/BullMQ、对象存储。
- 当前部署形态：单 VPS 上 Web/API/Worker 分进程，Nginx 入口；PostgreSQL/Redis 可同机或外部托管。
- 主运行时和语言：Node.js 22、TypeScript；扩展为原生 JavaScript MV3。
- 代码与部署根目录：仓库根 `D:/AI Agent/Work/QE/SS ERP`，生产路径由部署 runbook 绑定具体 commit。

## 进程与部署结构

| Process Or Deployable | Current Responsibility | Runtime | Communication | Data Or Secret Boundary | Start And Health Evidence |
| --- | --- | --- | --- | --- | --- |
| Web | 页面、交互和 BFF 外的 API 消费 | Next.js 15 / Node 22 | HTTPS 到 Fastify | 不持有 Ozon、短信、对象存储私钥 | `pnpm --filter web build` |
| API | 鉴权、权限、业务规则、配置、上传和外部 adapter 装配 | Fastify 5 / Node 22 | HTTP、Prisma、Redis、Provider API | 服务端密钥和租户上下文 | `/health`、`/ready`、server tests |
| Worker | 同步、发布、清理、备份和 AI 作业 | BullMQ / Node 22 | Redis queue + PostgreSQL ledger | 后台凭据与幂等/对账状态 | `start:worker` 与 worker tests |
| PostgreSQL | 持久业务、审计、状态机和账本真相 | PostgreSQL 16 | Prisma/SQL | 租户、订单、支付、Provider 证据 | Prisma validate/status/migration tests |
| Redis | 会话、队列、短期配额和协调 | Redis 7 | ioredis/BullMQ | 会话有效性和分布式临时状态 | `/ready` Redis check |
| Extension | 页面证据采集、受控用户操作和本地工作台 | Chrome MV3 | ERP API + page/content bridge | 设备凭据；不得持有服务端 Ozon/AI 密钥 | extension verifier/contract/browser evidence |

## Owner Map

| Concept | Current Owner | Target Owner | Public Contract | Forbidden Owner | Repair Or Keep |
| --- | --- | --- | --- | --- | --- |
| 产品边界 | `docs/PROJECT-OVERVIEW.md` | 同左 | README/docs index | 历史计划和聊天 | keep |
| 内部阶段状态 | `dev-docs/stages/` | 同左 | `sliver-stage/v2` | 公开部署日志 | materialize |
| 前端路由 | `apps/web/src/app/` | 同左 | Next route + API DTO | middleware 临时字符串 | keep |
| 设计 token | `apps/web/src/app/globals.css`、UI components | 同左 | Tailwind/Radix 组件接口 | 页面局部平行体系 | keep |
| API 合同 | shared schema 与 route validation | 扩大 Zod/shared owner 覆盖 | HTTP DTO/错误码 | TypeScript `as` 断言 | repair |
| 业务逻辑 | `services/`、`repositories/` 与局部领域 owner | 从超大 route 渐进提取 | typed service contract | UI、route handler、mock | repair |
| 数据库/schema | Prisma schema + migrations | 同左 | Prisma model/SQL constraints | 前端对象或 Redis | keep |
| 登录/权限 | auth/device-auth + route preHandler | 同左 | account/device token contracts | 隐藏按钮或客户端 role | repair |
| 图片公网下载 | `source-public-image-download.ts` | 所有用户 URL 下载统一消费它 | bounded downloaded image | route/watermark 裸 fetch | repair |
| 上传配额 | `upload-limiter.ts` | Redis 原子配额 owner | allowed/denied result | 单进程 Map | repair |
| 第三方接入 | 现有 provider/client/adapter | 同左 | provider contract + error mapping | 页面直调和日志字符串 | keep |
| 托管编辑发包边界 | `apps/server/src/services/ai-image-edit-dispatch.ts` | 同左 | 最后发包 callback；实时授权、冻结任务与预留绑定 | route、提示词、页面或 Provider 响应 | keep |
| 托管编辑 Provider 合同 | `apps/server/src/services/ai-image-edit-provider-contract.ts` | 同左 | 传输/规范端点/尺寸/冻结 prompt；readiness、service、repository、worker 共用 | HTTP handler 自定义 transport、UI 或证据标签别名 | keep |
| 托管编辑凭据身份 | `system-config-schema.ts`、`ai-image-edit-runtime-config.ts`、`ai-image-provider-runtime-contract.ts` | 同左 | 一次快照读取；Wanx v2 非密 recordId/revision/updatedAt；创建/重试/发包/查询共用 | 前端、日志、密钥摘要或当前配置自动覆盖旧任务 | keep |
| 编辑产物与只读恢复 | `ai-image-edit-artifacts.ts`、`ai-image-edit-recovery.ts`、reconciliation service/repository；raw 持久化由 `repositories/ai-image-edit-output.ts` 负责 | 同左 | 原 ID 的 GET；冻结输入→raw→合成/规范化→待审核；lease/CAS 和唯一账本终态 | 恢复 worker 重发 POST、直接生成可应用图片或重置原 attempt | keep |
| 编辑提示词规则与协议渲染 | `apps/server/src/services/ai-image-edit-prompt-contract.ts`；通用插值由 `ai-prompt-templates.ts` 负责 | 同左 | 显式 rendering profile 与独立快照摘要；registry 保持发布 owner | Provider adapter 截断/替换文本、UI 或临时脚本 | keep |
| 阿里云原生账单观察 | `apps/server/src/services/ai-image-alibaba-billing-observation.ts`；私有文件边界复用 `ai-image-sandbox-billing-settlement.ts` | 同左 | QueryBill 观察→待对账评估；精确金额口径、账号/账单身份分离；无结算 writer | 用量、页面现金数、报价或账单号冒充单请求费用/任务 ID | keep |
| Wanx 试点离线准备 | `apps/server/src/services/ai-image-wanx-trial-preparation.ts`；复用冻结 prompt、精确金额和私有 bundle owner | 同左 | CNY 1 两操作分配、输入副本与不可覆盖清单；verify 重算；固定不可收费和来源待核实 | CLI 自行定价、准备清单变批准、提议分配冒充执行预占、快照自洽冒充真实任务来源 | keep |
| Wanx 隔离执行与预算 | `ai-image-wanx-trial-execution.ts`、`ai-image-sandbox-approval.ts`、原 sandbox claim/private writer；single-submit 仅装配 | 同左 | v4 绑定物理私有根和冻结清单；全局 fingerprint、整轮与固定操作槽位在 POST 前持久领取；report-bound 范围证据 | 改单号/审批/目录重发、未知结果返还额度、隔离结果冒充 ERP 或原生计费验收 | keep |
| 部署/配置 | env templates、deploy scripts、SystemConfig | 各自保持启动/业务配置职责 | env/deploy contract | 页面常量和历史计划 | repair |
| REL-04 候选证据 | `packages/shared/src/rel04-release-evidence.ts` | 同左 | canary v2、完整 VPS verifier v1；CLI 与 API 共用候选绑定校验 | 日志文本、页面和手写运行回执 | keep |

## 数据、合同与安全边界

| Boundary | Current Truth | Writer | Reader | Transaction Or Consistency | Permission Enforcement | Drift Or Repair |
| --- | --- | --- | --- | --- | --- | --- |
| 账号会话 | JWT claims + Redis session + live User | auth routes/lib | API preHandler | authVersion、session TTL、设备撤销 | `authenticate`/device auth | production 禁止 Noop Redis |
| 订单/支付 | PostgreSQL order/account/transaction ledger | service transaction/webhook | finance/admin/user API | serializable/claim/idempotency | 服务端 owner 和角色 | 保持现有对账 owner |
| AI/Ozon 外部写入 | intent、grant、attempt、receipt 和 rollout gate | API/Worker | Web/扩展/运维 | append-only/CAS/reconciliation | owner/shop/device + gate | 本轮不启用真实写入 |
| 图片与附件 | DB URL/key + local/OSS storage | image services | Web/Ozon/extension | immutable key/size/quota | 用户 owner + admin role | 统一公网下载与配额 |
| 系统配置 | `system-config-schema.ts` | admin routes | API/Worker | typed validation/encryption | admin/super-admin | 审计必须可观测 |

## 关键运行链路

| Flow | Real Entry | Ordered Current Owners | Contracts And State | Real Result | Failure Or Missing Evidence |
| --- | --- | --- | --- | --- | --- |
| 登录 | Web `/login` | auth UI -> `/api/auth/login` -> human challenge -> User/Redis session | cookie JWT + live authVersion | Web 会话建立 | production Redis disabled 风险待修 |
| 来源采集到上架 | Extension/Web | page evidence -> source capture -> listing draft -> publish intent/attempt -> Ozon adapter | shared capture schema、draft revision、rollout/receipt | 可恢复发布流程 | 真实 Ozon 试点未授权 |
| AI 图片 | Web/Extension | prompt/plan -> credential-bound job -> dispatch fence -> Provider adapter -> raw/final -> review/apply；中断后原 ID GET -> 同一产物 owner | quota/cost/reservation/reconciliation | 暗态/受控结果 | Wanx 凭据绑定与只读恢复已接线；真实 Provider → ERP、账单/质量与正式 QA-04 仍待验收；最新证据见 `current-state-audit.md` |
| 图片处理 | Web | image route -> downloader/watermark/resize -> storage | URL/bytes/pixels/quota | 生成预览/上传结果 | 部分裸 fetch 待统一 |

## 局部架构真源投影

| Area | Current Detail Truth Owner | Target Detail Truth Owner | Macro Projection Kept Here | Status |
| --- | --- | --- | --- | --- |
| 前端 | `docs/common-components-guide.md`、源码 | 后续按需物化 frontend truth | Next Web 消费服务端合同 | repair |
| 后端 | `docs/service-layer-guide.md`、源码 | 后续按 owner 拆分补充 | Fastify API + Worker + services/repositories | repair |
| 数据 | Prisma schema/migrations 与 RUNBOOK | 同左 | PostgreSQL 持久真相 | keep |
| 安全 | threat model、auth、部署文档 | 后续统一 security-boundary owner | 服务端身份/权限、扩展不可信页面边界 | repair |
| 部署 | `docs/deployment.md`、`docs/RUNBOOK.md` | 同左 | 单 VPS、多进程、独立发布 gate | keep |

## 第三方和外部能力

| Provider | Current Adapter Owner | SDK Or Protocol | Auth And Secret Owner | Callback Or Job Boundary | Sandbox Or Live Evidence |
| --- | --- | --- | --- | --- | --- |
| Ozon | `ozon-client.ts` 与发布 services | Seller API/页面证据 | encrypted shop config | jobs/attempt/reconciliation | 本地合同充分，真实试点未验证 |
| OSS/R2 | `image-storage.ts`、runtime config | S3 API | env/SystemConfig encrypted fields | presign/proxy/upload | 本地与部署合同，当前线上未验证 |
| SMS/Turnstile | auth challenge 与 sms adapters | 官方 API | env/SystemConfig | auth endpoints/quota | 当前变更中，生产 live 未验证 |
| AI image providers | provider services/sandbox guards | Provider HTTP API | server config/BYOK profile boundary | jobs/cost reconciliation | fake/sandbox 合同，真实质量未验证 |

## 演进保护边界

| Product Truth Reference | Protected Owner Or Contract | Deferred Implementation | Migration Cliff | Re-Evaluation Trigger |
| --- | --- | --- | --- | --- |
| `docs/PROJECT-OVERVIEW.md` | 单 VPS 模块化单体 | K8s/微服务 | 运维与数据迁移 | 持续容量/SLA 证据 |
| source-to-Ozon contracts | 服务端 draft/attempt/receipt | 移除 legacy paths | 扩展与 API 兼容迁移 | 所有入口 V2 稳定窗口通过 |
| AI media provider matrix | cost/authorization/reconciliation | 全租户真实 Provider | 费用、质量与数据出境 | 独立试点和对账证据完成 |

## 禁止路径

- 禁止在本文复制 `technical-selection.md` 的决策理由和历史。
- 禁止把半路项目当空项目或整体重写超大文件。
- 禁止 UI、route、extension page 或 mock 拥有权限、金额、状态和发布真相。
- 禁止生产使用 Noop Redis、固定示例管理员或未验证的用户 URL 下载。
- 禁止为了短期绿色保留第二套 owner、削弱测试、关闭安全 gate 或手改生成物。
- 禁止在没有独立授权时执行迁移、生产部署、发布、Provider/Ozon 写入或凭据操作。

## 验证方式

- 本地启动命令：`pnpm env:check -- --profile local --env .env`，然后 `pnpm dev`。
- 构建命令：`pnpm --filter server build`、`pnpm --filter web build`。
- 测试命令：`pnpm --filter server test` 与受影响的 `scripts/*.test.mjs`。
- 模块或依赖结构检查：`pnpm lint`、依赖审计与 owner 定向搜索。
- 关键路径真实验收：登录、采集/上架、订单和图片工作流的浏览器/远端 smoke。
- API 契约和负例：身份、角色、跨租户、URL/资源、幂等和失败关闭测试。
- 数据库当前 schema、迁移与回滚：`prisma validate/status`，隔离 schema migration/integration。
- 第三方 sandbox/live 证据：只使用对应 runbook 与独立授权。
- 部署健康和回滚：`docs/RUNBOOK.md`、`/ready`、备份恢复与暗态 verifier。
- 项目 guardrail：Sliver `check_project_guardrails.py --mode adoption|constitution|stage`。
