# SS ERP 运维手册 (RUNBOOK)

## 服务器要求

- Ubuntu 22.04+ / Debian 12+
- Node.js 22+
- pnpm 11+
- PostgreSQL 16
- Redis 7
- Nginx

## 首次安装

```bash
# 1. 创建部署用户
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/ss-erp
sudo chown deploy:deploy /opt/ss-erp

# 2. 克隆代码
sudo -u deploy git clone <repo-url> /opt/ss-erp
cd /opt/ss-erp

# 3. 安装依赖
sudo -u deploy pnpm install --frozen-lockfile

# 4. 配置 staging 环境变量
sudo cp .env.staging.example .env.staging
sudo nano .env.staging  # 填入 staging 密钥

# 5. 数据库初始化
sudo -u deploy bash -lc 'cd /opt/ss-erp/apps/server && set -a && . ../../.env.staging && set +a && npx prisma generate && npx prisma migrate deploy'

# 6. 构建
sudo -u deploy bash -lc 'cd /opt/ss-erp && set -a && . ./.env.staging && set +a && pnpm --filter server build && pnpm --filter web build'

# 7. 安装 systemd 服务
sudo cp deploy/systemd/ss-erp-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ss-erp-api ss-erp-worker ss-erp-web

# 8. 安装 Nginx 配置
sudo cp docker/nginx/ss-erp.conf /etc/nginx/sites-available/
sudo cp docker/nginx/cloudflare-realip.conf /etc/nginx/conf.d/
sudo ln -sf /etc/nginx/sites-available/ss-erp.conf /etc/nginx/sites-enabled/
# 编辑 server_name 为实际域名
sudo nginx -t && sudo systemctl reload nginx

# 9. 启动
sudo systemctl start ss-erp-api ss-erp-worker ss-erp-web
```

## 日常更新

```bash
cd /opt/ss-erp
./scripts/deploy-staging.sh
```

执行部署脚本的用户需要有权限执行 `sudo systemctl restart ss-erp-*`。

默认部署当前已 checkout 的分支；如需指定分支或部署目录：

```bash
DEPLOY_BRANCH=hardening/prelaunch-auth-security ./scripts/deploy-staging.sh  # 当前预上线分支示例
DEPLOY_DIR=/opt/ss-erp ./scripts/deploy-staging.sh
```

`deploy-staging.sh` 会加载 `.env.staging`，用于 `prisma migrate deploy` 和 `next build`。如果密钥包含 `$`、`#`、空格等特殊字符，请在 `.env.staging` 里加引号，保持 shell-compatible。

## 查看日志

```bash
# API 日志
journalctl -u ss-erp-api -f

# Worker 日志
journalctl -u ss-erp-worker -f

# Web 日志
journalctl -u ss-erp-web -f

# Nginx 访问日志
tail -f /var/log/nginx/access.log
```

## 健康检查

```bash
# 浅探活（不检查依赖）
curl http://127.0.0.1:3001/health

# 深度就绪（检查 DB + Redis）
curl http://127.0.0.1:3001/ready
```

## 线上 Smoke 测试

每次部署后运行：

```bash
cd /opt/ss-erp/app/apps/server
SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
```

该脚本会创建临时超管和临时普通用户，覆盖健康检查、初始化状态、公开页面、Next 静态资源 API 地址、CORS 负向检查、路径遍历负向检查、注入形态登录负向检查、管理员独立登录、备份状态、注册短信码校验、扩展 runtime、维护模式阻断与恢复。脚本结束会删除临时用户、Redis session、短信码，并恢复维护模式配置。

如果脚本失败，先确认清理状态：

```bash
cd /opt/ss-erp/app/apps/server
set -a && . ../../.env.staging && set +a
node --input-type=module -e "import {PrismaClient} from '@prisma/client'; const p = new PrismaClient(); console.log(await p.systemConfig.findUnique({ where: { key: 'maintenance_enabled' }, select: { value: true } })); await p.\$disconnect();"
```

## 回滚

```bash
cd /opt/ss-erp
git log --oneline -10          # 找到要回滚的 commit
git checkout <commit-hash>
pnpm install --frozen-lockfile
pnpm --filter server build
pnpm --filter web build
sudo systemctl restart ss-erp-api ss-erp-worker ss-erp-web
```

## 数据库备份

```bash
# 手动备份
./scripts/backup-db.sh

# 无损恢复演练（恢复到临时库后自动删除）
. /etc/ss-erp-backup.env
./scripts/verify-backup-restore.sh

# 如果应用数据库账号没有 CREATEDB 权限，且 PostgreSQL 就在本机：
VERIFY_RESTORE_LOCAL_POSTGRES=1 ./scripts/verify-backup-restore.sh

# 定时备份（参考 crontab）
cat scripts/backup-db.crontab.example
```

## 常见问题

### API 启动失败
```bash
journalctl -u ss-erp-api -n 50
# 常见原因：DATABASE_URL 错误、JWT_SECRET 未配置、端口被占用
```

### Worker 重复执行定时任务
确保只有一个 worker 实例在运行。API 服务的 `RUN_WORKERS=0` 不会启动 worker。
```bash
systemctl status ss-erp-worker
# 如果有多个实例，停掉多余的
```

### Prisma migration 失败
```bash
cd /opt/ss-erp/apps/server
npx prisma migrate status
npx prisma migrate resolve --applied <migration-name>  # 标记已应用
```

## 维护模式

### 开启

超管后台 → 系统设置 → 维护模式 → 开启

或通过 API：
```bash
curl -X PUT http://localhost:3001/api/admin/system-config/maintenance_enabled \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"true"}'
```

### 行为

- 普通用户写接口返回 503 + `{"maintenance": true, "msg": "..."}`
- 读接口（GET/HEAD/OPTIONS）正常通过
- `/api/admin/*` 路径不受影响（管理员可继续操作）
- 白名单路径：/health, /ready, /api/setup/status, /api/auth/login, /api/user/me, /api/app-version/check

### 关闭

超管后台 → 系统设置 → 维护模式 → 关闭（5秒内缓存过期生效）

## 数据保留策略

通过超管后台 → 系统设置 → 数据保留 配置。

默认 `retention_cleanup_dry_run=true`（只统计不删除）。确认日志输出的统计数据合理后再关闭 dry-run。

Worker 每天执行一次，清理对象：
- 过期 session
- 已读/未读通知（按配置天数）
- 成功/失败 SyncJob（按配置天数）
- 临时图片（watermarked/resized/uploads/tmp）

**不会被自动删除的数据**：采集商品、订单、物流单号、成本快照。

## 发布流程（推荐）

```bash
# 1. 开启维护模式
# 2. 执行数据库备份
./scripts/backup-db.sh
# 3. git pull && pnpm install
# 4. pnpm --filter server db:migrate
# 5. pnpm build
# 6. systemctl restart ss-erp-api ss-erp-worker ss-erp-web
# 7. curl http://localhost:3001/ready
# 8. cd apps/server && SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
# 9. 关闭维护模式
```

## 环境变量：图片存储

云端模式下图片存储通过环境变量配置（不存数据库）：

```env
IMAGE_STORAGE_BACKEND=oss
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_BUCKET=ss-erp-images
OSS_ACCESS_KEY_ID=LTAI...
OSS_ACCESS_KEY_SECRET=<secret>
OSS_REGION=cn-hangzhou
OSS_CDN_DOMAIN=https://cdn.example.com
OZON_CDN_RELAY_URL=https://worker.example.com
OSS_FALLBACK_TO_CDN=true
LOCAL_BASE_URL=http://localhost:3001
```
