# SS ERP 运维手册 (RUNBOOK)

## 专项手册

- [Ozon 物流规则运维与验收](./ozon-logistics-rule-operations.md)

Ozon 物流上线顺序：确认环境和 feature flags，完成 tenant/shop/warehouse/method scope
onboarding 与同 bootstrap probe，审核规范化候选并发布，最后执行两台设备 20 次真实循环。真实验收完成前不得扩大范围或宣称试点通过。


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

# 4. 配置 staging 环境变量（root 所有、deploy 主组只读，不跟随既有目标）
DEPLOY_GROUP="$(id -gn deploy)"
test ! -e .env.staging && test ! -L .env.staging
sudo install -o root -g "$DEPLOY_GROUP" -m 0640 .env.staging.example .env.staging
sudo nano .env.staging  # 填入 staging 密钥

# 5. 仅对确认实际 Prisma DATABASE_URL 没有任何用户表的全新数据库执行一次 bootstrap
sudo -u deploy bash -lc 'cd /opt/ss-erp/apps/server && set -a && . ../../.env.staging && set +a && node ../../scripts/verify-empty-bootstrap-database.mjs && npx prisma generate && npx prisma migrate deploy'

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

第 5 步是空数据库首次建表的唯一 bootstrap 例外。查询结果不是精确的 `0` 时必须停止，改走
本页“备份与恢复”流程以及标准部署脚本；已存在业务表、`_prisma_migrations` 或任何历史数据的
环境不得使用该命令。bootstrap 完成后、生成第一份部署备份前，必须按
[部署文档的数据库身份初始化步骤](deployment.md#部署命令示例)写入一次数据库 ID/UUID 身份，并确认
`DATABASE_URL` 与 `BACKUP_DB_URL` 通过 `deploy-database-identity.mjs` 得到相同摘要。后续所有
migration 都必须经过目标 commit 绑定的备份恢复认证门禁。

## 日常更新 / 今天的更新推送

线上修复必须保持同一个闭环：本地代码修复 → 本地验证 → git commit → git push → VPS 部署该 commit → 线上验证。VPS 不能作为长期热修源头；如果直接在服务器目录改了业务代码，下一次从 Git 重新部署会覆盖掉这些改动，也会让 `.git` 无法准确说明线上版本。

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
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
./scripts/deploy-app-dir.sh
```

### Windows / WSL SSH 部署注意事项

这个仓库常在 Windows 工作区里操作，但部署脚本是 bash 脚本，容易混用三套环境：Windows PowerShell/OpenSSH、Git Bash、WSL。出问题时先分清是哪一层失败。

已知坑：

- 不要从 WSL 里运行 Windows Git 创建的 worktree。`.git` 文件会指向类似 `D:/AI Agent/.../.git/worktrees/...` 的 Windows 路径，WSL Git 会报 `fatal: not a git repository`。
- 在 WSL/Git Bash 里写 `SSH_KEY=~/.ssh/ss_erp_vultr_sg` 会解析到 Unix home，例如 `/home/miku/.ssh/...`，不是 Windows 的 `C:\Users\550W\.ssh\...`。如果 key 实际在 Windows 用户目录，必须用当前 shell 能读到的绝对路径。
- 在这台机器上，PowerShell 中的裸 `bash` 解析到 WSL，不能复用 Windows OpenSSH 的可用链路。执行发布脚本时显式调用 `C:\Program Files\Git\bin\bash.exe`（或 `C:\Progra~1\Git\bin\bash.exe`），并使用 Git Bash 可读的 `/c/Users/550W/.ssh/<key>` 路径。
- `ssh root@45.76.49.64 echo ok` 通过，只能证明认证和 exec 通道正常；`scp` 还会走文件传输通道，可能因为客户端默认 SFTP、远端策略或中间网络被关闭而失败。
- 当前机器上 Windows OpenSSH 到 VPS 可用；优先用 Windows 侧确认连通，再决定是否用 Git Bash/WSL 执行脚本。

部署前最小诊断：

```powershell
Test-NetConnection 45.76.49.64 -Port 22
ssh -i $env:USERPROFILE\.ssh\ss_erp_vultr_sg -o BatchMode=yes -o IdentitiesOnly=yes root@45.76.49.64 echo ok
ssh -i $env:USERPROFILE\.ssh\ss_erp_vultr_sg -o BatchMode=yes -o IdentitiesOnly=yes root@45.76.49.64 "command -v scp; grep -n '^Subsystem[[:space:]]\+sftp' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null || true"
```

如果当前工作树有无关已跟踪改动，`deploy-app-dir.sh` 会拒绝部署。不要为了部署去提交或 stash 无关改动；从当前 commit 新建干净 clone 再部署：

```powershell
git clone "D:\AI Agent\Work\QE\SS ERP" D:\tmp\ss-erp-deploy-clone-<commit>
cd D:\tmp\ss-erp-deploy-clone-<commit>
git checkout <commit>
$env:DEPLOY_HOST="45.76.49.64"
$env:DEPLOY_USER="root"
$env:SSH_KEY="$env:USERPROFILE\.ssh\ss_erp_vultr_sg"
$env:DEPLOY_ENV_PROFILE="cloud-r2"
$env:EXTENSION_RELEASE_ROOT="/var/lib/ss-erp-extension-releases/<full-target-commit>"
C:\Progra~1\Git\bin\bash.exe scripts/deploy-app-dir.sh <commit>
```

如果脚本卡在上传阶段，先单独测试上传同一个 tarball；`scp` 失败时不要反复重跑完整部署脚本，先切换到可控的上传方式或修复本机 SSH/SFTP 客户端问题。

部署前可以先在 VPS 做只读就绪检查：

```bash
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging EXPECTED_PROFILE=cloud-r2 bash scripts/verify-deploy-readiness.sh
```

如果它提示 `IMAGE_STORAGE_BACKEND expected oss` 或 `OSS_* is required`，说明 env 兜底未配置。新版本也可以改用超管后台的 `upload_*` 配置驱动图片上传。

如果输出指向 `/opt/ss-erp` 且目录里有 `.git`，才使用 git checkout 模式：

```bash
cd /opt/ss-erp
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-staging.sh
```

checkout 模式不会把 deploy 用户可写的 Git 目录复制成 root 代码。每个目标提交必须先按
`docs/deployment.md` 的步骤，从本机可信 checkout 生成 gate archive，并由 VPS root 在
`/usr/local/lib/ss-erp-deploy-gate/<target-commit>/` 预装；缺失或逐字节不一致时脚本会在安装依赖和
停服前失败。

如果输出指向 `/opt/ss-erp/current`，使用 release/symlink 模式：

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root SSH_KEY=~/.ssh/ss_erp_vultr_sg DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy.sh
```

执行部署脚本的用户需要有权限执行 `systemctl restart ss-erp-*`。

git checkout 模式默认部署当前已 checkout 的分支；如果你想让 VPS 直接跟着 GitHub 仓库跑，这是最省事的方式。若要指定分支或部署目录：

```bash
DEPLOY_BRANCH=hardening/prelaunch-auth-security ./scripts/deploy-staging.sh  # 当前预上线分支示例
DEPLOY_DIR=/opt/ss-erp ./scripts/deploy-staging.sh
```

`deploy-staging.sh` 必须直接由 runtime `deploy` 用户执行，root helper 以 no-follow descriptor 将
`.env.staging` 快照一次。独立 `ss-erp-build` 用户以不同的非 root UID/GID、空 supplementary groups
安装依赖并构建，只收到公开构建 allowlist 和不可连接的占位 `DATABASE_URL`，不能读取 env 或运行时
密钥。构建前后清单及新 inode 封存通过后，runtime 用户才用同一快照执行备份认证、migration 和
post-migration guard。脚本不接受 `--skip-build`，会删除旧依赖/构建输出并以
`pnpm install --frozen-lockfile --force` 重建；Worker/API/Web 在任何 in-place 改动前停止。
根目录除当前 `$ENV_FILE` 外不得残留任何被 Git 忽略的 `.env*`；Next 的构建 cache 不会被直接
`chown`，封存后会清空并由 root 新建 runtime 专用目录。

所有 systemd 部署模式都必须先把 `pnpm package:extension` 产生并完成外部审批的同一四件套安装到
`/var/lib/ss-erp-extension-releases/<full-target-commit>`，目录为 `root:root 0755`、文件为
`root:root 0644`。部署只运行 `stage-extension-release.mjs` 复验并复制该候选，不会重新打包或增版。
候选准备与精确命令见 `docs/deployment.md`；缺少 `EXTENSION_RELEASE_ROOT` 时必须在停服前失败。

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

部署完成后同时确认实际 commit。app-dir 模式可以查看部署脚本写入的标记；如果标记不存在，至少用最近部署日志或 release 目录名确认：

```bash
cd /opt/ss-erp/app
test -f DEPLOYED_COMMIT && cat DEPLOYED_COMMIT
```

这个 commit 应与本地 `git log --oneline -1` 或指定部署 commit 一致。

如果你只能通过公网访问、没有 SSH 或数据库权限，用本地机器跑：

```bash
pnpm smoke:remote
```

如果要验证图片 / 附件上传是否真的切到 R2 / OSS，再加：

```bash
SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote
```

注意区分两类“R2 设置”：

- `backup_remote_*` 是数据库备份的远程存储，优先供 `ss-erp-worker` 的数据库备份任务使用；旧 `backup-db.sh` 仍读取 `BACKUP_S3_*` 作为兼容兜底。
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

预期分两种：

- 后台配置路径：看到 `upload SystemConfig complete`，说明超管后台的 `upload_storage_backend=oss` 和 `upload_oss_*` 已完整生效。
- env 兜底路径：看到 `RUNTIME_MODE=cloud`、`IMAGE_STORAGE_BACKEND=oss`，并且 `OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION` 都为非空。

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

# 国内 direct-origin app-dir 模式
cd /opt/ss-erp/app
VERIFY_ORIGIN_MODE=direct \
VERIFY_DIRECT_HOSTNAMES=ss-erp.cn,www.ss-erp.cn,app.ss-erp.cn,admin.ss-erp.cn \
VERIFY_EXPECT_LOCAL_POSTGRES=false \
VERIFY_DOMAIN=ss-erp.cn \
VERIFY_READY_URL=https://ss-erp.cn/ready \
DEPLOY_DIR=/opt/ss-erp/app \
ENV_FILE=.env.staging \
bash scripts/verify-vps-deploy.sh
```

覆盖 systemd 服务、Nginx 配置、端口绑定、UFW、防火墙策略、备份 cron、备份状态文件、Prisma migration、`/ready` 和最近错误日志。默认 `VERIFY_EXPECT_LOCAL_POSTGRES=true`，此时还验证本地 PostgreSQL 服务、loopback 5432 和临时恢复库残留；external/RDS 模式必须显式设为 `false`，此时要求本机 5432 无监听并跳过本地临时恢复库检查，因此不提供远端 RDS 临时恢复库残留证明，但仍无条件验证 Prisma migration 及本地/公网 `/ready`。默认 `cloudflare` 模式检查 Cloudflare 真源保护和 IP 更新任务；`direct` 模式改为检查 active Nginx 的合法/未知 Host 路由、ACME HTTP-01 不重定向、`acme.sh` 自动续期，以及列表内每个域名的有效证书和 `/ready`。任一模式缺少 UFW 都视为失败。

### AI Media 暗态门禁（Unit 9C-A / 10B-E / 9C-B / 10A-H1 / H2 / H3 / H4）

Unit 9C-A、10B-E 和 9C-B 已交付 fake-only `FULL_EDIT` / `INPAINT`、Web Mask 编辑器和受约束的候选链式编辑；Unit 10A-H1/H2/H3 已交付历史恢复及 collect/listing-draft 应用账本，Unit 10A-H4 已交付“只恢复既有 Provider task ID、绝不重提”的结果核对状态机、Worker 和超管操作面。它们都不是新付费任务的功能激活。`1600` 至 `1660` 保护候选契约，`1670`/`1680` 支持 history/updates keyset 查询，两个应用账本及 `21124000` 至 `21131000` 的结果核对状态/事件/租约索引只能前向保留。扩展端参考图生图、整图编辑、局部重绘 Mask、历史/审核/`APPLY_APPEND` 控件已在开发和测试环境实现，可用 `node scripts/extension-source-media-standalone.test.mjs` 和 `node scripts/extension-media-mask-editor.test.mjs` 验证。真实生产 Provider 新任务和外部质量验收仍未开启，生产扩展媒体执行会 fail closed，因此所有环境必须保持暗态。标准部署脚本会在 migration 后、启动 API/Worker 前执行同一检查；手工部署也必须显式执行：

```bash
# app-dir 模式
cd /opt/ss-erp/app
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/verify-ai-media-dark.sh

# release/symlink 模式
cd /opt/ss-erp/current
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-ai-media-dark.sh
```

唯一通过结果以 `PASS AI Media rollout is dark` 开头，并确认 master、suite、fullEdit、inpaint、webMedia 均为 `false` 或 absent，rollout policy 的 `tenantIds` 为空。检查失败时：

1. 不得切换 release，不得启动或重启 API/Worker，也不得用 `|| true` 忽略失败。
2. 记录当前 `system_configs` 中相关 key、value、revision；确认没有批准中的试点租户。
3. 通过受审计的管理员变更把以下开关恢复为 `false`，并把 policy 恢复为非负 revision 和空 `tenantIds`：
   - `feature_ai_media_workflow_v2`
   - `feature_ai_media_suite`
   - `feature_ai_media_full_edit`
   - `feature_ai_media_inpaint`
   - `feature_source_listing_web_media`
   - `ai_media_workflow_v2_rollout_policy={"revision":<non-negative>,"tenantIds":[]}`
4. 重新运行暗态检查；只有通过后才允许恢复服务。若本次发布失败，保持数据库前向兼容并恢复上一版应用，不要回滚这些 additive migrations。

三个 systemd 部署入口和 `deploy-compose.sh` / Compose migration wrapper 的 `MIGRATION_TIMEOUT` 均默认为 `20m`，格式必须是正整数加 `s`、`m` 或 `h`（例如 `900s`、`20m`、`1h`）。Linux 入口从进程环境读取；Compose 从对应 env 文件读取。超时会先向 Prisma 发送 TERM，并在 30 秒后强制结束。Compose 升级必须使用 `deploy-compose.sh`，由它先停止旧 API/Worker/Web，再执行 gate；不要用裸 `docker compose up -d`。可用以下命令确认一次性 gate 结果：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs migrate
# staging 改用 docker-compose.staging.yml 和 .env.staging
```

超时或非零退出时 API/Worker 必须保持停止。若当前 migration 使用 `CREATE INDEX CONCURRENTLY`，超时也可能留下 invalid index；先执行本页“Prisma migration 失败”的 `pg_index` / `pg_get_indexdef` 检查，不得把重跑当作恢复策略。

故障清理完成后，migration 重放仍必须使用安装在 root-owned target 目录中的统一 orchestrator；
不得在已存在数据库上直接执行裸 Prisma migration。下面命令会用同一次 dotenv 读取先复验备份，
再降权运行 migration 和 post-migration guard：

```bash
DEPLOY_ROOT=/opt/ss-erp/current  # app-dir 改为 /opt/ss-erp/app；checkout 改为 /opt/ss-erp
TARGET_COMMIT="$(tr -d '\n' < "$DEPLOY_ROOT/DEPLOYED_COMMIT")"
ENV_FILE_REAL="$(readlink -f -- "$DEPLOY_ROOT/.env.staging")"
SERVER_DIR_REAL="$(readlink -f -- "$DEPLOY_ROOT/apps/server")"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "/usr/local/lib/ss-erp-deploy-gate/$TARGET_COMMIT/deploy-backup-gate.mjs" \
  --mode migrate \
  --env-file "$ENV_FILE_REAL" \
  --target-git-commit "$TARGET_COMMIT" \
  --server-dir "$SERVER_DIR_REAL" \
  --run-user deploy \
  --migration-timeout 20m
```

本节所有手工 SQL 使用 `node ../../scripts/run-deploy-psql.mjs -- ...`。该 wrapper 从
`DATABASE_URL` 环境读取目标，移除 Prisma-only 参数，强制 `--no-psqlrc`，并拒绝 `-d/--dbname`
覆盖；数据库 URL 不会进入 argv。

### AI Media 历史分页索引检查与恢复（Unit 10A-H1）

Unit 10A-H1 对应 111 个 migration。`20260720167000_add_ai_media_workflow_history_index` 和 `20260720168000_add_ai_media_workflow_priority_index` 都是单语句 `CREATE INDEX CONCURRENTLY`；前者建立 `ai_media_workflow_owner_context_history`，后者建立 `ai_media_workflow_owner_context_updates`。部署完成、超时或 migration 非零退出后，在 API/Worker 保持停止时执行：

```bash
cd /opt/ss-erp/current/apps/server   # app-dir 模式改为 /opt/ss-erp/app/apps/server
set -a
. ../../.env.staging
set +a

npx prisma migrate status

node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260720167000_add_ai_media_workflow_history_index',
  '20260720168000_add_ai_media_workflow_priority_index'
)
ORDER BY migration_name;

SELECT index_ns.nspname AS index_schema,
       c.relname AS index_name,
       table_ns.nspname AS table_schema,
       t.relname AS table_name,
       i.indisvalid,
       i.indisready,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
JOIN pg_namespace AS index_ns ON index_ns.oid = c.relnamespace
JOIN pg_class AS t ON t.oid = i.indrelid
JOIN pg_namespace AS table_ns ON table_ns.oid = t.relnamespace
WHERE index_ns.nspname = current_schema()
  AND table_ns.nspname = current_schema()
  AND t.relname = 'ai_media_workflows'
  AND c.relname IN (
  'ai_media_workflow_owner_context_history',
  'ai_media_workflow_owner_context_updates'
)
ORDER BY c.relname;
SQL
```

两个索引都必须同时满足 `indisvalid=true`、`indisready=true`。定义必须以 `owner_user_id, context_type, context_id` 开头；history 索引随后为 `created_at DESC, id DESC`，updates 索引随后为 `updated_at DESC, id DESC`。索引缺失、无效、未 ready 或定义漂移都不能通过，且不能用 `prisma migrate resolve --applied` 掩盖。

若失败 migration 留下同名 invalid index，先确认没有重复写入进程，再对对应索引执行独立的并发删除。`DROP INDEX CONCURRENTLY` 不能放入 transaction block。只有 ledger 显示 `1670` 实际失败且未 rolled back 时，运行：

```bash
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT format(
  'DROP INDEX CONCURRENTLY IF EXISTS %I.%I;',
  current_schema(),
  'ai_media_workflow_owner_context_history'
)
\gexec
SQL
npx prisma migrate resolve --rolled-back 20260720167000_add_ai_media_workflow_history_index
```

只有 ledger 显示 `1680` 实际失败且未 rolled back 时，运行：

```bash
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT format(
  'DROP INDEX CONCURRENTLY IF EXISTS %I.%I;',
  current_schema(),
  'ai_media_workflow_owner_context_updates'
)
\gexec
SQL
npx prisma migrate resolve --rolled-back 20260720168000_add_ai_media_workflow_priority_index
```

处理所有实际失败项后，先回到仓库根目录执行上文统一 root-owned orchestrator 命令，再检查状态：

```bash
npx prisma migrate status
```

若只有一个 migration 失败，不得对另一个已成功 migration 执行 `resolve --rolled-back`；只运行失败项对应的 drop/resolve，然后在重放前复验当前目标 commit 的备份认证。认证过期时，先按“备份与恢复”重新生成可恢复证据，不能跳过 verifier。重放后必须再次执行 `pg_index` 查询，确认两个索引均 valid、ready 且定义精确，再运行 `verify-ai-media-dark.sh`。H1 本地关闭基线为 PostgreSQL 45/45、populated upgrade 1/1、2627 项服务端测试通过且 125 项按环境跳过、192 项扩展检查通过；workspace typecheck、full preflight 和 production build 均通过，桌面/移动多会话浏览器验收无横向溢出或控制台错误。该基线不替代目标环境复核；H4 检查见下一节，H2/H3b 账本检查见后续各节。

### Provider 结果核对检查与恢复（Unit 10A-H4）

H4 对应连续 migrations `20260721124000` 至 `20260721131000`。它只查询已经持久化的异步 Provider task ID；没有 task ID 时只能进入人工核对，任何路径都不能调用 submit 或创建替代付费任务。Worker 使用 20 分钟租约、每次即时领取一条并在单轮内有界排空；超管 `/admin/ops` 默认显示 `MANUAL_REVIEW`，结果决定与 AI 成本结算是两个独立审计流程。

部署前停止 API/Worker，执行 migrate 后检查八个 migration、due/工作流恢复/租约三个任务索引、事件索引和延期事件：

```bash
cd /opt/ss-erp/current/apps/server   # app-dir 模式改为 /opt/ss-erp/app/apps/server
set -a
. ../../.env.staging
set +a
npx prisma migrate status

node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name BETWEEN
  '20260721124000_add_ai_provider_reconciliation_state' AND
  '20260721131000_extend_ai_provider_reconciliation_backfill_deadlines'
ORDER BY migration_name;

SELECT c.relname AS index_name, i.indisunique, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema()
  AND c.relname IN (
    'ai_image_job_provider_reconciliation_due',
    'ai_image_job_workflow_provider_reconciliation',
    'ai_image_job_provider_reconciliation_lease_due',
    'ai_provider_reconciliation_event_job_revision'
  )
ORDER BY c.relname;

SELECT provider_reconciliation_status, count(*)
FROM ai_image_jobs
WHERE provider_reconciliation_status <> 'NOT_REQUIRED'
GROUP BY provider_reconciliation_status
ORDER BY provider_reconciliation_status;
SQL
```

四个索引必须 `indisvalid=true` 且 `indisready=true`；事件 job/revision/created 索引必须 `indisunique=false`，从而允许终态后追加身份冲突证据。`126000` 与 `130000` 都必须保持为单语句 `CREATE INDEX CONCURRENTLY`。若其中一项失败并留下同名 invalid index，在所有 writer 停止时只执行对应的一组命令：

```bash
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 \
  -c 'DROP INDEX CONCURRENTLY IF EXISTS ai_image_job_workflow_provider_reconciliation'
npx prisma migrate resolve --rolled-back 20260721126000_add_ai_provider_reconciliation_workflow_index

# 或仅在 130000 实际失败时：
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 \
  -c 'DROP INDEX CONCURRENTLY IF EXISTS ai_image_job_provider_reconciliation_lease_due'
npx prisma migrate resolve --rolled-back 20260721130000_index_ai_provider_reconciliation_leases
```

不得对已经成功的另一个 concurrent-index migration 执行 `resolve --rolled-back`。清理实际失败项后，
先按本页“备份与恢复”取得当前目标 commit 的新鲜认证，再执行上文统一 root-owned orchestrator、
上述 `pg_index` 查询和暗态 verifier；不得裸跑 migration。

`131000` 会为仍处于 `PENDING/RUNNING/RETRY_WAIT` 且期限不足 24 小时的任务同时延长 deadline、将 revision 加一，并写 `PROVIDER_RECONCILIATION_DEADLINE_EXTENDED` 不可变事件。任何失败都必须保持 API/Worker 停止；不得禁用 transition trigger、不得手工改 revision、不得 `resolve --applied`。修复后重跑 migration/status 和暗态 verifier，再启动 Worker，并检查：

```bash
journalctl -u ss-erp-worker --since '10 minutes ago' | grep -E 'ai-provider-reconciliation|error|failed'
```

超管只可依据 Provider 控制台证据执行 `RESUME`（同一 task ID）、`NO_OUTPUT` 或 `NOT_SUBMITTED`；任务身份冲突、过期、配置不可查询时不能猜测成功。取消后的迟到输出只保存为审计资产，不恢复工作流，已计费单位仍计入每日额度。H4 本地关闭基线为 130 migrations、PostgreSQL 54/54、94-migration populated upgrade、2769 passed/134 skipped 服务端测试、192 项扩展检查、workspace typecheck/build 和 lint 0 errors。该基线不代表真实 Provider 质量验收或允许 Ozon 写入。

### AI Media 应用账本与补偿回滚检查（Unit 10A-H2）

H2 对应 migrations `20260720169000_add_ai_media_application_mutations` 和 `20260720170000_harden_ai_media_application_mutation_authority`，使当前 collect 图片应用成为 owner-scoped、不可变的 APPLY/ROLLBACK 账本。`1690` 创建表、外键、唯一键和 immutable/authority triggers；`1700` 在 `ACCESS EXCLUSIVE` 锁下要求账本为空后再安装加固约束并清理旧 authority trigger。两项 migration 都必须前向保留，不能用应用版本回滚或 down migration 删除账本。

部署或故障排查时，先停止 API/Worker 写入并完成备份：

```bash
cd /opt/ss-erp/current/apps/server   # app-dir 模式改为 /opt/ss-erp/app/apps/server
set -a
. ../../.env.staging
set +a

npx prisma migrate status

node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260720169000_add_ai_media_application_mutations',
  '20260720170000_harden_ai_media_application_mutation_authority'
)
ORDER BY migration_name;

SELECT count(*) AS application_mutation_rows
FROM ai_media_application_mutations;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'ai_media_application_mutations'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ai_media_application_mutations'
ORDER BY indexname;
SQL
```

正常首次升级必须在 API/Worker 停止、暗态开关关闭时看到账本行数为 `0`，两个 migration 的 `finished_at` 非空且 `rolled_back_at` 为空，并存在以下 triggers：`ai_media_application_mutations_validate_insert`、`ai_media_application_mutations_immutable`。结构检查还应确认 `ai_media_application_mutation_id_owner_key`、`ai_media_application_mutation_rollback_of_key`、`ai_media_application_mutation_owner_operation_key`、`ai_media_application_mutation_job_kind_key`、`ai_media_application_mutation_target_sequence_key`、`ai_media_application_mutation_target_history_idx` 和 `ai_media_application_mutation_workflow_history_idx`。迁移后账本非零是正常业务状态，不得据此清空数据。

如果 `1700` 报 `application mutation authority upgrade requires an empty ledger`：保持 API/Worker 停止，**不得** `TRUNCATE`/`DELETE` 账本，**不得** `prisma migrate resolve --applied`，也不得伪造 migration 状态；保留数据并升级为逐行审计后的前向迁移。只有确认是 lock timeout、事务已完整回滚且表仍为空时，才可按 migration 状态将实际失败项标为 rolled back 后重放。重放后重新执行结构查询和 `verify-ai-media-dark.sh`。

应用版本回滚跨 H2 时，先关闭所有 AI Media/Web-media 开关并阻止旧 binary 新增应用；保留 `1690`/`1700` 的表、函数、触发器、索引和所有历史记录。媒体撤销只能通过 API 的补偿式 `ROLLBACK` mutation 完成：只允许当前 target frontier，遇到 `ROLLBACK_ORDER_CONFLICT` 必须先处理后续应用，遇到 `ROLLBACK_TARGET_CHANGED` 必须刷新并人工复核，不能强制覆盖。重复请求应复用相同 operation key 取得 replay；不同 fingerprint 必须失败。只读历史可通过：

```text
GET /api/ai-images/applications?targetType=collect&targetId=<owned-target-id>
```

服务端和数据库共同限制每个 managed array 最多 100 项、完整 projection 最多 262144 bytes；超限、跨 owner/workflow/job/asset、非当前 frontier 或 stale CAS 均必须 fail closed。确认账本检查和暗态 verifier 均通过后，才允许恢复 API/Worker。

H2 本地关闭基线为 focused 143/143、PostgreSQL 46/46、populated upgrade 1/1、2648 项服务端测试通过且 126 项按环境跳过、192 项扩展检查通过；workspace typecheck、full preflight、production build 和 lint 0 errors / 20 条既有 warnings 均通过。浏览器验收覆盖 stale refresh、5→6 APPEND、确认式 6→5 补偿 ROLLBACK、成对历史与空 rollback frontier，并在 `1440x1000` 和 `375x812` 下无可见横向溢出或新增 console/network 错误。该证据不替代每个目标环境的 migration/status/trigger/index/dark-gate 复核，也不授权真实 Provider 或 Ozon 写入。

### AI Media listing-draft 应用账本检查（Unit 10A-H3b）

H3b 对应 migrations `20260721120000_add_ai_media_listing_draft_application_mutations`、`20260721121000_harden_ai_media_listing_draft_application_authority`、`20260721122000_fix_ai_media_listing_draft_projection_constraints` 和 `20260721123000_enforce_ai_media_listing_draft_actor_authority`。四项 migration 必须按顺序前向保留；应用版本回滚不得删除账本、草稿版本、触发器或有效索引。生产环境保持 fake-only/dark，能力 DTO 的 `listingDraftApplyEnabled` 必须为 `false`。

部署或故障排查时停止 API/Worker 写入并执行：

```bash
npx prisma migrate status
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260721120000_add_ai_media_listing_draft_application_mutations',
  '20260721121000_harden_ai_media_listing_draft_application_authority',
  '20260721122000_fix_ai_media_listing_draft_projection_constraints',
  '20260721123000_enforce_ai_media_listing_draft_actor_authority'
)
ORDER BY started_at, id;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ai_media_listing_draft_application_mutations'
ORDER BY indexname;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'ai_media_listing_draft_application_mutations'::regclass
  AND NOT tgisinternal
ORDER BY tgname;
SQL
```

正常结果必须包含六个 ledger indexes 和四个启用的 triggers：`ai_media_listing_draft_mutation_actor_insert`、`ai_media_listing_draft_mutation_authority_insert`、`ai_media_listing_draft_mutation_immutable`、`ai_media_listing_draft_mutation_validate_insert`。历史查询使用 `GET /api/ai-images/contexts/listing-draft/<draft-id>/applications`；写入只接受当前冻结 product/SKU slot，rollback 只能是当前 target frontier 的补偿 mutation。遇到 stale、cross-owner、operation-key conflict 或 forged projection 时必须 fail closed，不得手工更新账本。

本地 H3b 关闭证据为 PostgreSQL 51/51、populated upgrade、真实双连接跨账本 operation-key serialization、forward-only apply/rollback chain、reapply conflict 和 owner/actor/snapshot/operation/source/SKU-slot 篡改拒绝；当前全量 preflight 为服务端 2843 passed/137 skipped、扩展 201 checks，生产构建与 lint 0 errors / 20 条既有 warnings。浏览器已覆盖 product/SKU APPEND、confirmed REPLACE、reload recovery、严格多步回滚、刷新风暴回归及 1440x1000/390x844 无溢出，并确认所有 rollout/provider/Ozon gate 恢复暗态。本地 Ozon 凭证不可用时 `/attributes` 的预期 503 不属于 H3b 写回失败。该证据不授权真实 Provider、扩展完整工作台或 Ozon 写入。

### 阿里云短信（Dysmsapi 2017-05-25）

当前服务端支持 `SendSms`、已审核签名/验证码模板候选查询，以及注册、密码找回和可选的短信登录。OpenAPI Explorer 能使用浏览器登录态自动签名，但 VPS 进程必须配置机器凭证：

- 推荐阿里云 ECS：创建只允许 `dysms:SendSms`、`dysms:QuerySmsSignList`、`dysms:QuerySmsTemplateList` 的 RAM 角色并绑定到 ECS；设置 `SMS_ALIYUN_CREDENTIAL_MODE=ecs_ram_role`，角色名可留空由 IMDS 自动发现。该显式模式强制 IMDSv2。
- 也可使用 SDK 默认凭证链：`SMS_ALIYUN_CREDENTIAL_MODE=auto`。为兼容旧部署，存在完整 `SMS_ALIYUN_ACCESS_KEY_ID/SECRET` 时会优先使用这对密钥；没有完整密钥时按环境变量、配置文件、ECS RAM Role 等顺序查找凭证，并必须设置 `ALIBABA_CLOUD_IMDSV1_DISABLED=true`。
- 只有无法使用角色时才使用 `SMS_ALIYUN_CREDENTIAL_MODE=access_key`，并把 `SMS_ALIYUN_ACCESS_KEY_ID/SECRET` 放在 VPS 私有环境，不进 Git 或聊天。

无论凭证来源是哪一种，都必须按用途明确选择已审核的签名、模板 Code 和变量名：注册、找回密码、短信登录互不回退。旧版单模板只兼容注册用途；同一个通用模板若确实通过了多个业务场景的审核，也必须由管理员显式填入每个用途。管理员设置页的“读取已审核资源”只查询候选并读取变量名，不会自动判断用途，也不会发送短信；候选模板会按所选签名过滤，切换签名会清空旧模板选择。

国内当前已审核资源使用签名 `常青藤上云`：注册 `SMS_509985065`、找回密码 `SMS_509985066`、短信登录 `SMS_510180079`，变量均为 `code`。`SMS_510120085` 属于修改/重制密码模板，但当前 ERP 没有对应的用户短信改密流程，因此保留未接线，不能替代找回密码模板。

真实测试前必须在系统设置填写 `auth_sms_test_phone_whitelist`。然后在“管理 -> 集成”输入白名单手机号并点击测试；无白名单时服务端拒绝真实测试发送。测试接口为 `GET /api/admin/system-status/test/sms/aliyun-resources`（只读查询候选）和 `POST /api/admin/system-status/test/sms`（只有当前网页登录会话和白名单手机号才能发送，固定使用注册用途）。

短信登录默认关闭，需在系统设置显式打开 `feature_sms_login`；首位管理员仍通过 `/setup` 创建，不经过短信登录。

## 服务器功能验收清单

真实短信尚未配置时，可以先把短信发送检查视为待验收项；cloud 运行模式会拒绝 console provider，只有本地环境允许将验证码写入开发日志，其余项目必须给出明确通过/失败结果。

### 公网基础功能

在本地机器运行：

```bash
pnpm smoke:remote
```

通过标准：

- `/ready` 返回 `status:"ready"`，且 `db`、`redis` 都是 `ok`
- `ss-erp.com/` 直接渲染官网首页，`ss-erp.com/landing` 和 `www.ss-erp.com` 规范化到主域
- `app.ss-erp.com`、`admin.ss-erp.com` 页面可访问并保持登录入口隔离
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

- `ss-erp-api`、`ss-erp-worker`、`ss-erp-web`、Nginx、Redis 都 active；本地 PostgreSQL 模式还要求 PostgreSQL active
- API/Web/Redis 内部端口只监听 loopback；本地 PostgreSQL 模式要求 5432 只监听 loopback，external/RDS 模式要求本机 5432 无监听
- 80/443 对外可用
- 两种 PostgreSQL 模式都要求 Prisma migration up to date，且本地和公网 `/ready` 通过
- 仅 `VERIFY_EXPECT_LOCAL_POSTGRES=true` 的本地 PostgreSQL 模式检查临时恢复库残留；external/RDS 模式不提供远端临时恢复库残留证明
- schema v3 `backup-status.json`、不可变 sidecar 和当前 deployed-commit attestation 均通过
- 最近 API/Worker 日志没有 fatal、exception、unhandled、panic

### 备份与恢复

首次启用本门禁前，按 `docs/deployment.md` 为每个数据库插入独立的
canonical `deployment_database_identity_v1` ID/UUID 对象；克隆数据库必须轮换，不能沿用源库
identity。

在 VPS 运行：

```bash
TARGET_COMMIT=<lowercase-full-40-character-commit>
set -a
. ./.env.staging
. /etc/ss-erp-backup.env
set +a
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/backup-db.sh
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/verify-backup-restore.sh
bash scripts/verify-deploy-backup.sh "$TARGET_COMMIT"
```

通过标准：

- 本地生成经过 `gzip -t` 的 `ss_erp_*.sql.gz`，保留压缩字节数和 SHA-256
- 写入 canonical schema v3 latest 状态及每份备份不可变的 `.status.json` sidecar
- 应用和备份 URL 查询得到相同实际数据库名、OID 与库内 deployment UUID；路由可以不同
- 恢复演练从 no-follow descriptor 读取同一份备份、读到正数 public 表，并确认临时库删除成功
- maintenance 路由写入的随机数据库标记必须能由恢复 URL 在导入前及删除前精确读回
- 生成 `0600`、数据库实际身份/目标 commit/恢复流绑定的 schema v2 部署认证，且部署前复验通过

应用 env 中的发布门禁目录键是 `DEPLOY_BACKUP_LOCAL_DIR`；`BACKUP_LOCAL_DIR` 留在
`/etc/ss-erp-backup.env` 给备份工具使用。后台备份服务若配置自己的 `BACKUP_LOCAL_DIR`，应使用
不同目录，不能覆盖或清理发布认证文件。发布证据目录必须由备份/verifier 用户（标准部署为
root）所有且不可被 group/world 写入；应用 `DATABASE_URL` 与备份 `BACKUP_DB_URL` 的目标
数据库名、OID 和库内 deployment UUID 必须一致；hostname/port 路由可以不同。

同一 commit 的认证过期后直接重新运行恢复演练。脚本由 root 先将旧认证以完整 SHA-256 命名归档，
保留原始 inode/字节，再签发新的 commit 指针；不要手工删除、覆盖或改名
`deploy-backup-<commit>.attestation.json`。任何轮换失败都不允许继续 migration。

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

release/symlink 模式只允许用已测试的 rollback 入口切换现有不可变 release：

```bash
DEPLOY_HOST=<server> DEPLOY_USER=root ./scripts/rollback.sh [full-target-commit]
DEPLOY_DIR=/opt/ss-erp/current bash scripts/verify-vps-deploy.sh
```

app-dir 模式必须在确认数据库向后兼容后，为目标 revision 生成新鲜备份/恢复认证，再用
`deploy-app-dir.sh <full-target-commit>` 重新发布。checkout 模式不得手工 `git checkout` 后直接 build/restart；
先预装目标 gate，再通过受控 rollback 分支运行 `deploy-staging.sh`，或改用 archive 入口。应用回滚
不会撤销数据库 migration；不兼容旧 binary 时停止回滚并做前向修复。

## 数据库备份

新版本优先使用后台配置：

- 超管后台 `系统设置 -> 备份策略`：配置 `backup_remote_*`，密钥加密入库。
- 超管后台 `接口与集成`：测试“数据库备份 R2”是否可写。
- 超管后台 `系统设置 -> 备份策略`：可点“立即备份”，由 `ss-erp-worker` 执行 `pg_dump`、压缩、上传和状态写入。
- `/opt/ss-erp/shared/backups` 只属于应用后台备份 worker，不是发布门禁证据。
- 发布门禁默认显式使用 `DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp`；没有 shared/旧路径 fallback，
  两个目录不得相同或通过符号链接指向同一位置。

发布备份脚本仍作为标准门禁的取证工具；它不是可绕过认证的兼容兜底：

```bash
# 手动发布备份（目标必须是将要执行 migration 的完整 commit）
set -a
. ./.env.staging
. /etc/ss-erp-backup.env
set +a
TARGET_COMMIT=<lowercase-full-40-character-commit>
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" ./scripts/backup-db.sh

# 无损恢复演练（恢复到临时库后自动删除）
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" ./scripts/verify-backup-restore.sh
./scripts/verify-deploy-backup.sh "$TARGET_COMMIT"

# 如果应用数据库账号没有 CREATEDB 权限，且 PostgreSQL 就在本机：
VERIFY_RESTORE_LOCAL_POSTGRES=1 BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" \
  ./scripts/verify-backup-restore.sh

# 定时备份（参考 crontab）
cat scripts/backup-db.crontab.example
```

建议至少做两类备份测试：

1. 后台“数据库备份 R2”测试是否能写入并删除测试对象。
2. 后台“立即备份”是否能生成本地备份、上传 R2、写入 `backup-status.json`。
3. `verify-backup-restore.sh` 是否能恢复同一份 sidecar-bound 备份、自动清理临时库，并让
   `verify-deploy-backup.sh` 通过目标 commit/database 认证。

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

先停止 API/Worker 写入、完成数据库备份，并查看状态和失败日志。不要在没有核对实际数据库对象时把 migration 标记为已应用：

```bash
cd /opt/ss-erp/current/apps/server   # app-dir 模式改为 /opt/ss-erp/app/apps/server
set -a
. ../../.env.staging
set +a
npx prisma migrate status

node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 <<'SQL'
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '20260720153000_bind_ai_image_edit_outputs';

SELECT c.relname AS index_name,
       i.indisvalid,
       i.indisready,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
WHERE c.relname = 'media_assets_edit_output_job_kind_unique';
SQL
```

`20260720153000_bind_ai_image_edit_outputs` 使用 `CREATE UNIQUE INDEX CONCURRENTLY`。该命令失败时可能留下 `indisvalid=false` 的索引。**禁止直接执行** `prisma migrate resolve --applied 20260720153000_bind_ai_image_edit_outputs`；migration ledger 不能替代索引有效性和定义检查。

预期索引定义必须同时满足：

- `UNIQUE (ai_image_job_id, kind)`；
- predicate 只覆盖 `AI_PROVIDER_OUTPUT`，以及 metadata 含 `providerOutputAssetId` 的 `AI_GENERATED`；
- `indisvalid=true` 且 `indisready=true`。

若索引不存在、无效，或 migration 已失败但留下了索引，保持 API/Worker 停止，并在独立语句中清理后重放。`DROP INDEX CONCURRENTLY` 不能放在 transaction block 中：

```bash
node ../../scripts/run-deploy-psql.mjs -- -v ON_ERROR_STOP=1 \
  -c 'DROP INDEX CONCURRENTLY IF EXISTS "media_assets_edit_output_job_kind_unique";'

npx prisma migrate resolve --rolled-back 20260720153000_bind_ai_image_edit_outputs
# 回到仓库根目录执行上文统一 root-owned orchestrator 命令后：
npx prisma migrate status
```

如果首次创建 unique index 是因重复数据失败，先查询并人工审计冲突记录，不要自动删除资产：

```sql
SELECT ai_image_job_id, kind, count(*)
FROM media_assets
WHERE ai_image_job_id IS NOT NULL
  AND (
    kind = 'AI_PROVIDER_OUTPUT'
    OR (kind = 'AI_GENERATED' AND metadata->>'providerOutputAssetId' IS NOT NULL)
  )
GROUP BY ai_image_job_id, kind
HAVING count(*) > 1;
```

重放后再次执行 `pg_index` / `pg_get_indexdef` 查询，确认有效性和 predicate 与 migration 文件完全一致；随后运行 `verify-ai-media-dark.sh`。两项都通过后才能恢复 API/Worker。若已存在有效但定义不同的同名索引，停止处理并升级审查，不能标记 applied 或自行改写 migration 历史。

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

下面的备份、恢复和 verifier 三条命令在目标 VPS 的目标 revision 私有运维 checkout 中执行；
随后从持有同一 commit 的运维工作站运行标准部署入口。若分支在两步之间移动，commit 绑定会让
部署失败，必须针对新的目标重新取证，不能复用旧认证。

```bash
# 1. 开启维护模式
# 2. 确认目标 revision，并从该 revision 的私有运维 checkout 执行：
TARGET_COMMIT=<lowercase-full-40-character-commit>
set -a
. ./.env.staging
. /etc/ss-erp-backup.env
set +a
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/backup-db.sh
BACKUP_TARGET_GIT_COMMIT="$TARGET_COMMIT" bash scripts/verify-backup-restore.sh
bash scripts/verify-deploy-backup.sh "$TARGET_COMMIT"
# 3. 使用与部署模式匹配的标准入口；不要直接执行 Prisma migration
DEPLOY_HOST=<server> DEPLOY_ENV_PROFILE=cloud-r2 ./scripts/deploy-app-dir.sh "$TARGET_COMMIT"
# release/symlink 模式改用 ./scripts/deploy.sh "$TARGET_COMMIT"
# 4. 标准入口通过 readiness 和暗态检查后运行 smoke
cd apps/server && SMOKE_ENV_FILE=../../.env.staging SMOKE_BASE_URL=https://ss-erp.com pnpm smoke:live
# 5. 关闭维护模式
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
