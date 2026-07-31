# 本地开发

这份文档只讲一件事：在自己的机器上把 SS ERP 跑起来、测通、再推送。

## 验收优先级

先按下面顺序看结果，避免把配置入口看串：

| 顺序 | 验收项 | 看什么 |
| --- | --- | --- |
| 1 | 代码健康 | `pnpm preflight` |
| 2 | 公网核心功能 | `pnpm preflight --remote-core` |
| 3 | 域名隔离 | `SMOKE_EXPECT_DOMAIN_SPLIT=true pnpm smoke:remote` |
| 4 | 备份链路 | `backup-status.json`、`backup-db.sh`、`verify-backup-restore.sh` |
| 5 | 图片上传 R2 / OSS | 超管后台 `upload_storage_backend=oss` + `upload_oss_*`，或 VPS env `IMAGE_STORAGE_BACKEND=oss` + `OSS_*` |

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
- 云端 `.env.staging` 还需要 `RUNTIME_MODE=cloud`、`NEXT_PUBLIC_RUNTIME_MODE=cloud`、`NEXT_PUBLIC_API_BASE_URL=https://ss-erp.com` 和 `CORS_ORIGIN`

云端基础环境文件可以先做静态校验，不会打印密钥。这里检查的是启动级配置，不要求 R2 密钥必须写在 `.env.staging`：

```bash
pnpm env:check -- --profile cloud-bootstrap --env .env.staging
```

先区分两类配置，不要混着看：

- `backup_remote_*` 是数据库备份的远程存储配置。
- `upload_storage_backend` 和 `upload_oss_*` 是图片 / 附件上传链路的后台配置。
- 如果 `upload_*` 没填，服务才回退到 VPS `.env.staging` 里的 `IMAGE_STORAGE_BACKEND` 和 `OSS_*`。

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

如果这次改动涉及 Ozon 跟卖上架、图片补传或上架日志诊断，额外补跑：

```bash
pnpm --filter server test -- src/__tests__/collect-publish-helpers.test.ts src/__tests__/listing-picture-stage.test.ts src/__tests__/ozon-attribute-dictionary-cache.test.ts
```

这两组用例覆盖：

- `follow-by-sku` 图片补传在 `已上传 / 已阻塞 / 待补传` 三种状态下的续跑逻辑
- Ozon 已拒绝商品卡时，系统应跳过图片补传并直接展示卡片阻塞原因
- `Название цвета` 这类补充变体值在发布时是否区分“仅用于 SKU 区分”和“可安全拼进标题/属性”；主观修饰词应被中性化成未冲突的 `Тип N`
- Ozon 类目属性字典是否优先读持久缓存、缺失时拉 Seller API、API 异常时用旧缓存兜底

如果这次改动涉及 Ozon 扩展采集模式、变体补全或 ERP 批量采集回写，额外补跑：

```bash
node --test scripts/extension-ozon-collect-policy.test.mjs
node scripts/extension-erp-collect-diagnostics.test.mjs
node scripts/extension-ozon-rich-description.test.mjs
pnpm --filter server test -- src/__tests__/collect-batch-upsert.test.ts
```

这两组用例覆盖：

- popup、Ozon 面板、ERP Web 单采/批量采是否默认走 `balanced`
- `balanced` 首轮采集后是否会排队触发 `complete` 补全
- Ozon 完整补全回写 ERP 时是否更新同一条 `supplyGoods` 记录，而不是创建重复采集数据
- Ozon 富内容提取是否同时兼容老 `richAnnotationJson` 和新版 `content/blocks` 结构
- ERP Web 扩展采集入口是否先检测扩展桥、ERP Token 和采集模块状态，避免点击后没有任何反馈

## 测试矩阵

| 场景 | 在哪里跑 | 命令 | 通过标准 |
| --- | --- | --- | --- |
| 代码健康 | 本地 | `pnpm preflight` | 类型检查、后端测试、扩展静态验收均通过 |
| 扩展静态验收 | 本地 | `pnpm verify:extension` | manifest、JS 语法、cloud/local adapter 检查通过 |
| 公网基础功能 | 本地 | `pnpm smoke:remote` | `/ready` 的 DB/Redis 为 `ok`，公开页面可访问，未登录后台接口被拒绝 |
| 公网登录后只读接口 | 本地 | `pnpm preflight --remote-core` | 临时用户可登录，核心只读 API 正常返回 |
| R2/OSS 上传 | 本地 | `pnpm preflight --remote-oss` | 返回 `runtimeImageUpload:"oss"` 且上传结果 `backend:"oss"` |
| VPS 部署层 | VPS | `DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh` | systemd、Nginx、端口、防火墙、备份状态、Prisma migration、`/ready` 均通过 |
| 数据库备份 | VPS | `set -a; . ./.env.staging; . /etc/ss-erp-backup.env; set +a; BACKUP_TARGET_GIT_COMMIT=<full-commit> bash scripts/backup-db.sh` | 生成真实 `ss_erp_*.sql.gz`、canonical latest 状态和不可变 sidecar |
| 恢复演练 | VPS | `set -a; . ./.env.staging; . /etc/ss-erp-backup.env; set +a; BACKUP_TARGET_GIT_COMMIT=<full-commit> bash scripts/verify-backup-restore.sh` | 临时库恢复成功、表数为正并写出 commit/database 认证 |

## 当前服务器验收流程

服务器功能性测试分三层，不要把结果混在一起：

1. 公网基础功能和域名隔离：

```powershell
$env:SMOKE_BASE_URL='https://ss-erp.com'
$env:SMOKE_MARKETING_BASE_URL='https://ss-erp.com'
$env:SMOKE_WEB_BASE_URL='https://app.ss-erp.com'
$env:SMOKE_ADMIN_WEB_BASE_URL='https://admin.ss-erp.com'
$env:SMOKE_EXPECT_DOMAIN_SPLIT='true'
pnpm --filter server smoke:remote
```

通过标准：

- `/ready` 的 DB / Redis 都是 `ok`
- `ss-erp.com/` 直接渲染官网首页，`ss-erp.com/landing` 和 `www.ss-erp.com` 规范化到主域
- `ss-erp.com`、`app.ss-erp.com`、`admin.ss-erp.com` 的跳转隔离正确
- 未登录访问后台、备份、扩展 runtime 等接口会返回 401/403
- Next.js chunk 不再硬编码 localhost

2. 验证码未接入前的登录后只读接口：

云端登录和注册现在会被 Turnstile / SMS 挡住。如果验证码服务还没接入，不要用“临时用户注册”证明主体 API 是否可用；改用已有测试用户 token 或手动生成一个 smoke token，再跑：

```powershell
$env:SMOKE_USER_TOKEN='<user-token>'
pnpm --filter server smoke:remote
```

如果可以 SSH 到 VPS，推荐直接在服务器上生成 2 小时临时 token，避免把真实密码写进本地命令历史：

```bash
cd /opt/ss-erp/app/apps/server
SMOKE_ENV_FILE=../../.env.staging node scripts/create-smoke-token.mjs --role USER
SMOKE_ENV_FILE=../../.env.staging node scripts/create-smoke-token.mjs --role ADMIN
```

脚本会选择最早的 active 用户；`--role ADMIN` 默认选择超管。输出 JSON 里的 `token` 填到本地 `SMOKE_USER_TOKEN` 或 `SMOKE_ADMIN_TOKEN`。

通过标准是 `authenticated core read endpoints respond` 检查 17 个只读接口均通过。这个只能证明服务器主体 API 正常，不能替代登录、注册、短信验证码验收。

如果使用统一入口，也可以先设置 `$env:SMOKE_USER_TOKEN`，再跑：

```powershell
pnpm preflight --remote-core
```

有 `SMOKE_USER_TOKEN` 或 `SMOKE_USER_COOKIE` 时，preflight 会复用已有会话，不会再创建临时用户。

3. R2/OSS 图片上传链路：

这项必须单独验收。只有同时满足下面两条才算通过：

- `/api/extension/runtime` 返回 `mode:"cloud"` 且 `capabilities.imageUpload:"oss"`
- `/api/images/upload-base64` 返回 `backend:"oss"`

如果当前验证码未接入，`SMOKE_CREATE_TEMP_USER=true` 可能会因为短信验证码失败而卡住。此时使用已有用户 token：

```powershell
$env:SMOKE_USER_TOKEN='<user-token>'
$env:SMOKE_EXPECT_UPLOAD='true'
$env:SMOKE_EXPECT_OSS='true'
pnpm --filter server smoke:remote
```

如果返回 `imageUpload:"ozon-cdn"`，说明代码和域名可以是最新的，但后台 `upload_*` 或 VPS env 仍没有让图片上传切到 OSS。

当前线上仍是 `/opt/ss-erp/app` app-dir 模式。如果 smoke 的排查提示需要指定部署目录，可以设置：

```powershell
$env:SMOKE_VPS_DEPLOY_DIR='/opt/ss-erp/app'
```

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

并确保后台 `upload_storage_backend=oss` 和 `upload_oss_*` 已配置，或这些变量已经设置：

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

如果要在发布后专门验证域名隔离是否生效，可以加：

```bash
$env:SMOKE_EXPECT_DOMAIN_SPLIT='true'
pnpm smoke:remote
```

它会检查：

- `ss-erp.com/` 是否直接显示官网首页
- `ss-erp.com/landing`、`www.ss-erp.com/` 是否跳转到 `ss-erp.com/`
- `ss-erp.com/login`、`ss-erp.com/register` 是否跳转到 `app.ss-erp.com`
- `app.ss-erp.com/admin*` 是否跳转到 `admin.ss-erp.com` 的同一路径
- `admin.ss-erp.com/`、`/login`、`/register` 是否跳转到 `admin.ss-erp.com/admin/login`

如果只是要证明线上上传链路是否真的走 R2/OSS，可以创建临时用户并上传 1x1 测试图：

```bash
$env:SMOKE_CREATE_TEMP_USER='true'
$env:SMOKE_EXPECT_OSS='true'
$env:SMOKE_EXPECT_UPLOAD='true'
pnpm smoke:remote
```

预期返回里 `authenticated upload stores image in expected backend` 应为 `backend:"oss"`。如果返回 `backend:"local"` 或 URL 仍是 `http://localhost:3001/uploads/...`，说明 R2 bucket 可能已创建，但生产 API 没有读到后台 `upload_*` 或 env `OSS_*` 配置。

如果同时看到 `runtimeMode:"local"` / `runtimeImageUpload:"local"`，说明运行态仍是本地模式，优先修正 `RUNTIME_MODE=cloud` 和 `IMAGE_STORAGE_BACKEND=oss`。

修复后再次验证时，先确认：

1. 线上 API / Worker / Web 都已重启
2. 运行中的进程实际加载了新的 `.env.staging`
3. `smoke:remote` 返回的上传后端变成 `oss`

服务器侧可以用只读脚本确认 `.env.staging`、systemd `EnvironmentFile`、API/Worker 进程实际环境变量是否一致：

```bash
pnpm env:check -- --profile cloud-bootstrap --env .env.staging
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

`cloud-bootstrap` 只检查服务启动必需的 `.env` 项。`diagnose-runtime-env.sh` 会先读取后台 `upload_storage_backend` / `upload_oss_*`。后台 R2 配置完整时，即使 env 兜底仍是 `IMAGE_STORAGE_BACKEND=ozon-cdn` 也不会误报；后台只填一半时会明确列出缺少的 `upload_oss_*` 项。只有后台完全没填时，脚本才要求 VPS env 里 `IMAGE_STORAGE_BACKEND=oss` 和 `OSS_*` 齐全。

如果线上 R2 已经在 Cloudflare 控制台创建，但 smoke 仍返回 `imageUpload:"local"` 或 `imageUpload:"ozon-cdn"`，不要继续改前端或扩展。优先确认超管后台：

```env
upload_storage_backend=oss
upload_oss_endpoint=...
upload_oss_bucket=...
upload_oss_access_key_id=...
upload_oss_access_key_secret=...
upload_oss_region=auto
```

只填 R2 Endpoint 不会切换上传链路；Bucket、Access Key ID、Secret Access Key 也必须填写。保存后先在“接口与集成”页面点 OSS 测试，再跑 `SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm --filter server smoke:remote`。

如果选择用环境变量兜底，再在 VPS 上确认：

```env
RUNTIME_MODE=cloud
IMAGE_STORAGE_BACKEND=oss
OSS_ENDPOINT=...
OSS_BUCKET=...
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
OSS_REGION=auto
```

可以用仓库脚本安全写入 VPS env（不会打印密钥，会自动备份旧 `.env.staging`）：

```bash
cd /opt/ss-erp/app
export OSS_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
export OSS_BUCKET='ss-erp-assets'
export OSS_ACCESS_KEY_ID='...'
export OSS_ACCESS_KEY_SECRET='...'
export OSS_REGION='auto'
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/configure-cloud-r2-env.sh
```

如果当前服务器旧版本没有这个脚本，先从本地复制：

```powershell
scp -i $env:USERPROFILE\.ssh\ss_erp_vultr_sg scripts/configure-cloud-r2-env.sh root@45.76.49.64:/opt/ss-erp/app/scripts/
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

### 修复闭环

任何线上问题都按同一条链路处理，避免本地代码、GitHub 和 VPS 三处漂移：

1. 本地修复代码并跑对应验证。
2. 只 stage 本次相关文件，提交到当前分支。
3. push 到 GitHub，让仓库成为唯一事实来源。
4. VPS 只部署这个明确 commit，并记录/确认 `DEPLOYED_COMMIT`。
5. 部署后跑 `/ready`、相关 smoke 或专项测试，再审查 `git diff` / `git log` 确认没有游离改动。

不要在 VPS 上直接改业务代码做热修。确实需要临时排查脚本时，放在 `tmp/` 或服务器临时目录，最终修复仍回到本地仓库提交，再按 commit 部署。这样后续重新打包、回滚和再次部署才不会出现“服务器好了但 Git 没记录”的偏差。

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

如果 VPS 仍是当前旧式 `/opt/ss-erp/app` 打包目录模式，不要用 `git pull`，从本地仓库执行：

```powershell
$env:DEPLOY_HOST='45.76.49.64'
$env:DEPLOY_USER='root'
$env:SSH_KEY="$env:USERPROFILE\.ssh\ss_erp_vultr_sg"
$env:DEPLOY_ENV_PROFILE='cloud-r2'
C:\Progra~1\Git\bin\bash.exe scripts/deploy-app-dir.sh
```

如果已经切到 release 目录 + symlink 模式，不要再用 `deploy-staging.sh`，改用：

```bash
DEPLOY_HOST=<server-ip> DEPLOY_USER=<ssh-user> SSH_KEY=<ssh-key-path> ./scripts/deploy.sh
```

三种方式三选一。`deploy-app-dir.sh` 适合当前 VPS 已经在跑 `/opt/ss-erp/app` 的情况；`deploy-staging.sh` 适合服务器本身就是 GitHub checkout；`deploy.sh` 适合已经切换到 release/symlink 的线上阶段。

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
DEPLOY_HOST=<server-ip> DEPLOY_USER=<ssh-user> SSH_KEY=<ssh-key-path> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh
```

然后同样跑 `diagnose-runtime-env.sh`、`verify-vps-deploy.sh` 和 `smoke:remote`。

如果 VPS 仍是 `/opt/ss-erp/app` 模式，则对应命令是：

```bash
DEPLOY_HOST=<server-ip> DEPLOY_USER=<ssh-user> SSH_KEY=<ssh-key-path> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-app-dir.sh
```

部署前可先在 VPS 做只读就绪检查：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging EXPECTED_PROFILE=cloud-r2 bash scripts/verify-deploy-readiness.sh
```

这一步会明确检查当前版本、systemd 指向、备份状态、R2 env 是否齐全。

部署后在 VPS 上验证：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh
DEPLOY_DIR=/opt/ss-erp/app ./scripts/verify-vps-deploy.sh
```

## 备份验证

数据库备份脚本和恢复演练都只建议在 Linux / VPS / WSL 上跑。

```bash
TARGET_COMMIT=<lowercase-full-40-character-commit>
set -a; . ./.env.staging; . /etc/ss-erp-backup.env; set +a
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/backup-db.sh
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/verify-backup-restore.sh
bash scripts/verify-deploy-backup.sh "$TARGET_COMMIT"
```

R2 / S3 兼容备份建议单独使用一个 bucket，不要和图片桶混用。

推荐策略：

- 本地 VPS 备份保留 7 天。
- 远程 R2/S3 备份保留 30-90 天。
- 每次重要发布前手动跑一次 `backup-db.sh`。
- 每月至少跑一次 `verify-backup-restore.sh`，不要只确认“有备份文件”。

发布前的最低备份测试：

```bash
TARGET_COMMIT=<lowercase-full-40-character-commit>
set -a; . ./.env.staging; . /etc/ss-erp-backup.env; set +a
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/backup-db.sh
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/verify-backup-restore.sh
bash scripts/verify-deploy-backup.sh "$TARGET_COMMIT"
DEPLOY_DIR=/opt/ss-erp ./scripts/verify-vps-deploy.sh
```

`verify-vps-deploy.sh` 会检查 cron、schema v3 latest 状态、数据库实际身份/commit、真实本地字节、远程上传状态，并重跑 commit 认证的 SHA-256/gunzip/时效校验；仍会检查恢复演练残留临时库。它不会修改或上传备份，也不是备份或恢复演练本身的替代品。

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
