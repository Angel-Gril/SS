# 本地 Windows 版打包路线

本页定义 SS ERP 本地 Windows 版的交付边界。当前目标是 Portable v0.1：在一台 Windows 机器上运行现有源码和本机服务，先满足启动、采集、本地存图、备份恢复和扩展连接；暂不做完全免依赖安装器。

## 本地版目标

- Windows 单机可启动 Web、API 和 Worker。
- 商品采集能从 local 扩展包推送到本机 API。
- 图片默认写入本地磁盘，不依赖 R2、OSS、Cloudflare 或外部 CDN。
- 登录、注册不依赖短信服务和 Cloudflare Turnstile。
- 数据库可以备份到本地目录并恢复。
- 扩展 local 包默认连接 `http://127.0.0.1:3001`。

## 和 SaaS 云端版的差异

| 项目 | 本地 Windows 版 | SaaS 云端版 |
| --- | --- | --- |
| 运行模式 | `RUNTIME_MODE=local` | `RUNTIME_MODE=cloud` |
| API | `http://127.0.0.1:3001` | 线上域名 `/api/*` |
| Web | `http://127.0.0.1:3000` | `app.ss-erp.com` / `admin.ss-erp.com` |
| 图片存储 | `IMAGE_STORAGE_BACKEND=local` | `IMAGE_STORAGE_BACKEND=oss` 或后台 `upload_*` |
| 注册短信 | local 模式绕过短信验证码 | 真实短信 provider |
| Turnstile | local 模式不校验 | 登录/短信发码需要校验 |
| 扩展包 | `pnpm build:extension:local` | `pnpm build:extension:cloud` |
| 备份 | `data/backups` 本地文件 | VPS 本地备份 + 可选远程备份 |

本地版不修改云端主链路，不接入 VPS、OSS/R2、SMS、Cloudflare 或 1Panel/K8s。

## 现有本地能力盘点

当前本地运行依赖这些服务或进程：

- PostgreSQL：主数据库，必须可连接。
- Redis：缓存、会话和 BullMQ 队列。代码支持 `REDIS_DISABLED=1` 做最小本地运行，但队列类 Worker 能力会受限。
- Node 和 pnpm：运行 Web、API、Worker 和脚本。
- Web：Next.js，默认 `127.0.0.1:3000`。
- API：Fastify，默认 `127.0.0.1:3001`。
- Worker：现有 API 进程可内嵌启动部分 worker，也可以用 `src/worker.ts` 单独启动。

`RUNTIME_MODE=local` 已经能绕过云端登录挑战：

- `requiresAuthChallenges()` 在 local 模式返回 `false`。
- `/api/auth/sms-code` 在 local 模式直接返回“本地模式无需短信验证码”。
- 注册不会要求 `smsCode`。
- 登录不会校验 Turnstile。
- `verifyTurnstile()` 在 local 模式直接放行。
- `IMAGE_STORAGE_BACKEND` 未设置时，local 模式默认 `local`。

注意：后台 `SystemConfig.upload_storage_backend` 如果被人工改成 `oss`，会覆盖 env 兜底。Windows 本地版验收时应保持后台上传后端为 `env` 或 `local`，并在 env 里使用 `IMAGE_STORAGE_BACKEND=local`。

扩展 local 包现状：

- `extensions/ss-erp/shared/adapters/runtime-config.js` 默认 `baseUrl` 是 `http://127.0.0.1:3001`。
- local 包保留 localhost / 127.0.0.1 权限，cloud 包构建时会剥离这些本地 origin。
- 扩展仍需要连接当前本地 ERP 账号。流程是：先登录本机 Web，再在 Web 的扩展连接入口生成 30 天扩展 Token，填入扩展设置页。这个 Token 由本机 API 签发，不是云端 Token。

`build/scripts` 现状判断：

- `build/scripts/build-windows.ps1`：旧的完整 Windows 打包脚本，会假设 `build/runtime/node` 和 `build/runtime/pgsql` 已存在；当前不作为 Portable v0.1 主路线。
- `build/scripts/start.bat`、`stop.bat`、`backup.bat`、`restore.bat`、`fix-links.js`：旧离线包运行脚本，只适合旧 `build/dist/SS-ERP-*` 结构。
- `build/scripts/post-build-fix.ps1`：旧打包产物修复脚本，依赖旧 dist 目录。
- `build/scripts/sync-start.ps1`：写死旧 `build/dist/SS-ERP-1.0.2` 路径，是临时同步脚本。
- `build/scripts/fix-links.js`：旧 zip 解压后修复 pnpm junction 的辅助脚本。

新路线优先使用 `scripts/windows-local/`，旧 `build/scripts/` 暂保留作历史参考，后续完整安装器阶段再决定是否迁移或删除。

## 运行依赖

Portable v0.1 不捆绑大二进制运行时，需要用户机器已有：

- Windows 10/11 或 Windows Server。
- Node.js 20+。
- pnpm 11.x。
- PostgreSQL 客户端工具和数据库服务，至少包含 `psql`、`pg_isready`、`pg_dump`、`pg_restore`。
- Redis 服务或兼容服务。

Portable v0.1 不负责安装 PostgreSQL，也不会自动创建数据库。启动脚本只会对 `DATABASE_URL` 指向的已有数据库执行 Prisma migration；首次使用前需要先创建好 `ss_erp`（或把 `DATABASE_URL` 改成你已经创建的库）。

现实限制：Redis 没有官方稳定 Windows 发行版。Portable v0.1 不强行把 Redis 打进安装包。可选路线是使用 WSL/Docker/第三方 Windows Redis 兼容发行版，或在最小采集场景下显式设置 `REDIS_DISABLED=1`，但这不是完整 Worker/队列验收。

## 目录结构

推荐从仓库根目录运行：

```text
SS ERP/
  .env.local-windows          本机私有配置，不提交 Git
  .env.local-windows.example  模板
  apps/server/public/uploads/ 当前代码默认本地上传目录
  data/backups/               Windows local 脚本默认备份目录
  logs/windows-local/         start/status/stop 日志和 pid
  scripts/windows-local/      Portable v0.1 脚本
```

当前 `image-storage.ts` 的 local 后端写入 `apps/server/public/uploads`。`data/uploads` 可以作为后续完整安装器的目标目录，但在未改静态文件服务前不要把它写进运行配置。

## 准备

```powershell
.\scripts\windows-local\prepare.ps1
```

它会：

- 检查 Node、pnpm、PostgreSQL CLI、Redis 可用性。
- 如果 `.env.local-windows` 不存在，从模板生成一份并写入本机随机密钥。
- 提示 PostgreSQL / Redis 当前是否可连接。

生成后按实际数据库密码修改：

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/ss_erp"
REDIS_URL="redis://127.0.0.1:6379"
```

## 启动、停止、状态检查

启动：

```powershell
.\scripts\windows-local\start.ps1
```

默认会：

- 加载 `.env.local-windows`。
- 检查 PostgreSQL 和 Redis。
- 执行 `pnpm --filter server db:deploy`。
- 启动 API、Worker、Web。
- 写入 `logs/windows-local/*.pid` 和日志文件。

如果 `DATABASE_URL` 指向的数据库不存在，`db:deploy` 会失败；先在 PostgreSQL 中创建数据库后再重新启动。

停止：

```powershell
.\scripts\windows-local\stop.ps1
```

状态检查：

```powershell
.\scripts\windows-local\status.ps1
```

`stop.ps1` 只停止脚本启动的 Node 进程，不停止本机 PostgreSQL/Redis 服务，避免误伤用户已有数据库。

如果 `.env.local-windows` 设置了 `REDIS_DISABLED=1`，`start.ps1` 会跳过独立 Worker 进程。原因是部分 BullMQ Worker 仍会在模块加载或启动时创建 Redis-backed queue。这个模式只用于最小本地采集验证，不算完整 Worker/队列验收。

## 备份和恢复

备份：

```powershell
.\scripts\windows-local\backup.ps1
```

默认输出到一个目录：

```text
data/backups/ss_erp_YYYYMMDD_HHMMSS/
  database.dump
  manifest.json
  assets/
    uploads/
    watermarked/
    resized/
```

备份包含 PostgreSQL 数据和当前本地图目录 `apps/server/public/uploads`、`watermarked`、`resized`。

恢复最新备份：

```powershell
.\scripts\windows-local\restore.ps1 -Latest -ConfirmRestore
```

恢复指定备份：

```powershell
.\scripts\windows-local\restore.ps1 -BackupFile .\data\backups\ss_erp_20260602_120000 -ConfirmRestore
```

恢复会覆盖当前数据库对象，并把备份里的本地图复制回 `apps/server/public/*`。资产恢复只覆盖同名文件，不会清空当前目录里的额外文件。执行前先确认备份来自同一套 SS ERP 版本，并建议先手动再跑一次 `backup.ps1`。

## 扩展 local 模式安装

构建 local 包：

```powershell
pnpm build:extension:local
pnpm verify:extension
```

安装：

1. Chrome 打开扩展程序页面。
2. 开启开发者模式。
3. 加载 `build/extensions/ss-erp-local`。
4. 打开本机 Web：`http://127.0.0.1:3000`。
5. 登录本机账号，在 Web 的“扩展连接”入口生成 30 天扩展 Token。
6. 打开扩展设置页，ERP 后端地址填 `http://127.0.0.1:3001`，Token 填本机生成的 Token。

这个 Token 只用于当前本机 API，不需要云端账号、云端 Token 或 SaaS 域名。

## 常见问题

### PostgreSQL 不可连接

先确认数据库服务已启动，并且 `.env.local-windows` 的 `DATABASE_URL` 用户名、密码、端口和数据库名正确。`prepare.ps1` 和 `status.ps1` 会提示当前 host/port 是否可连。

### Redis 不可用

Redis Windows 没有官方稳定发行版。完整本地版建议使用 WSL、Docker 或可信的第三方兼容发行版。只做最小本地采集时可以临时设置 `REDIS_DISABLED=1`，但队列和部分 Worker 能力不算完整验收。

### 扩展提示未配置 Token

local 扩展默认知道本机 API 地址，但采集接口仍要知道当前用户是谁。先登录本机 Web，再用本机 Web 生成扩展 Token，填到扩展设置页。

### 图片没有写到 data/uploads

当前代码默认写入 `apps/server/public/uploads` 并从 `/uploads/:filename` 读取。`data/uploads` 是后续安装器整理目录时再迁移的目标。

### 不想影响 SaaS 云端

Windows local 模板和脚本只设置本地进程环境变量，不改 `.env.staging`、R2/OSS 配置、短信配置或云端部署脚本。

## 后续安装器路线

1. Portable ZIP：当前 v0.1，源码 + 脚本 + env 模板，不捆绑大二进制。
2. Inno Setup / NSIS：增加安装向导、开始菜单、服务管理和卸载流程。
3. Runtime bundling：评估是否内置 Node、PostgreSQL，Redis 仍需单独路线或替代队列方案。
4. 代码签名：安装器和可执行启动器签名，降低 Windows Defender / SmartScreen 干扰。
5. 升级和回滚：安装前自动备份数据库，保留上一版本目录。
