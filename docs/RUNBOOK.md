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
