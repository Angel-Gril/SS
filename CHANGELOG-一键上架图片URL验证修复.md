# 一键上架图片 URL 验证错误修复

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

**错误原因**：传给 OZON API 的 `images[1]`（第二张图片）URL 无效。

---

## 根因分析

### 原代码逻辑（`collect.ts:287-311`）

```typescript
async function resolveImageUrls(images: string[]): Promise<string[]> {
  const resolved: string[] = [];
  let backend: Awaited<ReturnType<typeof getStorageBackend>> | null = null;
  for (const img of images) {
    if (img.startsWith('/watermarked/') || img.startsWith('/uploads/')) {
      if (!backend) {
        try { backend = await getStorageBackend(body.shopId); } catch { resolved.push(img); continue; }
      }
      try {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
        const buf = await readFile(localPath);
        const filename = img.split('/').pop() || 'img.jpg';
        const result = await backend.uploadBuffer(buf, filename);
        resolved.push(result.url);
      } catch {
        resolved.push(img);  // ❌ 问题：上传失败时返回本地路径
      }
    } else {
      resolved.push(img);  // ❌ 问题：不验证 URL 有效性
    }
  }
  return resolved;
}
```

### 问题点

1. **上传失败时返回本地路径**：
   - 水印图片上传到存储后端失败时，`catch` 块直接 `resolved.push(img)`
   - 返回的是 `/watermarked/xxx.jpg`（本地路径），OZON API 无法访问
   - OZON API 报错：`invalid URL`

2. **不验证 URL 有效性**：
   - 对于非本地路径的图片，直接 `resolved.push(img)`
   - 没有验证是否是有效的 HTTP/HTTPS URL
   - 可能传入空字符串、相对路径等无效值

3. **存储后端获取失败时返回本地路径**：
   - `getStorageBackend` 失败时，`catch` 块 `resolved.push(img)`
   - 同样返回本地路径

---

## 修复方案

### 新逻辑

```typescript
async function resolveImageUrls(images: string[]): Promise<string[]> {
  const resolved: string[] = [];
  let backend: Awaited<ReturnType<typeof getStorageBackend>> | null = null;
  for (const img of images) {
    // 1. 跳过空值和无效值
    if (!img || typeof img !== 'string' || img.trim() === '') {
      console.warn(`[resolveImageUrls] skipping invalid image: ${JSON.stringify(img)}`);
      continue;
    }

    if (img.startsWith('/watermarked/') || img.startsWith('/uploads/')) {
      // 2. 本地路径：上传到存储后端
      if (!backend) {
        try {
          backend = await getStorageBackend(body.shopId);
        } catch (e: any) {
          console.error(`[resolveImageUrls] failed to get storage backend: ${e.message}`);
          continue;  // ✅ 跳过而不是返回本地路径
        }
      }
      try {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
        const buf = await readFile(localPath);
        const filename = img.split('/').pop() || 'img.jpg';
        const result = await backend.uploadBuffer(buf, filename);
        resolved.push(result.url);
        console.log(`[resolveImageUrls] uploaded ${img} → ${result.url}`);
      } catch (e: any) {
        console.error(`[resolveImageUrls] failed to upload ${img}: ${e.message}`);
        continue;  // ✅ 跳过而不是返回本地路径
      }
    } else {
      // 3. 外部 URL：验证是否为有效 HTTP/HTTPS URL
      if (img.startsWith('http://') || img.startsWith('https://')) {
        resolved.push(img);
      } else {
        console.warn(`[resolveImageUrls] skipping non-HTTP URL: ${img}`);
        continue;  // ✅ 跳过无效 URL
      }
    }
  }
  return resolved;
}
```

### 修复要点

1. **跳过空值和无效值**：
   - 检查 `!img || typeof img !== 'string' || img.trim() === ''`
   - 记录警告日志

2. **上传失败时跳过而不是返回本地路径**：
   - `catch` 块改为 `continue`
   - 记录错误日志

3. **验证外部 URL 有效性**：
   - 只接受 `http://` 或 `https://` 开头的 URL
   - 其他格式跳过并记录警告

4. **增强日志**：
   - 上传成功：记录 `uploaded /watermarked/xxx.jpg → https://...`
   - 上传失败：记录错误原因
   - 跳过无效 URL：记录警告

---

## 测试验证

### 测试场景

| 场景 | 输入 | 修复前 | 修复后 |
|------|------|--------|--------|
| 水印图片上传成功 | `/watermarked/xxx.jpg` | `https://cdn.com/xxx.jpg` ✓ | `https://cdn.com/xxx.jpg` ✓ |
| 水印图片上传失败 | `/watermarked/xxx.jpg` | `/watermarked/xxx.jpg` ❌ | 跳过（不传给 OZON）✓ |
| 存储后端获取失败 | `/watermarked/xxx.jpg` | `/watermarked/xxx.jpg` ❌ | 跳过（不传给 OZON）✓ |
| 有效外部 URL | `https://cdn.ozon.ru/xxx.jpg` | `https://cdn.ozon.ru/xxx.jpg` ✓ | `https://cdn.ozon.ru/xxx.jpg` ✓ |
| 无效 URL（相对路径） | `images/xxx.jpg` | `images/xxx.jpg` ❌ | 跳过（不传给 OZON）✓ |
| 空字符串 | `""` | `""` ❌ | 跳过（不传给 OZON）✓ |

### 预期结果

- ✅ OZON API 不再收到无效 URL
- ✅ 上传失败的图片被跳过，不影响其他图片
- ✅ 日志清晰记录每张图片的处理结果

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
   [resolveImageUrls] uploaded /watermarked/xxx.jpg → https://cdn.com/xxx.jpg
   [resolveImageUrls] failed to upload /watermarked/yyy.jpg: ENOENT: no such file
   [resolveImageUrls] skipping non-HTTP URL: images/zzz.jpg
   ```

---

## 后续优化建议

1. **前端提示**：
   - 当部分图片上传失败时，前端应提示用户"部分图片上传失败，已跳过"
   - 显示成功上传的图片数量

2. **重试机制**：
   - 对于上传失败的图片，可以增加重试逻辑（最多 3 次）

3. **存储后端健康检查**：
   - 在一键上架前，先检查存储后端是否可用
   - 如果不可用，提前提示用户

4. **图片预处理**：
   - 在采集时就验证图片 URL 有效性
   - 避免将无效 URL 存入数据库

---

## 相关文件

- ✅ `apps/server/src/routes/collect.ts` - 修复 `resolveImageUrls` 函数

---

## 总结

**问题**：水印图片上传失败时，返回本地路径给 OZON API，导致 `invalid URL` 错误

**修复**：上传失败时跳过该图片，只传有效的 HTTP/HTTPS URL 给 OZON API

**影响**：修复后，即使部分图片上传失败，其他图片仍能正常上架
