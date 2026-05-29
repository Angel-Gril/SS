# 上线前检查清单

## Critical（必须完成，否则拒绝启动）

- [ ] **ENCRYPTION_KEY 已配置**（≥32 字符，非默认值）
  - 验证：启动时检查日志无 `[crypto] ENCRYPTION_KEY 未配置` 警告

- [ ] **JWT_SECRET 已配置**（≥32 字符，非默认值）
  - 验证：启动时检查日志无 `[auth] JWT_SECRET 未配置` 警告

- [ ] **DATABASE_URL 正确**
  - 验证：`curl http://localhost:3001/health` 返回 `{"status":"ok"}`

- [ ] **Prisma baseline migration 已执行**
  - 验证：`npx prisma migrate status` 无 pending migrations

- [ ] **NODE_ENV=production**
  - 验证：`echo $NODE_ENV` 或检查 `.env`

- [ ] **AUTH_COOKIE_SECURE 正确**
  - 正式 HTTPS：设为 `true` 或留空
  - 仅 HTTP staging 临时测试：可设为 `false`，上线前必须恢复

- [ ] **SETUP_TOKEN 已配置**
  - 验证：`.env` 中存在高强度随机 `SETUP_TOKEN`
  - 验证：首次打开 `/setup` 创建超级管理员时必须填写初始化令牌
  - 验证：创建首个 ADMIN 后，`/api/setup/status` 返回 `needsSetup: false`

## High（强烈推荐）

- [ ] **CORS_ORIGIN 配置生产域名**
  - 验证：从非白名单域名访问 API 返回 CORS 错误

- [ ] **Turnstile 前后端闭环已接入**（防机器人注册）
  - 验证：注册页显示 Cloudflare 验证框，并且 `/api/auth/sms-code` 请求携带 `turnstileToken`
  - 验证：连续登录失败 5 次后，登录页显示 Cloudflare 验证框

- [ ] **Redis 已启动**（启用同步 worker）
  - 验证：`redis-cli ping` 返回 `PONG`
  - 验证：日志无 `REDIS_DISABLED=1, skipping BullMQ workers`

- [ ] **Nginx 反向代理已配置**
  - 验证：`curl https://app.yourdomain.com/health` 返回 200

- [ ] **SSL 证书已安装**
  - 验证：浏览器访问无证书警告

- [ ] **静态文件路径安全**
  - 验证：访问 `/uploads/../../../etc/passwd` 返回 400

## Medium（推荐配置）

- [ ] **OSS 对象存储已配置**（超管 UI `/admin/settings`）
  - 验证：`image_storage_backend` 设为 `oss`，`oss_config` JSON 完整
  - 验证：OSS bucket CORS 已配置允许前端域名 PUT
  - 验证：上传图片后 URL 可公开访问

- [ ] **短信验证码闭环已接入**
  - 验证：`.env` 中 `SMS_PROVIDER=tencent` 且 `SMS_TENCENT_*` 全部填写
  - 验证：`/api/auth/sms-code` 发送验证码，注册表单提交 `smsCode`，服务端调用 `verifySmsCode`
  - 验证：注册时手机收到验证码（非 console.log），错误验证码无法注册

- [ ] **Sentry 已接入**
  - 验证：`.env` 中 `SENTRY_DSN` 和 `NEXT_PUBLIC_SENTRY_DSN` 已填写
  - 验证：启动日志包含 `[sentry] initialized`
  - 验证：手动触发 500 错误后 Sentry dashboard 有事件

- [ ] **日志级别设置为 info**
  - 验证：`.env` 中 `LOG_LEVEL=info`

- [ ] **数据库备份脚本已配置**
  - 验证：`crontab -l` 包含备份任务

- [ ] **防火墙规则已配置**
  - 验证：`sudo ufw status` 仅开放 22/80/443

## Low（可选优化）

- [ ] **通知清理 worker 已启动**
  - 验证：日志包含 `[NotificationCleanup] started`

- [ ] **监控告警已配置**（Prometheus/Grafana/云监控）

- [ ] **CDN 已配置**（加速静态资源）

- [ ] **代理已配置**（访问 OZON API 需要时）
  - 验证：`.env` 中 `HTTPS_PROXY` 已填写

---

## 功能验证清单

### 用户认证
- [ ] 首个超级管理员通过 `/setup` 创建，而不是通过公开注册创建
- [ ] 注册新账号（触发 Turnstile + 短信验证码，并完成服务端校验）
- [ ] 登录成功（浏览器 DevTools → Application → Cookies 可见 `sserp_token` HttpOnly cookie）
- [ ] 登录失败 5 次后强制 Turnstile
- [ ] 退出登录（cookie 被清除）

### 店铺管理
- [ ] 添加 OZON 店铺（Client ID + API Key）
- [ ] 店铺凭证加密存储（数据库中 `apiKeyEncrypted` 非明文）

### 商品采集
- [ ] 通过扩展采集 OZON 商品
- [ ] 采集结果保存到 `supplyGoods` 表
- [ ] 图片正确显示（本地或 OSS）

### 商品上架
- [ ] 普通商品模式（继承源商品属性）
- [ ] 首通商品模式（手动填属性）
- [ ] 上架失败时显示完整错误信息
- [ ] 上架成功后任务 ID 正确记录

### 订单同步
- [ ] Redis 启动后 worker 自动运行
- [ ] 订单同步到 `Order` 表
- [ ] 财务数据同步到 `Finance` 表

### 图片处理
- [ ] 上传图片（base64 / URL）
- [ ] 水印添加
- [ ] 批量改尺寸

---

## 性能验证

- [ ] **API 响应时间** < 500ms（`/health`）
- [ ] **数据库连接池** < 20 个活跃连接
- [ ] **Redis 内存** < 1GB
- [ ] **磁盘空间** > 20% 剩余

---

## 安全验证

- [ ] **SQL 注入防护**：尝试 `' OR 1=1--` 登录失败
- [ ] **XSS 防护**：商品标题包含 `<script>` 被转义
- [ ] **CSRF 防护**：跨域请求被 CORS 拦截
- [ ] **路径遍历防护**：`/uploads/../../../etc/passwd` 返回 400
- [ ] **频率限制**：1 分钟内 200+ 请求被限流

---

## 回滚计划

如果上线后发现严重问题，按以下步骤回滚：

1. **停止新版本服务**
   ```bash
   docker-compose -f docker-compose.prod.yml down
   ```

2. **恢复数据库备份**（如果有 schema 变更）
   ```bash
   gunzip < /backup/ss-erp/ss_erp_YYYYMMDD.sql.gz | psql -U ss_erp_user ss_erp
   ```

3. **启动旧版本服务**
   ```bash
   git checkout <previous-tag>
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **验证服务恢复**
   ```bash
   curl https://app.yourdomain.com/health
   ```

---

## 上线后监控（首 24 小时）

- [ ] **每小时检查日志**：无 Critical 错误
- [ ] **监控 API 错误率**：< 1%
- [ ] **监控数据库慢查询**：无 > 1s 的查询
- [ ] **监控磁盘空间**：增长速度正常
- [ ] **用户反馈**：无严重 bug 报告

---

## 签字确认

- [ ] **开发负责人**：__________ 日期：__________
- [ ] **运维负责人**：__________ 日期：__________
- [ ] **产品负责人**：__________ 日期：__________
