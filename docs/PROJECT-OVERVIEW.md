# SS ERP 项目总览

SS ERP 是面向 OZON 跨境卖家的 SaaS ERP。系统目标是把商品采集、图片处理、上架、订单同步、物流处理、财务统计、供应链协作和运维配置集中到一个可维护的工作台里。

本文是项目的总入口文档。日常开发先看这里，再按文末文档地图进入具体手册。

## 当前定位

- **目标用户**：OZON 跨境卖家、中小运营团队、需要从表格/手工流程迁移到系统化运营的团队。
- **部署阶段**：单 VPS 云端部署为主，保留本地离线 ERP 能力。
- **规模假设**：早期到中期总用户约 1 万以内，优先单体架构、可观测性、备份、回滚和扩展稳定性，不提前引入 K8s 或复杂集群。
- **核心原则**：先保证采集、上架、订单、图片、账号、安全、备份这些主链路可靠，再做横向扩容。

## 域名规划

| 域名                | 用途            | 当前约定                                                             |
| ------------------- | --------------- | -------------------------------------------------------------------- |
| `ss-erp.com`        | 官网和 API 主域 | `/` 展示官网首页；`/api/*` 走后端 API；`/api/cdn/*` 代理 R2 图片读取 |
| `www.ss-erp.com`    | 官网别名        | 301 到 `ss-erp.com`                                                  |
| `app.ss-erp.com`    | 用户 ERP        | 用户登录、采集、订单、商品、仓库、财务等工作台                       |
| `admin.ss-erp.com`  | 超管/管理员后台 | 系统配置、用户管理、运维配置、集成状态                               |
| `assets.ss-erp.com` | 后期可选        | 绑定 R2 自定义域名后承载静态图片，当前阶段暂不启用                   |
| `api.ss-erp.com`    | 后期可选        | 当前 API 使用 `ss-erp.com/api/*`，暂不单独拆域名                     |

R2 的 `*.r2.cloudflarestorage.com` 是 S3 API endpoint，只给服务端带密钥上传/读取使用，不作为浏览器图片访问域名。没有配置 R2 自定义域名时，图片统一通过 `ss-erp.com/api/cdn/*` 代理读取。

## 系统架构

```text
Browser Web / Admin
        |
        | HTTPS
        v
Next.js Web (apps/web)
        |
        | /api/*
        v
Fastify API (apps/server) ---- PostgreSQL
        |                         |
        |                         +-- Prisma migrations
        |
        +---- Redis session / BullMQ
        |
        +---- Workers: sync, cleanup, retention, billing
        |
        +---- R2 / OSS object storage

Chrome Extension (extensions/ss-erp)
        |
        +---- OZON public/seller pages
        +---- 1688 / PDD / Taobao source pages
        +---- SS ERP API
```

## 代码结构

```text
apps/web/                 Next.js 15 App Router 前端
apps/server/              Fastify API、Prisma、Workers
packages/shared/          共享 schema、类型和工具
extensions/ss-erp/        Chrome 扩展
print-agent/              打印代理原型
scripts/                  部署、备份、诊断、预检脚本
deploy/                   systemd 服务模板
docker/                   Docker/Nginx 生产模板
docs/                     项目文档
docs/archive/             历史记录、阶段性分析和旧文档
build/scripts/            本地离线包脚本
```

根目录只放工程入口和配置文件。临时构建包、截图、压缩包、一次性部署脚本不进入 Git，生成后可以安全清理。

## 核心业务链路

### 商品采集

- 浏览器扩展在 OZON 商品页或列表页读取商品信息。
- 采集数据进入 `/api/collect`，保留源商品 ID、原始标题、上架标题、价格、货币、图片和变体信息。
- Ozon 采集到 ERP 现在分两阶段：首轮默认走 `balanced`，先快速保存当前页商品、当前页/弹窗可见变体、价格和主图，不等待富内容详情页和 seller 细节接口；后台再静默补跑 `complete`，把完整变体组合、富内容、源视频、类目和子 SKU seller 属性回写到同一条采集记录，避免大多变体商品首轮采集明显变慢。
- ERP Web 发起的扩展采集会先 ping 浏览器扩展，确认扩展桥、版本、ERP 连接配置和采集模块状态；如果采集请求没有打到后端，页面会优先提示扩展未连接、未配置 Token 或模块未加载。
- Ozon 富文本简介和源视频元数据会随采集保存到 metadata，便于后续展示和能力扩展；采集兼容 `richAnnotationJson / richAnnotation` 以及 `content / blocks / children / items / nodes / widgets` 等富内容结构。发布链路不会把源商品的视频、富媒体或视频封面属性直接克隆到新商品；富内容会优先保留 Ozon 原始模板（如 `version: 0.3` / `raShowcase`），转存图片、清洗文本，并按类目支持的 `22336` 或 `11254` 属性写入。
- 上架标题要求使用 OZON 可识别语言。检测到中文标题时，后端阻止直接上架并提示人工修正。
- 价格采集保留货币信息，避免把 `CNY` 数字误当 `RUB` 计算。

### 列表页注入

- 扩展在 OZON 列表页注入轻量信息卡。
- 默认展示关键字段，展开后展示更多商品指标。
- Premium 数据不可用时不阻塞基础卡片渲染。

### 图片和对象存储

- 云端优先使用 R2/OSS。
- 上传凭据保存在超管后台 `SystemConfig`，环境变量只作为兜底。
- 上传成功后返回可读 URL：
  - 有 R2 自定义域名：返回自定义域名 URL。
  - 无自定义域名：返回 `ss-erp.com/api/cdn/<objectKey>`。
- 对象路径按用途分组：
  - `users/{userId}/raw/`
  - `users/{userId}/watermarked/`
  - `users/{userId}/tmp/`
  - `announcements/`
  - `system/attachments/`

### 上架

- 支持单商品、多变体、SKU 级价格覆盖。
- 支持倍率加价和固定 CNY 加价。
- 支持删除单个变体，避免多变体商品只能整体处理。
- 发布到 Ozon 前会过滤视频、富媒体、视频封面和富内容等从源商品克隆来的属性，避免把不可复用的源商品媒体字段写入新卡片；如果采集数据里有 `richDescriptionJson` 且当前类目支持富内容属性，发布侧会保留 Ozon 富内容模板结构，重写图片 URL，并生成新的 `22336` 或 `11254` 富内容属性。
- Ozon 视频信息会随采集保存并写入发布诊断，但当前不会克隆源商品视频/封面字段，也不会自动上传视频；需要确认 Ozon 支持的视频发布接口后再开启实际上传。
- 多 SKU 发布会保留真实采集到的颜色/规格属性和 8292 分组属性，不再把内部 `offer_id` 写入 10097 颜色族；`Цвет` 仍按标准颜色清洗，`Название цвета` 会保留 `Тип 1`、`90x180 см` 等安全短补充值用于区分同色 SKU。标题只拼接结构化补充值；像 `изысканный`、`красивых зеленых кусочков` 这类主观/描述性短语不会进标题，也不会原样发给 Ozon，而是按同组未占用的 `Тип N` 中性化，避免既触发审核又造成同色 SKU 合并冲突。
- 高风险标题只给人工确认建议，不静默替换。当前规则覆盖敏感手办/摆件标题、身体/头发香氛喷雾标题，以及重复容量后缀等容易触发 Ozon 审核的问题。
- `follow-by-sku` 跟卖任务的图片补传分三类状态：`已上传`、`已阻塞`、`待补传`。只要还有 `待补传` 的 SKU，任务会继续刷新，不会因为前面某个 SKU 图片 400 就提前收口。
- 如果 Ozon 已经对某个已创建商品卡返回阻塞型错误（例如 `FB_ORIGINAL`、标题/属性被拒绝），系统会跳过该 offer 的图片补传，并在上架日志里直接展示卡片阻塞原因，避免把卡片审核错误误判成纯图片错误。

### 运维配置

- 全局配置统一走 `SystemConfig`。
- 配置项集中在 `apps/server/src/config/system-config-schema.ts`，包含类型、默认值、校验和敏感字段标记。
- 超管后台负责功能开关、上传/R2、保留策略、备份、维护模式等设置。

## 部署策略

当前推荐单 VPS：

```text
Nginx / Cloudflare
  |
  +-- Next.js Web
  +-- Fastify API
  +-- Worker
  +-- PostgreSQL
  +-- Redis
```

短期不需要蓝绿集群或 K8s。后期如果出现 Worker 队列堆积、数据库 IO 压力、部署明显影响用户，再按顺序拆：

1. Worker 独立到第二台 VPS。
2. PostgreSQL/Redis 独立或托管。
3. R2 自定义域名/CDN 承载图片读取。
4. API 多实例和 Redis 化缓存失效。

## 验证命令

本地基础验证：

```bash
pnpm typecheck
pnpm --filter server test
pnpm --filter web build
pnpm verify:extension
```

云端部署前预检：

```bash
pnpm env:check -- --profile cloud-r2 --env .env.staging
pnpm preflight --remote-oss
```

线上诊断：

```bash
DEPLOY_DIR=/opt/ss-erp/app ENV_FILE=.env.staging bash scripts/diagnose-runtime-env.sh
```

## 安全边界

- R2 `Access Key ID` 和 `Secret Access Key` 只允许服务端使用，不进入前端或扩展。
- Cloudflare API Token 只用于 Cloudflare 管理 API，不用于 ERP 图片上传链路。
- `/api/cdn/*` 由后端代理读取对象，可做 Referer 检查和访问控制。
- 管理员/超管配置变更应开启审计日志。
- 生产备份需要定期做恢复演练，不只检查备份文件存在。

## 文档地图

- [本地开发](local-development.md)
- [运维手册](RUNBOOK.md)
- [VPS 部署](vps-deployment.md)
- [本地离线 ERP](local-offline-erp.md)
- [PostgreSQL 慢查询](postgresql-slow-query.md)
- [Service 层指南](service-layer-guide.md)
- [前端通用组件](common-components-guide.md)
- [TanStack Query 指南](tanstack-query-guide.md)
- [扩展开发与整合计划](extension-development.md)
- [历史文档归档](archive/)

## 当前不做的事

- 不为早期阶段引入 K8s。
- 不把 R2 S3 endpoint 暴露为浏览器图片 URL。
- 不把 OSS/R2 密钥下发给扩展或用户浏览器。
- 不把临时构建包、测试截图、一次性部署包提交到 Git。
