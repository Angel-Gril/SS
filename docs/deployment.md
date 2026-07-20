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
- `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（注册/登录人机验证）
- `SMS_PROVIDER` + `SMS_TENCENT_*`（短信验证码）
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`（服务端 / 浏览器端错误追踪）
- `NEXT_PUBLIC_API_BASE_URL`（前端 API 地址）
- `IMAGE_STORAGE_BACKEND` + `OSS_*`（图片存储；云端推荐 `oss`，OSS 未准备好时 staging 可临时用 `ozon-cdn`）

OSS/图片存储配置走环境变量，不再存入 `system_configs`。详见根目录 `DEPLOYMENT.md` 第 3.3 节。

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

```env
MIGRATION_TIMEOUT=20m
```

超时时 wrapper 先发送 TERM，并在 30 秒后强制结束。若超时发生在 concurrent-index migration，不要直接重跑或标记 applied；先按 `docs/RUNBOOK.md` 检查 invalid index，再决定清理和重放。

## AI Media 暗态发布门禁

Unit 9C-A、10B-E 和 9C-B 已实现暗态 fake-only `FULL_EDIT` / `INPAINT`、Web Mask 编辑器及受约束的候选链式编辑。`1600` 至 `1660` migration 会前向保留来源工作流互斥锁、OLD/NEW 反向重验和完整候选图片契约，应用版本回滚不得尝试回退这些 additive database guards。真实 Provider、扩展端 Mask 编辑器、替换/回滚 UI 和外部质量验收仍未完成。发布时以下状态必须为 `false` 或 absent：

- `feature_ai_media_workflow_v2`
- `feature_ai_media_suite`
- `feature_ai_media_full_edit`
- `feature_ai_media_inpaint`
- `feature_source_listing_web_media`

`ai_media_workflow_v2_rollout_policy` 必须是合法 JSON、revision 为非负整数且 `tenantIds` 为空。Compose 以 `migrate` service 的成功退出作为强制门禁；以下宿主机命令仅用于独立审计和故障排查：

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-ai-media-dark.sh
```

只有 `PASS AI Media rollout is dark` 才允许切换 release 或启动 API/Worker。检查失败时按以下顺序恢复：

1. 保持 API/Worker 停止，保存失败输出和当前 `system_configs` 快照。
2. 确认没有经过审批的试点后，通过受审计的管理员变更将五个开关恢复为 `false`，将 rollout policy 恢复为空 tenant 列表；不要用 shell 忽略 verifier 的退出码。
3. Compose 修复配置后重新运行 `deploy-compose.sh`，并检查一次性 migrate/gate 日志；systemd/手工部署重新运行宿主机 verifier。通过后再恢复服务；仍失败则恢复上一版应用，数据库保持 additive migration 的前向状态。
4. 若失败来自 `20260720153000_bind_ai_image_edit_outputs` 并发索引 migration，禁止直接 `resolve --applied`。按 `docs/RUNBOOK.md` 检查 `pg_index.indisvalid` 和 `pg_get_indexdef`，必要时 `DROP INDEX CONCURRENTLY`、`prisma migrate resolve --rolled-back`、重新 deploy 并复核定义。

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
- OSS 回滚：对象 key 不覆盖，用版本化路径，如 `ss-erp/images/yyyy/mm/...`。

## 备份策略

- RDS 自动备份和 PITR 至少保留 7 天。
- 每周 `pg_dump` 到独立 OSS bucket，保留 90 天。
- 备份账号和应用账号分离。
- 每月至少做一次恢复演练。
