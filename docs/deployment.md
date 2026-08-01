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

同一 target commit 的认证过期时，重新运行恢复演练即可受控刷新；不要手工删除旧认证。root-only
`archive` 步骤先把旧文件以
`deploy-backup-<commit>.attestation.archived-<sha256>.json` 原字节留存，再删除当前 commit 指针并
排他写入新认证。归档摘要冲突、身份不一致、文件被替换或旧指针无法安全移除时都会失败关闭。

`deploy.sh` 和 `deploy-app-dir.sh` 从目标 archive 解包后、在把 release 交给隔离构建用户前，会
调用 `install-deploy-backup-gate.sh`，把十个 runtime gate 文件和只读 marker 原子安装到
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

三个 systemd 部署脚本不再生成或递增扩展版本。正式候选必须先在完整 `QA-02`/`QA-04`
对应的 clean commit 上按独立 origin 区域各执行一次 `pnpm package:extension`。同一发布的区域候选必须
使用相同 target commit 和扩展版本，但 `.com` 与 `.cn` 的 cloud 包、evidence、签名及官网回执必须
分别绑定各自的 Web/Admin/API origin；不得把一个区域的四件套部署到另一区域。完成外部签名和安装
升级验收后，再把与目标机区域一致的 canonical 四件套预置到该目标机。`init-server.sh` 会创建 root-owned
`/var/lib/ss-erp-extension-releases`；每个 commit 使用一个 root-owned、不可被 group/world 写入、
构建用户只读的子目录，并通过进程环境传入：

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit>
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
路径。`deploy.sh`、`deploy-app-dir.sh` 和 `deploy-staging.sh` 会在构建用户下重新验证完整 commit、
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

生产下载端点只接受 repository source 生成、与当前 `DEPLOYED_COMMIT` 精确绑定的一套 canonical
release evidence、双包 SHA-256 清单和原始 ZIP；缺任一目标、commit 不符或 ZIP 被替换时统一返回
404，且不会从 unpacked 目录现场重建。clean checkout 在正式打包时记录的 `commitSource=GIT_HEAD`
可部署到相同 commit 的 `DEPLOYED_COMMIT` 目标；commitSource 只描述取证上下文，不替代 commit
身份校验。`/api/extensions/latest` 返回的每个下载 URL 都包含不可变 version 与
SHA-256；Server 启动时只解析一次当前元数据，首次下载时只校验并缓存所选 target 的 ZIP，下载
响应同时携带 `X-Content-SHA256`。`signatureStatus=EXTERNAL_REQUIRED` 仍表示 canonical 四件套本身
不内嵌签名；必须另行保留 Ed25519 签名侧车和官网双包下载回执，下载可用不等于 `REL-03` 完成。
`deploy-staging.sh` 不接受 `--skip-build`；每个目标
commit 仍必须重新编译 Server/Web 并复验预置扩展候选，避免新 marker/migration 配上旧应用构建。

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
在暗态启动，不授权任何 pilot。`sandbox-pilot` / `publish-pilot` 必须另行使用
`verify-extension-byok-rollout-policy.mjs`，并显式传入期望的 hosted 开关、revision、owner、
shop、device session、Provider origin 和 operations；`maxConcurrency` 必须为 1。

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
必须显式输出到候选目录之外：

```bash
export EXTENSION_RELEASE_SIGNING_KEY_ID=ss-erp-extension-release-2026-08-02-01
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
隔离。实际下载回执只能在 `REL-04` 暗部署
并通过 pre-enable canary 后生成：探针不带 Cookie/Authorization、拒绝跳转，先读取
`/api/extensions/latest`，再完整下载 cloud/local 两个 version/SHA URL，并核对 Content-Length、
Content-Disposition、`X-Content-SHA256` 和 body SHA-256。

```bash
node scripts/probe-extension-website-distribution.mjs \
  --origin https://ss-erp.com \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --signature "$PUBLICATION/ss-erp-extension-$VERSION.release-signature.json" \
  --output "$PUBLICATION/ss-erp-extension-$VERSION.distribution-receipt.json"

node scripts/verify-extension-publication.mjs \
  --evidence "$CANDIDATE/ss-erp-extension-$VERSION.release-evidence.json" \
  --signature "$PUBLICATION/ss-erp-extension-$VERSION.release-signature.json" \
  --receipt "$PUBLICATION/ss-erp-extension-$VERSION.distribution-receipt.json" \
  --keyring config/extension-release-trusted-keys.json
```

国际站和国内站必须分别运行上述 probe/verifier：国际站使用 `https://ss-erp.com` 及 `.com` 候选，
国内站使用 `https://ss-erp.cn` 及 `.cn` 候选。两份回执不得混用；候选可以同版、同 commit，但其
evidence/signature/receipt SHA-256 必然独立。

因此执行顺序是 `REL-03a package/sign -> REL-04 dark deploy/canary -> REL-03b website receipt`；只有
最终 verifier 通过，`REL-03` 与 `REL-04` 才能同时关闭并进入 `REL-02`。任何阶段都不能把私钥复制
到仓库、VPS、命令参数、日志或候选四件套。

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
