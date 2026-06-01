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

## 日常更新 / 今天的更新推送

先确认当前服务器部署模式：

```bash
systemctl cat ss-erp-api ss-erp-web ss-erp-worker | grep -E 'WorkingDirectory|EnvironmentFile'
```

如果输出指向 `/opt/ss-erp/app`，当前是 app-dir 打包模式。不要在 VPS 上 `git pull`；从本地仓库执行：

```bash
DEPLOY_HOST=45.76.49.64 \
DEPLOY_USER=root \
SSH_KEY=~/.ssh/ss_erp_vultr_sg \
DEPLOY_ENV_PROFILE=cloud-r2 \
./scripts/deploy-app-dir.sh
```

部署前可以先在 VPS 做只读就绪检查：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging EXPECTED_PROFILE=cloud-r2 bash scripts/verify-deploy-readiness.sh
```

如果它提示 `IMAGE_STORAGE_BACKEND expected oss` 或 `OSS_* is required`，说明 env 兜底未配置。新版本也可以改用超管后台的 `upload_*` 配置驱动图片上传。

如果输出指向 `/opt/ss-erp` 且目录里有 `.git`，才使用 git checkout 模式：

```bash
cd /opt/ss-erp
DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
```

如果输出指向 `/opt/ss-erp/current`，使用 release/symlink 模式：

```bash
DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh
```

执行部署脚本的用户需要有权限执行 `systemctl restart ss-erp-*`。

git checkout 模式默认部署当前已 checkout 的分支；如果你想让 VPS 直接跟着 GitHub 仓库跑，这是最省事的方式。若要指定分支或部署目录：

```bash
DEPLOY_BRANCH=hardening/prelaunch-auth-security ./scripts/deploy-staging.sh  # 当前预上线分支示例
DEPLOY_DIR=/opt/ss-erp ./scripts/deploy-staging.sh
```

`deploy-staging.sh` 会加载 `.env.staging`，用于 `prisma migrate deploy` 和 `next build`。如果密钥包含 `$`、`#`、空格等特殊字符，请在 `.env.staging` 里加引号，保持 shell-compatible。

如果你更重视回滚和版本隔离，可以改用 `scripts/deploy.sh` 的 release 目录模式；这两种方式不要混着用。

当前 `/opt/ss-erp/app` 模式可以继续用 `deploy-app-dir.sh` 过渡。它会先构建新目录，成功后再替换 app 目录；失败时不会覆盖正在运行的旧目录。

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

如果你只能通过公网访问、没有 SSH 或数据库权限，用本地机器跑：

```bash
pnpm smoke:remote
```

如果要验证图片 / 附件上传是否真的切到 R2 / OSS，再加：

```bash
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

注意区分两类“R2 设置”：

- `backup_remote_*` 是数据库备份的远程存储，只影响 `backup-db.sh` 和 `backup-status.json`。
- `upload_storage_backend` 与 `upload_oss_*` 是图片/附件上传的后台配置，优先级高于 env。
- `IMAGE_STORAGE_BACKEND=oss` 与 `OSS_*` 是图片/附件上传的部署级兜底配置。
- 所以只在备份设置里填 `backup_remote_*` 不会切换图片上传；图片上传必须填 `upload_*` 或 env `OSS_*`。

当前 `/opt/ss-erp/app` app-dir 模式下，先看实际进程环境：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

`diagnose-runtime-env.sh` 会先读取后台 `upload_storage_backend` 和 `upload_oss_*`，后台 R2 配置完整时即使 env 兜底还是 `IMAGE_STORAGE_BACKEND=ozon-cdn` 也不应报错。常见结果：

- `upload SystemConfig complete`：后台上传 R2 配置完整，继续跑上传 smoke。
- `upload SystemConfig incomplete ... missing=...`：后台只填了一部分 R2，先补齐缺项。
- `upload SystemConfig empty; checking env OSS fallback`：后台未配置上传 R2，才需要看 env 里的 `IMAGE_STORAGE_BACKEND=oss` 和 `OSS_*`。

如果要检查三个域名是否按最新规则隔离：

```bash
SMOKE_EXPECT_DOMAIN_SPLIT=true pnpm smoke:remote
```

它会验证根域 `/login` 和 `/register` 跳转到用户域，用户域 `/admin*` 被挡回用户登录，管理员域只允许 `/admin/*`。

如果要验证 OSS 上传是否真的生效，优先看超管后台"系统设置 → 上传与对象存储"里的 `upload_*`，同时确认它不是只填了备份 `backup_remote_*`。使用 env 兜底时再看 VPS 当前进程环境：

```bash
cd /opt/ss-erp/app
bash scripts/diagnose-runtime-env.sh
```

预期里必须同时看到：

- `RUNTIME_MODE=cloud`
- `IMAGE_STORAGE_BACKEND=oss`
- `OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION` 都为非空

如果这里仍然是 `ozon-cdn` 或空值，但后台 `upload_*` 已填，新版本仍应该优先使用后台配置；这时看 `/api/extension/runtime` 的 `source` 和 `capabilities.imageUpload`。

需要连带检查后台、备份状态和 OSS/R2 时，提供管理员手机号密码，或管理员 token/cookie：

```bash
SMOKE_ADMIN_PHONE=13800000000 SMOKE_ADMIN_PASSWORD=... SMOKE_EXPECT_OSS=true SMOKE_EXPECT_BACKUP_STATUS=true SMOKE_EXPECT_AUTH_CHALLENGES=true pnpm smoke:remote
```

只验证上传链路是否真正走 R2/OSS，可以不用超管，直接创建临时普通用户上传测试图：

```bash
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

如果验证码服务尚未接入，临时用户注册会被短信验证码挡住。此时先用已有用户生成或复制一个 `SMOKE_USER_TOKEN`，再跑：

```bash
SMOKE_USER_TOKEN=<user-token> SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

有 SSH 权限时可以直接在 VPS 生成短期 smoke token：

```bash
cd /opt/ss-erp/app/apps/server
SMOKE_ENV_FILE=../../.env.staging node scripts/create-smoke-token.mjs --role USER
SMOKE_ENV_FILE=../../.env.staging node scripts/create-smoke-token.mjs --role ADMIN
```

输出 JSON 不会打印密码；把 `token` 复制到本地 `SMOKE_USER_TOKEN` / `SMOKE_ADMIN_TOKEN` 即可。默认 TTL 为 7200 秒，可用 `--ttl-seconds 600` 缩短。

预期上传检查返回 `backend:"oss"`。如果返回 `backend:"local"` 或 URL 为 `http://localhost:3001/uploads/...`，说明 R2 还没有被当前 API 实际使用，需要检查后台 `upload_*`、env 兜底配置或服务版本。

如果结果里 `runtimeMode:"local"` 且 `runtimeImageUpload:"local"`，优先检查 `RUNTIME_MODE=cloud` 和 `IMAGE_STORAGE_BACKEND=oss` 是否已进入当前 API 进程。

### 配置 R2 / OSS

推荐入口：超管后台 → 系统设置 → 上传与对象存储。

```env
upload_storage_backend=oss
upload_oss_endpoint=https://<account-id>.r2.cloudflarestorage.com
upload_oss_bucket=ss-erp-assets
upload_oss_access_key_id=...
upload_oss_access_key_secret=...
upload_oss_region=auto
```

保存后到"接口与集成"页面点 OSS 测试。通过后再跑 `SMOKE_USER_TOKEN=<user-token> SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote`。

只填 `upload_oss_endpoint` 不够。R2 上传链路必须同时有 `upload_oss_bucket`、`upload_oss_access_key_id`、`upload_oss_access_key_secret`，且 `upload_storage_backend=oss`。如果 backend 仍是 `env`，系统会回退到 VPS `.env.staging`，当前 env 兜底可能仍是 `IMAGE_STORAGE_BACKEND=ozon-cdn`。

环境变量仍可作为部署级兜底：

不要把 R2 密钥提交到 Git。当前 `/opt/ss-erp/app` 模式可以在 VPS 上这样写入 `.env.staging`：

```bash
cd /opt/ss-erp/app
export OSS_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
export OSS_BUCKET='ss-erp-assets'
export OSS_ACCESS_KEY_ID='...'
export OSS_ACCESS_KEY_SECRET='...'
export OSS_REGION='auto'
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/configure-cloud-r2-env.sh
```

脚本会先生成 `.env.staging.bak.<timestamp>`，再写入：

- `RUNTIME_MODE=cloud`
- `NEXT_PUBLIC_RUNTIME_MODE=cloud`
- `IMAGE_STORAGE_BACKEND=oss`
- `OSS_ENDPOINT`
- `OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_REGION`

旧版本如果没有 `configure-cloud-r2-env.sh`，先从本地复制脚本到服务器再执行，或手动把上述 key 写入 `.env.staging`：

```bash
scp -i ~/.ssh/ss_erp_vultr_sg scripts/configure-cloud-r2-env.sh root@45.76.49.64:/opt/ss-erp/app/scripts/
```

写完后必须重启 API、Worker、Web，才会进入当前进程环境。

排查顺序：

1. 确认后台 `upload_storage_backend=oss`
2. 确认 `upload_oss_endpoint / upload_oss_bucket / upload_oss_access_key_id / upload_oss_access_key_secret / upload_oss_region` 都已填写
3. 打开"接口与集成"页面点 OSS 测试
4. 如果使用 env 兜底，再确认运行中的 API 进程能读到 `IMAGE_STORAGE_BACKEND=oss` 和 `OSS_*`
5. 再跑一次 `SMOKE_USER_TOKEN=<user-token> SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote`

服务器上可先跑只读诊断，不会输出密钥；它会检查 `.env.staging`、systemd `EnvironmentFile`、API/Worker 进程实际环境变量：

```bash
DEPLOY_DIR=/opt/ss-erp ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

如果仍在旧 `/opt/ss-erp/app` 目录运行：

```bash
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

如果已经切到 release 目录 + symlink 部署：

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

release 模式下，systemd 应使用 `deploy/systemd-release/*.service` 模板，关键字段是：

```ini
WorkingDirectory=/opt/ss-erp/current/apps/server
EnvironmentFile=/opt/ss-erp/shared/.env.staging
```

如果仍使用 `deploy/systemd/*.service`，服务会从 `/opt/ss-erp/.env.staging` 读取环境变量；这会导致你已经在 shared env 写入 R2 配置，但运行中的 API 仍返回 `mode:"local"`。

安装 release 模式 systemd 模板：

```bash
cd /opt/ss-erp/current
DEPLOY_BASE=/opt/ss-erp ENV_FILE_NAME=.env.staging bash scripts/install-release-systemd.sh --restart
```

该脚本是只读诊断：只检查环境文件、systemd `EnvironmentFile`、API/Worker 运行进程实际环境变量和本机 `/ready`。不会创建用户、不会修改数据库、不会上传文件。若 smoke 已提示 `runtime.mode="local"` 或 `imageUpload="local"`，优先跑它确认当前进程是否真的读取到了 `RUNTIME_MODE=cloud` 和 `IMAGE_STORAGE_BACKEND=oss`。

诊断脚本还会检查 systemd 的 `WorkingDirectory` 与 `EnvironmentFiles` 是否匹配当前部署模式。`DEPLOY_DIR=/opt/ss-erp/current` 时，脚本会期望：

- API/Worker 工作目录：`/opt/ss-erp/current/apps/server`
- Web 工作目录：`/opt/ss-erp/current/apps/web`
- systemd 环境文件：`/opt/ss-erp/shared/.env.staging`

如果这些检查失败，先修 systemd unit，再继续测 R2。

云端运行态一键验收（只读）：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
```

它会串行执行运行时环境诊断和 VPS 部署层检查。通过后，再从本地机器运行 R2 smoke。

release/symlink 模式改用：

```bash
cd /opt/ss-erp/current
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
```

部署层验收：

```bash
# git checkout 模式
cd /opt/ss-erp
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh

# release/symlink 模式
cd /opt/ss-erp/current
DEPLOY_DIR=/opt/ss-erp/current ./scripts/verify-vps-deploy.sh
```

覆盖 systemd 服务、Nginx 配置、端口绑定、防火墙、Cloudflare 真源保护、备份 cron、备份状态文件、Prisma migration、临时恢复库残留、`/ready` 和最近错误日志。

## 服务器功能验收清单

验证码未实现时，可以先把验证码相关检查视为已知缺口，其余项目必须给出明确通过/失败结果。

### 公网基础功能

在本地机器运行：

```bash
pnpm smoke:remote
```

通过标准：

- `/ready` 返回 `status:"ready"`，且 `db`、`redis` 都是 `ok`
- `ss-erp.com`、`app.ss-erp.com`、`admin.ss-erp.com` 页面可访问
- Next.js chunk 不再包含 `http://localhost:3001`
- 未登录访问后台配置、备份状态、扩展 runtime 返回 401/403

### R2/OSS 上传链路

在本地机器运行：

```bash
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

如果验证码服务尚未接入，临时用户注册会被挡住。改用已有用户 token：

```bash
SMOKE_USER_TOKEN=<user-token> SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

通过标准：

- `/api/extension/runtime` 返回 `mode:"cloud"`
- `capabilities.imageUpload` 返回 `oss`
- `/api/images/upload-base64` 返回 `backend:"oss"`

如果返回 `mode:"local"` 或 `imageUpload:"local"`，说明线上服务仍在本地模式。不要改扩展或前端，先在 VPS 上跑：

```bash
DEPLOY_DIR=/opt/ss-erp ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

若服务器仍在旧目录运行，则改为：

```bash
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

### VPS 系统层

在 VPS 运行：

```bash
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh
```

通过标准：

- `ss-erp-api`、`ss-erp-worker`、`ss-erp-web`、Nginx、PostgreSQL、Redis 都 active
- API/Web/PostgreSQL/Redis 内部端口只监听 loopback
- 80/443 对外可用
- Prisma migration up to date
- `backup-status.json` 存在且格式正确
- 最近 API/Worker 日志没有 fatal、exception、unhandled、panic

### 备份与恢复

在 VPS 运行：

```bash
. /etc/ss-erp-backup.env
bash scripts/backup-db.sh
bash scripts/verify-backup-restore.sh
```

通过标准：

- 本地生成 `ss_erp_*.sql.gz`
- 写入 `/var/backups/ss-erp/backup-status.json`
- 恢复演练能创建临时库、恢复备份、读到 public 表，并自动删除临时库

备份 R2/S3 bucket 建议和图片 R2 bucket 分开，避免生命周期规则互相影响。

浏览器扩展静态验收：

```bash
pnpm verify:extension
pnpm build:extension:cloud
STRICT_EXTENSION_CHECK=1 EXTENSION_DIR=build/extensions/ss-erp-cloud pnpm verify:extension
```

覆盖 manifest 引用文件、所有扩展 JS 语法、service worker adapter import、cloud/local adapter 基本行为、外部连接域名和 Chrome Web Store 权限风险提示。`cloud` 包会移除本地/旧 IP/`<all_urls>`/`file:///*` 权限；`local` 包保留离线调试能力。

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

建议至少做两类备份测试：

1. `backup-db.sh` 是否能成功生成本地备份和 `backup-status.json`
2. `verify-backup-restore.sh` 是否能把备份恢复到临时库并自动清理

如果备份桶接到了 R2 / 其他 S3 兼容存储，备份桶最好和图片桶分开，避免对象生命周期规则互相干扰。

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

## VPS 最小优化建议

- 当前用户量不大时，先保持单体部署
- 2C4G 可以跑，但 4C8G 会更宽松，尤其是同机跑 PostgreSQL、Redis、worker 和构建任务时
- 先加 swap，再考虑拆 worker
- API 和 Web 都只监听 loopback，外网只暴露 Nginx 的 80/443
- worker 只有在队列堆积、同步任务拖慢接口时才拆出去
- 不需要 1Panel 或 K8s 才能把这套系统跑好

## 图片存储配置

云端模式下图片存储优先通过超管后台 `upload_*` 配置。环境变量用于部署级兜底：

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
