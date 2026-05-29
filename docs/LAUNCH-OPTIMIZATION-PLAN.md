# SS ERP 上线优化整合建议（2026-05-29）

> 基于 Claude 原始建议 + Codex 补充 + hardening 分支已落地改动，整合后的最终开发/上线路线图。

---

## 一、已完成项（hardening/prelaunch-auth-security 分支）

| # | 原始问题 | 落地方式 | 文件 |
|---|----------|----------|------|
| 1 | ENCRYPTION_KEY fallback 裸奔 | 生产启动硬校验，缺失/过短直接 exit(1) | `bootstrap-config.ts:64-76` |
| 2 | JWT_SECRET 默认值 | 同上，生产拒绝启动 | `bootstrap-config.ts:65-69` |
| 3 | 注册无防护 | 后端 Turnstile 校验 + 路由级 10/min 频控；前端组件待接入 | `auth.ts:28`, `captcha.ts` |
| 4 | 登录无防护 | 后端失败 5 次后强制 Turnstile + Redis 计数；前端失败态组件待接入 | `auth.ts:77-82` |
| 5 | CORS 白名单过宽 | 生产严格匹配 CORS_ORIGIN（逗号分隔） | `index.ts:72-79` |
| 6 | rateLimit 全局偏宽 | 全局 200/min + auth 路由 10/min 分级 | `index.ts:90`, `auth.ts:11` |
| 7 | bodyLimit 30MB | 默认降到 1MB，图片路由单独放宽 | `index.ts:57` |
| 8 | 静态文件无鉴权/路径遍历 | isSafeFilename 校验 + 白名单字符 | `index.ts:144-146` |
| 9 | 无结构化错误码 | reply.ts 统一 ok/fail/badRequest/unauthorized | `lib/reply.ts` |
| 10 | Notification 无归档 | notification-cleanup worker 定期清理 | `workers/notification-cleanup.ts` |
| 11 | 无 CI/CD | GitHub Actions: typecheck → build → docker | `.github/workflows/ci.yml` |
| 12 | 无 Dockerfile | server + web 双 Dockerfile + compose.prod | `docker/` |
| 13 | 无部署文档 | DEPLOYMENT.md + PRE-LAUNCH-CHECKLIST.md | 根目录 |
| 14 | Redis 连接不统一 | redis.ts 走 REDIS_URL 环境变量 | `lib/redis.ts:38` |
| 15 | 短信验证码骨架 | provider + sendSmsCode/verifySmsCode 已实现；注册路由/前端验证码闭环待接入 | `captcha.ts:42-76` |
| 16 | 双运行模式 | bootstrap-config.ts 支持 config.json 便携包 | `bootstrap-config.ts` |

---

## 二、未完成 — 按优先级排序

### P0：上线阻塞（不修不能上）

| # | 问题 | 说明 | 状态 |
|---|------|------|------|
| 1 | **Worker Redis 硬编码 127.0.0.1** | 6 个 worker 统一走 `lib/bullmq-connection.ts` 解析 REDIS_URL | ✅ 已完成 |
| 2 | **Prisma baseline migration** | `20260529000000_baseline` 覆盖完整 schema，旧 migration 已清理 | ✅ 已完成 |
| 3 | **SMS 网关接入** | `lib/sms/` 抽象层 + 腾讯云 provider + console fallback；注册验证码闭环待接入 | ✅ provider 已完成 / 📋 闭环待接入 |

### P1：上线前强烈推荐

| # | 问题 | 说明 | 状态 |
|---|------|------|------|
| 4 | **Web token 迁移 HttpOnly Cookie** | authenticate 优先读 cookie；login/register 设 cookie；logout 清 cookie | ✅ 已完成 |
| 5 | **Cloudflare 真源保护** | Nginx geo 限制只接受 CF IP；后端读 CF-Connecting-IP | 📋 待运维配置 |
| 6 | **图片 OSS 直传（预签名 URL）** | `/api/images/presign` + 前端 `uploadDirect()` helper | ✅ 已完成 |
| 7 | **Sentry 接入** | server `@sentry/node` + web `instrumentation.ts` + 全局 errorHandler | ✅ 已完成 |
| 8 | **数据库备份脚本** | pg_dump cron + OSS 异地存储 | 📋 待运维实现 |
| 9 | **蓝绿部署脚本** | docker-compose blue/green + Nginx upstream 切换 + 健康检查 | 📋 待运维实现 |
| 10 | **Turnstile 前端接入** | 注册页必须传 `turnstileToken`；登录失败 5 次后显示验证 | 📋 待代码接入 |
| 11 | **短信注册闭环** | 发送验证码接口 + 注册表单验证码 + 服务端 `verifySmsCode` | 📋 待代码接入 |

### P2：上线后迭代

| # | 问题 | 说明 | 工作量 |
|---|------|------|--------|
| 12 | **版本发布表 + 接口** | Web/扩展/打印代理统一版本检查 | 2h |
| 13 | **Chrome 扩展 OTA** | 优先 Chrome Web Store；企业用户走策略安装 | 2h |
| 14 | **打印代理 electron-updater** | GitHub Releases + OSS 托管 | 2h |
| 15 | **大文件拆分** | collect.ts 1585 行 / order.ts 1344 行 → routes + services 分层 | 8h |
| 16 | **测试基线** | auth + crypto + image-storage 先写 vitest 覆盖关键路径 | 4h |
| 17 | **OpenTelemetry** | BullMQ + Fastify trace 串联，排查 OZON 同步卡顿 | 4h |

### P3：长期优化

| # | 问题 | 说明 |
|---|------|------|
| 18 | ICP 备案决策 | 服务器在中国内地 → 必须备案；纯境外 + CF → 可绕 |
| 19 | 前端版本提醒 | setInterval 轮询 /api/version，提示用户刷新 |
| 20 | 关键表分区/归档 | orders/balance_logs/notifications 按月归档 |

---

## 三、P0 修复方案（可立即动手）

### 3.1 Worker Redis 统一连接

所有 worker 的 `connection` 改为从 REDIS_URL 解析：

```typescript
// apps/server/src/lib/bullmq-connection.ts

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const parsed = new URL(url);

export const connection = {
  host: parsed.hostname || '127.0.0.1',
  port: Number(parsed.port) || 6379,
  password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
  db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
  maxRetriesPerRequest: null,
};
```

涉及文件（6 个 worker 全部替换）：
- `workers/product-sync.ts`
- `workers/order-sync.ts`
- `workers/finance-sync.ts`
- `workers/solo-billing.ts`
- `workers/scheduled-dispatch.ts`
- `workers/exchange-rate-sync.ts`

### 3.2 Prisma Baseline Migration

```bash
# 1. 基于当前 schema 生成完整 baseline SQL
npx prisma migrate diff --from-empty --to-schema-datamodel apps/server/prisma/schema.prisma --script > apps/server/prisma/migrations/20260529000000_baseline/migration.sql

# 2. 生产首次部署标记为已应用
npx prisma migrate resolve --applied 20260529000000_baseline

# 3. 此后严格走 migrate dev / migrate deploy，禁用 db push
```

### 3.3 SMS 网关接入（腾讯云短信）

已完成：
- `SMS_PROVIDER` 工厂读取 `tencent | console`，腾讯云 provider 可真实发送
- captcha.ts 的 `sendSmsCode` 调用 provider.send()
- 开发环境 fallback 到 console.log

待完成：
- 新增发送验证码 API（例如 `/api/auth/sms-code`）
- 注册 schema / 路由加入 `smsCode` 并调用 `verifySmsCode(phone, smsCode)`
- 注册页加入发送验证码按钮和验证码输入框

---

## 四、P1 关键设计要点

### 4.1 Token 迁移 HttpOnly Cookie

| 端 | 方案 |
|----|------|
| Web（浏览器） | 登录后 Set-Cookie: sserp_token=xxx; HttpOnly; Secure; SameSite=Lax; Path=/ |
| Chrome 扩展 | 保持 Bearer token（扩展 content script 无法读 HttpOnly cookie） |
| 打印代理 | 保持 Bearer token（Electron 非浏览器环境） |

后端改动：
- auth.ts login/register 成功后 `setAuthCookie()` 写入 `sserp_token`
- authenticate 中间件优先读 cookie，fallback 读 Authorization header
- logout 清 cookie

前端改动：
- apiFetch 去掉手动 Authorization header（cookie 自动带）
- tokenStore 仅保留给扩展/代理用的 fallback

### 4.2 Cloudflare 真源保护

```nginx
# /etc/nginx/conf.d/cloudflare-only.conf
# 只允许 Cloudflare IP 访问（定期更新）
# https://www.cloudflare.com/ips-v4 + ips-v6

geo $is_cloudflare {
  default 0;
  173.245.48.0/20 1;
  103.21.244.0/22 1;
  103.22.200.0/22 1;
  # ... 完整列表
  2400:cb00::/32 1;
  2606:4700::/32 1;
}

server {
  # 非 CF IP 直接 444 断开
  if ($is_cloudflare = 0) { return 444; }
}
```

配合：后端读 `CF-Connecting-IP` 作为真实客户端 IP（rate-limit 的 keyGenerator）。

### 4.3 OSS 直传

```
前端 → POST /api/images/presign → 后端签发预签名 PUT URL（5min 有效）
前端 → PUT 直传 OSS（不经后端）
前端 → 使用返回的 finalUrl 展示/保存到业务数据
```

好处：后端不再承受 30MB body，可水平扩展。

---

## 五、服务器选型建议（维持原方案）

| 组件 | 推荐 | 月成本 |
|------|------|--------|
| 应用服务器 | 阿里云 4C8G ECS + 100GB SSD | ¥200-300 |
| PostgreSQL | 云 RDS PG 2C4G（自带 PITR） | ¥250-400 |
| Redis | 云 Redis 1GB 主从 | ¥80-150 |
| 对象存储 | 阿里云 OSS 标准 | 按量 ¥0.12/GB |
| CDN | Cloudflare 免费版（WAF + Turnstile） | ¥0 |
| SSL | Let's Encrypt / CF 自动 | ¥0 |
| 域名 | .com 国际域名 | ¥60/年 |

**总计约 ¥600-900/月**（1-50 用户阶段）

---

## 六、ICP 备案决策树

```
服务器在中国内地？
  ├─ 是 → 必须 ICP 备案（无论 .com 还是 .cn）
  └─ 否（纯境外 ECS / CF 回源境外）
       ├─ 用户主要在国内？→ 延迟高，建议备案 + 国内 ECS
       └─ 用户是跨境卖家，本身用代理？→ 可暂不备案，走 CF + 境外 ECS
```

当前建议：先用境外 ECS + Cloudflare 快速上线，用户量起来后再迁国内 + 备案。

---

## 七、执行顺序建议

```
第 1 天  ─ P0 全部修完（Worker Redis / Prisma baseline / SMS 网关选型）
第 2 天  ─ Token 迁移 HttpOnly Cookie + Sentry 接入
第 3 天  ─ OSS 直传 + 备份脚本 + CF 真源保护
第 4 天  ─ 蓝绿部署脚本 + 全流程冒烟测试
第 5 天  ─ 上线 🚀
```

---

## 八、Codex 补充点落地状态

| Codex 建议 | 状态 | 备注 |
|------------|------|------|
| Git/分支规范 | ✅ 已建仓 + 分支策略 | docs/git-workflow.md |
| 区分本地/云端双模式 | ✅ bootstrap-config.ts | config.json 便携包模式 |
| Worker Redis 硬编码 | ✅ 已修 | P0 #1，lib/bullmq-connection.ts |
| Cloudflare 真源保护 | 📋 待运维配置 | P1 #5，Nginx geo + CF-Connecting-IP |
| Turnstile ≠ 短信 | ⚠️ 后端基础已分开 | 前端 Turnstile + 注册短信闭环待接入 |
| Chrome 扩展 OTA 限制 | 📋 已知 | P2 走 Web Store |
| ICP 判断 | 📋 决策树已列 | 第六节 |
| Web token → HttpOnly | ✅ 已修 | P1 #4，sserp_token cookie |
| Prisma baseline 校准 | ✅ 已修 | P0 #2，20260529000000_baseline |
| 版本发布表 | ❌ 未修 | P2 #12 |
