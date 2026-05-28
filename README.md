# 松鼠跨境 ERP (SS ERP)

跨境电商 SaaS 管理平台，对接 OZON / Yandex / Kaspi / Wildberries。

## 技术栈

- **前端**: Next.js 14 (App Router) + TypeScript + TailwindCSS + shadcn/ui
- **后端**: Fastify + TypeScript + Prisma
- **数据库**: PostgreSQL 16 + Redis 7
- **队列**: BullMQ
- **认证**: JWT + Redis 会话

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
- 前端: http://localhost:3000
- 后端: http://localhost:3001
- 数据库 GUI: `pnpm db:studio`

## 项目结构

```
SS ERP/
├── apps/
│   ├── web/          Next.js 前端
│   └── server/       Fastify 后端 + Prisma
├── packages/
│   └── shared/       共享类型 + 工具
├── docker/           生产部署 Dockerfile
└── docker-compose.yml  本地开发服务
```

## 部署

详见 `docker/README.md`。
