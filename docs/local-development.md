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

