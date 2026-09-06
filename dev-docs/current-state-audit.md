# SS ERP 当前状态审计

审计日期：2026-09-06，最新实现检查点为 `0ede34eb`；日本、国内 VPS 当前运行安全修复提交 `a986d0f6`。公开扩展仍按批准状态绑定 `b64b723c` / `1.0.316`（COM）和 `d27b3ad8` / `1.0.311`（CN），`1.0.317` 仅为暗部署候选。该结论来自当前分支、文件和新鲜命令，不用诊断/helper 提交冒充运行包证据。

## 现状证据

- 项目根目录：`D:/AI Agent/Work/QE/SS ERP`。
- 当前分支：`feat/ai-media-prompt-registry`，跟踪 `origin/feat/ai-media-prompt-registry`。
- Git evidence state：实现检查点 `0ede34eb` 已提交，包含 QA-04 Git provenance 和 Ozon sandbox v2 receipt/production compiler envelope 加固；认证、扩展发布、SSRF、AI quota、durable operation claim、CI pin、Web 配置合同、受管扩展诊断、部署备份 retention、typed production smoke token、Ozon Key 只写修复和 Ozon 只读 preflight 均有独立检查点。两地运行包仍绑定 `a986d0f6`，因为后续改动只涉及仓库工具、合同和文档，未触发新的运行部署。
- 未跟踪文件：无。
- 嵌套 Git 仓库：只发现项目根 `.git`；`git submodule` 在当前 Windows Git 环境因缺少 Unix helper 未完成验证。
- 现有 agent 指令文件：审计前未找到；本次按用户授权新增根 `AGENTS.md`。
- 现有内部文档：审计前没有统一真源；`docs/plans/` 含历史实施计划但状态跨度较大。
- 现有公开文档：`README.md`、`docs/PROJECT-OVERVIEW.md`、`docs/README.md`、`docs/RUNBOOK.md`、`docs/deployment.md`。
- package/framework 文件：根 `package.json`、`pnpm-lock.yaml`、`apps/web/package.json`、`apps/server/package.json`、`packages/shared/package.json`。
- 启动/测试/构建脚本：`pnpm dev`、`pnpm typecheck`、`pnpm lint`、`pnpm preflight`、server Vitest、Web build、扩展 verifier。
- schema/migration：`apps/server/prisma/schema.prisma`，148 个迁移；本地 `prisma migrate status` 为 up to date。
- 部署脚本：`scripts/deploy*.sh`、`docker-compose*.yml`、`deploy/systemd*` 与扩展签名/分发 gate。
- 配置模板：`.env.example`、`.env.staging.example`、`.env.production.example`；真实 `.env` 被 Git 忽略。
- 已知启动证据：类型检查、后端测试、Web build、扩展静态验证通过；`bootstrap-local-env.mjs` 修复当前 ignored `.env` 后，local profile 校验为 0 failure。
- 当前用户请求：按优先级继续验收并解决受管扩展、Provider、Ozon 与生产运行瓶颈；远端备份暂不配置。VPS 与 skills 已获授权，但 Provider 费用和 Ozon 测试店写入仍必须绑定精确的一次性批准。

## 产品边界

- 当前产品看起来是什么：面向 Ozon 跨境卖家的 SaaS/本地双模式 ERP，包含 Web、API、Worker、PostgreSQL/Redis、对象存储和 Chrome 扩展。
- 当前产品不是：通用多租户基础平台、微服务集群、K8s 平台或完全由浏览器端承担业务真相的扩展。
- 用户确认的方向：沿用当前功能和技术组合，按审计顺序修复治理、安全、供应链和可维护性问题。
- 旧名称、旧概念或过期语义：`docs/LAUNCH-OPTIMIZATION-PLAN.md` 与 `docs/plans/saas-remaining-tasks.md` 中部分待办已被后续代码完成，不能直接当当前 backlog。
- 用户明确否定或延期的方向：不换栈、不执行破坏性数据库操作，远端备份暂不配置；未满足费用/测试店门禁时不执行真实 Provider/Ozon 写入。

## 已确认的演进边界

- 当前必须交付：关闭已证实的 P0 安全边界，恢复可信依赖/CI 门禁，建立当前真源，并做最小结构收敛。
- 已确认的下一阶段能力：在当前单体与扩展边界上继续迭代，不增加新基础设施。
- 当前不实现但不能堵死：后续真实浏览器回归、Provider/Ozon 试点和生产发布仍消费现有合同与 gate。
- 明确不会做：本轮不切换框架、数据库、认证模型、支付模型或部署拓扑。
- 只是设想，不得影响当前架构：K8s、微服务拆分、API 多实例等只有出现可观测容量或组织触发条件后再评估。
- 临时 fallback 真源迁移：从分散的 `docs/plans/` 状态描述迁到本目录；公开文档保留公开职责，不移动历史文件。

## 技术栈适配

- 当前前端：Next.js 15 App Router、React 18、TypeScript、TailwindCSS、Radix UI、TanStack Query。
- 当前后端：Fastify 5、TypeScript、Prisma、BullMQ、Vitest。
- 当前数据库：PostgreSQL 16，Redis 7 负责会话、队列与分布式控制。
- 当前第三方服务：Ozon、Cloudflare Turnstile/R2、S3-compatible OSS、阿里云/腾讯云短信、Sentry、AI 图片 Provider。
- 当前部署方式：单 VPS，Nginx + systemd 或 Compose，API/Web/Worker 分进程。
- 结论：沿用但修正。
- 证据：现有组合已通过类型、构建、5164 个后端测试和扩展合同验证；风险集中在外部运行证据，而不是框架不适配。
- 用户需要决定：本轮无需新的产品决定；真实部署、费用、凭据与迁移仍需单独授权。

## 调用链和 owner

| 功能/概念 | 当前入口 | 真实 owner | 下游展示/adapter | 风险 |
| --- | --- | --- | --- | --- |
| Web 会话 | `/api/auth/*` | `apps/server/src/lib/auth.ts` 与 Redis session | 登录/注册页面、扩展 Bearer adapter | cloud/production 已拒绝 Redis disabled；生产只读会话已验证，Redis 集群拓扑仍未验证 |
| 图片远程读取 | `/api/images/*`、水印服务 | `apps/server/src/services/source-public-image-download.ts` | image-upload route、watermark、Web 图片处理页 | URL/重定向/字节/像素边界已统一；线上外部地址回归未验证 |
| 上传配额 | image-upload route | `apps/server/src/lib/upload-limiter.ts` | Web 图片管理 | 云端 Redis Lua 原子计数已完成；Redis 集群拓扑仍未验证 |
| 数据模型 | API/Worker | `apps/server/prisma/schema.prisma` + migrations | Prisma repositories/services | schema 大且格式检查未进入日常 gate |
| 扩展发布 | `pnpm package:extension` | release/package/verify 脚本和签名证据 | 官网下载 API、MV3 扩展 | preflight 单一串行入口过重 |
| 项目真相 | 根 README 与公开 docs | `dev-docs/README.md` 索引的内部 owner | Agent、开发者、阶段验收 | 审计前缺少唯一当前状态 |

## 文档盘点

| 文件 | 当前角色 | 状态 | 建议动作 |
| --- | --- | --- | --- |
| `docs/PROJECT-OVERVIEW.md` | public | active | keep，维护公开产品/架构入口 |
| `docs/deployment.md` | public | active | keep，线上记录必须绑定提交与日期 |
| `docs/RUNBOOK.md` | public | active | keep，继续承载运维步骤 |
| `docs/plans/*.md` | internal history | stale | keep，不作为当前阶段状态 owner |
| `docs/archive/` | history | active | keep，不回流当前决策 |
| `dev-docs/*.md` | internal truth | active | 按 owner 职责更新 |

## AI 债务和假成功

- 重复页面/组件/API：多个超大 route/page/extension 文件聚合了多个职责，存在高变更冲突风险。
- mock/假数据：大量合同测试有价值，但 Web 的源码字符串测试不能替代真实浏览器行为。
- 自定义 wrapper：扩展发布与部署 gate 很完整，但 `preflight` 串行包含 132 个步骤，定位和耗时成本过高。
- 多套状态/请求/权限模式：账号 token 与设备 session 已有明确迁移边界；旧兼容路径必须继续由 rollout gate 限制。
- 旧备份/死文件：ignored 的 `*.orig`、大量 build 历史产物不进入 Git，但会增加本机扫描噪声。
- 已修复的假成功：CI audit/Semgrep 已阻断；审计日志生产失败会抛 `AUDIT_LOG_WRITE_FAILED`；上传配额已使用 Redis Lua 原子计数；PostgreSQL 关键集成有隔离 runner。
- 用户级工具边界：`C:\Users\550W\.codex\skills` 的 45 个顶层技能入口指向未授权的 `C:\Users\550W\.cc-switch\skills`，其内容未审计；允许目录内的 gstack 工具包含自动更新、遥测、会话导入和 Hook 设置写入能力，但没有证据表明这些 Hook 在当前用户配置中已启用。下一步必须先取得 `.cc-switch` 或实际用户配置的独立授权，不能把技能目录中的模板当作运行态证据。
- 日本/COM VPS 当前运行 `a986d0f6817d4c1783f510ac56410687817ccdfa`：API/Web/Worker、DB/Redis、Nginx/UFW、148 migrations、双 `/ready` 和暗态 verifier 均健康；`ss_erp_20260906_073135.sql.gz`（47,647,846 bytes）已完成 144 表临时恢复演练，attestation SHA-256 为 `6354965d20d5a6fd7caadb35557bc8b3a67275b387274f4cced5198a01172568`。远端备份按用户决定暂不配置，verifier 唯一 warning 为本地备份。
- 国内/CN VPS 当前运行同一 `a986d0f6817d4c1783f510ac56410687817ccdfa`：外部 RDS、Redis、Nginx/UFW、148 migrations、四个 `.cn` HTTPS host、双 `/ready` 和直连 verifier 均健康；`ss_erp_20260906_171253.sql.gz`（15,600,762 bytes）完成 141 表临时恢复演练，attestation SHA-256 为 `dadc95dfe5b952aeea188b6283b950597f3f41c68e1947bb42c8433e3eb82d75`。远端备份按用户决定暂不配置，verifier 唯一 warning 为本地备份。
- 公开扩展仍为已批准的 `1.0.316`，固定 ID `nkkemglcckgmhmcfnjjmcfbdhciafahl` 保持不变；VPS 暗部署候选为 `1.0.317`，cloud/local SHA-256 分别为 `e9ab7c3d258e4f8edd8795aabcc3d0ed0115e5e9565299c16e44dfb1ed7ca4be`、`c692326cc3231d0692fbc746d307c1a4f13abc5105d5687a6ed4378b0ac7f358`。候选 release evidence SHA-256 为 `cb25890f2bf0477fd632bd6899c2d77f172b09454b45df1b7938e1578cc29685`，签名 SHA-256 为 `208c9c3d90d106d6ae83300972d3e6e96d02d284c3addb092698f80ca9820fb8`；官网仍明确保持 `1.0.316` 指针。专用 CDP 已关闭，普通 Chrome 未操作。
- 最新外部只读预检：Xiaoyi 双域 7-GET 预检成功且无费用；DashScope 当前 credential 仍能读取 `wanx2.1-imageedit`，阿里官方价格页于 2026-09-06 仍列出 CNY 0.14/成功图片，私有价格观察 SHA-256 为 `ede27c30...524a62`。既有 Wanx IMAGE_TO_IMAGE/FULL_EDIT/INPAINT 技术结果成功但计费账户未关联，不能提升 Registry 或替代新 pilot 批准。
- Ozon Seller Info 根因复核：此前 `b4383731...572fd` 的 HTTP 400、`code=3 Invalid Api-Key` 来自错误绑定的占位店铺，并非操作员指定测试店。生产库另有三条未禁用记录共用同一 Client ID；操作员指定测试店 `DOTH / Client ID 4980990` 已在 `a986d0f6` 通过零重试 Seller Info，只读回执 SHA-256 为 `c56b173ee0843b3ab5438f868296d540a766c5f1905dbcfb6fc4661982379094`，没有商品写入。店铺 API Key 详情现只返回配置状态，替换凭据不再解密旧值；Ozon 写入仍需独立的精确 pilot 批准。
- 生产 smoke 使用目标部署前的 `3d3333ef` 600 秒 typed USER/ADMIN token helper 对当前运行中的 `a986d0f6` 复核；此前通过的域名隔离、Turnstile 拒绝、17 个用户只读端点、管理员只读状态和 cloud/OSS runtime 保持有效，本轮未上传图片，AI Media/BYOK/Ozon Publisher 仍全暗态。
- 受管扩展活动 COM 目录及其 228 个子项已完成 ACL 收紧：禁用继承，仅允许当前用户、SYSTEM、Administrators；无 reparse 点或额外主体，固定路径身份诊断保持 `FOUND`。
- 当前可以继续开发：本地代码、server/Web 构建、测试和 owner 内重构均有可重复门禁。
- 仍需单独验收：可对账的真实 Provider pilot、专用 Ozon 测试店写入/回滚、Redis 集群拓扑/外部告警和 CN 远端备份；生产域名、公开扩展、受管 active worker 与基础只读运行态已不再属于未验证项。
- Redis 新鲜只读盘点：COM/CN 均为 `redis_mode=standalone`、`role=master`、`connected_slaves=0`、`cluster_enabled=0`；未发现 Prometheus/Alertmanager、Redis 专用 systemd timer 或告警 cron。当前应用只读 `/ready` 能证明 Redis 可用，不能证明高可用、容量告警或故障切换。建设告警/集群需要外部基础设施和独立运维授权，本轮未修改生产拓扑。
- Redis 诊断合同：`pnpm diagnose:redis` / `scripts/diagnose-redis-runtime.sh` 只读执行 `PING`、`INFO`、`CONFIG GET`、systemd unit 枚举和用户 cron 枚举，分别输出运行可用性、拓扑、副本、持久化、客户端压力和告警发现状态，不打印认证信息。COM/CN 实际结果均为 `REDIS_RUNTIME_STATUS=PASS`、`REDIS_TOPOLOGY=standalone`、`REDIS_REPLICATION_STATUS=no_replicas`、`REDIS_ALERTING_STATUS=not_detected`、`REDIS_PERSISTENCE_STATUS=rdb_only`；该工具不改变 Redis 配置，也不把健康状态升级为高可用验收。
- 开发体验盘点：`pnpm --filter web lint` 为 0 error/0 warning；Next `15.5.25` build 仍提示 flat ESLint config 未被其 legacy 检测器识别。引入官方 plugin 会产生 47 个既有 `<img>` 警告且不能消除 build 提示，已撤销无收益依赖变更，保留为低优先级工具链项。
- Node ESM 提示已通过 `apps/web/package.json` 的显式 `"type": "module"` 关闭；依赖 Web TypeScript 源文件的 28 个合同测试不再输出 `MODULE_TYPELESS_PACKAGE_JSON`，Web typecheck/lint/build 均通过。该声明由 `web-next-dist-dir.test.mjs` 固定，Next plugin 检测提示仍独立保留。
- Ozon 写入前门禁：`0ede34eb` 起，execute 只接受 `ozon-listing-production-compile-adapter/v1` envelope，不再接受手写 `{items:[...]}`；它要求 24 小时内的 v2 preflight receipt 及精确 SHA-256，并绑定同一凭据 revision、ERP 店铺别名、Ozon Seller 名和 offer ID。写入前再次读取 Seller Info；网络禁止 redirect、响应限 2 MiB；归档只有在只读复查 `is_archived=true` 后才记 `ARCHIVE_VERIFIED`。合同测试 `10/10` 通过，真实 Ozon 写入仍未执行。
- Ozon v2 只读 preflight：COM VPS 从加密数据库唯一选择 `DOTH / Client ID 4980990`，对 reserved offer `ss-erp-sbx-v2-20260906-0ede34eb-01` 执行新门禁；结果为 `READY_FOR_SEPARATE_WRITE_APPROVAL`、Seller `DOIT`、`offerExists=false`、`networkWritesSent=false`，回执 SHA-256 `3dbeef2949c8a943ae11a1cb92d6ca710d3ab9f0a46279fad900f229d7b1d6d1`，VPS 与本机受保护目录逐字节一致。历史 v1 回执 `5bb18366...ee646` 只保留审计，不能用于 execute。
- Ozon production compiler 输入盘点：同一 `DOTH / 4980990` 店铺当前 `sourceListingWorkflow` 为 0，`PUBLISH_INTENT_RECORDED` 可导出草稿为 0；未读取商品正文、图片或客户数据。写入前必须先通过正常 ERP 流程创建纯测试草稿并完成来源、类目、属性、图片、包裹与价格权威审核，不能手写 envelope 绕过 owner。ERP 别名 `DOTH` 与 Seller `DOIT` 的业务对应仍需操作员确认。
- Ozon 测试素材准备：操作员已确认 `DOTH` 对应 Seller `DOIT`，并授权只写 ERP 的测试工作流/图片。固定 1200x1200 单页 PNG 明示 `TEST ONLY / NO REAL PRODUCT / NOT FOR SALE`，源 SHA-256 `f53b25e7...d7b74`；通过 600 秒临时 USER session 上传到 COM 默认 OSS，回执 SHA-256 `ec11f958...3701b`。公网重新下载 63,671 bytes 后 SHA 一致；临时 session 已撤销并复核无 600 秒内短时 session，Provider/Ozon 请求均为 0。
- Ozon 测试工作流配置边界：`DOTH` owner 当前有 165 个 supply goods、1 个 Capture subject/1 个 snapshot，但 `SOURCE_CAPTURE_V2`、`SOURCE_LISTING_WORKFLOW`、Ozon mapping read/write 与 publisher 均为 `master_off`。正常 API 创建新 Capture/Workflow 会失败关闭；未绕过 gate 直写 Prisma。继续需要 exact owner/shop 的临时 `SOURCE_CAPTURE_V2=shadow_write` 与 `SOURCE_LISTING_WORKFLOW=dual_read` pilot，publisher 必须保持关闭，并需由操作员提供测试商品真实的包裹重量/长宽高、定价/币种/VAT 和类目方向。
- QA-04 归属：`fbb5f11d` 起，离线 gate 在首尾分别验证相同 Git root、精确 40 位 HEAD 和完整 clean porcelain，拒绝 staged/untracked/运行中漂移。`0ede34ebd479157b96de946e0bd8347dbc2b8a7e` 上的九项 rehearsal 全部通过：server `5165 passed / 223 skipped`，source/cloud/local extension verifier 均 `0 failure / 0 warning`，scope-revocation 与 AI Media PostgreSQL 148 migrations 回放通过。准确付费 Provider QA-02 仍未完成，因此没有生成或宣称正式 `QA04_FINAL_ACCEPTANCE`。

## 危险接管动作

- 是否要创建或改写 agent 宪法：是，用户已明确要求按审计流程修复并继续。
- 是否要确认内部真源目录：使用此前审计推荐的 `dev-docs/`，用户已要求按该流程执行。
- 是否要移动/归档/删除旧文档：否。
- 是否要重命名产品或公开文案：否。
- 是否要删除旧 API/字段/路由：否。
- 是否要改变 Git/发布流程：只做当前分支阶段提交与 push；本轮按用户授权执行 VPS 备份/恢复、attestation 刷新、pilot 撤销和暗态恢复，不创建 tag、GitHub Release 或绕过签名门禁部署。

## 下一步

- 推荐下一路线：本地开发可继续；需要发布时进入 `验收`/`发布准备`，补齐外部运行证据，不把本地绿灯当作发布授权。
- 为什么不是直接开发：多 owner 修复需要一个持久顺序，防止安全、CI 和结构更改互相污染。
- 第一个安全任务：建立治理和运行基线，确保后续提交有唯一范围和验收 owner。
- 需要用户确认：Provider 每个真实操作仍需独立精确费用上限和一次性批准；Ozon 写入仍需有效凭据且可证明为专用测试店。远端备份按用户决定暂不配置，受管扩展 live worker 已完成独立验收。
- 停止条件：出现产品行为改变、数据迁移、真实费用、凭据、部署、公开发布或无法隔离用户现有改动。
- 未验证项：远端仓库 visibility、Redis 集群/外部告警、可对账 Provider pilot、Ozon 纯测试工作流/compiler envelope/写入/归档、REL-04 canary 对区域候选四件套的精确摘要绑定，以及 CN 远端备份。
