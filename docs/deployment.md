# SS ERP 生产部署草案

本文档描述云端 SaaS 部署骨架。本地 Windows 离线包继续使用 `build/scripts`，不要和云端部署混用。

## 运行模式

### 本地开发/离线版

- Web: Next.js 本地服务
- API: Fastify 本地服务
- DB: 本地 PostgreSQL 或打包版 PostgreSQL
- Redis: 可禁用或本地 Redis（禁用后短信验证码不可用，仅适合本地调试）
- 文件: 本地 `public/uploads`、`public/watermarked`

### 云端 SaaS

- Web: Next.js 容器
- API: Fastify 容器
- Worker: 独立进程（API 使用 `RUN_WORKERS=0`）
- DB: RDS PostgreSQL 或托管 PostgreSQL
- Redis: 托管 Redis
- 文件: OSS/COS/R2 + CDN
- 入口: Cloudflare + Nginx/Caddy

## 推荐域名

- `app.example.com`: Web
- `api.example.com`: API
- `assets.example.com`: OSS/CDN
- `updates.example.com`: 扩展和桌面端更新包

如果源站或 CDN 在中国内地，域名仍然需要按服务商规则做 ICP 备案；`.com` 不等于自动免备案。

## 首次云端部署流程

1. 准备 `.env.production`，不要提交真实密钥。
2. 创建 PostgreSQL 和 Redis。
3. 创建 OSS/R2/COS bucket，配置 CORS 和 CDN 域名。
4. 执行 Prisma baseline 校准。
5. 构建镜像，但先不要启动 API/Worker。
6. 停止写入后执行 `prisma migrate deploy`。
7. 运行 `scripts/verify-ai-media-dark.sh`；失败时保持 API/Worker 停止。
8. 暗态检查通过后启动服务，验证 `/health`、登录、店铺连接、图片上传、订单同步。
9. Cloudflare 开启代理、WAF 和 Turnstile。
10. 防火墙限制源站只接受 Cloudflare IP 和运维 SSH。

## 生产环境变量

核心变量见 `.env.production.example`。

必须项（缺失会拒绝启动）：

- `DATABASE_URL`
- `JWT_SECRET`（≥32 字符）
- `ENCRYPTION_KEY`（≥32 字符）
- `SETUP_TOKEN`（首次创建超级管理员的初始化令牌）
- `CORS_ORIGIN`
- `NODE_ENV=production`

强烈推荐：

- `REDIS_URL`（启用短信验证码、登录失败计数和 BullMQ worker）
- 国际站人机验证：`HUMAN_CHALLENGE_PROVIDER=cloudflare-turnstile` + `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_ALLOWED_HOSTNAMES`。白名单填写英文逗号分隔的精确 hostname，不支持协议、端口、路径或通配符，留空或非法时认证失败关闭。
- 国内站人机验证：`HUMAN_CHALLENGE_PROVIDER=builtin-pow` + 至少 32 位随机 `HUMAN_CHALLENGE_SIGNING_SECRET`；按需设置 `HUMAN_CHALLENGE_POW_DIFFICULTY=4` 和 `HUMAN_CHALLENGE_TTL_SECONDS=120`。
- `SMS_PROVIDER` + `SMS_ALIYUN_*` 或 `SMS_TENCENT_*`（短信验证码；阿里云生产优先使用 ECS RAM Role）
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`（服务端 / 浏览器端错误追踪）
- `NEXT_PUBLIC_API_BASE_URL`（前端 API 地址）
- `IMAGE_STORAGE_BACKEND` + `OSS_*`（图片存储；云端推荐 `oss`，OSS 未准备好时 staging 可临时用 `ozon-cdn`）

OSS/图片存储配置走环境变量，不再存入 `system_configs`。详见根目录 `DEPLOYMENT.md` 第 3.3 节。

`HUMAN_CHALLENGE_PROVIDER`、`TURNSTILE_*` 和 PoW 环境变量显式设置后优先于管理员后台；未设置时才读取 `SystemConfig`。部署前必须确认最终生效来源，避免环境变量和后台保存两套冲突值。旧部署若仍使用 `FEATURE_TURNSTILE_LOGIN=true`，同样必须配置 Turnstile 两把 key 与 `TURNSTILE_ALLOWED_HOSTNAMES`。

首个超级管理员只允许通过 `/setup` 引导流程创建。公开注册只创建普通 `USER`，且在系统没有任何 `ADMIN` 前会被后端拒绝。生产环境必须配置 `SETUP_TOKEN`，防止公网首次访问者抢占管理员账号。

## 部署命令示例

```bash
COMPOSE_FILE=docker-compose.prod.yml \
ENV_FILE=.env.production \
MIGRATION_TIMEOUT=20m \
bash scripts/deploy-compose.sh
```

`deploy-compose.sh` 先构建镜像，再停止旧 API/Worker/Web，随后启动基础设施并运行一次性 `migrate` service；只有 `prisma migrate deploy` 和容器内暗态 verifier 都通过，才会重建并启动应用服务。失败或超时时旧应用服务保持停止，必须由运维按 Runbook 检查后恢复。不要用裸 `docker compose up -d` 执行升级，因为 `depends_on` 不会静默已经运行的旧容器。生产和 staging Compose 仍保留 `service_completed_successfully`，用于约束全新环境的首次启动。Compose 中 API 和 Worker 已分离：API 设置 `RUN_WORKERS=0`，Worker 使用 `node dist/worker.js`。

标准 systemd 部署应使用 `scripts/deploy.sh`、`scripts/deploy-app-dir.sh` 或 `scripts/deploy-staging.sh`，它们同样在 migration 后、切换或重启服务前执行暗态 verifier。四类入口的 `MIGRATION_TIMEOUT` 默认都是 `20m`，只接受正整数加 `s`、`m` 或 `h`，例如 `900s`、`20m`、`1h`。Linux 脚本通过进程环境覆盖；Compose 在 `.env.production` / `.env.staging` 中设置：

三个 systemd 部署脚本都会在切换或重启服务前同时生成 cloud 与 local 扩展 ZIP；cloud 包使用当前站点域名，local 包固定连接本机 ERP。两类包都以当前线上产物和源码 manifest 的较高版本为基线自动递增一次。成功发布同一提交后不要仅为检查产物重复执行部署，否则扩展补丁版本会再次递增；应通过 `/api/extensions/latest` 和两个下载端点验收现有产物。`deploy-staging.sh --skip-build` 会连同扩展打包一起跳过，只用于已经验证过全部构建产物的场景。

```env
MIGRATION_TIMEOUT=20m
```

超时时 wrapper 先发送 TERM，并在 30 秒后强制结束。若超时发生在 concurrent-index migration，不要直接重跑或标记 applied；先按 `docs/RUNBOOK.md` 检查 invalid index，再决定清理和重放。

## AI Media 暗态发布门禁

Unit 9C-A、10B-E 和 9C-B 已实现暗态 fake-only `FULL_EDIT` / `INPAINT`、Web Mask 编辑器及受约束的候选链式编辑；Unit 10A-H1/H2/H3a/H3b 已完成历史恢复及 collect/listing-draft 应用账本，Unit 10A-H4 已增加对“已经被 Provider 接收”的异步图片翻译任务进行只查询、不重提的结果核对。`1600` 至 `1660` migration 会前向保留来源工作流互斥锁、OLD/NEW 反向重验和完整候选图片契约；`1670`/`1680` 增加 history/updates keyset 索引；`1690`/`1700` 及 `21120000` 至 `21123000` 建立 collect/listing-draft 应用账本；`21124000` 至 `21131000` 建立 Provider 结果核对状态、租约、事件和积压恢复索引。应用版本回滚不得回退这些数据库约束、账本、审计事件或有效索引。扩展双模式工作台、planned-suite、BYOK 审核/接收和统一发布协调已完成代码与本地 Chrome QA，但准确付费 Provider 的 `QA-02`、生产等价质量、试点和真实 Ozon 验收仍未完成。用户与管理员操作边界见[扩展 AI 图片工作台操作指南](extension-ai-image-workbench.md)。未经批准时以下历史 AI Media 状态必须为 `false` 或 absent：

Unit 10A-H3b 已增加暗态 fake-only listing-draft 精确槽位 APPEND/confirmed REPLACE、不可变账本及前向补偿 ROLLBACK。`20260721120000` 至 `20260721123000` 建立并加固 owner/actor/snapshot/operation/projection authority；生产能力响应必须保持 `listingDraftApplyEnabled=false`，只读历史和既有 rollback 仍可用。

- `feature_ai_media_workflow_v2`
- `feature_ai_media_suite`
- `feature_ai_media_full_edit`
- `feature_ai_media_inpaint`
- `feature_source_listing_web_media`

双模式扩展还有独立的默认关闭门禁；未经批准的 pilot 前保持：

- `feature_extension_hosted_ai=false`
- `feature_extension_byok_ai=false`
- `feature_extension_byok_ingest=false`
- `feature_extension_byok_publish=false`
- `extension_byok_admin_policy` 的 `mode` 为 `off`

`verify-ai-media-dark.sh` 现在同时查询上述四个扩展开关和
`extension_byok_admin_policy`，并把 Extension BYOK expectation 固定为 `off`。它只证明部署可
在暗态启动，不授权任何 pilot。`sandbox-pilot` / `publish-pilot` 必须另行使用
`verify-extension-byok-rollout-policy.mjs`，并显式传入期望的 hosted 开关、revision、owner、
shop、device session、Provider origin 和 operations；`maxConcurrency` 必须为 1。

正式扩展发布还要求私有部署 env 明确提供三项独立审批证据，且每项都是不带路径、查询或片段
的公开 HTTPS origin：

```text
EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN
EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN
EXTENSION_RELEASE_EXPECTED_API_ORIGIN
```

三项值不会从 `EXTENSION_CLOUD_BASE_URL` / `NEXT_PUBLIC_*` 自动推导。`pnpm package:extension`
一次计算版本并生成同版 cloud/local ZIP、SHA-256 清单和 canonical release evidence JSON；
验证器会解包重验 defaults、manifest permissions、文件数、ZIP SHA/CRC 与完整 commit。Evidence
中的 `signature.status=EXTERNAL_REQUIRED` 表示仍须完成真实签名/商店回执，不能把本地 JSON
当成签名。

`ai_media_workflow_v2_rollout_policy` 必须是合法 JSON、revision 为非负整数且 `tenantIds` 为空。Compose 以 `migrate` service 的成功退出作为强制门禁；以下宿主机命令仅用于独立审计和故障排查：

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-ai-media-dark.sh
```

只有 `PASS AI Media rollout is dark` 才允许切换 release 或启动 API/Worker。检查失败时按以下顺序恢复：

1. 保持 API/Worker 停止，保存失败输出和当前 `system_configs` 快照。
2. 确认没有经过审批的试点后，通过受审计的管理员变更将历史 AI Media 与四个扩展开关恢复为 `false`，将 AI Media rollout policy 恢复为空 tenant 列表，并将 Extension BYOK policy 恢复为 revision 0 的默认 `off`；不要用 shell 忽略 verifier 的退出码。
3. Compose 修复配置后重新运行 `deploy-compose.sh`，并检查一次性 migrate/gate 日志；systemd/手工部署重新运行宿主机 verifier。通过后再恢复服务；仍失败则恢复上一版应用，数据库保持 additive migration 的前向状态。
4. 若失败来自 `20260720153000_bind_ai_image_edit_outputs` 并发索引 migration，禁止直接 `resolve --applied`。按 `docs/RUNBOOK.md` 检查 `pg_index.indisvalid` 和 `pg_get_indexdef`，必要时 `DROP INDEX CONCURRENTLY`、`prisma migrate resolve --rolled-back`、重新 deploy 并复核定义。
5. 若失败来自 `1670`/`1680`，分别检查 `ai_media_workflow_owner_context_history` 和 `ai_media_workflow_owner_context_updates` 的 `indisvalid`、`indisready` 与精确定义。对失败项留下的同名 invalid index 执行独立 `DROP INDEX CONCURRENTLY`，只把实际失败的 migration resolve 为 rolled back，再重跑 deploy；完整命令见 `docs/RUNBOOK.md`。
6. 若 `1700` 报 `application mutation authority upgrade requires an empty ledger`，保持所有 writer 停止；禁止删除账本、禁止 `resolve --applied`。保留数据并按 Runbook 升级为审计后的前向迁移。
7. H3a listing-draft migrations 已通过空库与 populated upgrade；若 `21001000` 至 `21011000` 任一项失败，保持 API/Worker 停止，检查对应预建索引、约束和 deferred candidate trigger 后只修复失败项并重放。不要删除已有 listing-draft context 或候选资产，也不要把暗态 gate 改为 enabled。

8. H3b migrations 必须按 `120000`、`121000`、`122000`、`123000` 顺序全部成功；失败时保持 writer 停止，不得删除账本或回退草稿版本。检查 `ai_media_listing_draft_application_mutations` 的六个索引和四个 triggers，并确认 actor trigger 拒绝 owner 之外的账号。

9. H4 migrations 必须按 `124000` 至 `131000` 顺序全部成功。`126000` 与 `130000` 都是单语句 concurrent index；失败时分别检查 `ai_image_job_workflow_provider_reconciliation` 或 `ai_image_job_provider_reconciliation_lease_due`，只清理同名 invalid index，并且只将实际失败的 migration 标记 rolled back。`131000` 会对未解决任务递增 revision、延长 deadline 并写不可变事件，不能绕过触发器或标记 applied。

### Unit 10A-H1 滚动部署边界

H1 的 `GET /workflows` 只有在显式 `pageVersion=1` 时返回 additive `{items, priorityItems, priorityItemsTruncated, priorityNextCursor, nextCursor}` DTO；未带版本的旧客户端继续接收 legacy 数组。history cursor 使用 `createdAt/id`，priority cursor 使用固定 recent cutoff 的 `updatedAt/id`，两者均绑定 owner、context 和 lane，不能互换。新 Web 首屏最多合并 100 条 priority 记录，更多待处理记录只在用户显式点击后通过 `GET /workflows/priority` 逐页加载，因此 API 应先于或与 Web 同批部署；旧 Web 不依赖新端点。

Web 以 revision、再以 `updatedAt` 合并响应，并保持 `appliedMode` 和 cost 状态单调；运行中任务每 2 秒、待人工审核/应用任务每 30 秒刷新，页面 hidden 时暂停并在恢复可见时刷新。候选绑定使用 `selectedOutputAssetId`，最多并排比较两张，并显示商品/SKU/slot scope。上述行为仍全部处于暗态、fake-only，不允许据此启用付费 Provider 或真实 Ozon 写入。

Unit 10A-H1 是 111 migrations；本地关闭证据为 PostgreSQL 45/45、populated upgrade 1/1、2627 项服务端测试通过且 125 项按环境跳过、192 项扩展检查通过，并已通过 workspace typecheck、full preflight、production build 及桌面/移动多会话浏览器验收。Unit 10A-H2 增至 113 migrations；本地关闭证据为 focused 143/143、PostgreSQL 46/46、2648 项服务端测试通过且 126 项按环境跳过、192 项扩展检查、workspace typecheck、production build 和桌面/移动 stale-refresh/rollback 浏览器验收通过，lint 为 0 errors / 20 条既有 warnings。Unit 10A-H3a 增至 118 migrations，并已完成 listing-draft/SKU context authority 的关闭验证。部署前仍必须按 Runbook 在目标环境验证 `1670`/`1680` 索引、两个应用账本、H4 状态/事件/索引和暗态 gate。

Unit 10A-H3b 增至 122 migrations。Unit 10A-H4 增至 130 migrations；空库 PostgreSQL 54/54、94-migration populated upgrade、2769 passed/134 skipped 服务端测试、192 项扩展检查、workspace typecheck、生产构建和 lint 0 errors 已通过。H4 Worker 每次只即时领取一个任务并有界排空积压，只调用既有 task ID 的 lookup/poll，绝不调用 submit；超级管理员结果核对与成本结算保持两个独立界面。上述能力不允许据此启用真实 Provider 新任务或 Ozon 写入。

## Cloudflare 设置

- DNS 对 `app` 和 `api` 开启 proxy。
- SSL/TLS 使用 Full (strict)。
- Turnstile 用于注册发送短信验证码，以及登录失败后的二次验证。
- WAF 增加登录、注册、短信发送、图片上传的 rate limiting。
- 源站防火墙只允许 Cloudflare IP 访问 80/443。
- API 获取真实 IP 时只信任 Cloudflare 转发头。

## 回滚策略

- 应用回滚：保留最近 3 个镜像 tag，Nginx 或 compose 切回上一版。
- 数据库回滚：优先前向修复；破坏性 migration 必须先备份并准备手写回滚 SQL。
- Unit 9C 暗态回滚：关闭 AI Media master/suite/full-edit/inpaint/Web-media 开关并清空 rollout tenant 列表；保留 workflow、asset、job 和 migration 数据供兼容读取与审计。
- Unit 10A-H1/H2/H3b 应用回滚：旧客户端继续使用未版本化数组；保留 `1670`/`1680` 有效索引、`1690`/`1700` collect 账本、`20260721120000` 至 `20260721123000` listing-draft 账本及所有 workflow/job/asset/draft 历史。媒体撤销只能通过当前 frontier 的补偿式 ROLLBACK mutation；不得回指旧草稿版本、删除候选或伪造历史。
- OSS 回滚：对象 key 不覆盖，用版本化路径，如 `ss-erp/images/yyyy/mm/...`。

## 备份策略

- RDS 自动备份和 PITR 至少保留 7 天。
- 每周 `pg_dump` 到独立 OSS bucket，保留 90 天。
- 备份账号和应用账号分离。
- 每月至少做一次恢复演练。
