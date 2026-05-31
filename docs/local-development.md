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
pnpm --filter server db:migrate
pnpm dev
```

如果你是第一次跑，先确认 `.env`、`.env.staging`、`apps/server/.env` 里至少有：

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`

## 本地验收

```bash
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm --filter server test
pnpm verify:extension
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

修复后再次验证时，先确认：

1. 线上 API / Worker / Web 都已重启
2. 运行中的进程实际加载了新的 `.env.staging`
3. `smoke:remote` 返回的上传后端变成 `oss`

## 今天的更新推送

最省事的流程是：

```bash
git add .
git commit -m "..."
git push
```

然后在 VPS 上用本文档后面的发布方式拉取并部署，再跑一次 smoke。

## 备份验证

数据库备份脚本和恢复演练都只建议在 Linux / VPS / WSL 上跑。

```bash
source /etc/ss-erp-backup.env
bash scripts/backup-db.sh
bash scripts/verify-backup-restore.sh
```

R2 / S3 兼容备份建议单独使用一个 bucket，不要和图片桶混用。
