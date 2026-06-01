# 本地开发

这份文档只讲一件事：在自己的机器上把 SS ERP 跑起来、测通、再推送。

## 目标

- Web、API、数据库、Redis 都能本地跑
- 扩展能重新加载并通过验收
- `smoke:live` 可以区分本地 / 云端 / OSS / 备份
- 不依赖 1Panel，不需要先搭复杂部署体系

## 推荐启动顺序

```bash
pnpm install
pnpm env:check -- --profile local --env .env
pnpm --filter server db:migrate
pnpm dev
```

如果你是第一次跑，先确认 `.env`、`.env.staging`、`apps/server/.env` 里至少有：

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`

云端 R2 环境文件可以先做静态校验，不会打印密钥：

```bash
pnpm env:check -- --profile cloud-r2 --env .env.staging
```

本地离线版：

```bash
pnpm env:check -- --profile local --env .env
```

## 本地验收

推荐先跑统一入口：

```bash
pnpm preflight
```

默认会串行执行：

- `pnpm --filter server typecheck`
- `pnpm --filter web typecheck`
- `pnpm --filter server test`
- `pnpm verify:extension`

如果要把公网服务器也纳入验收：

```bash
pnpm preflight --remote --remote-core
```

如果这次发布涉及 R2/OSS 上传链路，再加：

```bash
pnpm preflight --remote --remote-core --remote-oss
```

`--remote-oss` 目前必须等线上 runtime 返回 `cloud` 且上传结果为 `backend:"oss"` 才算通过。

底层命令仍可单独运行，便于定位具体失败点：

```bash
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm --filter server test
pnpm verify:extension
```

建议把这四条当成开发提交前的最低门槛。涉及部署、存储、备份或扩展发布时，再按下面的测试矩阵补跑对应项。

## 测试矩阵

| 场景 | 在哪里跑 | 命令 | 通过标准 |
| --- | --- | --- | --- |
| 代码健康 | 本地 | `pnpm preflight` | 类型检查、后端测试、扩展静态验收均通过 |
| 扩展静态验收 | 本地 | `pnpm verify:extension` | manifest、JS 语法、cloud/local adapter 检查通过 |
| 公网基础功能 | 本地 | `pnpm smoke:remote` | `/ready` 的 DB/Redis 为 `ok`，公开页面可访问，未登录后台接口被拒绝 |
| 公网登录后只读接口 | 本地 | `pnpm preflight --remote-core` | 临时用户可登录，核心只读 API 正常返回 |
| R2/OSS 上传 | 本地 | `pnpm preflight --remote-oss` | 返回 `runtimeImageUpload:"oss"` 且上传结果 `backend:"oss"` |
| VPS 部署层 | VPS | `DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh` | systemd、Nginx、端口、防火墙、备份状态、Prisma migration、`/ready` 均通过 |
| 数据库备份 | VPS | `. /etc/ss-erp-backup.env && bash scripts/backup-db.sh` | 生成 `ss_erp_*.sql.gz` 和 `backup-status.json` |
| 恢复演练 | VPS | `. /etc/ss-erp-backup.env && bash scripts/verify-backup-restore.sh` | 临时库恢复成功并自动清理 |

### 本地 smoke

```bash
$env:SMOKE_EXPECT_RUNTIME='local'
$env:SMOKE_BASE_URL='http://127.0.0.1:3001'
$env:SMOKE_WEB_BASE_URL='http://127.0.0.1:3000'
pnpm --filter server smoke:live
```

本地模式下，下面这些检查默认会放宽：

- 生产环境 Secure cookie
- 备份状态必须存在
- Web chunk 里不能出现 localhost 回退
- 注册必须依赖短信码

如果你要顺手测 OSS / R2，再加：

```bash
$env:SMOKE_EXPECT_OSS='true'
```

并确保这些变量已经设置：

- `IMAGE_STORAGE_BACKEND=oss`
- `OSS_ENDPOINT`
- `OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_REGION`

### 远程 smoke

`smoke:remote` 不需要本地数据库、Redis 或 SSH，适合只通过公网检查服务器功能。

```bash
pnpm smoke:remote
```

默认检查公开页面、`/ready`、初始化状态、未登录后台保护、Next chunk 是否还带 localhost。需要把 Turnstile、OSS/R2、备份状态也纳入验收时，提供管理员 token/cookie，或直接提供管理员手机号和密码：

```bash
$env:SMOKE_ADMIN_PHONE='13800000000'
$env:SMOKE_ADMIN_PASSWORD='your-password'
$env:SMOKE_EXPECT_OSS='true'
$env:SMOKE_EXPECT_BACKUP_STATUS='true'
$env:SMOKE_EXPECT_AUTH_CHALLENGES='true'
pnpm smoke:remote
```

如果你已经从浏览器或接口拿到了 token，也可以用 `$env:SMOKE_ADMIN_TOKEN='...'` 代替手机号密码。

如果只是要证明线上上传链路是否真的走 R2/OSS，可以创建临时用户并上传 1x1 测试图：

```bash
$env:SMOKE_CREATE_TEMP_USER='true'
$env:SMOKE_EXPECT_OSS='true'
$env:SMOKE_EXPECT_UPLOAD='true'
pnpm smoke:remote
```

预期返回里 `authenticated upload stores image in expected backend` 应为 `backend:"oss"`。如果返回 `backend:"local"` 或 URL 仍是 `http://localhost:3001/uploads/...`，说明 R2 bucket 可能已创建，但生产 API 进程没有读到 `IMAGE_STORAGE_BACKEND=oss` 和 `OSS_*` 环境变量，或者部署后尚未重启生效。

如果同时看到 `runtimeMode:"local"` / `runtimeImageUpload:"local"`，说明运行态仍是本地模式，优先修正 `RUNTIME_MODE=cloud` 和 `IMAGE_STORAGE_BACKEND=oss`。

修复后再次验证时，先确认：

1. 线上 API / Worker / Web 都已重启
2. 运行中的进程实际加载了新的 `.env.staging`
3. `smoke:remote` 返回的上传后端变成 `oss`

服务器侧可以用只读脚本确认 `.env.staging`、systemd `EnvironmentFile`、API/Worker 进程实际环境变量是否一致：

```bash
pnpm env:check -- --profile cloud-r2 --env .env.staging
DEPLOY_DIR=/opt/ss-erp ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

如果线上 R2 已经在 Cloudflare 控制台创建，但 smoke 仍返回 `imageUpload:"local"`，不要继续改前端或扩展。优先在 VPS 上确认：

```env
RUNTIME_MODE=cloud
IMAGE_STORAGE_BACKEND=oss
OSS_ENDPOINT=...
OSS_BUCKET=...
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
OSS_REGION=auto
```

然后重启 API、Worker、Web：

```bash
sudo systemctl restart ss-erp-worker ss-erp-api ss-erp-web
```

重启后再从本地跑一次 R2/OSS 上传 smoke。只有返回 `runtimeImageUpload:"oss"` 和 `backend:"oss"`，才算 R2 真正进入生产上传链路。

如果当前只想测试“验证码未接入前，服务器核心功能是否能跑”，可以先不强制 OSS，跑临时用户只读 smoke：

```bash
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_RUNTIME=any pnpm smoke:remote
```

这会登录或复用一个 smoke 临时用户，并检查这些不会改业务数据的接口：

- `/api/user/me`
- `/api/user/shops`
- `/api/shops`
- `/api/dashboard/stats`
- `/api/dashboard/order-trend`
- `/api/orders`
- `/api/orders/stats`
- `/api/orders/pipeline`
- `/api/collect`
- `/api/collect/randomize-config`
- `/api/notifications/unread-count`
- `/api/announcements/unread-count`
- `/api/announcements/list`
- `/api/finance/balance`
- `/api/finance/stats`
- `/api/account/transactions`
- `/api/account/fee-templates`

`SMOKE_EXPECT_RUNTIME=any` 只适合排查核心 API 是否可用。正式云端验收时去掉它，预期就应该回到默认的 `cloud`；R2/OSS 上传验收仍必须返回 `runtimeImageUpload:"oss"` 和 `backend:"oss"`。

## 今天的更新推送

最省事的流程是：

```bash
git status --short
git add <本次需要提交的文件>
git commit -m "..."
git push
```

不要用 `git add .`。仓库里经常会有截图、扩展压缩包、部署 tar 包等本地测试产物，误提交后会把发布历史弄脏。

然后在 VPS 上用本文档后面的发布方式拉取并部署，再跑一次 smoke。

VPS 上如果是 git checkout 模式：

```bash
cd /opt/ss-erp
DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
```

如果已经切到 release 目录 + symlink 模式，不要再用 `deploy-staging.sh`，改用：

```bash
DEPLOY_HOST=<server-ip> DEPLOY_USER=<ssh-user> ./scripts/deploy.sh
```

两种方式二选一。`deploy-staging.sh` 适合当前小团队快速迭代；`deploy.sh` 适合需要版本隔离和快速回滚的线上阶段。

## GitHub 仓库部署测试

如果 VPS 本身就是 GitHub checkout，日常发布可以按这个顺序测：

```bash
cd /opt/ss-erp
git status --short
DEPLOY_BRANCH=feature/saas-cloud-prep DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
DEPLOY_DIR=/opt/ss-erp ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh
```

本地机器再跑：

```bash
pnpm smoke:remote
```

如果这次更新包含 R2/OSS、上传、CDN 代理、扩展上传链路，再补跑：

```bash
$env:SMOKE_CREATE_TEMP_USER='true'
$env:SMOKE_EXPECT_UPLOAD='true'
$env:SMOKE_EXPECT_OSS='true'
pnpm smoke:remote
```

这条只有返回 `runtimeImageUpload:"oss"` 和上传结果 `backend:"oss"` 才算通过。

如果 VPS 已经切到 release/symlink 模式，不要在服务器上 `git pull` 部署，改为本地执行：

```bash
DEPLOY_HOST=<server-ip> DEPLOY_USER=<ssh-user> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh
```

然后同样跑 `diagnose-runtime-env.sh`、`verify-vps-deploy.sh` 和 `smoke:remote`。

## 备份验证

数据库备份脚本和恢复演练都只建议在 Linux / VPS / WSL 上跑。

```bash
source /etc/ss-erp-backup.env
bash scripts/backup-db.sh
bash scripts/verify-backup-restore.sh
```

R2 / S3 兼容备份建议单独使用一个 bucket，不要和图片桶混用。

推荐策略：

- 本地 VPS 备份保留 7 天。
- 远程 R2/S3 备份保留 30-90 天。
- 每次重要发布前手动跑一次 `backup-db.sh`。
- 每月至少跑一次 `verify-backup-restore.sh`，不要只确认“有备份文件”。

发布前的最低备份测试：

```bash
source /etc/ss-erp-backup.env
bash scripts/backup-db.sh
bash scripts/verify-backup-restore.sh
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh
```

`verify-vps-deploy.sh` 会检查 cron 是否包含 `backup-db.sh`、`backup-status.json` 是否可读、是否有恢复演练残留的临时库。它不是备份本身的替代品，只是确认备份链路处于可观测状态。

## VPS 系统层优化验证

现阶段不需要 1Panel，也不需要 K8s。VPS 优化先围绕可观测、可回滚、低暴露面做：

- API 和 Web 只监听 `127.0.0.1:3001` / `127.0.0.1:3000`，公网只开放 `80/443`。
- PostgreSQL 和 Redis 只允许本机访问。
- UFW 默认拒绝入站，只允许 SSH、HTTP、HTTPS。
- Nginx 反代启用 Cloudflare 真实 IP 还原和源站保护。
- systemd 服务独立管理 `api`、`worker`、`web`。
- 服务器至少配置 swap，避免 build 或图片处理时内存打满。
- 日志和备份目录要有保留策略，避免磁盘被撑满。

这些项目目前主要通过下面命令验证：

```bash
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh
```

如果迁移到 release/symlink：

```bash
DEPLOY_DIR=/opt/ss-erp/current ./scripts/verify-vps-deploy.sh
```
