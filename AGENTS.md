# SS ERP Agent 规则

默认使用中文沟通。本文件约束在本仓库工作的编码 Agent；详细产品、架构和验收事实以
[`dev-docs/README.md`](dev-docs/README.md) 索引的当前真源为准。

## 项目边界

- SS ERP 是面向 Ozon 跨境卖家的 Web ERP、Fastify API/Worker 与 Chrome MV3 扩展组成的系统。
- 保持 Next.js、Fastify、Prisma/PostgreSQL、Redis/BullMQ 和 MV3 组合；没有新的产品后果确认，不做换栈、微服务化或 K8s 改造。
- 云端 SaaS 与本地离线模式必须显式区分，不能让本地降级策略削弱云端身份、队列、配额和审计边界。
- 真实 Provider、Ozon 写入、生产部署、数据库破坏性迁移、密钥使用与发布不由普通本地开发授权。

## 扩展方向（2026-11-11 产品裁决）

浏览器扩展按“精铺式直连、相对独立”开发，唯一 owner 是 [`dev-docs/extension-direction.md`](dev-docs/extension-direction.md)。要点：

- 采集、生图、上架由扩展直连完成：扩展用用户自己填写的 Ozon Client-Id/Api-Key 与生图 Provider Key 直接请求，不经过 ERP 草稿、托管状态机、计费和审核。
- ERP 对扩展只保留两件事：设备授权登录；上架完成后的最终数据同步（另提供生成图片的对象存储托管）。
- 一个功能只保留一条执行路径。新增直连能力时替换旧的托管入口，不允许在旧入口旁边并排再加一条。
- 界面是一个统一入口、一套皮肤（`extensions/ss-erp/shared/ui/tokens.css`），不再为新功能新增独立页面或独立悬浮按钮。
- 冻结（保留代码，停止投入，不新增入口）：Yandex Market、独立 AI 生图工作台页、Ozon 列表选品规则、1688 以外的货源平台。

本文件其余条款中关于“Provider/Ozon 写入必须走服务端授权、幂等、对账、额度”的要求，适用于 ERP 服务端与 Web 的托管路径，不适用于扩展直连通道。

## 危险接管动作

改写项目宪法、宣布新的真源、移动或删除旧文档、移除 API/字段/兼容合同、调整 schema/权限/部署流程前，必须先给出当前证据和产品后果；只有当前请求明确覆盖该结果时才可执行。

## 当前真源

- 开始工作先读 `dev-docs/README.md`，再读与任务直接相关的 owner、消费者、测试和当前 Git 状态。
- `docs/` 是公开使用和运维文档；`dev-docs/` 是内部项目真源。不要在两处复制同一决定。
- 代码、schema、当前命令结果和运行证据高于旧计划、归档文档与聊天摘要。
- 半路接管项目不得当作空项目重写。发现真源冲突时停止实现，先记录冲突和裁决证据。

## 工作流程

架构优先、设计优先、真源优先；先关闭 owner 和验收边界，再开始实现。

1. 明确结果、非目标、唯一 owner、调用者与消费者。
2. 对实现改动执行测试门禁分类；稳定且可自动化的新行为使用 RED -> GREEN。
3. 分类身份、权限、租户、输入、密钥、数据写入、第三方、公开面和资源上限影响。
4. 先改 owner，再改薄适配层；不从页面、route、prompt 或临时脚本反推业务规则。
5. 运行最小定向验证，再运行受影响回归；没有新鲜证据不得声称完成或可上线。
6. 行为、架构、配置、部署或验收边界变化后，回写 `dev-docs/` 的唯一 owner。

## Owner 规则

- 产品定位与公开架构入口：`docs/PROJECT-OVERVIEW.md`。
- 内部状态、技术决策、架构 owner map 与验收：`dev-docs/`。
- Web 路由和 UI：`apps/web/src/app/`、`apps/web/src/components/`；复用 `apps/web/src/components/ui/` 和 `apps/web/src/app/globals.css`。
- API 装配：`apps/server/src/index.ts`；业务规则进入 `services/`、`repositories/`、`lib/` 或明确的领域模块。
- 数据结构与迁移：`apps/server/prisma/schema.prisma` 和 `apps/server/prisma/migrations/`。
- 登录、会话和权限：`apps/server/src/lib/auth.ts`、设备认证 owner 与各路由服务端检查。
- 系统配置：`apps/server/src/config/system-config-schema.ts`；部署级启动配置由环境模板和部署脚本负责。
- 浏览器扩展运行时：`extensions/ss-erp/`；跨 Web/API/扩展合同优先放入 `packages/shared/` 或现有生成合同 owner。
- 扩展产品方向、直连通道边界与统一界面：`dev-docs/extension-direction.md`；设计变量：`extensions/ss-erp/shared/ui/tokens.css`。
- 测试：后端使用 Vitest，扩展/部署合同使用 `scripts/*.test.mjs`，真实 UI 行为需要浏览器证据。

禁止让 UI、HTTP handler、扩展页面、mock、日志字符串或 README 成为权限、金额、状态机、配额、发布或数据归属的 owner。生成物只通过源文件和生成器更新。

## 安全红线

- 前端输入不可信；身份、角色、权限、租户、数据归属、金额、状态和写入字段必须在服务端验证。
- 云端/生产不能使用 Noop Redis 模拟会话或配额成功。
- 用户 URL、上传文件和第三方响应必须限制协议、地址、重定向、大小、像素、数量与超时。
- 密钥、令牌、真实手机号、支付信息和生产数据不得进入日志、测试 fixture、普通 artifact 或 Git。
- 示例账号不得在生产 seed 中创建；首个管理员只通过受控 `/setup` 流程建立。
- ERP 服务端的支付、Provider 和 Ozon 写入必须有签名/授权、幂等、对账、额度和失败恢复证据；扩展直连通道的边界见 `dev-docs/extension-direction.md`。
- 安全审计不等于修复授权；未经确认不得扩大到生产、凭据、数据或第三方写入。安全验证证据缺失时明确标记 `未验证`。

## 测试与验证

- 每次实现改动前必须先完成测试门禁分类；稳定可自动化的安全或业务行为使用最小 owner 测试严格执行 RED -> GREEN。
- `T0` 文档/纯静态：读回、链接、diff 或构建。
- `T1` 已有门禁/纯重构：先建立原门禁基线，再验证未回归。
- `T2` 稳定行为、安全、权限、API、数据和配额变化：先写能因目标缺失而失败的测试，确认 RED，再实现并确认 GREEN。
- `T3` 浏览器、Provider、设备或环境行为：保留可重复的前后路径和真实证据。
- 禁止用 mock 自己、零测试、跳过测试或无关绿色套件冒充验收。

常用验证：

```powershell
pnpm typecheck
pnpm lint
pnpm --filter server test
pnpm --filter web build
pnpm verify:extension
pnpm env:check -- --profile local --env .env
```

数据库、发布、Provider 和真实浏览器验证按 `dev-docs/acceptance.md` 与对应 runbook 扩大范围。

## Git 和阶段提交

- 提交前检查仓库根、`git status --short`、ignored/未跟踪文件和 staged diff。
- 禁止 `git add .`；只 stage 当前阶段的明确路径。
- dirty worktree 中保留用户已有改动，不覆盖、不回滚、不混入无关提交。
- 每个阶段先通过对应验证，再形成单一目的提交；推送不代表部署或发布。
- `.env`、私钥、生产回执、真实客户资料、临时构建与浏览器 profile 不得提交。

## 停止条件

- 需要改变产品可见范围、成本、停机、数据迁移、锁定或不可逆后果。
- 需要切换框架、数据库、身份/权限模型、支付模型、Provider 或部署拓扑。
- 需要访问生产、使用凭据、产生真实费用、执行 Ozon/Provider 写入或部署。
- owner 不清、真源冲突、测试无法证明边界，或同一问题连续三次修复失败。
- staged 内容包含无关用户改动、ignored 私密文件或不明嵌套仓库。

## 多 Agent

仅当任务能拆成互不写同一 owner 的独立范围且确实缩短时间或增加证据时使用。子 Agent 结论必须由主 Agent 对当前代码、测试、文档和 Git 状态复核。
