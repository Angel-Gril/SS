# 本地 Windows 版打包路线

本页定义 SS ERP 本地 Windows 版的交付边界。当前分两条路线推进：

- Portable v0.1：源码 + 脚本 + 用户本机依赖，默认连接用户已有 PostgreSQL/Redis，先满足启动、采集、本地存图、备份恢复和扩展连接。
- Runtime-assisted v0.2：打包时手动提供 `runtime\node` 和 `runtime\pgsql`，产物使用生产构建和包内 PostgreSQL，解压后通过 `start.bat` 尽量一键启动。

两条路线都不会自动下载 runtime，不会把 Node/PostgreSQL/Redis 大二进制、数据库数据或 zip 提交进 Git。

## 本地版目标

- Windows 单机可启动 Web 和 API。Portable v0.1 在 Redis 可用时可以启动 Worker；Runtime-assisted v0.2 默认不启动 Worker。
- 商品采集能从 local 扩展包推送到本机 API。
- 图片默认写入本地磁盘，不依赖 R2、OSS、Cloudflare 或外部 CDN。
- 登录、注册不依赖短信服务和 Cloudflare Turnstile。
- 数据库和本地图可以备份到本地目录并恢复。
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

### Portable v0.1

默认不捆绑大二进制运行时，需要用户机器已有：

- Windows 10/11 或 Windows Server。
- Node.js 20+。
- pnpm 11.x。
- PostgreSQL 客户端工具和数据库服务，至少包含 `psql`、`pg_isready`、`pg_dump`、`pg_restore`。
- Redis 服务或兼容服务。

Portable v0.1 默认不负责安装 PostgreSQL，也不会自动创建数据库。默认启动只会对 `DATABASE_URL` 指向的已有数据库执行 Prisma migration；首次使用前需要先创建好 `ss_erp`（或把 `DATABASE_URL` 改成你已经创建的库）。

为了接近之前 `build/scripts/start.bat` 的旧离线包体验，脚本额外支持两个显式数据库入口：

- `start.ps1 -CreateDatabase`：仍然使用用户机器已有 PostgreSQL 服务，但会在当前 `DATABASE_URL` 用户有 `CREATEDB` 权限时幂等创建目标数据库。
- `start.ps1 -UseRuntimePostgres`：只在用户已经手动提供 `runtime\pgsql\bin` 或设置 `SS_ERP_POSTGRES_BIN` 时启用。脚本会初始化 `data\pgsql`、启动脚本管理的 PostgreSQL、创建目标数据库并跑 migration。因为 PostgreSQL runtime 初始化使用 trust auth，这个模式只允许 `DATABASE_URL` host 为 `127.0.0.1` 或 `localhost`。

这两个入口都不自动安装 PostgreSQL，也不下载 PostgreSQL runtime。`runtime/`、`build/runtime/`、`data/` 都被 Git 忽略，不能把 Node/PostgreSQL runtime 或数据库文件提交进仓库。
即使提供了 `runtime\node`，Portable v0.1 仍需要可用的 pnpm（或手动把可执行的 pnpm 放进 PATH），因为当前启动方式仍是源码 + pnpm 脚本。

现实限制：Redis 没有官方稳定 Windows 发行版。Portable v0.1 不强行把 Redis 打进安装包。可选路线是使用 WSL/Docker/第三方 Windows Redis 兼容发行版，或在最小采集场景下显式设置 `REDIS_DISABLED=1`，但这不是完整 Worker/队列验收。

### Runtime-assisted v0.2

打包机器需要 Node、pnpm 和手动准备好的 `runtime\node`、`runtime\pgsql`。最终用户解压后的目录内置：

- `runtime\node\node.exe`：启动 API 和 Next standalone Web，不要求用户安装 Node/pnpm。
- `runtime\pgsql\bin\*.exe`：首次启动自动初始化 `data\pgsql`，自动创建 `ss_erp` 数据库，并执行 Prisma migration。
- 生产构建产物：API 使用 `apps/server/dist/index.js`，Web 使用 `apps/web/standalone/**/server.js`。

Runtime-assisted v0.2 默认 `REDIS_DISABLED=1`、`RUN_WORKERS=0`，只启动 Web + API + PostgreSQL。采集、登录、本地图片上传、基础 ERP 功能优先跑通；Redis 和完整 Worker 队列作为后续增强模式处理。

## 目录结构

推荐从仓库根目录运行：

```text
SS ERP/
  .env.local-windows          本机私有配置，不提交 Git
  .env.local-windows.example  模板
  runtime/node/               可选手动放置的 Node runtime，不提交 Git
  runtime/pgsql/              可选手动放置的 PostgreSQL runtime，不提交 Git
  data/pgsql/                 runtime-assisted PostgreSQL 数据目录，不提交 Git
  apps/server/public/uploads/ 未设置 UPLOAD_DIR 时的本地上传目录
  data/backups/               Windows local 脚本默认备份目录
  logs/windows-local/         start/status/stop 日志和 pid
  scripts/windows-local/      Portable v0.1 脚本
```

Runtime-assisted v0.2 产物目录：

```text
SS-ERP-Local/
  start.bat
  stop.bat
  backup.bat
  restore-latest.bat
  config.json
  runtime/node/
  runtime/pgsql/
  apps/server/dist/
  apps/server/node_modules/
  apps/web/standalone/
  extension/
  data/pgsql/
  data/uploads/
  data/watermarked/
  data/resized/
  data/backups/
  logs/windows-local/
```

未设置 `UPLOAD_DIR` 时，local 后端沿用 `apps/server/public/uploads`、`watermarked`、`resized`。Runtime-assisted v0.2 的 `config.json` 默认 `uploadDir=data/uploads`，图片目录会切到包根 `data/uploads`、`data/watermarked`、`data/resized`，便于备份和升级时保留用户数据。runtime 配置里的 `uploadDir` 必须是包根 `data/` 下的子目录，脚本和 server bootstrap 都会拒绝越界目录。

## 准备

```powershell
.\scripts\windows-local\prepare.ps1
```

它会：

- 检查 Node、pnpm、PostgreSQL CLI、Redis 可用性。
- 检测是否存在可选 `runtime\node` / `runtime\pgsql`。
- 如果 `.env.local-windows` 不存在，从模板生成一份并写入本机随机密钥。
- 提示 PostgreSQL / Redis 当前是否可连接，并区分 PostgreSQL 端口可达和目标数据库可访问。

生成后按实际数据库密码修改：

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/ss_erp"
REDIS_URL="redis://127.0.0.1:6379"
```

可选 runtime-assisted 字段：

```env
SS_ERP_POSTGRES_BIN=""
SS_ERP_POSTGRES_DATA_DIR="data/pgsql"
SS_ERP_NODE_EXE=""
```

留空时脚本会先找 `runtime\pgsql\bin` 和 `runtime\node\node.exe`，再回退到 PATH。

## 启动、停止、状态检查

### Portable v0.1

启动：

```powershell
.\scripts\windows-local\start.ps1
```

默认会：

- 加载 `.env.local-windows`。
- 检查 PostgreSQL、目标数据库和 Redis。
- 执行 `pnpm --filter server db:deploy`。
- 启动 API、Worker、Web。
- 写入 `logs/windows-local/*.pid` 和日志文件。

如果 `DATABASE_URL` 指向的数据库不存在，默认启动会在 migration 前失败并提示先创建数据库。可以选用：

```powershell
.\scripts\windows-local\start.ps1 -CreateDatabase
```

前提是 `DATABASE_URL` 中的用户有建库权限。

如果你已经手动提供 `runtime\pgsql\bin`，可以走接近旧离线包的模式：

```powershell
.\scripts\windows-local\start.ps1 -UseRuntimePostgres
```

这个模式会初始化 `data\pgsql`（首次运行）、启动脚本管理的 PostgreSQL、幂等创建目标数据库，然后执行 migration。它不会安装 PostgreSQL，也不会停止用户系统里的共享 PostgreSQL 服务。出于安全边界，`-UseRuntimePostgres` 只接受 `127.0.0.1` 或 `localhost`，如果 `DATABASE_URL` 指向 `0.0.0.0`、局域网 IP 或其他非 loopback host，会直接拒绝。

停止：

```powershell
.\scripts\windows-local\stop.ps1
```

状态检查：

```powershell
.\scripts\windows-local\status.ps1
```

`stop.ps1` 只停止脚本启动的 Node 进程，不停止本机 PostgreSQL/Redis 服务，避免误伤用户已有数据库。

如果是 `-UseRuntimePostgres` 启动的脚本管理 PostgreSQL，`stop.ps1` 会根据 `logs/windows-local/postgres-runtime.json` 停止该 runtime PostgreSQL。使用 `-KeepRuntimePostgres` 可以保留它继续运行：

```powershell
.\scripts\windows-local\stop.ps1 -KeepRuntimePostgres
```

如果 `.env.local-windows` 设置了 `REDIS_DISABLED=1`，`start.ps1` 会跳过独立 Worker 进程。原因是部分 BullMQ Worker 仍会在模块加载或启动时创建 Redis-backed queue。这个模式只用于最小本地采集验证，不算完整 Worker/队列验收。

### Runtime-assisted v0.2

最终用户解压后使用包根入口：

```powershell
.\start.bat
```

首次启动会：

- 读取或创建 `config.json`。
- 初始化 `data\pgsql`。
- 启动脚本管理的 PostgreSQL，默认端口 `5433`。
- 自动创建 `ss_erp` 数据库。
- 执行 Prisma migration。
- 启动 API：`node apps/server/dist/index.js`。
- 启动 Web：`node apps/web/standalone/**/server.js`。
- 打开 `http://127.0.0.1:3000`。

停止：

```powershell
.\stop.bat
```

停止脚本只停止自己记录的 Web/API/PostgreSQL 进程，不会停止用户系统里的 PostgreSQL/Redis 服务。Runtime-assisted v0.2 默认不启动 Redis，也不启动独立 Worker。

## Portable 打包

### Portable v0.1 源码包

默认 dry-run：

```powershell
.\scripts\windows-local\package.ps1 -DryRun
```

默认包只包含源码、`scripts/windows-local/`、文档和 `.env*.example`，排除 `.env*`、`node_modules`、`runtime/`、`build/runtime/`、`data/`、`logs/`、本地图目录和 zip 等产物。

如果你已经手动准备根目录 `runtime\node` 和 `runtime\pgsql`，可以生成 runtime-assisted 目录：

```powershell
.\scripts\windows-local\package.ps1 -IncludeRuntime
```

这个参数只复制已经存在的 `runtime\node` 和 `runtime\pgsql`，不下载 runtime，不包含 Redis，不复制其他 `runtime/` 子目录，也不改变 Git 忽略规则。如果 `runtime\pgsql` 任意层级发现 `data`、`pgdata`、`log`、`logs`、`pg_log`、`PG_VERSION`、`postmaster.pid`、`postmaster.opts` 或常见日志文件，脚本会拒绝打包，避免把数据库状态或日志带进 Portable 目录。

### Runtime-assisted v0.2 生产构建包

先手动准备：

```text
runtime/node/node.exe
runtime/pgsql/bin/postgres.exe
runtime/pgsql/bin/pg_ctl.exe
runtime/pgsql/bin/initdb.exe
runtime/pgsql/bin/psql.exe
runtime/pgsql/bin/pg_dump.exe
runtime/pgsql/bin/pg_restore.exe
```

然后 dry-run：

```powershell
.\scripts\windows-local\package-runtime.ps1 -DryRun
```

构建 runtime-assisted 目录：

```powershell
pnpm build:local-windows-runtime
```

或直接运行：

```powershell
.\scripts\windows-local\package-runtime.ps1
```

打包脚本会构建 server、生成 Prisma client、以 `NEXT_STANDALONE=1` 构建 Web、构建 local 扩展包，并输出到：

```text
build/windows-local/SS-ERP-Local-runtime-0.2.0/
```

如果构建产物已经存在，可以只整理目录：

```powershell
.\scripts\windows-local\package-runtime.ps1 -SkipBuild
```

使用 `-Zip` 会在 `build/windows-local/` 下额外生成 zip。zip 是产物，不提交 Git。

## 备份和恢复

### Portable v0.1

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

### Runtime-assisted v0.2

包根入口：

```powershell
.\backup.bat
.\restore-latest.bat
```

`restore-latest.bat` 默认只打印破坏性恢复提示，不直接加 `-ConfirmRestore`。确认最新备份确实是目标备份后，再运行显式确认命令。

也可以直接指定 `config.json`：

```powershell
.\scripts\windows-local\backup.ps1 -ConfigFile .\config.json
.\scripts\windows-local\restore.ps1 -ConfigFile .\config.json -Latest -ConfirmRestore
```

Runtime-assisted v0.2 备份包含：

- PostgreSQL dump：`data/backups/ss_erp_*/database.dump`
- 本地图：`data/uploads`、`data/watermarked`、`data/resized`

恢复会把数据库对象清理后重放 dump，并把资产复制回当前 `config.json` 指定的本地图片目录。

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

如果提示端口可达但目标数据库不可访问，说明 PostgreSQL 服务在运行，但 `DATABASE_URL` 指向的库不存在或当前用户无权访问。处理方式：

- 先手动创建 `ss_erp`。
- 或运行 `start.ps1 -CreateDatabase`，前提是当前用户有建库权限。
- 或手动提供 `runtime\pgsql\bin` 后运行 `start.ps1 -UseRuntimePostgres`，让脚本管理 `data\pgsql`。

### 想接近之前打包版本的一键数据库体验

之前旧包依赖 `build/runtime/pgsql`，会在首次启动时 `initdb`、启动 PostgreSQL、创建 `ss_erp` 并跑 migration。Portable v0.1 现在保留这个能力的受控版本：手动提供 `runtime\pgsql` 后用 `start.ps1 -UseRuntimePostgres`。默认路线仍然只连接已有 PostgreSQL，避免误解成免依赖安装器。

### Redis 不可用

Redis Windows 没有官方稳定发行版。完整本地版建议使用 WSL、Docker 或可信的第三方兼容发行版。只做最小本地采集时可以临时设置 `REDIS_DISABLED=1`，但队列和部分 Worker 能力不算完整验收。

Runtime-assisted v0.2 默认就是 `REDIS_DISABLED=1` 和 `RUN_WORKERS=0`，因此不需要 Redis 才能启动 Web/API/PostgreSQL。本地测试重点是登录、采集、本地图和基础 ERP 功能；后台同步、批量队列和自动任务后续再作为高级模式打开。

### PowerShell 提示 pnpm.ps1 / usr/bin/env 警告

如果命令 exit code 是 0，这通常是本机 pnpm shim 或 Corepack shim 的兼容警告，不是 SS ERP 脚本失败。`scripts/windows-local` 会优先查找 `pnpm.cmd`、`pnpm.exe`，再回退到 `pnpm`，因此脚本启动一般能绕开 `pnpm.ps1`。

手工执行时可以直接使用：

```powershell
pnpm.cmd --filter server typecheck
pnpm.cmd build:extension:local
```

如果想从根上修复本机 shim，重新安装或启用 Corepack/pnpm，让 Windows 重新生成 `pnpm.cmd` 和 `pnpm.ps1`；但只要 exit code 为 0，不影响当前验收结论。

### 扩展提示未配置 Token

local 扩展默认知道本机 API 地址，但采集接口仍要知道当前用户是谁。先登录本机 Web，再用本机 Web 生成扩展 Token，填到扩展设置页。

### 图片没有写到 data/uploads

未设置 `UPLOAD_DIR` 时，当前代码默认写入 `apps/server/public/uploads` 并从 `/uploads/:filename` 读取。Runtime-assisted v0.2 的 `config.json` 默认 `uploadDir=data/uploads`，启动器会把它解析到包根 `data/uploads`，并让 `/uploads/*`、`/watermarked/*`、`/resized/*` 从 `data/*` 读取。runtime 模式不允许把 `uploadDir` 指向包根 `data/` 之外。

### 不想影响 SaaS 云端

Windows local 模板和脚本只设置本地进程环境变量，不改 `.env.staging`、R2/OSS 配置、短信配置或云端部署脚本。

## 后续安装器路线

1. Portable v0.1：源码 + 脚本 + env 模板，不捆绑大二进制。
2. Runtime-assisted v0.2：手动准备 Node/PostgreSQL runtime，打包生产构建，默认禁用 Redis/Worker，解压后 `start.bat` 启动。
3. Inno Setup / NSIS：增加安装向导、开始菜单、服务管理和卸载流程。
4. 代码签名：安装器和可执行启动器签名，降低 Windows Defender / SmartScreen 干扰。
5. 升级和回滚：安装前自动备份数据库，保留上一版本目录，升级时不覆盖 `data/`。
6. 高级模式：评估 Redis 替代方案或可选 runtime，恢复完整 Worker 队列能力。
