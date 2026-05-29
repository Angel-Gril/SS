# SS ERP 部署指南

## 一、环境准备

### 1.1 服务器要求
- **操作系统**：Ubuntu 22.04 / CentOS 8+ / Debian 11+
- **CPU**：2 核+
- **内存**：4GB+
- **磁盘**：20GB+（建议 SSD）
- **网络**：能访问 OZON API（可能需要代理）

### 1.2 依赖服务
- **PostgreSQL 14+**
- **Redis 7+**（可选，禁用后 BullMQ worker 全部不启动）
- **Node.js 22+**
- **pnpm 11+**

---

## 二、数据库初始化

### 2.1 创建数据库
```bash
sudo -u postgres psql
CREATE DATABASE ss_erp;
CREATE USER ss_erp_user WITH PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE ss_erp TO ss_erp_user;
\q
```

### 2.2 运行 Prisma migration

仓库已包含 `20260529000000_baseline` 完整 baseline migration（覆盖全部 schema）。

```bash
cd apps/server
cp ../../.env.example .env
# 编辑 .env，至少填 DATABASE_URL / ENCRYPTION_KEY / JWT_SECRET

# === 场景 A：全新空库 ===
npx prisma migrate deploy

# === 场景 B：已有数据的库（之前用 db push 同步过） ===
# 标记 baseline 为已应用（不执行 SQL，只记录状态）
npx prisma migrate resolve --applied 20260529000000_baseline
```

后续 schema 变更：开发环境 `npx prisma migrate dev --name xxx`，生产部署 `npx prisma migrate deploy`。**禁止 `db push`**。

---

## 三、环境变量配置

完整字段以仓库根目录 `.env.example` 为准；生产环境在此基础上填写真实密钥、域名和 `NODE_ENV=production`。

### 3.1 必填项（生产环境，缺失会拒绝启动）

```bash
DATABASE_URL="postgresql://ss_erp_user:password@localhost:5432/ss_erp"

# 加密密钥（≥32 字符）
ENCRYPTION_KEY="$(openssl rand -base64 32)"

# JWT 密钥（≥32 字符）
JWT_SECRET="$(openssl rand -base64 32)"

# CORS 白名单（逗号分隔）
CORS_ORIGIN="https://app.yourdomain.com"

NODE_ENV="production"
```

### 3.2 强烈推荐

```bash
# Redis（启用 BullMQ worker：订单/产品/财务同步、计费、调度、通知清理）
REDIS_URL="redis://:password@host:6379"
REDIS_DISABLED="0"

# Cloudflare Turnstile（后端已校验 turnstileToken；生产上线前还需前端组件接入）
# 不配置时生产环境会拒绝注册；配置后注册请求必须携带有效 turnstileToken
TURNSTILE_SECRET_KEY="your_turnstile_secret"

# 短信 provider（生产发送验证码用；注册验证码路由/前端闭环需上线前接入）
SMS_PROVIDER="tencent"
SMS_TENCENT_SECRET_ID="..."
SMS_TENCENT_SECRET_KEY="..."
SMS_TENCENT_REGION="ap-guangzhou"
SMS_TENCENT_SDK_APP_ID="..."
SMS_TENCENT_SIGN_NAME="..."
SMS_TENCENT_TEMPLATE_ID="..."

# Sentry 错误追踪
SENTRY_DSN="https://xxx@xxx.ingest.sentry.io/xxx"
```

### 3.3 OSS 对象存储 — 走超管 UI，不在 .env 配置

> 重要：OSS 配置存在数据库 `system_configs` 表，不是环境变量。

部署完成后，使用超级管理员账号登录，访问 `/admin/settings` 配置（后端 API 为 `/api/admin/system-config`）：
- `image_storage_backend`：取值 `local` / `oss` / `ozon-cdn`
- `oss_config`：JSON，包含 `endpoint / bucket / accessKeyId / accessKeySecret / region / cdnDomain / pathPrefix`

支持 S3 兼容存储（阿里云 OSS / 腾讯云 COS / Cloudflare R2 / AWS S3 / MinIO）。

**OSS Bucket CORS 配置**（用于前端直传 `/api/images/presign`）：
```xml
<CORSRule>
  <AllowedOrigin>https://app.yourdomain.com</AllowedOrigin>
  <AllowedMethod>PUT</AllowedMethod>
  <AllowedMethod>GET</AllowedMethod>
  <AllowedHeader>*</AllowedHeader>
  <MaxAgeSeconds>3600</MaxAgeSeconds>
</CORSRule>
```

### 3.4 可选配置

```bash
# 出口代理（访问 OZON / 汇率 API 受限时）
HTTPS_PROXY="http://proxy.example.com:8080"

# Session / 端口
SESSION_TTL_SECONDS="604800"
SERVER_PORT="3001"
LOG_LEVEL="info"

# 便携包（Windows 离线版）
# SS_ERP_CONFIG="/path/to/config.json"
```

---

## 四、构建与部署

### 4.1 Docker Compose（推荐）
```bash
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml logs -f api
```

### 4.2 手动部署
```bash
pnpm install --frozen-lockfile
pnpm --filter server db:generate
pnpm --filter server build
pnpm --filter web build

pm2 start apps/server/dist/index.js --name ss-erp-api
pm2 start "pnpm --filter web start" --name ss-erp-web
pm2 save
```

---

## 五、Nginx 反向代理

```nginx
upstream api {
    server 127.0.0.1:3001;
}

upstream web {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name app.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.yourdomain.com/privkey.pem;

    # API（注意：HttpOnly cookie 鉴权依赖同源；跨子域需要 cookie domain 配置）
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 30M;
    }

    # 健康检查（后端实际路径为 /health）
    location = /health {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态图片（local / ozon-cdn 后端会经过这里；oss 后端走 CDN 域名）
    location ~ ^/(uploads|watermarked|resized)/ {
        proxy_pass http://api;
        proxy_cache_valid 200 1d;
        add_header Cache-Control "public, max-age=86400";
    }

    location / {
        proxy_pass http://web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

启用：
```bash
sudo ln -s /etc/nginx/sites-available/ss-erp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 六、SSL 证书（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d app.yourdomain.com
```

---

## 七、验证部署

```bash
# 健康检查
curl https://app.yourdomain.com/health
# 预期: {"status":"ok","timestamp":"..."}

# 注册流程：访问 https://app.yourdomain.com，确认前端已提交 turnstileToken 并完成短信验证码闭环
# 登录成功后浏览器应有 HttpOnly cookie sserp_token
```

---

## 八、监控与维护

### 8.1 日志轮转
```
/var/log/ss-erp/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 8.2 数据库备份
TODO：详细脚本见 `scripts/backup-db.sh`（P1 #8 任务，待实现）。生产环境建议直接用云 RDS 自带 PITR + 每周 logical dump 到独立 OSS 桶。

### 8.3 监控指标
- API 响应时间：`/health` 延迟
- 数据库连接：`SELECT count(*) FROM pg_stat_activity;`
- Redis 内存：`redis-cli INFO memory`
- 磁盘空间：`df -h`
- Sentry：错误率 / 5xx 趋势

---

## 九、常见问题

### 9.1 启动报错 `JWT_SECRET 未配置或长度不足 16 字符`
生产环境 `bootstrap-config.ts` 启动时硬校验 `JWT_SECRET` 和 `ENCRYPTION_KEY`，缺失或使用默认值会直接 `process.exit(1)`。检查 `.env` 字段值。

### 9.2 注册返回 `人机验证失败，请重试`
生产环境下 `/api/auth/register` 必须收到有效 `turnstileToken`。检查前端 Turnstile 组件是否已接入，以及 `TURNSTILE_SECRET_KEY` 是否正确。

### 9.3 启动报错 `SMS_PROVIDER 未配置`
生产环境必须显式配置 `SMS_PROVIDER=tencent` 或 `console`（仅测试用）。注意：provider 只负责发送，注册验证码发送路由和前端校验闭环仍需确认已接入。

### 9.4 上架失败：完整错误被截断
查看服务端日志：`docker-compose -f docker-compose.prod.yml logs -f api | grep "publish-ozon"`。常见原因：源商品禁止跟卖、必填属性缺失、offer_id 重复。

### 9.5 图片上传失败
- `local` 后端：检查 `public/uploads` 写权限
- `oss` 后端：检查超管 UI 的 `oss_config`，以及 OSS bucket 的 CORS / 公读策略
- `ozon-cdn` 后端：扩展同步 cookie 是否过期

### 9.6 登录失败 5 次后无法登录
IP 失败计数命中 Turnstile 兜底。前端传 `turnstileToken` 或 `redis-cli DEL login:fail:<IP>`。

---

## 十、安全加固

```bash
# 防火墙
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 禁用 root SSH（/etc/ssh/sshd_config）
PermitRootLogin no
PasswordAuthentication no

# Cloudflare 真源保护：参考 P1 #5 任务（待实现）
# 计划在 Nginx 加 geo $is_cloudflare 限制只接受 CF IP 流量
```

---

## 附录：快速启动清单

- [ ] 服务器准备（2核4G+）
- [ ] 安装 PostgreSQL + Redis
- [ ] 创建数据库
- [ ] 配置 `.env`：DATABASE_URL / ENCRYPTION_KEY / JWT_SECRET / CORS_ORIGIN / NODE_ENV
- [ ] 配置 Turnstile（`TURNSTILE_SECRET_KEY`）并确认前端提交 `turnstileToken`
- [ ] 配置短信网关（`SMS_PROVIDER` + `SMS_TENCENT_*`）并确认注册短信验证码闭环
- [ ] 配置 Sentry（`SENTRY_DSN`）
- [ ] 运行 Prisma migration（空库 `migrate deploy` / 已有库 `migrate resolve --applied`）
- [ ] 构建：`docker-compose -f docker-compose.prod.yml build`
- [ ] 启动：`docker-compose -f docker-compose.prod.yml up -d`
- [ ] Nginx 反代 + SSL
- [ ] 健康检查：`curl https://app.yourdomain.com/health`
- [ ] 超管登录后配置 OSS（`/admin/settings`）
- [ ] 设置 OSS bucket CORS（如启用 OSS 直传）
- [ ] 配置数据库定时备份（cron + pg_dump）
