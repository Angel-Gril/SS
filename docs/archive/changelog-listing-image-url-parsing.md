# 一键上架图片 URL 解析错误修复

## 日期
2025-05-25

## 问题描述

用户在采集商品后点击"添加水印"然后"一键上架"时报错：

```
上架失败: OZON API error 400 on /v3/product/import: 
{"code":3, "message":"Request validation error: 
productImportValidations.Validate.Items[1].images[1]: 
rpc error: code = InvalidArgument 
desc = Request validation error: invalid URL"}
```

**错误原因**：传给 OZON API 的图片 URL 是 `http://localhost:3001/watermarked/xxx.jpg`（本地地址），OZON 无法访问。

---

## 根因分析

### 实际数据流

1. **采集商品**：`images` 存储 OZON CDN 原始图片 URL
   ```json
   ["https://cdn.ozon.ru/xxx.jpg", "https://cdn.ozon.ru/yyy.jpg"]
   ```

2. **添加水印**：`processItemWatermarks` 下载图片 → 添加水印 → 保存到本地 `public/watermarked/`
   ```typescript
   // watermark.ts:105
   return `/watermarked/${filename}`;
   ```

3. **存储到数据库**：`watermarkedImages` 存储完整 URL
   ```typescript
   // collect.ts:1185-1188
   const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
   const fullUrls = result.watermarkedImages.map((p) =>
     p.startsWith('http') ? p : `${baseUrl}${p}`
   );
   // 结果：["http://localhost:3001/watermarked/xxx.jpg", ...]
   ```

4. **一键上架**：`resolveImageUrls` 应该把本地路径上传到 OZON CDN
   ```typescript
   // collect.ts:534-537
   const rawImages: string[] = meta?.watermarkedImages?.length
     ? meta.watermarkedImages  // ["http://localhost:3001/watermarked/xxx.jpg"]
     : cloned?.images?.length ? cloned.images : (Array.isArray(item.images) ? (item.images as string[]) : []);
   const images = await resolveImageUrls(rawImages);
   ```

### 原代码问题（`collect.ts:287-311`）

```typescript
async function resolveImageUrls(images: string[]): Promise<string[]> {
  const resolved: string[] = [];
  let backend: Awaited<ReturnType<typeof getStorageBackend>> | null = null;
  for (const img of images) {
    if (img.startsWith('/watermarked/') || img.startsWith('/uploads/')) {
      // ✅ 处理相对路径：/watermarked/xxx.jpg
      // 上传到 OZON CDN
    } else {
      resolved.push(img);  // ❌ 问题：直接返回 http://localhost:3001/watermarked/xxx.jpg
    }
  }
  return resolved;
}
```

**问题**：
- `watermarkedImages` 存储的是 `http://localhost:3001/watermarked/xxx.jpg`（完整 URL）
- 不是以 `/watermarked/` 开头，走了 `else` 分支
- 直接 `resolved.push(img)`，把 `http://localhost:3001/...` 传给 OZON API
- OZON API 无法访问 localhost，报错 `invalid URL`

---

## 修复方案

### 新逻辑

```typescript
async function resolveImageUrls(images: string[]): Promise<string[]> {
  const resolved: string[] = [];
  let backend: Awaited<ReturnType<typeof getStorageBackend>> | null = null;
  for (const img of images) {
    // 1. 提取 localhost URL 的路径部分
    // http://localhost:3001/watermarked/xxx.jpg → /watermarked/xxx.jpg
    let imgPath = img;
    if (img.startsWith('http://localhost:') || img.startsWith('http://127.0.0.1:')) {
      try {
        const url = new URL(img);
        imgPath = url.pathname;  // /watermarked/xxx.jpg
      } catch {
        imgPath = img;
      }
    }

    // 2. 检查是否为本地路径
    if (imgPath.startsWith('/watermarked/') || imgPath.startsWith('/uploads/')) {
      if (!backend) {
        try { backend = await getStorageBackend(body.shopId); } catch { resolved.push(img); continue; }
      }
      try {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const localPath = join(process.cwd(), 'public', imgPath.replace(/^\//, ''));
        const buf = await readFile(localPath);
        const filename = imgPath.split('/').pop() || 'img.jpg';
        const result = await backend.uploadBuffer(buf, filename);
        resolved.push(result.url);  // ✅ 返回 OZON CDN URL
        console.log(`[resolveImageUrls] uploaded ${imgPath} → ${result.url}`);
      } catch (e: any) {
        console.error(`[resolveImageUrls] failed to upload ${imgPath}: ${e.message}`);
        resolved.push(img);  // 失败时返回原始 URL（兜底）
      }
    } else {
      resolved.push(img);  // 外部 URL 直接返回
    }
  }
  return resolved;
}
```

### 修复要点

1. **提取 localhost URL 的路径**：
   - `http://localhost:3001/watermarked/xxx.jpg` → `/watermarked/xxx.jpg`
   - 使用 `new URL(img).pathname` 提取路径

2. **检查路径而不是完整 URL**：
   - 检查 `imgPath.startsWith('/watermarked/')` 而不是 `img.startsWith('/watermarked/')`

3. **上传到 OZON CDN**：
   - 读取本地文件 `public/watermarked/xxx.jpg`
   - 调用 `backend.uploadBuffer()` 上传到 OZON CDN
   - 返回 OZON CDN 的公网 URL（如 `https://cdn.ozon.ru/multimedia/xxx.jpg`）

4. **增强日志**：
   - 上传成功：记录 `/watermarked/xxx.jpg → https://cdn.ozon.ru/...`
   - 上传失败：记录错误原因

---

## 测试验证

### 测试场景

| 输入 | 修复前 | 修复后 |
|------|--------|--------|
| `http://localhost:3001/watermarked/xxx.jpg` | 直接传给 OZON ❌ | 上传到 OZON CDN ✓ |
| `/watermarked/xxx.jpg` | 上传到 OZON CDN ✓ | 上传到 OZON CDN ✓ |
| `https://cdn.ozon.ru/xxx.jpg` | 直接传给 OZON ✓ | 直接传给 OZON ✓ |

### 预期结果

- ✅ 水印图片成功上传到 OZON CDN
- ✅ OZON API 收到的是公网可访问的 CDN URL
- ✅ 一键上架成功

---

## 部署步骤

1. **重启服务端**：
   ```bash
   cd apps/server
   pnpm run dev  # 或 pnpm run build && pnpm start
   ```

2. **测试流程**：
   - 采集一个商品（SKU 3579560336）
   - 点击"添加水印"
   - 点击"一键上架"
   - 验证是否成功上架

3. **检查日志**：
   ```bash
   # 查看服务端日志
   tail -f apps/server/logs/app.log
   
   # 应该看到类似日志：
   [resolveImageUrls] uploaded /watermarked/xxx.jpg → https://cdn.ozon.ru/multimedia/xxx.jpg
   ```

---

## 相关配置

### 图片存储后端配置

在超管设置中配置 `image_storage_backend`：

| 后端类型 | 说明 | 配置要求 |
|---------|------|---------|
| `ozon-cdn` | 使用 OZON CDN 作为图床（推荐） | 需要店铺同步 OZON cookie 和 company_id |
| `oss` | 使用阿里云/腾讯云 OSS | 需要配置 OSS 凭证 |
| `local` | 本地静态服务（仅开发测试） | 需要配置 `local_base_url` |

### OZON CDN 配置

通过浏览器扩展同步 OZON 登录态：
1. 登录 OZON Seller 后台
2. 扩展自动同步 `ozonCdnCookie` 和 `ozonCompanyId` 到店铺配置
3. 服务端使用这些凭证上传图片到 OZON CDN

---

## 后续优化建议

1. **统一存储格式**：
   - `watermarkedImages` 统一存储相对路径（`/watermarked/xxx.jpg`）
   - 而不是完整 URL（`http://localhost:3001/watermarked/xxx.jpg`）
   - 避免 localhost 端口变化导致的问题

2. **上传失败重试**：
   - 对于上传失败的图片，增加重试逻辑（最多 3 次）

3. **前端提示**：
   - 显示图片上传进度（如"正在上传 2/5 张图片到 OZON CDN"）

---

## 相关文件

- ✅ `apps/server/src/routes/collect.ts` - 修复 `resolveImageUrls` 函数
- 📄 `apps/server/src/services/image-storage.ts` - OZON CDN 上传实现
- 📄 `apps/server/src/services/watermark.ts` - 水印处理逻辑

---

## 总结

**问题**：`watermarkedImages` 存储的是 `http://localhost:3001/watermarked/xxx.jpg`，`resolveImageUrls` 没有识别为本地路径，直接传给 OZON API 导致报错

**修复**：提取 localhost URL 的路径部分（`/watermarked/xxx.jpg`），然后上传到 OZON CDN

**影响**：修复后，水印图片会正确上传到 OZON CDN，一键上架成功
