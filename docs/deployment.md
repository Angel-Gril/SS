# SS ERP 生产部署草案

本文档描述云端 SaaS 部署骨架。本地 Windows 离线包继续使用 `build/scripts`，不要和云端部署混用。

## 日本/COM 最新部署（2026-09-05）

- COM VPS 已切换到不可变提交 `be6a63747877ec1f130b7eee6f2f58f39f9b8bf8`；扩展 `1.0.313`
  使用 Ed25519 key ID `ss-erp-extension-release-2026-09-05-01` 完成签名和暗部署。
- 目标备份 `ss_erp_20260905_145638.sql.gz` 已完成 142 表临时恢复演练并清理恢复库，148 migrations、服务重启和双 `/ready` 均通过。
- 官网 publication pointer 继续保留已批准的 `1.0.311`，`1.0.313` 尚未公开发布；AI Media/BYOK 保持暗态。
- 部署后 VPS verifier 为 `0 failure / 1 warning`，唯一 warning 为未配置远端备份；本次未执行 Provider/Ozon 写入。

## 历史生产发布（2026-08-20）

- COM 与 CN 两台生产 VPS 均运行不可变提交
  `d27b3ad855bb7bc373cb168b2861100c4aeea61e`；扩展 `1.0.311` 已部署但保持暗态，官网
  publication pointer 已通过 CAS 激活到 `1.0.311`。COM approval SHA-256 为
  `a65fa010239033550694437c97844f943648cdc6f53f0c82d622684b7ca5d4d5`，CN approval
  SHA-256 为 `0e481fb68068409a57997c087f98711cb072c86a06c7f0e82fe4b9d9ab86f4f0`。
- 部署 Run ID 为 `rel04-d27b3ad8-311-20260819`，helper SHA-256 为
  `83fe9f907ee9189cbce82d7dd6e4780f2539607c64260b2d749e5a987cd6c868`。双区域部署摘要
  SHA-256 为 `4da008349ff0de62c85bea2a35df6157500eab6f5a29950dfa2f36f7f554fd06`；备份/恢复
  认证、146 migrations、服务健康检查和 `7/32` REL-04 暗态 canary 已通过。
- 1.0.311 候选使用 Ed25519 key ID `ss-erp-extension-release-2026-08-02-01`；COM/CN 签名
  SHA-256 分别为 `f566956d399a8e577844bd7a7cec2a399e5a0813bf25b60ca09e741f243c289b` 和
  `e89f25a983db42c533b776598f04c6570dab6e60d928947d03d48a8881043b07`。
- CN 当前仅有本地备份，远端备份存储尚未配置。这不阻塞已批准的暗部署，但属于长期生产运维前
  仍需处理的加固项。
- 1.0.311 的 DNS-quorum publication closure 已完成。修正版 publication helper SHA-256 为
  `b2bd6f7f825e9308b91d81ea21d0037039930d65593077a42e02e11ca701ab01`，rollout-preserve
  wrapper SHA-256 为 `1d4b48d6d8bca542f5dc6d0a61fdf97d668f0a9ed7eed98a0985d29c6a919d04`，DNS
  quorum evidence SHA-256 为 `9cc22f7dad6882cf549eb7fd77d6442093d7db82642460b28398fc148902921c`。
  Run ID 为 `rel04-d27b3ad8-311-publication-closure-dns-r3-20260820`。COM/CN 只读远程
  verifier 均 `PASS`（0 failures、1 warning）；唯一 warning 是远端备份存储尚未配置。
  双区域 publication summary SHA-256 为
  `000d9800e8f7dadd45032db2d3763f26c436eabe49ea87671e7e1f552abd81bb`。
- 本次 closure 刷新了目标绑定备份/恢复证明：COM attestation SHA-256 为
  `6ab3174159a13f1622dc4d93a220a1f9b1158fcab857780da1355066c7777f4b`（142 restore tables，
  backup artifact `45e53ae8498725202c2454793c2603812721ef68fd864ccd0a29dcc5ca6a8836`）；CN
  attestation SHA-256 为 `0b767a21d3e8e810c781cbceb4c34d1a49bc579543692aa06e7a44d66554841c`
  （141 restore tables，backup artifact `d0529fce515436060c90a2043466b046cdbbb85ca0cbc393249457755073711a`）。
  临时恢复库均已清理，未修改业务库。
- COM 暗化/恢复 CAS 已将八项配置 revision 各推进 2，值哈希恢复为快照值；因此旧 revision
  绑定 wrapper 不可复用，后续暗态操作必须重新生成并核对 helper。COM BINI 已在独立批准下
  完成同路径 `1.0.310 -> 1.0.311` 升级：安装树 SHA-256 为
  `3270fbdaa93b1f7ac1df24ae3d1d6329208d66b337462e4d1f772766e46967bb`，旧版本 backup 树
  SHA-256 为 `5cce7010bcffdeb2e27ca55d12731be9f71f785670786802f2828ea9c15cfbca`；active-worker
  receipt SHA-256 为 `fbbdc67dd3ed74b816c3cff43eec7865c09ffc2b379069913e9859a787972fb2`，Unicode
  smoke receipt SHA-256 为 `ae28e385e134fa66c8a0c2254d103ced5f2e20eb253c0b590e07e73afccdb705`，
  same-path closure SHA-256 为 `9260f491007d86494e81546d598bebb9de7ca89d7a16c785206c85ac45b86c66`。
  CN 本机托管扩展不在本次 BINI 范围内。
- 本次变更未执行 Provider 请求、ERP ingest/publish、Ozon 写入或试点操作。真实试点前仍须
  将 COM BYOK 策略收紧到精确 owner/shop/device/origin/operation，并绑定草稿 revision、全新
  offer 前缀、回滚命令和责任操作员。

后续纯文档提交只记录上述事实，不改变生产部署、功能开关或官网 pointer。

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
6. 停止写入后，通过下文标准部署入口先验证目标 commit 的备份恢复认证，再执行
   `prisma migrate deploy`；不得直接运行裸 Prisma 命令。
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
- 国际站人机验证：`HUMAN_CHALLENGE_PROVIDER=cloudflare-turnstile` + `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_ALLOWED_HOSTNAMES`。白名单填写英文逗号分隔的精确 hostname，不支持协议、端口、路径或通配符，留空或非法时认证失败关闭。
- 国内站人机验证：`HUMAN_CHALLENGE_PROVIDER=builtin-pow` + 至少 32 位随机 `HUMAN_CHALLENGE_SIGNING_SECRET`；按需设置 `HUMAN_CHALLENGE_POW_DIFFICULTY=4` 和 `HUMAN_CHALLENGE_TTL_SECONDS=120`。
- `SMS_PROVIDER` + `SMS_ALIYUN_*` 或 `SMS_TENCENT_*`（短信验证码；阿里云生产优先使用 ECS RAM Role）
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`（服务端 / 浏览器端错误追踪）
- `NEXT_PUBLIC_API_BASE_URL`（前端 API 地址）
- `IMAGE_STORAGE_BACKEND` + `OSS_*`（图片存储；云端推荐 `oss`，OSS 未准备好时 staging 可临时用 `ozon-cdn`）

OSS/图片存储配置走环境变量，不再存入 `system_configs`。详见根目录 `DEPLOYMENT.md` 第 3.3 节。

`HUMAN_CHALLENGE_PROVIDER`、`TURNSTILE_*` 和 PoW 环境变量显式设置后优先于管理员后台；未设置时才读取 `SystemConfig`。部署前必须确认最终生效来源，避免环境变量和后台保存两套冲突值。旧部署若仍使用 `FEATURE_TURNSTILE_LOGIN=true`，同样必须配置 Turnstile 两把 key 与 `TURNSTILE_ALLOWED_HOSTNAMES`。

账号会话 Cookie 固定为 host-only，`app` 与 `admin` 子域必须分别持有自己的 `sserp_token`；两个 Web 主机的浏览器 API 请求都必须走当前主机的 `/api/*` 反代，公开下载地址和扩展配对仍使用 canonical API origin。旧部署若曾设置 `AUTH_COOKIE_DOMAIN=.example.com`，升级时暂时保留该变量：服务端只用它过期旧父域 Cookie，新登录不会继续写父域 Cookie。至少保留到最长旧 Cookie 生命周期结束并完成两端重新登录验收后再删除；首次迁移时其中一端可能需要重新登录一次。

Turnstile 依赖浏览器访问 `https://challenges.cloudflare.com`。如果登录页显示错误码（例如 `300030`）或持续提示加载失败，先在普通的最新版 Chrome/Edge 中关闭广告拦截、脚本拦截和严格隐私扩展，并确认该域名可访问；CDP、无头浏览器和部分企业代理会被 Cloudflare 拒绝，反复点击重试不会生成有效 token。中国大陆或无法稳定访问 Cloudflare 的部署应改用 `builtin-pow`，配置至少 32 位的 `HUMAN_CHALLENGE_SIGNING_SECRET` 后重启 API/Web，而不是把 Turnstile 密钥留空。

首个超级管理员只允许通过 `/setup` 引导流程创建。公开注册只创建普通 `USER`，且在系统没有任何 `ADMIN` 前会被后端拒绝。生产环境必须配置 `SETUP_TOKEN`，防止公网首次访问者抢占管理员账号。

## 部署命令示例

首次启用备份门禁时，每个既有数据库先单独生成一个非秘密 UUID，并插入一次内部身份行。不得在
production/staging 之间复用；从生产克隆数据库后也必须在克隆库轮换，再重新取证。下面的
`INSERT` 在 identity 已存在时会失败，避免静默改写：

```bash
DATABASE_IDENTITY_UUID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
DATABASE_IDENTITY_VALUE="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" \
  DATABASE_IDENTITY_UUID="$DATABASE_IDENTITY_UUID" node -e '
process.stdout.write(JSON.stringify({
  databaseId: process.env.DEPLOY_DATABASE_ID,
  databaseUuid: process.env.DATABASE_IDENTITY_UUID,
}));
')"
PGDATABASE="$BACKUP_DB_URL" psql --no-psqlrc -v ON_ERROR_STOP=1 \
  -v identity_value="$DATABASE_IDENTITY_VALUE" <<'SQL'
INSERT INTO public.system_configs
  (id, key, value, label, "group", description, revision, created_at, updated_at)
VALUES
  ('deployment-database-identity-v1', 'deployment_database_identity_v1', :'identity_value',
   'Deployment database identity', 'deployment',
   'Canonical non-secret deployment ID and UUID used by the pre-migration backup gate', 0,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
SQL
```

全新空数据库先完成 Runbook 中唯一的 bootstrap migration，再插入该身份行。identity 行必须是
canonical JSON，并同时绑定 `DEPLOY_DATABASE_ID` 与 UUID；缺失、格式错误、被修改，或备份/应用
连接查询到不同身份时，备份和部署都会失败。

所有四条部署入口现在都在 `prisma migrate deploy` 前强制校验同一条备份认证链。先用目标
revision 的 `backup-db.sh` 生成真实 gzip 和不可变 `.status.json` sidecar，再用
`verify-backup-restore.sh` 恢复到临时数据库；只有 public 表数为正时才会排他写出
`deploy-backup-<target-commit>.attestation.json`。应用 env 与备份 env 必须使用相同的
`DEPLOY_DATABASE_ID`，且两条数据库 URL 必须查询到相同实际数据库名、OID 和库内 deployment
UUID；宿主机与 Compose 可以使用不同 hostname/port 路由。
schema v3 sidecar 保存非秘密身份摘要；恢复 SQL 从 no-follow held descriptor 流出，并用一次性
proof 绑定最终 schema v2 attestation。maintenance 路由在新库中写入随机 schema/table 标记，
恢复 URL 必须在导入前和删除前读回同一标记，避免同名数据库经不同主机路由被误认证。临时恢复库
必须成功删除后才能写认证。默认认证窗口为
120 分钟，完整 SHA-256/gunzip 复验受独立 `20m`
超时保护。缺失、过期、跨数据库、跨 commit、被替换、非规范 JSON、非 gzip 或未恢复的证据
都会让 API/Worker 保持停止且 migration 不执行。
应用 env 使用 `DEPLOY_BACKUP_LOCAL_DIR` 指向这套发布证据；不要在应用 env 中用
`BACKUP_LOCAL_DIR` 代替它，后者属于后台备份服务/独立备份工具，混用会造成状态覆盖和清理冲突。
证据目录和三个不可变文件必须由执行备份/部署 verifier 的用户（标准部署为 root）所有；目录
不得 group/world writable。Compose runtime 因此包含只读 PostgreSQL client，只查询身份而不把
数据库 URL 放进 argv。

当历史环境仍让每日备份与发布证据共用目录时，`backup-db.sh` 使用
`prune-backup-retention.mjs` 先读取 canonical `backup-status.json` 和所有部署 attestation，保护其
引用的 gzip 与 sidecar 后才清理无引用旧备份。损坏、非规范或 symlink attestation 会让清理失败
关闭；不得恢复为裸 `find -delete`。新部署仍应优先把后台备份与发布证据拆到不同目录。

同一 target commit 的认证过期时，重新运行恢复演练即可受控刷新；不要手工删除旧认证。root-only
`archive` 步骤先把旧文件以
`deploy-backup-<commit>.attestation.archived-<sha256>.json` 原字节留存，再删除当前 commit 指针并
排他写入新认证。归档摘要冲突、身份不一致、文件被替换或旧指针无法安全移除时都会失败关闭。

`deploy.sh` 和 `deploy-app-dir.sh` 从目标 archive 解包后、在把 release 交给隔离构建用户前，会
调用 `install-deploy-backup-gate.sh`，把十一个 runtime gate 文件和只读 marker 原子安装到
`/usr/local/lib/ss-erp-deploy-gate/<target-commit>/`。同一 commit 目录不可覆盖，只能逐字节复用。
`deploy-staging.sh` 不会把 deploy 用户可写 checkout 提升为 root；它会在安装依赖或停服前要求
目标 gate 已经预装且与 checkout 逐字节一致。预装必须从本机可信 checkout 生成的目标 revision
archive 解到 VPS 的 root-owned 私有目录，再由安装器完成：

```bash
# 本机可信 checkout
TARGET_COMMIT=<lowercase-full-40-character-commit>
mkdir -p build
SNAPSHOT_ROOT="build/tmp-deploy-gate-source-${TARGET_COMMIT}"
mkdir "$SNAPSHOT_ROOT"
node scripts/git-commit-tree.mjs materialize "$TARGET_COMMIT" "$SNAPSHOT_ROOT"
tar -czf "build/ss-erp-deploy-gate-${TARGET_COMMIT}.tar.gz" -C "$SNAPSHOT_ROOT" \
  scripts/install-deploy-backup-gate.sh \
  scripts/deploy-backup-gate.mjs \
  scripts/deploy-backup-attestation.mjs \
  scripts/deploy-database-identity.mjs \
  scripts/postgres-connection-environment.mjs \
  scripts/deploy-environment.mjs \
  scripts/deploy-maintenance-gate.sh \
  scripts/deploy-source-manifest.mjs \
  scripts/freeze-deploy-source.sh \
  scripts/git-commit-tree.mjs \
  scripts/verify-deploy-build-inputs.mjs \
  scripts/verify-deploy-backup.sh
rm -rf -- "$SNAPSHOT_ROOT"
scp "build/ss-erp-deploy-gate-${TARGET_COMMIT}.tar.gz" root@<server>:/root/

# VPS root shell
SOURCE_ROOT="/root/ss-erp-deploy-gate-source-${TARGET_COMMIT}"
install -d -o root -g root -m 0700 "$SOURCE_ROOT"
tar -xzf "/root/ss-erp-deploy-gate-${TARGET_COMMIT}.tar.gz" -C "$SOURCE_ROOT"
chmod 0700 "$SOURCE_ROOT" "$SOURCE_ROOT/scripts"
bash "$SOURCE_ROOT/scripts/install-deploy-backup-gate.sh" "$TARGET_COMMIT" "$SOURCE_ROOT"
```

root-owned orchestrator 通过 no-follow、单链接、稳定 descriptor 把 `.env` 只快照一次，拒绝重复键
和读取期间变化。依赖安装、Prisma generate、Server/Web/扩展构建全部使用独立非 root
`ss-erp-build` UID/GID，并清空 supplementary groups；其 allowlist 环境只有构建所需公开值，
`DATABASE_URL` 被替换为不可连接的构建占位值，运行时密钥不可读。构建前开放清单允许受控生成文件，
构建后 closed 清单固定完整树；随后把源码复制到新的 root-owned inode、同时复验两份清单，最后才
安装 root-owned runtime symlink。Git 忽略的根级 `.env*` 也属于构建输入：除明确选择且 build UID
不可读的 runtime env 外，任何额外文件都会失败关闭。封存副本中的 Next build cache 会被删除，再由
root 安装到 commit-scoped 外置 cache 的 symlink，禁止递归接管构建产出的 symlink/hardlink。
上传、水印、缩放、临时文件、备份和 sandbox evidence 同样只通过 root 安装的外置 symlink 写入。
认证、migration 和
post-migration guard 则从同一 root 快照降权到 runtime 用户执行。

非敏感的临时 `pnpm` store 位于磁盘型 `/var/lib/ss-erp-deploy-build`，不得放入容量有限的
`/run` tmpfs；只有环境快照与构建清单保留在 `/run`。该父目录固定为 `root:root 0711`，三种
systemd 部署入口在整个构建期间持有同一 `flock`。构建 UID 只能写随机 `0700` 子目录，不能重命名
父目录项；上次进程被 SIGKILL 或主机重启留下的目录，下一次部署只会在持锁后核对名称、所有者、
规范路径和非挂载点，再进行单文件系统清理。未知条目、内存型挂载或锁文件身份异常均失败关闭。

archive 模式要求 `/opt/ss-erp`、`releases`/`backups` 父目录和 `shared` 根目录由 root 所有且不可
group/world writable；只有构建阶段的目标树交给 `ss-erp-build`，明确的 `shared` 子目录交给
runtime `deploy` 用户。共享
env 必须是 `root:<deploy-primary-group>`、`0640`。归档上传使用服务器随机 root-owned `0700`
临时目录，并在解包前复验调用方绑定的 SHA-256。旧版 `init-server.sh` 若曾递归把整个
`/opt/ss-erp` 交给 deploy，先按 `docs/vps-deployment.md` 修正所有权，否则新部署会失败关闭。

```bash
COMPOSE_FILE=docker-compose.prod.yml \
ENV_FILE=.env.production \
MIGRATION_TIMEOUT=20m \
bash scripts/deploy-compose.sh
```

`deploy-compose.sh` 必须由精确的非 root `DEPLOY_RUN_USER` 执行，并使用 `init-server.sh` 预装在
`/var/lib/ss-erp-deploy-locks` 的 root-owned 全局 project 锁。它验证 clean Git HEAD/可选 marker，
只快照一次 env；目标 Compose 文件和完整构建根都由 `--no-replace-objects` 的 `ls-tree` 与
binary-safe `cat-file --batch` 从 raw Git blobs 物化。本地 `.git/info/attributes`、clean/smudge
filter、`assume-unchanged`、`skip-worktree` 和 replacement refs 都不能改变构建字节。Dockerfile 在
运行任何仓库代码前只复制并复验该 archive 的 SHA-256；镜像同时写入 commit 与 archive digest
marker。镜像构建完成后，脚本确认原 env 未变化，才停止旧 API/Worker/Web、启动基础设施并运行
一次性 `migrate` service。project 固定为 `ss-erp-prod` 或 `ss-erp-staging`，进程中的
`COMPOSE_PROJECT_NAME` 不能重定向 stack。migrate container 只读挂载备份目录并在 Prisma 前再次
核对两个镜像 marker 和认证 verifier；只有备份门禁、migration、post-migration guard 与暗态
verifier 全部通过，才会重建应用服务。失败或超时时旧服务保持停止。不要用裸
`docker compose up -d`，因为它会绕过全局锁、env/source 快照和 host provenance 顺序。

标准 systemd 部署应使用 `scripts/deploy.sh`、`scripts/deploy-app-dir.sh` 或 `scripts/deploy-staging.sh`，它们同样在 migration 后、切换或重启服务前执行暗态 verifier。四类入口的 `MIGRATION_TIMEOUT` 默认都是 `20m`，只接受正整数加 `s`、`m` 或 `h`，例如 `900s`、`20m`、`1h`。Linux 脚本通过进程环境覆盖；Compose 在 `.env.production` / `.env.staging` 中设置：

正式发布必须使用五个独立、不可传递的操作员授权门：

1. **生产构建**：只允许从最终 clean commit 为 `.com` 和 `.cn` 分别生成并验证候选四件套；不包含私钥使用、生产网络访问、部署或业务写入。
2. **签名**：只允许使用受保护的 Ed25519 私钥签署已批准候选；构建成功不自动授权本步骤。
3. **生产部署与暗态 canary**：只允许把已签名、区域匹配的候选部署到明确主机，并保持全部新功能暗态完成只读/临时会话 canary；签名成功不自动授权部署。
4. **官网分发与同路径升级**：只允许在对应区域暗态 gate 通过后签署 website approval，以 compare-and-swap 激活独立 publication pointer，生成并验证官网分发回执，再完成同路径升级、活动 worker 和 Unicode smoke 证据；部署成功不自动授权签署 approval、切换 pointer、分发或升级。
5. **试点验证**：只允许在精确 owner/shop/device、offer 前缀、draft revision、回滚命令和责任操作员全部绑定后执行批准的 Provider 或 Ozon 写入；部署、canary 或升级成功不自动授权试点。

固定顺序为 `生产构建 -> 外部 release 签名 -> 双区域暗部署/canary -> 签署 website approval -> 激活 publication pointer -> 官网分发 probe -> 最终 publication verifier -> 同路径扩展升级 -> 单独批准的试点`。前两步、部署/canary、website publication/升级和试点分别属于上述五道授权；每一门都必须记录目标完整 commit、扩展版本、区域、操作者、输入证据和允许的副作用，批准其中一门不代表批准后续门。构建应绑定文档清理和验证完成后的最终 commit，不能提前复用中间工作树提交。

这里的“独立”指操作员授权、允许副作用和证据交接互不传递。当前 release signature、website
approval 与 distribution receipt 使用同一 active Ed25519 `keyId`/trusted keyring，但各自使用不同的
domain-separated payload；因此这是单一密码学信任域中的三类证据，不得描述为密码学职责分离。若要
由不同密码学主体签署，必须先引入独立 key role/keyring、轮换和验证策略，再修改发布声明。

三个 systemd 部署脚本不再生成或递增扩展版本。用于正式发布的候选必须先在完整 `QA-02`/`QA-04`
对应的 clean commit 上按独立 origin 区域各执行一次 `pnpm package:extension`。同一发布的区域候选必须
使用相同 target commit 和扩展版本，但 `.com` 与 `.cn` 的 cloud 包、evidence、签名及官网回执必须
分别绑定各自的 Web/Admin/API origin；不得把一个区域的四件套部署到另一区域。完成外部签名并验证
签名证明后，把与目标机区域一致的 canonical 四件套预置到该目标机；暗部署/canary 通过后，才能
签署 website approval、原子激活官网 publication pointer、生成官网分发回执并执行同路径安装升级验收。

**全暗态维护部署使用独立验收范围。** 经操作员明确批准后，可在 QA-02 未完成时使用目标 clean commit 的完整原生 offline 回执、区域候选/签名、原备份恢复门禁与完整 VPS 验证，先部署管理员只读接口修复。该范围由 `scripts/dark-maintenance-deployment.mjs` 执行，不调用正式 REL-04 的设备配对流程。AI/BYOK/Ozon 保持关闭，官网 publication pointer 和受管扩展保持原样。维护回执不能作为正式 QA04、REL-04、官网分发或 Provider 能力证据。

维护操作顺序：

1. 在最终 clean checkout 执行 `pnpm qa:04:offline --output <绝对私有路径>/offline.json`。只有九步及首尾 Git 检查全部成功才生成 `SS_ERP_QA04_OFFLINE_REHEARSAL`；保留完整日志并核对摘要。旧日志或手写回执不能替代该入口。
2. 按既有流程生成同 commit、同 version、各自 origin 的 COM/CN 四件套及签名。备份与恢复使用目标提交的受控工具副本和原入口；不要为取得工具而先切换运行目录。
3. 在目标 VPS 运行 `node scripts/dark-maintenance-deployment.mjs --backup-binding`，通过 `MAINTENANCE_DEPLOY_ENV_FILE` 指定既有部署 env，设置 `MAINTENANCE_TARGET_COMMIT`、`MAINTENANCE_REGION` 和独立的 `MAINTENANCE_OUTPUT_FILE`。它实际执行 `verify-deploy-backup.sh`，固定 120 分钟时效，绑定同一数据库/UUID/目标 commit 及验证前后不变的原生 attestation。
4. 在持有验证 checkout 的操作端运行 `pnpm maintenance:baseline`。它先验证下表中的文件，再读取超级管理员短时会话文件；只用 GET 保存原部署、原官网完整身份、实际能力和暗态状态。保存基线及其 SHA-256 后，通过既有 `deploy.sh` 部署，备份、migration、冻结源码、健康和回滚 gate 继续执行。
5. 对新部署执行完整 `verify-vps-deploy.sh`，设置 `VERIFY_EVIDENCE_OUTPUT` / `VERIFY_EVIDENCE_REGION` 取得真实 VPS 回执；再执行 `pnpm maintenance:verify`。它要求新运行 commit、签名/VPS 时间、原官网 commit/version/approval/cloud-local 摘要、同一超级管理员和暗态前后一致，并检查两个 source 路由。明确的 `ACTIVE_RELEASE_NOT_FOUND` 只记为 `SOURCE_UNAVAILABLE`，通用 404、匿名可读或非法模板摘要均失败。
6. COM 维护验收通过后再进行 CN；维护前后可能需要重新签发同一账号的短时会话，并分别撤销。停止/重启服务、备份/临时恢复及 migration 检查属于部署副作用，不能用探针的零业务写入声明代替。任一错误按原发布目录回滚，不自动回滚数据库、不删除历史证据。

部分 Linux Node 22 构建未包含 TypeScript stripping，直接运行上述 CLI 会报 `ERR_UNKNOWN_FILE_EXTENSION`，显式启用 stripping 仍可能报 `ERR_NO_TYPESCRIPT`。此时在维护工具进程上使用当前部署已锁定安装的 loader：`node --import /opt/ss-erp/current/apps/server/node_modules/tsx/dist/loader.mjs scripts/dark-maintenance-deployment.mjs --backup-binding`。完整 VPS 验证生成共享 TypeScript 合同回执时，可为该次命令设置 `NODE_OPTIONS=--import=/opt/ss-erp/current/apps/server/node_modules/tsx/dist/loader.mjs`。先实际验证 loader 能加载目标合同；该参数属于操作进程，不写入应用 env 或 systemd 服务配置。

生成完整 VPS 回执时，推荐从已核对提交的实际发布目录调用 `verify-vps-deploy.sh`，例如 `/opt/ss-erp/releases/<full-target-commit>/scripts/verify-vps-deploy.sh`；`DEPLOY_DIR` 仍保留 `/opt/ss-erp/current`，用于监视运行指针。当前源码的导出器使用 Node 原生主模块标识，支持通过 `current` 链接执行；旧版（包括 `63b98b2c`）仍须使用实际发布路径，避免命令行路径与模块 URL 不同而跳过回执写出。必须读回非空原生回执、核对类型/目标/摘要，不能只凭 shell exit 0 或控制台零失败进入维护验收。

维护基线与验收的环境输入：

| 变量 | 内容 |
| --- | --- |
| `MAINTENANCE_TARGET_COMMIT` / `MAINTENANCE_REGION` / `MAINTENANCE_API_ORIGIN` | 精确目标提交、COM/CN 与签名候选 API origin |
| `MAINTENANCE_DATABASE_ID` | 该区域已核对的部署数据库标识 |
| `MAINTENANCE_RELEASE_BUILD_ROOT` / `MAINTENANCE_RELEASE_SIGNATURE_FILE` / `MAINTENANCE_RELEASE_SIGNATURE_SHA256` | 区域四件套目录、签名文件及批准摘要 |
| `MAINTENANCE_OFFLINE_FILE` / `MAINTENANCE_OFFLINE_SHA256` | 同目标提交的原生完整离线回执 |
| `MAINTENANCE_BACKUP_FILE` / `MAINTENANCE_BACKUP_SHA256` | 上一步产生的原生备份验证绑定；不是数据库备份正文 |
| `MAINTENANCE_SUPER_ADMIN_TOKEN_FILE` | checkout 外真实目录中的私有短时会话文件；不接受命令行或直接环境明文 token |
| `MAINTENANCE_OUTPUT_FILE` | checkout 外尚不存在的私有输出文件，禁止覆盖 |
| `MAINTENANCE_BASELINE_FILE` / `MAINTENANCE_BASELINE_SHA256` | 验收阶段额外需要的原基线及摘要 |
| `MAINTENANCE_VPS_FILE` / `MAINTENANCE_VPS_SHA256` | 验收阶段额外需要的新完整 VPS 回执及摘要 |

原始模板响应、会话、备份和回执保留在受保护目录；不放入 Git。只读来源保持既有超级管理员权限，不通过模板列表初始化模板，也不自动创建工作流或接收图片。

`init-server.sh` 会创建 root-owned
`/var/lib/ss-erp-extension-releases`；每个 commit 使用一个 root-owned、不可被 group/world 写入、
构建用户只读的子目录，并通过进程环境传入：

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit>
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256>
```

本地可先把包含多版历史产物的 build root 收敛成待上传的精确四件套；四项 origin 必须与目标
环境的独立审批完全相同：

```bash
TARGET_COMMIT="$(git rev-parse HEAD)"
STAGE_ROOT="build/extension-release-stage-$TARGET_COMMIT"
node scripts/stage-extension-release.mjs \
  --build-root build/extensions \
  --output-dir "$STAGE_ROOT" \
  --target-git-commit "$TARGET_COMMIT" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin http://127.0.0.1:3001
```

把该目录内四个原始文件上传后，以 `root:root`、文件 `0644`、目录 `0755` 安装到上述远端
路径。签名侧车必须留在候选四件套目录之外；三个脚本会先校验其 root-owned/0644 身份、canonical
JSON、可信 Ed25519 keyring、证据摘要、目标完整 commit 和操作员批准的签名 SHA-256，再在应用构建的
`build/extension-release-publication/` 封存一份签名与只读的 `build/extension-release-signature.sha256`。
`deploy.sh`、`deploy-app-dir.sh` 和 `deploy-staging.sh` 会在构建用户下重新验证完整 commit、
package-input digest、origin、ZIP SHA/CRC/文件数，然后逐字节暂存到本次应用构建；任何缺失、额外
匹配候选、符号链接、可写文件或字节漂移都会失败。暂存后 root 会立即收回构建用户写权限，封存
树再通过可信脚本与远端原候选四项逐文件、逐字节比较；比较发生在 migration/切换之前。部署不再调用
`pnpm package:extension`，因此 `REL-03` 已签名/分发候选不会在 `REL-04` 被另一个
`EXTERNAL_REQUIRED` 版本替换。

正式 repository-source 打包不读取工作树字节作为发布输入。Git 读取会移除继承的 `GIT_*`
重定向并使用 `--no-replace-objects`；协调器按绑定 commit 的 blob 创建私有 snapshot，随后从该
snapshot 执行 cloud/local 子打包器、archive verifier 和 release verifier。这样 Windows 的
CRLF/mixed checkout、`.git/info/attributes` clean/smudge filter 或 `refs/replace` 都不能让实际 ZIP
偏离 evidence 中的 commit/digest。`EXTENSION_OUT_DIR` 可以位于仓库外，但执行 snapshot 始终留在
仓库 `build/` 下，以便只从同一安装依赖树解析受控工具依赖；成功或失败后都会删除 snapshot。
`deploy.sh` 与 `deploy-app-dir.sh` 也从同一 raw-blob materializer 生成上传 archive，而不是执行受
本地 attributes 影响的 `git archive`。

release/symlink 的 `deploy.sh` 还负责首次 systemd 切换，不能把它拆成“先用旧 unit 重启成功，
再人工换 unit”两段。脚本在 `current` 切换后、重启前以目标 release 中的模板执行
`systemd-analyze verify`，把现有三个 unit 保存到 target-bound root-only 快照，原子安装后检查有效
`FragmentPath`、`WorkingDirectory`、`EnvironmentFiles` 和 `ExecStart`。重启后必须再证明三个
MainPID 的 cwd 都解析到目标 release，才会检查 `/ready`。安装、启动、cwd 或健康失败都会先恢复
旧 unit；首次发布不依赖不存在的 `PREVIOUS_RELEASE` symlink。

`deploy-staging.sh` 成功后不会再把封存 checkout 交还给 runtime user。整个 `$DEPLOY_DIR` 在服务
运行期间保持 root-owned、不可被 group/world 写入，实际 env 单独保持
`root:<DEPLOY_RUN_USER primary group>`、`0640`；因此 runtime user 不能重命名或替换 serving
`build` 父目录。下一次 staging 会先用当前 `DEPLOYED_COMMIT` 对应的预安装 root gate 验证冻结
checkout，并由 root helper 写入持久 maintenance marker 和三个 systemd condition drop-in，停止
Worker/API/Web，然后才调用 `thaw` 并执行 fetch/build。即使 deploy shell 被 SIGKILL 或主机重启，
marker 仍会阻止服务从可写 checkout 启动；marker 同时绑定 canonical deploy root 与它的 runtime
sibling，helper 只授予媒体、备份和 Web cache 的精确 `ReadWritePaths`。成功封存并复验后才删除
marker。上传、备份、sandbox evidence 与 commit-scoped Next cache 位于默认 sibling
`DEPLOY_RUNTIME_ROOT=/opt/ss-erp.runtime`；root-owned symlink 保持最小写边界。更新、migration、restart 或 health
任一步失败时 maintenance 与停服状态保持，需操作员恢复；不要在服务运行时手工调用 `thaw`。

生产下载端点只接受由独立 root-owned publication pointer 指向、已签 release、暗态 canary 与 website
approval 全部验证通过的一套 canonical release evidence、双包 SHA-256 清单和原始 ZIP；应用部署脚本
不会创建或切换该 pointer。缺任一目标、批准绑定不符或 ZIP 被替换时统一返回 404，且不会从 unpacked
目录现场重建。暗部署新 commit 时，官网可以没有 pointer，也可以继续服务不同 commit 的旧批准版本；
`VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false` 会读取真实 `/api/extensions/latest` 并拒绝
pointer 已提前指向本次 `DEPLOYED_COMMIT`。设置为 `true` 时反向要求 pointer 已指向当前 commit。
`VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED` 独立校验不可变 cloud 包内物流开关，两者不得互相
推导。clean checkout 在正式打包时记录的 `commitSource=GIT_HEAD`
可部署到相同 commit 的 `DEPLOYED_COMMIT` 目标；commitSource 只描述取证上下文，不替代 commit
身份校验。`/api/extensions/latest` 返回的每个下载 URL 都包含不可变 version 与
SHA-256；生产请求从独立 pointer 重新验证 approval、签名、canary 与候选绑定，下载响应同时携带
`X-Content-SHA256` 和 `X-Publication-Approval-SHA256`。`signatureStatus=EXTERNAL_REQUIRED` 仍表示 canonical 四件套本身
不内嵌签名；必须另行保留 Ed25519 签名侧车和官网双包下载回执，下载可用不等于 `REL-03` 完成。
`deploy-staging.sh` 不接受 `--skip-build`；每个目标
commit 仍必须重新编译 Server/Web 并复验预置扩展候选，避免新 marker/migration 配上旧应用构建。
`verify-vps-deploy.sh` 会从封存的 publication 目录和 SHA-256 sidecar 读取签名并执行同一 verifier。
上一版历史兼容基线 `0c326b10feed5f971052c1d1d6ecb3bd3e61ca13` 没有签名封存时只允许明确的兼容警告；任何
其他目标 commit 缺少签名元数据都会失败。兼容例外只固定到该历史基线
`0c326b10feed5f971052c1d1d6ecb3bd3e61ca13`；`VERIFY_LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT`
仅作为诊断名称保留，脚本会拒绝任何不同的环境覆盖。变更兼容基线必须修改源码、重新审查并重新发布，
不得通过环境变量把新候选标记为 legacy。该例外只跳过旧基线不存在的 Ed25519 侧车校验；四件套数量、
commit、origin、checksum、ZIP 结构、物流开关和正式 release verifier 仍必须全部通过。

```env
MIGRATION_TIMEOUT=20m
DEPLOY_DATABASE_ID=production-primary
DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp
DEPLOY_BACKUP_MAX_AGE_MINUTES=120
DEPLOY_BACKUP_VERIFY_TIMEOUT=20m
```

超时时 wrapper 先发送 TERM，并在 30 秒后强制结束。若超时发生在 concurrent-index migration，不要直接重跑或标记 applied；先按 `docs/RUNBOOK.md` 检查 invalid index，再决定清理和重放。

## AI Media 暗态发布门禁

Unit 9C-A、10B-E 和 9C-B 已实现暗态 fake-only `FULL_EDIT` / `INPAINT`、Web Mask 编辑器及受约束的候选链式编辑；Unit 10A-H1/H2/H3a/H3b 已完成历史恢复及 collect/listing-draft 应用账本，Unit 10A-H4 已增加对“已经被 Provider 接收”的异步图片翻译任务进行只查询、不重提的结果核对。`1600` 至 `1660` migration 会前向保留来源工作流互斥锁、OLD/NEW 反向重验和完整候选图片契约；`1670`/`1680` 增加 history/updates keyset 索引；`1690`/`1700` 及 `21120000` 至 `21123000` 建立 collect/listing-draft 应用账本；`21124000` 至 `21131000` 建立 Provider 结果核对状态、租约、事件和积压恢复索引。应用版本回滚不得回退这些数据库约束、账本、审计事件或有效索引。扩展双模式工作台、planned-suite、BYOK 审核/接收和统一发布协调已完成代码与本地 Chrome QA，但准确付费 Provider 的 `QA-02`、生产等价质量、试点和真实 Ozon 验收仍未完成。用户与管理员操作边界见[扩展 AI 图片工作台操作指南](extension-ai-image-workbench.md)。未经批准时以下历史 AI Media 状态必须为 `false` 或 absent：

Unit 10A-H3b 已增加暗态 fake-only listing-draft 精确槽位 APPEND/confirmed REPLACE、不可变账本及前向补偿 ROLLBACK。`20260721120000` 至 `20260721123000` 建立并加固 owner/actor/snapshot/operation/projection authority；生产能力响应必须保持 `listingDraftApplyEnabled=false`，只读历史和既有 rollback 仍可用。

- `feature_ai_media_workflow_v2`
- `feature_ai_media_suite`
- `feature_ai_media_full_edit`
- `feature_ai_media_inpaint`
- `feature_source_listing_web_media`

双模式扩展还有独立的默认关闭门禁；未经批准的 pilot 前保持：

- `feature_extension_hosted_ai=false`
- `feature_extension_byok_ai=false`
- `feature_extension_byok_ingest=false`
- `feature_extension_byok_publish=false`
- `extension_byok_admin_policy` 的 `mode` 为 `off`

`verify-ai-media-dark.sh` 现在同时查询上述四个扩展开关和
`extension_byok_admin_policy`，并把 Extension BYOK expectation 固定为 `off`。它只证明部署可
在暗态启动，不授权任何 pilot。`sandbox-pilot` / `ingest-pilot` / `publish-pilot` 必须另行使用
`verify-extension-byok-rollout-policy.mjs`，并显式传入期望的 hosted 开关、revision、owner、
shop、device session、Provider origin 和 operations；`maxConcurrency` 必须为 1。
`sandbox-pilot` 精确要求生成开启、接收和发布关闭；`ingest-pilot` 精确要求生成和接收开启、
发布关闭；只有 `publish-pilot` 可以让三项都开启。任一其他组合必须失败关闭。

`REL-04` 还必须从受保护的 token 文件运行 `pnpm canary:rel04:dark`。默认 `off` 模式生成候选绑定的
v2 全暗态回执；已批准且正在运行的受限 hosted pilot 必须显式设置
`REL04_AI_MEDIA_ROLLOUT_EXPECTATION=hosted-pilot` 和精确的
`REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON`，生成 v3 受限 pilot 回执。v3 逐项重验 owner、shop、现有
active device session、AI/source policy revision 与 allowed operations，且拒绝白名单外开启的
FULL_EDIT/INPAINT、BYOK 或 Ozon publisher。禁止为了生成 v2 回执临时关闭 pilot。

两种模式都先离线验证目标区域、版本、release evidence SHA-256、Ed25519 签名及完整 VPS verifier
回执，随后验证 `/ready`、extension CORS、对应 rollout、Hosted readiness 和 publisher capability，再创建
仅含 `byok:media:ingest` 的临时设备配对，验证 refresh 与 BYOK disabled-path，最后撤销会话。

CN 账号确无店铺时，可显式设置 `REL04_NO_SHOP_DARK_CANARY=true`、`REL04_REGION=CN`、
`REL04_AI_MEDIA_ROLLOUT_EXPECTATION=off` 和保留的哨兵 `REL04_SHOP_ID=cn-dark-no-shop`；
此哨兵不创建真实店铺。该模式只读确认该账号 `/api/shops` 为空，并验证所有暗态开关及 Hosted
suite disabled；不调用店铺级 publisher capability，不创建配对/设备 session，也不执行 BYOK readiness。
回执明确记载 publisher capability 未验证，因此不构成实际店铺发布能力或设备授权的验收。
COM、hosted pilot 及有真实店铺的暗态仍必须走原有完整设备生命周期，不能使用此开关。
此模式不设置 `REL04_EXPECTED_PUBLISH_CAPABILITY_*`，并继续绑定目标提交的 QA04 回执。
claim 响应丢失时会按唯一 `deviceId` 找回并撤销已提交会话；任何清理失败都会使 canary 失败。
它不发送 Provider 请求、不执行 ERP 图片 ingest，也不调用 Ozon 写接口。

在已获批准的区域暗部署验收中，为完整 `verify-vps-deploy.sh` 增加
`VERIFY_EVIDENCE_OUTPUT=/operator-private/vps-verification-COM.json` 和 `VERIFY_EVIDENCE_REGION=COM`
（国内区域使用 `CN`），并沿用该区域已有的 `DEPLOY_DIR`、`ENV_FILE` 和 `VERIFY_*` 设置。
输出目录须事先存在，Linux 上须由执行者所有且为 `0700`。只有完整检查结束、failure 为 0、
签名验证通过、开始与结束的 deployed commit 一致时，脚本才以 `0600` 创建新的 canonical JSON。
原有回执不可覆盖；warning 数量保留在回执中，远端备份或高可用缺口不会因此消失。
扩展子 verifier 的进度日志写入 stderr，stdout 保持单一 JSON，供完整 verifier 绑定候选摘要。

全暗态 canary 回执为 `schemaVersion: 2 / SS_ERP_REL04_DARK_CANARY`；受限 pilot 为
`schemaVersion: 3 / SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY`。二者的 `bindings.release` 都绑定
同一候选及 VPS 回执摘要；v3 还用 `bindings.rollout.policySha256` 绑定 producer 实际验证的 pilot policy。
VPS 验证必须在该候选签名之后开始，完成时间不晚于 canary 开始，且相距不超过 24 小时。
新 website approval 的签署接受候选绑定的 v2 或 v3；已经签署的 v1 回执仍可用于原有官网批准链的验证。
生产构建、签名、部署/canary、官网批准和真实 pilot 的独立授权继续适用。

当生产库已有目标部署开始后完成的 `SUBMITTED/SUCCEEDED` 发布记录时，显式提供 workflow、attempt
和 `REL04_PUBLISH_RECONCILIATION_NOT_BEFORE` 做只读核验。若暗部署前两区都没有发布记录，不得伪造；
改为提供同一目标 commit 的 canonical `QA04_FINAL_ACCEPTANCE` 私密文件及其 SHA-256。canary 会重验
commit、完整九项 gate、extension 结果和零 Provider/Ozon/VPS 副作用，再把该摘要绑定为
`TARGET_COMMIT_QA04_REGRESSION`。第一次真实 Ozon reconciliation 仍属于 `REL-02` 单店试点。

正式 QA04 回执由 `pnpm qa:04:final` 汇总原件产生。先在最终 clean commit 执行
`pnpm qa:04:offline --output <私有绝对路径>/qa04-offline.json`，保存完整原生日志。输入文件使用
`SS_ERP_QA04_FINAL_INPUTS`，逐项引用原生回执/日志、四类 QA02 技术原件、历史质量反例与正常 ERP
生成/计费/恢复原件的绝对路径和 SHA-256；字段合同见 `scripts/qa04-final-acceptance.mjs`。
不接受操作员直接填写 `PASS` 或 `COMPLETE` 作为证据。可先不带 `--output` 校验，再写入新的私有文件：

```text
pnpm qa:04:final --input <私有输入文件> --input-sha256 <输入摘要>
pnpm qa:04:final --input <私有输入文件> --input-sha256 <输入摘要> --output <新的私有回执文件>
```

入口核对当前 Git、九步原生日志、实际扩展检查计数及原件链；历史 ERP 证据默认要求服务端、shared、
schema 和依赖完全一致。唯一执行中立例外是固定的官网发布 validator 及其测试；producer 会逐 Git object
比较其它全部 server 文件，并在回执中记录受保护 inventory 摘要和例外文件的前后 object ID，调用者不能指定或扩大例外。
根 package 仅允许新增两个固定 QA 命令；其他依赖、构建或安装脚本必须一致。输出保留真实执行提交和质量
反例，明确新目标 Web、生产 MV3 与官网分发的未验证范围。它不查询供应商账单、不发网络请求、
不改变配置；当前验收决定见[生图计费阶段](../dev-docs/stages/ai-image-billing-closure-2026-09.md)。

```bash
export REL04_API_ORIGIN=https://ss-erp.com
export REL04_TARGET_GIT_COMMIT=<full-target-commit>
export REL04_REGION=COM
export REL04_VERSION=<approved-extension-version>
export REL04_RELEASE_BUILD_ROOT=<approved-regional-four-file-candidate-directory>
export REL04_RELEASE_EVIDENCE_SHA256=<approved-release-evidence-sha256>
export REL04_RELEASE_SIGNATURE_FILE=<sealed-regional-release-signature-file>
export REL04_RELEASE_SIGNATURE_SHA256=<approved-release-signature-sha256>
export REL04_VPS_VERIFICATION_FILE=/operator-private/vps-verification-COM.json
export REL04_VPS_VERIFICATION_SHA256=<full-vps-verification-file-sha256>
export REL04_EXTENSION_ORIGIN=chrome-extension://<managed-id>
export REL04_SHOP_ID=<active-owner-shop-id>
export REL04_OWNER_TOKEN_FILE=/operator-private/rel04-owner.token
export REL04_ADMIN_TOKEN_FILE=/operator-private/rel04-admin.token
export REL04_QA04_ACCEPTANCE_FILE=/operator-private/qa04-final.json
export REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256=<qa04-file-sha256>
export REL04_EXPECTED_PUBLISH_CAPABILITY_REASON=master_off
export REL04_EXPECTED_PUBLISH_CAPABILITY_REVISION=master-off
export REL04_EXPECTED_PUBLISH_LEGACY_ALLOWED=true
export REL04_CANARY_OUTPUT=/operator-private/rel04-dark-canary.json
# 仅 COM 等已批准受限 hosted pilot 使用；CN 全暗态不设置这两项。
export REL04_AI_MEDIA_ROLLOUT_EXPECTATION=hosted-pilot
export REL04_AI_MEDIA_PILOT_EXPECTATIONS_JSON='<exact owner/shop/device/revision/operations JSON>'
pnpm canary:rel04:dark
```

三项 capability expectation 必须来自部署前已审计策略，不能照抄响应；这样
`config_unavailable`、非法策略或 revision mismatch 不会被误判为暗态。该 canary 不能替代
`verify-vps-deploy.sh`、systemd/Web 检查或后续官网 ZIP probe。暗部署阶段必须明确保持
`VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false` 和
`VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false`；VPS verifier 会分别证明 cloud 包内
物流开关为 false，并从区域官网读取 `/api/extensions/latest`，确认新部署 commit 尚未被 publication
pointer 公开。官网继续服务不同 commit 的旧批准版本属于预期，不要求先下线旧下载：

```bash
VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false \
VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=false \
VERIFY_EVIDENCE_OUTPUT=/operator-private/vps-verification-COM.json \
VERIFY_EVIDENCE_REGION=COM \
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging \
bash scripts/verify-vps-deploy.sh
```

正式扩展发布还要求私有部署 env 明确提供四项独立审批证据。前三项是不带路径、查询或片段
的公开 HTTPS origin；local 首版只允许固定 loopback origin：

```text
EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN
EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN
EXTENSION_RELEASE_EXPECTED_API_ORIGIN
EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN=http://127.0.0.1:3001
```

四项值不会从 `EXTENSION_CLOUD_BASE_URL` / `NEXT_PUBLIC_*` 自动推导。`pnpm package:extension`
一次计算版本并生成同版 cloud/local ZIP、SHA-256 清单和 canonical release evidence JSON；
验证器会解包重验 defaults、manifest permissions、文件数、ZIP SHA/CRC 与完整 commit。Evidence
中的 `signature.status=EXTERNAL_REQUIRED` 表示仍须完成真实签名和官网分发回执，不能把本地 JSON
或单独一次 HTTP 200 当成签名/分发证明。
部署前还必须按上文设置 `EXTENSION_RELEASE_ROOT`；部署脚本只消费候选，不生成候选。

扩展正式分发渠道固定为官网第一方 `/api/extensions`（receipt channel=`FIRST_PARTY_WEBSITE`），
不是 Chrome Web Store。canonical 候选目录
必须始终只保留两份 ZIP、checksum 和 release evidence 四个文件；Ed25519 私钥只能位于操作员的
受保护私密目录，仓库只保留 `config/extension-release-trusted-keys.json` 公钥 keyring。签名和回执
必须显式输出到候选目录之外。私钥及其目录不得上传到 VPS；两个签名命令只在受保护的外部签名
环境运行，VPS 只接收已签的公开证据：

```bash
export EXTENSION_RELEASE_SIGNING_KEY_ID=ss-erp-extension-release-2026-09-05-01
export EXTENSION_RELEASE_SIGNING_KEY_PATH=/operator-private/extension-release-signing-key.pkcs8.pem

# 仅首次创建或审计轮换时运行；父目录必须预先限制为操作员/SYSTEM/Administrators。
pnpm create:extension-release-key
# 将命令输出的 public key 条目经审查后加入 trusted-key keyring；不得输出或提交私钥。

node scripts/sign-extension-release.mjs \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --output "$PUBLICATION/ss-erp-extension-$VERSION.release-signature.json"
```

官网 ZIP 是下载后解压并用 Chrome 开发者模式加载的完整 MV3 包；Ed25519 侧车不把 ZIP 变成 CRX、
商店安装或自动更新。首次安装必须使用受管固定目录并把实际 `chrome-extension://<id>` 加入
`CORS_EXTENSION_ORIGINS`；升级时覆盖同一路径后重新加载，避免路径变化造成扩展 ID 和本地 profile
隔离。磁盘 manifest 版本和安装目录哈希不能单独证明 Chrome 正在执行新 Worker。同路径替换后，
关闭旧的专用 QA Chrome，再用下方 launcher 和同一个受管 QA profile 启动新进程；launcher 会通过
`--load-extension` 加载当前安装树。如果专用 QA Chrome 不能关闭，则不要运行 launcher：改在
`chrome://extensions` 对目标扩展明确 reload，并直接使用该实例既有的 loopback CDP 地址执行活动
验收。

同一 QA profile 的新进程仍可能复用旧 Service Worker 缓存，即使 `getManifest().version` 已显示新版。
若 active-worker 的主脚本摘要不一致，先保留失败结果并将实际活动源码与候选、历史源码逐字节比较；
确认旧缓存后，只在已核对身份的专用 QA 实例中明确 reload 该扩展，再执行下方两项原生验收。
恢复保留受管目录、非密 profile 和原失败证据；版本号相同不能代替活动脚本一致性检查。

安装前可在目标机器运行 `pnpm diagnose:extension:managed -- --expected-version <version>`，确认固定
Extension ID、受管目录、稳定 key 派生 ID 和 loopback CDP 端口均已绑定。诊断返回
`EXTENSION_STATUS=FOUND` 与 `CDP_STATUS=READY` 后，再按下方命令执行 active-worker attestation；
`MISSING`、`UNBOUND`、`STALE` 或 `KEY_MISMATCH` 均不得用 unpacked 包替代。该诊断只证明安装
边界和端口存在；随后仍需执行主脚本 attestation 和独立语义 smoke。两条路径都不得复用操作员的常规 Chrome。

```bash
# QA 可重复启动独立的有界面 Chromium；默认打开 about:blank，不访问生产，也不会关闭或复用操作员的常规 Chrome。
pnpm launch:extension:cdp -- \
  --extension-dir "$MANAGED_EXTENSION_DIR" \
  --extension-id "$EXTENSION_ID" \
  --expected-version "$VERSION" \
  --profile "$MANAGED_QA_PROFILE" \
  --port "$CDP_PORT"

pnpm attest:extension:active-worker -- \
  --cdp http://127.0.0.1:$CDP_PORT \
  --extension-id "$EXTENSION_ID" \
  --extension-dir "$MANAGED_EXTENSION_DIR" \
  --expected-version "$VERSION" \
  --output "$PRIVATE_RECEIPTS/active-worker-$VERSION.json"

pnpm smoke:extension:live-sw-unicode -- \
  --cdp http://127.0.0.1:$CDP_PORT \
  --extension-id "$EXTENSION_ID" \
  --expected-version "$VERSION" \
  --output "$PRIVATE_RECEIPTS/live-sw-unicode-$VERSION.json"
```

Active-worker receipt 的范围仅为 `MAIN_SCRIPT_IDENTITY_ONLY`。外层升级回执仍必须分别绑定已验证的
release evidence、detached signature、官网 distribution receipt、ZIP SHA-256、候选/安装整树、固定
managed path、同一 extension ID、非密 profile 保留与 session-only 状态清除；随后再绑定上述
active-worker 和 Unicode smoke 两份回执 SHA-256。缺少任一项都不能声明 same-path upgrade 通过。

实际下载回执只能在 `REL-04` 暗部署并通过 pre-enable canary、website approval 已独立签署且
publication pointer 已通过 CAS 激活后生成。部署脚本绝不替操作员切换 pointer。首次激活把
`--expected-current-approval-sha256` 设为 `NONE`；后续升级必须传入已审计的旧 pointer SHA-256，摘要
不匹配即保持旧批准版本继续服务。release signature 的 `signedAt` 必须不晚于 canary `observedAt`，
且 canary 必须不晚于 approval `approvedAt`。示例中的摘要必须来自独立审批记录，不得用占位符执行。
先在外部签名环境运行：

```bash
export RELEASE_SIGNATURE="$PUBLICATION/ss-erp-extension-$VERSION.release-signature.json"
export RELEASE_SIGNATURE_SHA256=<operator-approved-release-signature-sha256>
export DARK_CANARY=/operator-private/rel04-dark-canary.json
export DARK_CANARY_SHA256=<operator-approved-dark-canary-sha256>
export WEBSITE_APPROVAL="$PUBLICATION/ss-erp-extension-$VERSION.website-publication-approval.json"
export WEBSITE_APPROVAL_SHA256=<operator-approved-website-approval-sha256>
export CURRENT_WEBSITE_APPROVAL_SHA256=<current-approved-pointer-sha256-or-NONE>

node scripts/sign-extension-website-publication.mjs \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --release-signature "$RELEASE_SIGNATURE" \
  --expected-release-signature-sha256 "$RELEASE_SIGNATURE_SHA256" \
  --dark-canary "$DARK_CANARY" \
  --expected-dark-canary-sha256 "$DARK_CANARY_SHA256" \
  --distribution-origin https://ss-erp.com \
  --region COM \
  --keyring config/extension-release-trusted-keys.json \
  --output "$WEBSITE_APPROVAL"
```

通过受认证传输只把 website approval 与原始 dark-canary 文件送到 VPS 临时入口；不要传私钥。然后在
VPS 上把两份输入安装成 root-owned、不可由 group/world 写入的文件，并只使用 active deployment
内已经封存的四件套、release signature 和 SHA-256 sidecar：

```bash
export ACTIVE_DEPLOY_DIR=/opt/ss-erp/current
export TARGET_COMMIT="$(cat "$ACTIVE_DEPLOY_DIR/DEPLOYED_COMMIT")"
export WEBSITE_INPUT_ROOT="/var/lib/ss-erp-extension-publication-inputs/$TARGET_COMMIT"
export UPLOADED_WEBSITE_APPROVAL=/root/incoming/ss-erp-extension-$VERSION.website-publication-approval.json
export UPLOADED_DARK_CANARY=/root/incoming/rel04-dark-canary.json
export STAGED_WEBSITE_APPROVAL="$WEBSITE_INPUT_ROOT/ss-erp-extension-$VERSION.website-publication-approval.json"
export STAGED_DARK_CANARY="$WEBSITE_INPUT_ROOT/rel04-dark-canary.json"
export ACTIVE_CANDIDATE="$ACTIVE_DEPLOY_DIR/build/extensions"
export ACTIVE_RELEASE_SIGNATURE="$ACTIVE_DEPLOY_DIR/build/extension-release-publication/ss-erp-extension-$VERSION.release-signature.json"
export DEPLOY_LOCK=/var/lib/ss-erp-deploy-build/deploy.lock

sudo install -d -o root -g root -m 0755 "$WEBSITE_INPUT_ROOT"
sudo install -o root -g root -m 0644 "$UPLOADED_WEBSITE_APPROVAL" "$STAGED_WEBSITE_APPROVAL"
sudo install -o root -g root -m 0600 "$UPLOADED_DARK_CANARY" "$STAGED_DARK_CANARY"

sudo node "$ACTIVE_DEPLOY_DIR/scripts/activate-extension-website-publication.mjs" \
  --active-deployed-commit "$ACTIVE_DEPLOY_DIR/DEPLOYED_COMMIT" \
  --approval "$STAGED_WEBSITE_APPROVAL" \
  --candidate-root "$ACTIVE_CANDIDATE" \
  --dark-canary "$STAGED_DARK_CANARY" \
  --expected-approval-sha256 "$WEBSITE_APPROVAL_SHA256" \
  --expected-current-approval-sha256 "$CURRENT_WEBSITE_APPROVAL_SHA256" \
  --deploy-lock "$DEPLOY_LOCK" \
  --expected-distribution-origin https://ss-erp.com \
  --expected-region COM \
  --keyring "$ACTIVE_DEPLOY_DIR/config/extension-release-trusted-keys.json" \
  --publication-root /var/lib/ss-erp-extension-publications \
  --release-signature "$ACTIVE_RELEASE_SIGNATURE"
```

激活返回 `ACTIVATED` 或在完整复验和 fsync/re-read 后返回 `ALREADY_ACTIVATED`，才可运行公开探针。
若返回 `UNKNOWN_OUTCOME`，命令以非零状态结束；停止自动下游，不得改 CAS 值或盲目切换，确认 active
deployment 未变化后以完全相同 approval、摘要和旧 pointer 摘要重跑。重跑只有明确返回
`ALREADY_ACTIVATED`/`ACTIVATED` 才能继续。探针不带 Cookie/Authorization、拒绝跳转，先读取
`/api/extensions/latest`，再完整下载 cloud/local 两个 version/SHA URL，并核对 Content-Length、
Content-Disposition、`X-Content-SHA256` 和 body SHA-256。

```bash
node scripts/probe-extension-website-distribution.mjs \
  --origin https://ss-erp.com \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --signature "$RELEASE_SIGNATURE" \
  --approval "$WEBSITE_APPROVAL" \
  --dark-canary "$DARK_CANARY" \
  --output "$PUBLICATION/ss-erp-extension-$VERSION.distribution-receipt.json"

node scripts/verify-extension-publication.mjs \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --signature "$RELEASE_SIGNATURE" \
  --approval "$WEBSITE_APPROVAL" \
  --dark-canary "$DARK_CANARY" \
  --receipt "$PUBLICATION/ss-erp-extension-$VERSION.distribution-receipt.json" \
  --keyring config/extension-release-trusted-keys.json

# pointer 已激活，但不可变候选内的物流开关仍保持本次构建值。
VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED=false \
VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED=true \
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging \
bash scripts/verify-vps-deploy.sh
```

国际站和国内站必须分别运行上述 probe/verifier：国际站使用 `https://ss-erp.com` 及 `.com` 候选，
国内站使用 `https://ss-erp.cn` 及 `.cn` 候选。两份回执不得混用；候选可以同版、同 commit，但其
evidence/signature/receipt SHA-256 必然独立。

因此执行顺序是 `package -> external release sign -> deploy/dark canary -> sign website approval ->
activate pointer -> distribution probe -> final verify -> same-path upgrade -> independently approved
pilot`。只有最终 verifier 与同路径升级证据都通过，`REL-03` 与 `REL-04` 才能同时关闭；进入
`REL-02` 仍需第五道独立试点授权。任何阶段都不能把私钥复制到仓库、VPS、命令参数、日志或候选四件套。

`ai_media_workflow_v2_rollout_policy` 必须是合法 JSON、revision 为非负整数且 `tenantIds` 为空。Compose 以 `migrate` service 的成功退出作为强制门禁；以下宿主机命令仅用于独立审计和故障排查：

```bash
DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-ai-media-dark.sh
```

只有 `PASS AI Media rollout is dark` 才允许切换 release 或启动 API/Worker。检查失败时按以下顺序恢复：

1. 保持 API/Worker 停止，保存失败输出和当前 `system_configs` 快照。
2. 确认没有经过审批的试点后，通过受审计的管理员变更将历史 AI Media 与四个扩展开关恢复为 `false`，将 AI Media rollout policy 恢复为空 tenant 列表，并将 Extension BYOK policy 恢复为 revision 0 的默认 `off`；不要用 shell 忽略 verifier 的退出码。
3. Compose 修复配置后重新运行 `deploy-compose.sh`，并检查一次性 migrate/gate 日志；systemd/手工部署重新运行宿主机 verifier。通过后再恢复服务；仍失败则恢复上一版应用，数据库保持 additive migration 的前向状态。
4. 若失败来自 `20260720153000_bind_ai_image_edit_outputs` 并发索引 migration，禁止直接 `resolve --applied`。按 `docs/RUNBOOK.md` 检查 `pg_index.indisvalid` 和 `pg_get_indexdef`，必要时 `DROP INDEX CONCURRENTLY`、`prisma migrate resolve --rolled-back`、重新 deploy 并复核定义。
5. 若失败来自 `1670`/`1680`，分别检查 `ai_media_workflow_owner_context_history` 和 `ai_media_workflow_owner_context_updates` 的 `indisvalid`、`indisready` 与精确定义。对失败项留下的同名 invalid index 执行独立 `DROP INDEX CONCURRENTLY`，只把实际失败的 migration resolve 为 rolled back，再重跑 deploy；完整命令见 `docs/RUNBOOK.md`。
6. 若 `1700` 报 `application mutation authority upgrade requires an empty ledger`，保持所有 writer 停止；禁止删除账本、禁止 `resolve --applied`。保留数据并按 Runbook 升级为审计后的前向迁移。
7. H3a listing-draft migrations 已通过空库与 populated upgrade；若 `21001000` 至 `21011000` 任一项失败，保持 API/Worker 停止，检查对应预建索引、约束和 deferred candidate trigger 后只修复失败项并重放。不要删除已有 listing-draft context 或候选资产，也不要把暗态 gate 改为 enabled。

8. H3b migrations 必须按 `120000`、`121000`、`122000`、`123000` 顺序全部成功；失败时保持 writer 停止，不得删除账本或回退草稿版本。检查 `ai_media_listing_draft_application_mutations` 的六个索引和四个 triggers，并确认 actor trigger 拒绝 owner 之外的账号。

9. H4 migrations 必须按 `124000` 至 `131000` 顺序全部成功。`126000` 与 `130000` 都是单语句 concurrent index；失败时分别检查 `ai_image_job_workflow_provider_reconciliation` 或 `ai_image_job_provider_reconciliation_lease_due`，只清理同名 invalid index，并且只将实际失败的 migration 标记 rolled back。`131000` 会对未解决任务递增 revision、延长 deadline 并写不可变事件，不能绕过触发器或标记 applied。

### Unit 10A-H1 滚动部署边界

H1 的 `GET /workflows` 只有在显式 `pageVersion=1` 时返回 additive `{items, priorityItems, priorityItemsTruncated, priorityNextCursor, nextCursor}` DTO；未带版本的旧客户端继续接收 legacy 数组。history cursor 使用 `createdAt/id`，priority cursor 使用固定 recent cutoff 的 `updatedAt/id`，两者均绑定 owner、context 和 lane，不能互换。新 Web 首屏最多合并 100 条 priority 记录，更多待处理记录只在用户显式点击后通过 `GET /workflows/priority` 逐页加载，因此 API 应先于或与 Web 同批部署；旧 Web 不依赖新端点。

Web 以 revision、再以 `updatedAt` 合并响应，并保持 `appliedMode` 和 cost 状态单调；运行中任务每 2 秒、待人工审核/应用任务每 30 秒刷新，页面 hidden 时暂停并在恢复可见时刷新。候选绑定使用 `selectedOutputAssetId`，最多并排比较两张，并显示商品/SKU/slot scope。上述行为仍全部处于暗态、fake-only，不允许据此启用付费 Provider 或真实 Ozon 写入。

Unit 10A-H1 是 111 migrations；本地关闭证据为 PostgreSQL 45/45、populated upgrade 1/1、2627 项服务端测试通过且 125 项按环境跳过、192 项扩展检查通过，并已通过 workspace typecheck、full preflight、production build 及桌面/移动多会话浏览器验收。Unit 10A-H2 增至 113 migrations；本地关闭证据为 focused 143/143、PostgreSQL 46/46、2648 项服务端测试通过且 126 项按环境跳过、192 项扩展检查、workspace typecheck、production build 和桌面/移动 stale-refresh/rollback 浏览器验收通过，lint 为 0 errors / 20 条既有 warnings。Unit 10A-H3a 增至 118 migrations，并已完成 listing-draft/SKU context authority 的关闭验证。部署前仍必须按 Runbook 在目标环境验证 `1670`/`1680` 索引、两个应用账本、H4 状态/事件/索引和暗态 gate。

Unit 10A-H3b 增至 122 migrations。Unit 10A-H4 增至 130 migrations；空库 PostgreSQL 54/54、94-migration populated upgrade、2769 passed/134 skipped 服务端测试、192 项扩展检查、workspace typecheck、生产构建和 lint 0 errors 已通过。H4 Worker 每次只即时领取一个任务并有界排空积压，只调用既有 task ID 的 lookup/poll，绝不调用 submit；超级管理员结果核对与成本结算保持两个独立界面。上述能力不允许据此启用真实 Provider 新任务或 Ozon 写入。

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
- Unit 10A-H1/H2/H3b 应用回滚：旧客户端继续使用未版本化数组；保留 `1670`/`1680` 有效索引、`1690`/`1700` collect 账本、`20260721120000` 至 `20260721123000` listing-draft 账本及所有 workflow/job/asset/draft 历史。媒体撤销只能通过当前 frontier 的补偿式 ROLLBACK mutation；不得回指旧草稿版本、删除候选或伪造历史。
- OSS 回滚：对象 key 不覆盖，用版本化路径，如 `ss-erp/images/yyyy/mm/...`。

## 备份策略

- RDS 自动备份和 PITR 至少保留 7 天。
- 每周 `pg_dump` 到独立 OSS bucket，保留 90 天。
- 备份账号和应用账号分离。
- 每月至少做一次恢复演练。
