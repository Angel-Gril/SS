# SS ERP 上线检查清单

当前项目仍处于本地开发版本。上线前目标不是一次性重构所有业务代码，而是建立可回滚、可部署、可维护的最小生产链路。

## 协作规则

- `main` 是唯一正式主线。
- Claude 当前负责 `apps/server/src/routes/collect*` 和 `apps/server/src/routes/order*` 拆分时，其他人不要改这些文件。
- Git baseline 等 Claude 的路由分片和 typecheck 完成后再提交。
- 每次上线相关变更独立提交，避免和业务重构混在一起。

## P0: 首次上线前必须完成

- 初始化 Git，并在 Claude 当前重构完成后建立 baseline commit。
- 确认 `.gitignore` 不会提交 `.env`、`node_modules`、`.next`、`build/dist`、`apps/server/dist`、上传图片、日志和本地数据库。
- 生产启动时硬校验 `JWT_SECRET` 和 `ENCRYPTION_KEY`，禁止使用开发兜底值。
- 统一 Redis 连接配置，所有 BullMQ `Queue` / `Worker` 使用 `REDIS_URL`，不要硬编码 `127.0.0.1:6379`。
- Prisma 建立可复现的 baseline migration；生产只通过带目标 commit 备份恢复认证的标准部署入口执行 migration。
- 注册和短信发送接口接入 Cloudflare Turnstile 服务端校验。
- 手机验证码使用 Redis TTL 存储，按手机号和 IP 做分级限流。
- 生产 CORS 只允许正式 Web 域名和固定 Chrome 扩展 ID。
- OSS/R2/COS 接入为默认图片存储，本地 `/uploads`、`/watermarked` 仅保留开发模式。
- 数据库使用 RDS/云 PostgreSQL 或至少配置自动备份和恢复演练。
- Cloudflare 代理后开启源站保护，服务器防火墙只允许 Cloudflare 出口 IP 访问 Web/API 端口。

## P1: 上线测试阶段

- 增加 `/health` 深度检查：数据库、Redis、OSS 配置状态。
- 增加 `/api/version`，返回 Web/API/扩展/打印代理当前版本和最低兼容版本。
- 接入错误监控，如 Sentry。
- 接入访问日志和业务审计日志，覆盖管理员充值、重置密码、删除店铺、系统配置修改。
- 为 `auth`、`crypto`、`image-storage`、`sms`、`captcha` 增加最小单元测试。
- 准备回滚流程：镜像版本回滚、数据库 migration 回滚策略、OSS 配置回退。

## P2: 持续迭代和 OTA

- Web 使用蓝绿或滚动部署，不做运行时热替换。
- Chrome 扩展通过官网第一方下载接口发布版本与 SHA-256 绑定的云端/本地包；升级需重新下载并加载。
- 打印代理使用 `electron-updater` 或独立更新器，下载包必须校验 SHA256。
- Windows 离线包更新前先自动备份本地 PostgreSQL 数据。
- 增加 `app_versions` 或等价配置，统一管理 Web、API、扩展、打印代理、Windows 包版本。

## 上线前验证命令

```powershell
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm --filter server build
pnpm --filter web build
```

如有 Docker 环境，再验证：

```powershell
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml build
```

## 不纳入首轮上线的事项

- 不在首轮拆完所有大路由文件。
- 不在首轮引入 Kubernetes。
- 不通过公告、远程 JS 或自研热更新协议替换扩展代码；更新只发布完整官网安装包。
- 不把本地 Windows 离线包和云端 SaaS 强行合并成同一套启动方式。
