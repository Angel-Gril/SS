# 松鼠跨境 ERP (SS ERP)

SS ERP 是面向 OZON 跨境卖家的跨境电商 SaaS ERP，覆盖商品采集、图片处理、上架、订单同步、物流处理、财务统计、供应链协作和超管运维配置。

完整说明从这里开始：

- [项目总览](docs/PROJECT-OVERVIEW.md)
- [文档索引](docs/README.md)
- [本地开发](docs/local-development.md)
- [本地 Windows 版](docs/local-windows-package.md)
- [运维手册](docs/RUNBOOK.md)

## 技术栈

- **前端**：Next.js 15 App Router、TypeScript、TailwindCSS
- **后端**：Fastify、TypeScript、Prisma
- **数据库/缓存**：PostgreSQL、Redis
- **队列/任务**：BullMQ、独立 Worker
- **扩展**：Chrome Extension，负责 OZON 页面采集和注入式数据展示
- **对象存储**：Cloudflare R2 / S3-compatible OSS

## 快速开始

```bash
pnpm install
cp .env.example .env

pnpm db:up
pnpm db:migrate
pnpm db:seed

pnpm dev
```

访问：

- Web: http://localhost:3000
- API: http://localhost:3001
- Prisma Studio: `pnpm db:studio`

## 常用验证

```bash
pnpm typecheck
pnpm --filter server test
pnpm --filter web build
pnpm verify:extension
```

## Windows 本地版

本地 Windows 版路线见 [docs/local-windows-package.md](docs/local-windows-package.md)。当前有两种包：

- Portable v0.1：源码 + 脚本 + 用户本机 Node/pnpm/PostgreSQL/Redis。
- Runtime-assisted v0.2：手动准备 `runtime/node`、`runtime/pgsql` 后，打包生产构建和本地 PostgreSQL runtime，默认禁用 Redis/Worker。

```powershell
.\scripts\windows-local\package.ps1 -DryRun
.\scripts\windows-local\package-runtime.ps1 -DryRun
pnpm build:local-windows-runtime
```

## 项目结构

```text
apps/web/          Next.js 前端
apps/server/       Fastify API、Prisma、Workers
packages/shared/   共享类型和 schema
extensions/ss-erp/ Chrome 扩展
print-agent/       打印代理原型
scripts/           部署、备份、诊断、预检脚本
scripts/windows-local/ Windows 本地版 Portable v0.1 / Runtime-assisted v0.2 脚本
deploy/            systemd 服务模板
docker/            Docker/Nginx 模板
docs/              项目文档
```

根目录只保留工程入口和配置。阶段性分析、旧 changelog、历史部署说明统一放入 `docs/archive/`。
