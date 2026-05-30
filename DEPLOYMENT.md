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
- **Redis 7+**（生产必须启用；短信验证码、登录失败计数和 BullMQ worker 依赖 Redis）
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

# Cookie Secure 开关：正式 HTTPS 保持 true；仅 HTTP staging 临时测试可设 false
AUTH_COOKIE_SECURE="true"

# 首个超级管理员初始化令牌（仅 /setup 首次创建 ADMIN 使用）
SETUP_TOKEN="$(openssl rand -base64 32)"

# CORS 白名单（逗号分隔）
CORS_ORIGIN="https://app.yourdomain.com"

NODE_ENV="production"
```

首个超级管理员必须通过 `/setup` 引导页创建，不能走公开注册。生产环境缺少 `SETUP_TOKEN` 时，`/api/setup/init` 会拒绝创建管理员，避免公网首个访问者抢占管理员权限。创建完成后，普通用户走 `/register`，员工和额外管理员由已有管理员在后台创建或邀请。

如果暂时只用 `http://公网IP` 做 staging 验收，需要临时设置 `AUTH_COOKIE_SECURE=false`，否则浏览器不会保存生产环境的 Secure cookie，表现为注册/登录成功后仍进不了 ERP。绑定 HTTPS 域名后必须改回 `true` 或删除该变量。

### 3.2 强烈推荐

```bash
# Redis（启用短信验证码、登录失败计数、BullMQ worker：订单/产品/财务同步、计费、调度、通知清理）
REDIS_URL="redis://:password@host:6379"
REDIS_DISABLED="0"

# Cloudflare Turnstile（保护短信发码；登录失败过多后触发二次验证）
# 不配置时生产环境会拒绝短信发码和登录二次验证；前端需要 NEXT_PUBLIC_TURNSTILE_SITE_KEY 渲染组件
TURNSTILE_SECRET_KEY="your_turnstile_secret"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="your_turnstile_site_key"

# 短信 provider（生产发送注册验证码用）
SMS_PROVIDER="tencent"
SMS_TENCENT_SECRET_ID="..."
SMS_TENCENT_SECRET_KEY="..."
SMS_TENCENT_REGION="ap-guangzhou"
SMS_TENCENT_SDK_APP_ID="..."
SMS_TENCENT_SIGN_NAME="..."
SMS_TENCENT_TEMPLATE_ID="..."

# Sentry 错误追踪
SENTRY_DSN="https://xxx@xxx.ingest.sentry.io/xxx"
NEXT_PUBLIC_SENTRY_DSN="https://xxx@xxx.ingest.sentry.io/xxx"
```

### 3.3 图片存储 / OSS 对象存储

> 重要：图片存储和 OSS 凭证通过环境变量配置，不再写入数据库 `system_configs`。超管 `/admin/integrations` 页面只显示接入状态和测试连接。

```bash
# 云端推荐 oss；OSS 未准备好时，staging 可临时使用 ozon-cdn。
IMAGE_STORAGE_BACKEND="oss"   # local / oss / ozon-cdn
LOCAL_BASE_URL="https://app.yourdomain.com"

# OZON CDN 国内直连失败时可填 CF Worker 中转地址
OZON_CDN_RELAY_URL=""

# OSS 失败时，如果目标店铺已同步 OZON CDN cookie/company_id，自动降级到 OZON CDN
OSS_FALLBACK_TO_CDN="true"

# IMAGE_STORAGE_BACKEND=oss 时必填
OSS_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com"
OSS_BUCKET="ss-erp-assets"
OSS_ACCESS_KEY_ID="..."
OSS_ACCESS_KEY_SECRET="..."
OSS_REGION="cn-hangzhou"
OSS_CDN_DOMAIN=""  # 可选，例如 https://assets.yourdomain.com
```

对象路径由系统固定生成：`userId/category/yyyy/mm/hash.ext`，其中 `category` 目前为 `raw`，后续水印图/缩略图扩展为 `watermarked` / `thumbnail`。不要在 `.env` 或超管 UI 自定义路径前缀，避免生产数据进入后路径规则漂移。

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

# 注册流程：访问 https://app.yourdomain.com，确认发送短信验证码前已通过 Turnstile，注册提交时服务端校验短信码
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

脚本位于 `scripts/backup-db.sh`，配套恢复脚本 `scripts/restore-db.sh`。

**部署步骤：**
```bash
# 1. 创建环境变量文件（参考 scripts/backup-db.crontab.example）
sudo tee /etc/ss-erp-backup.env << 'EOF'
BACKUP_DB_URL="postgresql://ss_erp_user:password@localhost:5432/ss_erp"
BACKUP_LOCAL_DIR="/var/backups/ss-erp"
BACKUP_KEEP_DAYS="7"
BACKUP_S3_BUCKET="ss-erp-backup"
BACKUP_S3_ENDPOINT="https://oss-cn-hangzhou.aliyuncs.com"
BACKUP_S3_ACCESS_KEY_ID="..."
BACKUP_S3_SECRET_ACCESS_KEY="..."
BACKUP_S3_PREFIX="db/"
BACKUP_S3_REGION="oss-cn-hangzhou"
EOF
sudo chmod 600 /etc/ss-erp-backup.env
sudo mkdir -p /var/backups/ss-erp /var/log/ss-erp

# 2. 手动测试一次
sudo bash -c 'source /etc/ss-erp-backup.env && bash /opt/ss-erp/scripts/backup-db.sh'

# 3. 加入 root cron（每天凌晨 3:00，按服务器本地时区）
(sudo crontab -l 2>/dev/null; echo '0 3 * * * . /etc/ss-erp-backup.env && bash /opt/ss-erp/scripts/backup-db.sh >> /var/log/ss-erp/backup.log 2>&1') | sudo crontab -
```

**恢复：**
脚本生成的备份包含 `pg_dump --clean --if-exists`，恢复时会先删除并重建 dump 内的对象。执行前必须停止 API/worker，并确认 `BACKUP_DB_URL` 指向正确目标库。

```bash
source /etc/ss-erp-backup.env
# 列出本地备份
bash scripts/restore-db.sh
# 从本地恢复
bash scripts/restore-db.sh ss_erp_20260529_030000.sql.gz
# 从 S3 恢复
bash scripts/restore-db.sh --from-s3 db/ss_erp_20260529_030000.sql.gz
```

**后期修改：**
- 改频率：`sudo crontab -e` 改时间表达式
- 改保留天数：改 `/etc/ss-erp-backup.env` 的 `BACKUP_KEEP_DAYS`
- 切桶：改 `BACKUP_S3_*` 变量
- OSS 端保留策略：在 OSS 控制台设置桶生命周期规则（如 90 天自动删除）

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

### 9.2 发送验证码返回 `人机验证失败，请重试`
生产环境下 `/api/auth/sms-code` 必须收到有效 `turnstileToken`。检查前端 Turnstile 组件是否已渲染、`NEXT_PUBLIC_TURNSTILE_SITE_KEY` 是否正确，以及后端 `TURNSTILE_SECRET_KEY` 是否匹配。

### 9.3 启动报错 `SMS_PROVIDER 未配置`
生产环境必须显式配置 `SMS_PROVIDER=tencent` 或 `console`（仅测试用）。注意：provider 只负责发送，真实上线还要确认腾讯云签名、模板和短信内容已审核通过。

### 9.4 上架失败：完整错误被截断
查看服务端日志：`docker-compose -f docker-compose.prod.yml logs -f api | grep "publish-ozon"`。常见原因：源商品禁止跟卖、必填属性缺失、offer_id 重复。

### 9.5 图片上传失败
- `local` 后端：检查 `public/uploads` 写权限，以及 `LOCAL_BASE_URL` 是否为公网 HTTPS 地址
- `oss` 后端：检查 `OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET` 环境变量，以及 OSS bucket 的 CORS / 公读策略
- `ozon-cdn` 后端：扩展同步 cookie 是否过期；国内直连失败时检查 `OZON_CDN_RELAY_URL`

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
- [ ] 配置 Turnstile（`TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`）并确认发送验证码接口提交 `turnstileToken`
- [ ] 配置短信网关（`SMS_PROVIDER` + `SMS_TENCENT_*`）并确认注册短信验证码闭环
- [ ] 配置 Sentry（`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`）
- [ ] 运行 Prisma migration（空库 `migrate deploy` / 已有库 `migrate resolve --applied`）
- [ ] 构建：`docker-compose -f docker-compose.prod.yml build`
- [ ] 启动：`docker-compose -f docker-compose.prod.yml up -d`
- [ ] Nginx 反代 + SSL
- [ ] 健康检查：`curl https://app.yourdomain.com/health`
- [ ] 配置图片存储环境变量（`IMAGE_STORAGE_BACKEND` + `OSS_*` 或 staging 临时 `ozon-cdn`）
- [ ] 设置 OSS bucket CORS（如启用 OSS 直传）
- [ ] 配置数据库定时备份（cron + pg_dump）
