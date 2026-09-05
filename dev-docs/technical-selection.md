# SS ERP 技术选型与基础决定

本文件是“沿用当前组合并做局部修正”的理由和证据 owner。具体当前结构只在 `architecture.md` 维护。

## Foundation Decision Control

- schema: sliver-foundation/v1
- decision_status: implementation_ready
- source_coverage: complete
- blocking_unknowns: none
- source_conflicts: none
- network_evidence: verified_current: 2026-09-05 https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj 返回 200，并确认当前 Next 15.5.18 低于该公告修复版本
- poc_status: not_required: 当前组合已由现有构建、测试和迁移状态证明可行，本轮不存在决定换栈的关键未知
- user_confirmation_scope: product_consequences_only
- product_consequence_confirmation: original_request_confirmed: 用户在审计结论后要求按该流程修复并分阶段推送，确认保留产品行为与当前技术路线进行加固
- recommendation: primary
- decision_record: recorded: 2026-09-05 选择保留 TypeScript 模块化单体和现有进程边界，局部修复安全、供应链、验证与 owner 结构

## Source Coverage

| Category | Source | Status | Evidence |
| --- | --- | --- | --- |
| product_scope | `docs/PROJECT-OVERVIEW.md` | confirmed | Ozon ERP、云端/本地双模式和单 VPS 边界明确 |
| users_outcomes | `README.md`、Web 路由清单 | confirmed | 卖家围绕采集、上架、订单、物流、财务和图片完成工作 |
| roadmap_boundaries | `docs/PROJECT-OVERVIEW.md`、本次用户请求 | confirmed | 不提前引入 K8s，当前先加固主链路并分阶段推送 |
| existing_system | package manifests、`apps/`、`extensions/` | confirmed | Next/Fastify/Prisma/Redis/MV3 组合和 owner 已存在 |
| runtime_operations | typecheck、Vitest、Web build、Prisma status、扩展 verifier | confirmed | 组合可构建可测试；环境和完整 preflight 缺口单独修复 |
| data_security_compliance | Prisma schema、auth、部署与 threat model | confirmed | 数据、身份、发布和 Provider 已有 owner，已识别局部边界缺口 |
| platform_organization | `docs/deployment.md`、Compose/systemd 文件 | confirmed | 单 VPS 多进程是当前实际运维形态，生产操作受独立授权 gate 控制 |

## Architecture Drivers

| Driver | Business Priority | Architecture Impact | Source Evidence | Failure Consequence |
| --- | --- | --- | --- | --- |
| 跨境上架链路可靠且可对账 | 最高业务优先级 | 业务真相留在服务端，扩展只采集证据和发起受控动作 | `docs/contracts/source-to-ozon-external-contracts.md` | 重复发布、错商品或无法恢复未知结果 |
| 小团队可持续维护 | 高业务优先级 | 保持模块化单体和明确 owner，渐进拆超大文件 | `docs/PROJECT-OVERVIEW.md`、文件尺寸审计 | 修改冲突和回归成本持续上升 |
| 身份、费用和 Provider 安全 | 最高安全优先级 | Redis、数据库账本、服务端权限与外部 gate 必须失败关闭 | auth、AI cost、payment 和 threat-model owner | 越权、重复计费、密钥或客户数据泄露 |
| 单 VPS 可稳定运维 | 高运维优先级 | Web/API/Worker 分进程，PostgreSQL/Redis/对象存储保持现有拓扑 | Compose/systemd 与 RUNBOOK | 部署复杂度超过团队能力或恢复不可控 |

## Quality Attribute Scenarios

| Attribute | Source | Stimulus | Artifact | Environment | Response | Measure | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| security | 未登录或跨租户调用方 | 篡改 owner、URL 或授权字段 | API 与扩展命令边界 | 云端生产环境 | 服务端拒绝且不产生外部或数据副作用 | 返回 401/403/4xx 且负例可复跑 | 阻断发布 |
| reliability | Redis 服务不可用或被配置禁用 | 登录、撤销、配额或队列请求 | auth、worker 与 runtime | 云端生产环境 | 启动或 readiness 失败关闭 | 禁止任何 Noop 成功路径 | 阻断发布 |
| resource | 已登录用户提交远程图片 URL 列表 | 内网地址、超大体积或像素炸弹 | image download、watermark 与 resize | Fastify API 运行环境 | 拒绝非公网地址并执行数量、字节、像素和超时上限 | 有界错误且内存不随输入无界增长 | 阻断发布 |
| modifiability | 开发者修改采集、AI 图片或扩展发布 | 多个语义 owner 同时变化 | route、service、extension 与 script | 本地开发和持续集成 | 先改唯一 owner，再跑定向合同和受影响回归 | 每个阶段独立提交并能够回滚 | 重要质量项 |
| operability | 操作员准备候选发布 | 依赖漏洞、迁移或 gate 失败 | CI 与部署入口 | 持续集成和生产准备 | 高危门禁阻断并输出可定位结果 | 不允许 `continue-on-error` 形成假绿色 | 阻断发布 |

## Pattern Axes

| Axis | Current Choice | Scope | Driver Fit | Rejected Alternative | Upgrade Trigger |
| --- | --- | --- | --- | --- | --- |
| 部署拓扑 | 单 VPS 上 Web/API/Worker 分进程 | 当前 SaaS 与本地包 | 低运维成本且隔离后台任务 | K8s/微服务会增加当前无收益复杂度 | 队列、数据库或部署影响出现持续 SLA 数据 |
| 内部代码组织 | Fastify/Next 原生边界加局部 service/repository | server/web/shared | 保留现有模式并逐步压缩 route owner | 全量 Clean Architecture 重写风险过高 | 超大 owner 无法用局部拆分维持测试与职责 |
| 领域建模 | 交易/发布/AI 使用显式状态与账本，其余事务脚本 | 高风险领域 | 把复杂度放在需要审计的区域 | 全域 DDD 会制造过多类型和层级 | 新领域出现跨入口状态机与一致性需求 |
| 数据与一致性 | PostgreSQL 为持久真相，Redis 为会话/队列/短期协调 | 全部运行面 | 支持事务、审计和异步任务 | 浏览器/localStorage 或 Redis 作为持久业务真相 | PostgreSQL 容量或隔离需求出现量化瓶颈 |
| 模块通信 | API 同步调用 + BullMQ 可靠异步任务 | Web/API/Worker | 匹配现有任务和恢复模型 | 引入消息总线会增加运维面 | 多服务独立部署且需要跨服务可靠事件 |
| 客户端接口 | Fastify 通用 API，Web 与扩展消费受控合同 | Web/扩展 | 服务端统一权限和数据 owner | 为每端复制业务后端会漂移 | 客户端需求无法由同一合同安全表达 |
| 扩展机制 | MV3 扩展作为采集/本地交互 adapter | Ozon 与来源平台 | 浏览器证据留在客户端，写入权留在 ERP | 把支付、权限、Provider/Ozon 真相下放扩展 | 平台能力或 Chrome 政策使现有边界不可行 |
| 组织与平台 | 单产品模块化单体 | 当前团队 | owner 清晰且成本最低 | 提前建设通用中台没有真实消费者 | 多产品复用、独立 SLA、资金和平台 owner 同时成立 |

## Framework Architecture Fit

| Candidate | Framework-Native Structure | Driver Fit | Native Support | Local Adaptation | Conflict/Bypass Cost | Operations Cost | Migration Cliff | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SS ERP TypeScript modular monolith | Next App Router、Fastify plugin、Prisma migration、BullMQ Worker、MV3 | 覆盖 Web、API、任务、数据和浏览器证据边界 | native | 保留 service/repository 与合同生成器，渐进拆大 owner | 当前局部 route 聚合和脚本门禁需要修正 | 单 VPS 可运维，依赖升级需持续维护 | 换栈会重写 140 个模型、146 个迁移、数百路由/测试与扩展合同 | primary |

## Current Primary Evidence

| Candidate Or Decision | Claim Being Checked | Primary URL/Source | Source Type | Checked Date | Version/Support Target | Result |
| --- | --- | --- | --- | --- | --- | --- |
| SS ERP TypeScript modular monolith | 当前 Next 版本需要安全补丁而非换框架 | https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj | official_advisory | 2026-09-05 | Next 15.5.x | 当前 15.5.18 低于 15.5.21 修复线，应做兼容补丁升级 |
| SS ERP TypeScript modular monolith | Fastify 5 的 Node 支持边界 | https://fastify.dev/docs/latest/Reference/LTS/ | official_docs | 2026-09-05 | Fastify 5 / Node 20+ | 当前 Node 22 满足支持边界，保留框架合理 |
| SS ERP TypeScript modular monolith | Prisma 当前运行时要求 | https://www.prisma.io/docs/orm/v7/reference/system-requirements | official_docs | 2026-09-05 | Prisma 当前系统要求 | Node 22 满足现代 Prisma 路线；本轮避免跨主版本迁移 |
| SS ERP TypeScript modular monolith | Node 22 生命周期 | https://nodejs.org/en/about/previous-releases | official_release | 2026-09-05 | Node 22 | 当前引擎与部署版本仍在支持路线内 |

## Proof Of Concept

- poc_hypothesis: 不需要 PoC；当前组合是否可行已由现有生产构建、5136 个后端测试、Prisma 迁移状态和扩展 verifier 直接证明。
- disposable_boundary: 不产生实验实现；依赖升级和安全修复各自使用测试先行及独立提交验证。

| PoC ID | Success Criterion | Failure Criterion | Evidence Reference | Observed Result | Decision Impact |
| --- | --- | --- | --- | --- | --- |
| POC-NOT-REQUIRED | 现有组合能完成类型检查、测试、构建和迁移状态读取 | 任一基础能力要求换栈才能恢复 | `pnpm typecheck`、`pnpm --filter server test`、`pnpm --filter web build` | 当前组合已通过这些本地证据，不需要额外实验代码 | 保留组合并在现有 owner 内局部加固 |

## Product Consequence Confirmation

| Consequence | User-Visible Result | Cost Or Operation Impact | Data, Downtime Or Irreversible Impact | User Decision | Confirmation Evidence |
| --- | --- | --- | --- | --- | --- |
| 保留当前产品和技术组合做局部加固 | 现有页面、流程和部署形态保持不变，安全失败更明确 | 增加测试与维护工作，不新增基础设施 | 本地代码和 CI 变更可回滚，不执行生产迁移或停机 | original_request_confirmed | 2026-09-05 用户要求按审计流程修复并分阶段 push |

## Primary Decision And Tradeoffs

- primary_combination: SS ERP TypeScript modular monolith，以 Next.js 15、Fastify 5、Prisma/PostgreSQL、Redis/BullMQ 和 MV3 为现有基础。
- why_it_fits: 当前组合已承载完整产品链路并有高测试覆盖；已证实问题可在现有 owner 内局部修复。
- accepted_downside: 继续承担 Node/Next/Fastify/Prisma 供应链升级，以及超大文件的渐进拆分成本。
- rejected_alternatives: 拒绝全量重写、微服务化、K8s 和跨 Prisma 主版本迁移；它们扩大故障面且不能直接修复当前 P0。
- minimum_reversible_boundary: 每个安全 owner、CI gate 和结构拆分独立提交，保持 API、schema 和用户流程不变。
- migration_cliff: 换数据库、认证模型、扩展权限模型或部署拓扑会触发数据/客户端迁移和停机计划。
- re_evaluation_trigger: 单 VPS 持续容量告警、独立团队/产品 owner、框架支持终止或现有边界无法满足安全合同。
- architecture_writeback: 当前组合与 owner 投影已写入 `architecture.md`，不在该文件复制决策历史。
