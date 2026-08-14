# 本地离线 ERP

这份方案适合用户不多、网络条件不稳定、或者需要在单机上长期运行的场景。

## 本地版定位

本地版不是云端 SaaS 的缩水版，而是一个可以离线交付、单机长期跑的稳定包。默认目标如下：

| 项目 | 本地版默认 |
| --- | --- |
| 部署形态 | 单台 VPS 或本地服务器 |
| 图片存储 | 本地磁盘，必要时再接单一对象存储 |
| 短信 | `console` 或本地替代实现 |
| 登录验证 | 不依赖 Turnstile / 第三方验证码 |
| 更新方式 | Git checkout 或 release/symlink 二选一 |
| 备份 | 本地备份优先，远程备份可选 |
| 扩展包 | `build:extension:local` |

## 建议架构

- Web、API、Worker、PostgreSQL、Redis 全部放在同一台 VPS 或本地服务器
- 图片默认本地存储
- 短信可以临时用 `console` provider 做开发验证
- 生产备份再按需接到远程 S3 兼容存储

## 推荐环境变量

本地离线版优先使用本地能力，避免依赖云短信、R2、外部 CDN：

```env
RUNTIME_MODE=local
IMAGE_STORAGE_BACKEND=local
LOCAL_BASE_URL=http://127.0.0.1:3001
SMS_PROVIDER=console
NEXT_PUBLIC_RUNTIME_MODE=local
```

数据库和 Redis 可以是本机服务，也可以是 Docker Compose：

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sserp
REDIS_URL=redis://127.0.0.1:6379
```

如果以后本地版也要把图片放到 R2 / S3，可以在超管后台设置 `upload_storage_backend=oss` 和 `upload_oss_*`，也可以用 `IMAGE_STORAGE_BACKEND=oss` 和 `OSS_*` 做部署级兜底。不要把本地版默认做成云端依赖，否则离线价值会下降。

改完环境文件后先校验：

```bash
pnpm env:check -- --profile local --env .env
```

如果本地版临时切到 R2 / S3 测试，不要用 `local` profile 验收，改用云端上传 smoke 单独验证对象存储链路。

## 本地版和云端版的验收差异

本地版验收看“能离线跑完整主体功能”，云端版验收看“外部服务是否真正接入”。两者不要共用同一套通过标准。

| 项目 | 本地版通过标准 | 云端版通过标准 |
| --- | --- | --- |
| 运行模式 | `RUNTIME_MODE=local` | `RUNTIME_MODE=cloud` |
| 图片上传 | `IMAGE_STORAGE_BACKEND=local` 或单独接一个对象存储 | 后台 `upload_storage_backend=oss` 或 env `IMAGE_STORAGE_BACKEND=oss`，且上传返回 `backend:"oss"` |
| 登录验证 | 不依赖 Turnstile，短信可用 `console` | Turnstile 和短信服务都必须真实可用 |
| 扩展包 | `pnpm build:extension:local` | `pnpm build:extension:cloud` |
| 备份 | 本地备份必须可恢复，远程备份可选 | 本地备份 + 远程备份建议都验收 |

如果客户环境没有短信服务，本地版不要强行开启云端验证码；否则会出现登录/注册流程被验证码挡住，主体 ERP 功能无法验收的问题。

## 本地版推荐测试流程

```bash
pnpm env:check -- --profile local --env .env
pnpm preflight
pnpm build:extension:local
pnpm verify:extension
```

如果本地服务器已经通过 Nginx 暴露到局域网或公网，再跑：

```bash
SMOKE_EXPECT_RUNTIME=local SMOKE_BASE_URL=http://127.0.0.1:3001 pnpm --filter server smoke:live
```

本地版测试重点：

- 登录、采集、商品、订单、财务等主体页面可用
- 扩展能连接到本地 API
- 图片落到本地 `uploads/` 或配置的单一对象存储
- 数据库备份文件能生成并恢复到临时库
- 更新后可回滚到上一版本

## 适用边界

- 适合小规模用户
- 适合先上线、先跑业务，再逐步分拆
- 不适合一开始就上 K8s、1Panel、分布式存储集群

## 文件与数据

- 上传图：本地盘或单一对象存储桶
- 备份：本地 + 远程二选一或同时使用
- 日志：保留最近几天，配合 `journalctl` / logrotate

本地版 ERP 只保留“够用”的能力，不追求云端的全部运维花活。优先保证：

- 能离线启动
- 能本地采集 / 重新采集 / 上架
- 能本地备份和恢复
- 能通过 `deploy-staging.sh` 或 release symlink 更新
- 能在没有云短信、没有 R2、没有外部 CDN 时继续测试核心链路
- 能在单机上长期稳定运行，不依赖额外运维面板

## 更新方式

推荐两种方式，二选一：

### 方式 A: GitHub 仓库拉取部署

服务器本身就是一个 git checkout 时，直接用：

```bash
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
./scripts/deploy-staging.sh <full-target-commit>
```

优点是简单，适合单机小团队。

本地离线版不要设置 `DEPLOY_ENV_PROFILE=cloud-r2`；如果要在部署前校验本地环境，单独先跑：

```bash
pnpm env:check -- --profile local --env .env
```

### 方式 B: release 目录 + symlink 回滚

如果你更看重回滚速度和版本隔离，使用：

```bash
DEPLOY_HOST=<server> DEPLOY_USER=<user> \
EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<full-target-commit> \
EXTENSION_RELEASE_SIGNATURE_PATH=/var/lib/ss-erp-extension-release-signatures/<full-target-commit>/ss-erp-extension-<version>.release-signature.json \
EXTENSION_RELEASE_SIGNATURE_SHA256=<operator-approved-detached-signature-sha256> \
./scripts/deploy.sh <full-target-commit>
```

优点是每次发布都有独立版本目录，失败可以快速切回上一版。

本地离线部署同样不能绕过候选四件套和外置 Ed25519 签名。上面两个代码块都是模板，必须先按
`docs/deployment.md` 完成独立批准的生产构建与签名，并替换所有尖括号占位符；缺少任一签名变量时
部署入口会在构建或停服前失败。本地离线客户如果没有开发能力，优先选方式 A：服务器保留 GitHub
checkout，由受控远程运维上传目标 commit 对应的候选和签名后运行 `deploy-staging.sh`。等到客户对停机
敏感，再切到方式 B。

### 本地版推荐更新流程

1. 拉取最新代码或切换到目标 commit，记录完整 40 位 `TARGET_COMMIT`；按独立生产构建授权生成
   cloud/local 同版候选四件套。
2. 在受保护的外部签名环境按第二道授权签署 exact candidate；构建成功不授权签名，签名成功也不
   授权部署。
3. 在目标服务器上从该 revision 的私有运维 checkout 加载应用 env 和
   `/etc/ss-erp-backup.env`，生成目标 commit 绑定的备份。
4. 把同一份备份恢复到临时数据库；只有实际数据库身份一致、public 表数为正、临时库成功删除且
   `verify-deploy-backup.sh "$TARGET_COMMIT"` 通过时才继续。
5. 在第三道部署授权下使用 `deploy-staging.sh`、`deploy-app-dir.sh "$TARGET_COMMIT"` 或
   `deploy.sh "$TARGET_COMMIT"` 中与安装模式匹配的一条标准入口。入口负责 build、停止旧版
   API/Worker、再次验证认证、migration、暗态检查、整体启动和 readiness。
6. 跑 `pnpm smoke:remote` 或本地 smoke。本地离线部署到此结束，不得把部署授权解释为官网发布或
   真实试点授权。
7. 如果失败，保持 API/Worker 停止并按 Runbook 处理；数据库迁移不可逆时必须按该版本的发布说明
   恢复已认证备份。

涉及唯一索引或写入契约变化的版本不支持新旧 API 滚动共存。必须先完成构建，再停掉旧 API/Worker，迁移后整体启动新版本。

线上或客户环境不要用 `prisma migrate dev` / `db push`，也不要手工裸跑
`npx prisma migrate deploy`。发布 migration 只能由上述带备份恢复认证门禁的标准入口执行。

## 备份与恢复

本地离线版也必须做备份，不要只依赖“服务器还在”。推荐：

首次启用时先按 `docs/deployment.md` 为该数据库插入独立、同时绑定环境 ID 与 UUID 的 canonical
`deployment_database_identity_v1` 对象；从其他环境克隆后必须轮换。

- 本机备份保留 7-14 天。
- 可选远程 S3/R2 备份保留 30-90 天。
- 重要更新前手动备份一次。
- 每月至少恢复演练一次。

命令：

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

应用 `DATABASE_URL` 与备份 `BACKUP_DB_URL` 必须查询到同一实际数据库名、OID 和库内 deployment
UUID；hostname/port 路由可以不同。
`DEPLOY_DATABASE_ID` 也必须一致。应用 env 的 `DEPLOY_BACKUP_LOCAL_DIR` 要等于备份 env 的
`BACKUP_LOCAL_DIR`，且该目录由备份用户独占、不能被 group/world 写入。应用后台备份服务如使用
自己的 `BACKUP_LOCAL_DIR`，必须选另一个目录。`backup-db.sh` 每次都会生成 schema v3
`backup-status.json` 和不可变 sidecar，超管后台和 `verify-vps-deploy.sh` 可据此检查最近证据。

## 扩展包

本地离线版优先使用 local 扩展包：

```bash
pnpm build:extension:local
pnpm verify:extension
```

local 包允许访问本地 API 和本地运行态，适合局域网或单机部署。cloud 包用于 SaaS 域名和线上 API，二者不要混用。

本地 local 包交付不切换第一方官网 publication pointer。若同一版本另行进入 SaaS 官网分发，仍须
完整执行五道独立授权及固定顺序：`package -> external release sign -> deploy/dark canary -> sign
website approval -> activate pointer -> distribution probe -> final verify -> same-path upgrade ->
independently approved pilot`。公开 probe 与最终 verifier 必须同时传入 `--approval` 和
`--dark-canary`；本地安装或 smoke 不能替代这些区域官网证据，也不能授权 Provider/Ozon 写入。

## 什么时候该分拆 worker

先保持单体即可。只有出现下面情况再拆：

- 队列经常堆积
- 图片处理或 OZON 同步拖慢 API
- 数据库 CPU / IO 持续高
- 单 VPS 风险开始不可接受

到那时先拆 worker，不必直接上 K8s。

拆分顺序建议：

1. 仍然单 VPS：Web + API + Worker + DB + Redis。
2. 第二台小 VPS：只放 Worker，处理同步和图片任务。
3. 数据库独立或托管：当 PostgreSQL CPU/IO 持续高再做。
4. Redis 独立：当队列量和缓存压力明显增大再做。

不要为了“分布式”提前买一堆小 VPS。真正先影响体验的通常是 worker 队列、数据库 IO、磁盘空间和备份恢复能力。

## 本地版 ERP 不建议先做的事

- 不建议上 1Panel 这种额外运维面板
- 不建议为了“看起来云原生”而拆成很多小 VPS
- 不建议为了小规模用户提前做分布式对象存储集群
- 不建议把蓝绿 / 灰度 / A/B 当成默认路径；只有用户量和更新风险明显上来再补

## 本地版最低配置参考

- 2C4G：只适合开发、演示或低负载测试
- 4C8G：更适合单机长期跑 Web + API + Worker + PostgreSQL + Redis
- 如果有大量图片处理或同步任务，优先加内存和 swap，再考虑拆 worker

建议至少配置：

- 40-80GB SSD 起步，图片多时单独扩盘。
- 2-4GB swap，避免构建或图片处理时 OOM。
- logrotate 清理 Nginx 和 systemd 日志。
- 监控磁盘使用率，低于 20% 剩余空间时告警或人工处理。
