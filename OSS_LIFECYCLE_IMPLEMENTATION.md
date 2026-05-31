# OSS 对象生命周期管理 - 实现文档

## 概述

本次开发完成了 OSS/R2 对象存储的生命周期管理功能，包括：
1. 规范化对象存储路径
2. 超管后台配置界面
3. 自动清理 Worker

---

## 一、对象路径规范化

### 新路径结构

```
R2 / OSS 对象路径（规范化后）：
├── users/{userId}/
│   ├── raw/yyyy/mm/hash.ext           ← 原始采集图（默认保留 15 天）
│   ├── watermarked/yyyy/mm/hash.ext   ← 水印图（默认保留 60 天）
│   └── tmp/yyyy/mm/hash.ext           ← 失败/临时图（默认保留 7 天）
├── announcements/yyyy/mm/hash.ext     ← 公告附件（默认永久保留）
└── system/
    └── attachments/yyyy/mm/hash.ext   ← 系统附件（默认永久保留）
```

### 改动文件

**后端**：
- `apps/server/src/services/image-storage.ts`
  - 修改 `generateObjectKey()` 函数，支持 6 种分类：`raw`、`watermarked`、`thumbnail`、`tmp`、`announcement`、`system`
  - 修改 `ImageStorageBackend` 接口，`uploadBuffer()` 增加 `options` 参数
  - 修改 `OssBackend`、`OzonCdnBackend`、`LocalBackend`、`FallbackStorageBackend` 实现

- `apps/server/src/routes/image-upload.ts`
  - `/upload-base64`：传递 `{ category: 'raw', ownerId: userId }`
  - `/upload-attachment`：传递 `{ category: 'announcement' }`
  - `/upload-from-url`：传递 `{ category: 'raw', ownerId: userId }`
  - `/upload-watermarked`：传递 `{ category: 'watermarked', ownerId: userId }`
  - `/batch-resize`：上传到 OSS/R2 时传递 `{ category: 'tmp', ownerId: userId }`

- `apps/server/src/services/ozon-image-resolver.ts`
  - 发布到 OZON 前会把本地 `/watermarked/` 路径上传为 `watermarked` 分类
  - `/uploads/` 兼容历史路径，上传为 `raw` 分类

- `apps/server/src/routes/collect.ts`、`apps/server/src/routes/product.ts`
  - 调用图片上传/解析时传递当前 `userId`，确保对象写入 `users/{userId}/...`

---

## 二、超管后台配置

### 新增配置项

在 `apps/server/src/config/system-config-schema.ts` 中新增：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `retention_oss_raw_days` | number | 15 | 原始采集图保留天数 |
| `retention_oss_watermarked_days` | number | 60 | 水印图保留天数 |
| `retention_oss_tmp_days` | number | 7 | 临时图保留天数 |
| `retention_oss_attachments_days` | number | 0 | 公告附件保留天数（0=永久） |
| `retention_oss_cleanup_enabled` | boolean | false | OSS 清理总开关 |
| `retention_oss_cleanup_dry_run` | boolean | true | dry-run 模式（只统计不删除） |

### 前端界面

前端页面 `apps/web/src/app/(dashboard)/admin/settings/page.tsx` 已自动支持新配置项（通过动态渲染 `retention` 分组）。

超管访问路径：`/admin/settings` → "数据保留" 分组

---

## 三、OSS 清理 Worker

### 实现文件

- `apps/server/src/workers/oss-cleanup.ts`
  - 每天运行一次（首次延迟 30 分钟启动）
  - 读取 SystemConfig 配置
  - 按 prefix 扫描 OSS 对象，按分类筛选过期对象
  - 支持 dry-run 模式（只统计不删除）

- `apps/server/src/worker.ts`
  - 注册 `startOssCleanupWorker()`

- `apps/server/src/index.ts`
  - 在 `RUN_WORKERS` 非 0 的开发/单进程模式下也注册 `startOssCleanupWorker()`

### 清理逻辑

1. **用户图片**（一次扫描 `users/` 前缀，按子路径分类）：
   - `users/{userId}/raw/` → 保留 `retention_oss_raw_days` 天
   - `users/{userId}/watermarked/` → 保留 `retention_oss_watermarked_days` 天
   - `users/{userId}/tmp/` → 保留 `retention_oss_tmp_days` 天

2. **公告附件**（扫描 `announcements/` 前缀）：
   - 如果 `retention_oss_attachments_days > 0`，则清理过期附件
   - 默认 `0` 表示永久保留

3. **系统附件**（扫描 `system/attachments/` 前缀）：
   - 当前未配置清理策略，默认永久保留

### 日志输出

```
[oss-cleanup] 开始清理 OSS 对象...
[oss-cleanup] raw_images=123
[oss-cleanup] watermarked_images=45
[oss-cleanup] tmp_images=67
[oss-cleanup] 清理完成
```

Dry-run 模式：
```
[oss-cleanup][dry-run] 开始清理 OSS 对象...
[oss-cleanup][dry-run] 将删除 123 个对象（users/）
[oss-cleanup][dry-run] raw_images=123
[oss-cleanup][dry-run] 清理完成
```

---

## 四、测试验证

### 后端测试

```bash
cd apps/server
pnpm typecheck  # ✅ 通过
pnpm test       # ✅ 39 个测试全部通过
```

### 手动测试步骤

#### 1. 初始化配置

1. 启动后端：`pnpm dev`
2. 访问超管后台：`/admin/settings`
3. 点击"初始化默认配置"
4. 确认 `retention` 分组中出现 6 个新配置项

#### 2. 测试路径规范化

1. 上传图片（`/api/image/upload-base64`）
2. 检查 R2 对象路径：应为 `users/{userId}/raw/yyyy/mm/hash.jpg`
3. 上传公告附件（`/api/image/upload-attachment`）
4. 检查 R2 对象路径：应为 `announcements/yyyy/mm/hash.pdf`

#### 3. 测试 Worker（Dry-run）

1. 修改配置：
   - `retention_oss_cleanup_enabled = true`
   - `retention_oss_cleanup_dry_run = true`
   - `retention_oss_raw_days = 1`（测试用，设置为 1 天）
2. 启动 Worker：`pnpm worker`
3. 等待 30 分钟（或修改代码缩短延迟）
4. 查看日志：应输出 `[oss-cleanup][dry-run] 将删除 X 个对象`
5. 检查 R2：对象未被删除（dry-run 模式）

#### 4. 测试 Worker（真实删除）

⚠️ **警告**：仅在测试环境执行！

1. 修改配置：
   - `retention_oss_cleanup_dry_run = false`
2. 重启 Worker
3. 等待执行
4. 查看日志：应输出 `[oss-cleanup] 已删除 X 个对象`
5. 检查 R2：过期对象已被删除

---

## 五、部署建议

### 阶段 1：路径规范化（立即部署）

- ✅ 新上传的图片会使用规范化路径
- ✅ 旧图片路径不受影响（兼容）
- ✅ 无风险

### 阶段 2：Dry-run 测试（1 周）

1. 生产环境启用配置：
   ```
   retention_oss_cleanup_enabled = true
   retention_oss_cleanup_dry_run = true
   retention_oss_raw_days = 15
   retention_oss_watermarked_days = 60
   retention_oss_tmp_days = 7
   ```

2. 观察日志 1 周，确认：
   - 统计数量合理
   - 无误删公告附件
   - 无误删正在使用的图片

### 阶段 3：真实清理（谨慎）

1. 关闭 dry-run：
   ```
   retention_oss_cleanup_dry_run = false
   ```

2. 持续监控：
   - 每天检查日志
   - 监控用户反馈（是否有图片丢失）
   - 监控 R2 存储用量变化

### 阶段 4：Cloudflare R2 生命周期规则（可选）

等路径规范化稳定后，可以在 Cloudflare R2 控制台配置生命周期规则：

```
规则：公告附件（如需要自动过期）
- Prefix: announcements/
- 操作: N 天后删除
```

⚠️ **注意**：Cloudflare R2 生命周期规则支持按对象前缀匹配，但当前用户图片路径是
`users/{userId}/{category}/...`，无法用一条规则表达 `users/*/raw/` 这种中间层通配符。
除非未来把路径改成 `raw/users/{userId}/...`，否则用户图片建议优先使用我们自己的 Worker 清理。

---

## 六、风险与缓解

### 风险 1：误删公告附件

**原因**：路径分类不彻底，公告附件仍在 `raw/`

**缓解**：
- ✅ 已修改上传逻辑，公告附件存储到 `announcements/`
- ✅ 默认 `retention_oss_attachments_days = 0`（永久保留）
- ✅ Dry-run 模式先运行 1 周

### 风险 2：删除正在使用的图片

**原因**：商品刚上架，图片还在 R2，但已被 OZON 引用

**缓解**：
- ✅ 保留期设置足够长（raw 15 天，watermarked 60 天）
- ✅ 商品上架成功后，数据库只保留 OZON CDN URL（不依赖 R2）

### 风险 3：R2 API 限流

**原因**：批量删除对象时触发 R2 API 限流

**缓解**：
- ✅ 每次最多删除 1000 个对象（S3 API 限制）
- ✅ 分页扫描，避免一次性加载所有对象
- ⚠️ 如果触发限流，可以增加延迟（当前未实现）

---

## 七、后续优化

### 优化 1：按用户 ID 分批扫描

当前实现：一次扫描整个 `users/` 前缀

优化方案：
1. 从数据库查询所有用户 ID
2. 按用户 ID 分批扫描：`users/{userId}/`
3. 避免一次性加载大量对象

### 优化 2：增量清理

当前实现：每天全量扫描

优化方案：
1. 记录上次清理时间
2. 只扫描 `LastModified` 在上次清理后的对象
3. 减少 API 调用次数

### 优化 3：清理统计报表

当前实现：只输出日志

优化方案：
1. 将清理统计写入数据库
2. 超管后台展示清理历史
3. 图表展示存储用量变化

---

## 八、改动清单（供 Codex 提交）

### 后端改动

```
M apps/server/src/config/system-config-schema.ts
M apps/server/src/index.ts
M apps/server/src/routes/collect.ts
M apps/server/src/routes/product.ts
M apps/server/src/services/image-storage.ts
M apps/server/src/services/ozon-image-resolver.ts
M apps/server/src/routes/image-upload.ts
M apps/server/src/worker.ts
A apps/server/src/workers/oss-cleanup.ts
```

### Commit 建议

```
feat(oss): implement object lifecycle management

- Normalize OSS object paths:
  - User images: users/{userId}/{raw|watermarked|tmp}/yyyy/mm/
  - Announcements: announcements/yyyy/mm/
  - System attachments: system/attachments/yyyy/mm/

- Add SystemConfig for OSS retention policies:
  - retention_oss_raw_days (default 15)
  - retention_oss_watermarked_days (default 60)
  - retention_oss_tmp_days (default 7)
  - retention_oss_attachments_days (default 0, permanent)
  - retention_oss_cleanup_enabled (default false)
  - retention_oss_cleanup_dry_run (default true)

- Add OSS cleanup worker:
  - Runs daily (30min delay on startup)
  - Scans users/ prefix once, deletes by category
  - Supports dry-run mode (log only, no deletion)
  - Respects retention policies per category

Why: Current OSS objects are mixed in raw/ directory, cannot set
different retention policies. This change enables automatic cleanup
of expired objects while preserving announcements and system files.

Breaking: None (backward compatible, new uploads use new paths)
```

---

## 九、相关文档

- [Cloudflare R2 生命周期规则](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [AWS S3 DeleteObjects API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html)
- [项目架构对比文档](./memory/project_architecture-comparison.md)
- [图片存储架构文档](./memory/project_image-storage-architecture.md)

---

## 十、FAQ

### Q1: 为什么不直接用 Cloudflare R2 生命周期规则？

A: R2 生命周期规则支持按 prefix 匹配，但不支持 `users/*/raw/` 这种中间通配符。当前路径把 userId 放在 category 前面，因此不同用户的 raw/watermarked/tmp 无法用少量 R2 规则分别控制。我们的 Worker 会解析对象 key，按分类精确清理。

### Q2: 如果误删了图片怎么办？

A: 
1. 短期：R2 可能有回收站功能（需确认）
2. 长期：定期备份 R2 到其他存储（如 S3）
3. 预防：先 dry-run 1 周，确认无误后再真删

### Q3: 清理 Worker 会影响性能吗？

A: 不会。Worker 每天只运行一次，且首次延迟 30 分钟启动（避免启动时负载过高）。扫描和删除都是异步的，不影响 API 响应。

### Q4: 如何查看清理历史？

A: 当前只有日志输出。后续可以优化为写入数据库，超管后台展示清理历史。

### Q5: 如何手动触发清理？

A: 当前只能等待定时任务。后续可以在超管后台增加"立即清理"按钮。

---

**实现完成时间**：2026-05-31  
**实现人员**：Claude (Opus 4.7)  
**验收人员**：待 Codex 验收
