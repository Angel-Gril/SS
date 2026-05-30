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
- Worker: 后续从 API 中拆出独立进程
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
5. 构建并启动容器。
6. 执行 `prisma migrate deploy`。
7. 验证 `/health`、登录、店铺连接、图片上传、订单同步。
8. Cloudflare 开启代理、WAF 和 Turnstile。
9. 防火墙限制源站只接受 Cloudflare IP 和运维 SSH。

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

```powershell
$env:ENV_FILE=".env.production"
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node node_modules/prisma/build/index.js migrate deploy
```

当前 API 进程会同时启动 workers。后续应拆出 `apps/server/src/worker.ts` 或类似入口，再在 compose 中单独启动 `worker` 服务。

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
- OSS 回滚：对象 key 不覆盖，用版本化路径，如 `ss-erp/images/yyyy/mm/...`。

## 备份策略

- RDS 自动备份和 PITR 至少保留 7 天。
- 每周 `pg_dump` 到独立 OSS bucket，保留 90 天。
- 备份账号和应用账号分离。
- 每月至少做一次恢复演练。
