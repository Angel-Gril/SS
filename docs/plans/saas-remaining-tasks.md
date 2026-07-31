# SS ERP 联网/SaaS 开发任务计划

> 基于 2026-05-30 审计结果，列出从"本地可用"到"公开 SaaS 上线"的全部剩余任务。
> 已完成项不再列出（见 LAUNCH-OPTIMIZATION-PLAN.md 第一节）。

---

## Phase A：上云冒烟（1-2 天）— 不需要新功能，只需要跑通

目标：staging 服务器能跑起来，管理员能登录、建店铺、同步一次订单。

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| A1 | 域名 + Cloudflare 配置 | DNS 指向 ECS，CF 代理开启，Turnstile site key 绑定 staging 域名 | 域名购买 |
| A2 | Nginx 部署 + SSL | 用 docker/nginx/ss-erp.conf，替换 server_name，CF origin cert | A1 |
| A3 | .env.staging 填入真实值 | DATABASE_URL、REDIS_URL、JWT_SECRET、ENCRYPTION_KEY、CORS_ORIGIN、SMS 密钥 | 服务器就绪 |
| A4 | 标准 bootstrap/deploy gate | 仅全新空库按 Runbook 执行一次 bootstrap；既有库由带备份恢复认证的标准部署入口迁移 | A3 |
| A5 | 首次 /setup 创建管理员 | 浏览器访问 staging 域名，用 SETUP_TOKEN 创建超管 | A4 |
| A6 | 冒烟测试 | 登录 → 添加店铺 → 触发一次产品同步 → 查看订单 → 图片上传 | A5 |

---

## Phase B：SaaS 核心缺失（3-5 天）— 不修不能对外开放

### B1. 自助密码重置（P0）

| 步骤 | 内容 |
|------|------|
| 后端 | `POST /api/auth/reset-password/sms-code` — 发送重置验证码 |
| 后端 | `POST /api/auth/reset-password` — 验证码 + 新密码 |
| 前端 | `/forgot-password` 页面（输入手机号 → 验证码 → 新密码） |
| 安全 | Turnstile 保护 + 5次/分钟 rate limit |

工作量：4h

### B2. 用户服务协议 + 隐私政策（P0）

| 步骤 | 内容 |
|------|------|
| 内容 | 起草《用户服务协议》《隐私政策》（可用模板） |
| 前端 | `/terms` 和 `/privacy` 静态页面 |
| 注册 | 注册表单加"已阅读并同意"勾选框，后端记录同意时间 |

工作量：3h（不含法务审核）

### B3. 落地页 / 产品介绍页（P0）

| 步骤 | 内容 |
|------|------|
| 设计 | 单页：功能亮点 + 截图 + 定价 + 注册入口 |
| 实现 | 可以是 Next.js 的 `/` 路由（未登录时展示），或独立子域名 |
| SEO | title/description/OG tags |

工作量：6h

### B4. 自助充值 / 支付接入（P0）

| 步骤 | 内容 |
|------|------|
| 选型 | 支付宝当面付 / 微信 Native 支付（跨境卖家群体最常用） |
| 后端 | `POST /api/account/create-payment` — 创建支付订单 |
| 后端 | `POST /api/webhooks/alipay` — 支付回调，到账后自动充值余额 |
| 前端 | `/account/recharge` 页面 — 输入金额 → 扫码支付 → 轮询状态 |
| 安全 | 回调签名验证 + 幂等处理 |

工作量：8-12h

### B5. 操作审计日志（P1）

| 步骤 | 内容 |
|------|------|
| Schema | `AuditLog` 表：userId, action, target, targetId, detail(JSON), ip, createdAt |
| 中间件 | Fastify onResponse hook 自动记录写操作（POST/PUT/PATCH/DELETE） |
| 管理端 | `/api/admin/audit-logs` 查询接口（按用户/时间/操作类型筛选） |

工作量：4h

### B6. 邮件系统基础（P1）

| 步骤 | 内容 |
|------|------|
| 选型 | Resend / 阿里云邮件推送 / 腾讯企业邮 |
| 实现 | `lib/email/` 抽象层（类似 sms/），provider 可切换 |
| 模板 | 密码重置、余额不足提醒、订单异常通知 |
| 配置 | `EMAIL_PROVIDER`、`EMAIL_FROM`、`EMAIL_API_KEY` |

工作量：4h

---

## Phase C：体验优化（3-5 天）— 降低流失率

### C1. 新用户引导向导

| 步骤 | 内容 |
|------|------|
| 前端 | 首次登录检测（无店铺时）→ 弹出引导 |
| 步骤 | 1. 添加 OZON 店铺 → 2. 首次同步 → 3. 查看订单 → 4. 配置仓库 |
| 后端 | `GET /api/user/onboarding-status` 返回完成进度 |

工作量：6h

### C2. 后台 Job 监控面板

| 步骤 | 内容 |
|------|------|
| 方案A | 接入 BullMQ Board（`@bull-board/fastify`），挂在 `/api/admin/queues` |
| 方案B | 自建简易面板：队列深度、失败数、最近错误 |
| 权限 | 仅 ADMIN 可访问 |

工作量：3h（方案A）/ 8h（方案B）

### C3. 移动端适配

| 步骤 | 内容 |
|------|------|
| 导航 | 侧边栏改为移动端抽屉 |
| 表格 | 订单/产品列表改为卡片视图 |
| 优先级 | 先做登录 + 订单查看 + 仪表盘 |

工作量：8-12h

### C4. 自助密码修改

| 步骤 | 内容 |
|------|------|
| 后端 | `POST /api/user/change-password`（需旧密码验证） |
| 前端 | 设置页 → 修改密码表单 |

工作量：2h

---

## Phase D：扩展云端适配（2-3 天）

### D1. 扩展 Cloud 模式

| 步骤 | 内容 |
|------|------|
| 扩展 | 读取 `/api/extension/runtime` 判断 local/cloud |
| Cloud 模式 | 不再用本地 cookie 上传图片，改为调 `/api/images/presign` 获取 OSS 直传 URL |
| Cloud 模式 | 采集/上架任务提交到服务端队列，不再本地直接调 OZON API |
| Local 模式 | 保持现有行为不变 |

工作量：8h

### D2. 扩展 Token 认证

| 步骤 | 内容 |
|------|------|
| 后端 | `POST /api/auth/extension-token` — 已有 30 天 token，后续可按需要调整为 90 天 |
| 扩展 | 设置页输入服务器地址 + token，存入 chrome.storage |
| 扩展 | 所有 API 请求带 `Authorization: Bearer <token>` |

工作量：4h

### D3. 本地版 Tag 固化

| 步骤 | 内容 |
|------|------|
| Git | `git tag v1.0.3-local-final` 标记当前本地打包版 |
| 文档 | 说明本地版不再接收功能更新，仅修安全漏洞 |

工作量：10min

---

## Phase E：运维 + 安全加固（持续）

| # | 任务 | 说明 | 优先级 |
|---|------|------|--------|
| E1 | CF 真源保护 | Nginx geo 限制 + CF-Connecting-IP | 上线前 |
| E2 | 蓝绿部署 | docker-compose blue/green 或 systemd 滚动 | 上线前 |
| E3 | 自动备份验证 | 每周自动恢复到测试库验证备份可用 | 上线后 |
| E4 | 监控告警 | Uptime 监控（/ready）+ 磁盘/内存告警 | 上线后 |
| E5 | 日志聚合 | journald → Loki/CloudWatch，保留 30 天 | 上线后 |
| E6 | 2FA（可选） | TOTP 二次验证，管理员强制开启 | 上线后 |

---

## 执行顺序建议

```
Day 1-2   Phase A（冒烟）— 服务器跑通，管理员能用
Day 3     B1 密码重置 + B2 协议页 + C4 密码修改
Day 4     B3 落地页 + C1 引导向导
Day 5-6   B4 支付接入
Day 7     B5 审计日志 + B6 邮件
Day 8-9   D1-D2 扩展云端适配
Day 10    C2 Job 监控 + E1-E2 运维加固
Day 11    全流程回归测试 → 上线 🚀
```

---

## 本地可以立即开发的（不需要服务器/域名/第三方密钥）

| 任务 | 原因 |
|------|------|
| B1 密码重置（后端 + 前端） | SMS mock 可测 |
| B2 协议页面 | 纯前端 |
| B5 审计日志 schema + 中间件 | 纯后端 |
| C1 引导向导前端 | 纯前端 |
| C4 密码修改 | 纯后端 + 前端 |
| D2 扩展 token 生成接口 | 纯后端 |
| D3 本地版 tag | git 操作 |

## 需要第三方密钥/服务器才能开发的

| 任务 | 依赖 |
|------|------|
| A1-A6 冒烟 | 域名 + 服务器 + CF |
| B4 支付 | 支付宝/微信商户号 |
| B6 邮件 | 邮件服务商 API key |
| D1 扩展云端 | staging 服务器运行中 |
| E1-E2 运维 | 服务器 |
