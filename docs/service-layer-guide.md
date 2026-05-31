# Service 层架构指南

本文档介绍如何使用 Service 层分离业务逻辑和路由处理。

---

## 为什么需要 Service 层？

### 问题：Route 层过于臃肿

**现状**：
- `collect.ts` (72K) — 采集逻辑全在路由文件
- `product.ts` (39K) — 商品 CRUD + 业务逻辑混在一起
- `shop.ts` (34K) — 店铺管理 + 权限检查 + 数据库操作
- `order.ts` (30K) — 订单处理 + 统计 + 物流更新

**问题**：
- ❌ 路由文件过大，难以维护
- ❌ 业务逻辑和 HTTP 处理耦合
- ❌ 无法复用（Worker、Cron、CLI 无法调用）
- ❌ 难以测试（需要 mock Fastify request）
- ❌ 权限检查分散在各处

### 解决方案：三层架构

```
┌─────────────────────────────────────┐
│  Route 层 (routes/*.ts)             │
│  - HTTP 请求/响应处理                │
│  - 参数验证（Zod schema）            │
│  - 权限检查（authenticate）          │
│  - 调用 Service 层                   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Service 层 (services/*.service.ts) │
│  - 业务逻辑封装                      │
│  - 数据库操作                        │
│  - 权限检查（数据级）                │
│  - 可被 Route/Worker/Cron 复用      │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Data 层 (lib/prisma.ts)            │
│  - Prisma Client                    │
│  - 数据库连接                        │
└─────────────────────────────────────┘
```

---

## Service 层设计原则

### 1. 单一职责
每个 Service 文件负责一个领域模型：
- `shop.service.ts` — 店铺管理
- `order.service.ts` — 订单管理
- `product.service.ts` — 商品管理
- `user.service.ts` — 用户管理

### 2. 纯函数
Service 函数应该是纯函数（或接近纯函数）：
- 输入：参数
- 输出：返回值或抛出异常
- 无副作用：不依赖全局状态

### 3. 可测试
Service 函数易于单元测试：
```typescript
// ✅ 易于测试
const shop = await createShop({ userId: 'xxx', name: 'Test Shop', ... });
expect(shop.name).toBe('Test Shop');

// ❌ 难以测试（需要 mock Fastify request）
app.post('/shops', async (request, reply) => { ... });
```

### 4. 可复用
Service 函数可被多处调用：
- Route 层（HTTP 请求）
- Worker 层（后台任务）
- Cron 层（定时任务）
- CLI 层（命令行工具）

---

## 使用示例

### 示例 1：店铺管理

**Before（Route 层直接操作数据库）**：
```typescript
// routes/shop.ts (34K)
app.post('/shops', async (request, reply) => {
  const { name, platform, clientId, apiKey } = request.body;
  const userId = (request as any).user.userId;

  // 业务逻辑 + 数据库操作混在一起
  const shop = await prisma.shop.create({
    data: {
      userId,
      platform,
      name,
      clientId,
      apiKeyEncrypted: encrypt(apiKey),
      status: 'ACTIVE',
    },
  });

  return reply.send({ code: 1, data: shop });
});
```

**After（Route 层调用 Service 层）**：
```typescript
// routes/shop.ts (简化后)
import * as shopService from '../services/shop.service.js';

app.post('/shops', async (request, reply) => {
  const { name, platform, clientId, apiKey } = request.body;
  const userId = (request as any).user.userId;

  // 调用 Service 层
  const shop = await shopService.createShop({
    userId,
    platform,
    name,
    clientId,
    apiKeyEncrypted: encrypt(apiKey),
  });

  return reply.send({ code: 1, data: shop });
});

// services/shop.service.ts
export async function createShop(input: CreateShopInput): Promise<Shop> {
  return prisma.shop.create({
    data: {
      userId: input.userId,
      platform: input.platform as any,
      name: input.name,
      clientId: input.clientId,
      apiKeyEncrypted: input.apiKeyEncrypted,
      status: 'ACTIVE',
    },
  });
}
```

**优势**：
- Route 层只负责 HTTP 处理
- Service 层可被 Worker 复用（如定时同步店铺信息）
- Service 层易于测试

---

### 示例 2：订单列表（支持分页、筛选）

**Before（Route 层直接构建查询）**：
```typescript
// routes/order.ts (30K)
app.get('/orders', async (request, reply) => {
  const { shopId, status, keyword, page = 1, pageSize = 50 } = request.query;
  const userId = (request as any).user.userId;

  // 复杂的查询逻辑
  const where: any = { shop: { userId } };
  if (shopId) where.shopId = shopId;
  if (status) where.status = status;
  if (keyword) {
    where.OR = [
      { postingNumber: { contains: keyword } },
      { domesticTrackingNumber: { contains: keyword } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return reply.send({ code: 1, data: { orders, total, page, pageSize } });
});
```

**After（Route 层调用 Service 层）**：
```typescript
// routes/order.ts (简化后)
import * as orderService from '../services/order.service.js';

app.get('/orders', async (request, reply) => {
  const { shopId, status, keyword, page, pageSize } = request.query;
  const userId = (request as any).user.userId;

  // 调用 Service 层
  const result = await orderService.getOrders({
    userId,
    shopId,
    status,
    keyword,
    page: parseInt(page) || 1,
    pageSize: parseInt(pageSize) || 50,
  });

  return reply.send({ code: 1, data: result });
});

// services/order.service.ts
export async function getOrders(options: GetOrdersOptions): Promise<OrderListResult> {
  const { userId, shopId, status, keyword, page = 1, pageSize = 50 } = options;

  const where: Prisma.OrderWhereInput = {};
  if (userId) where.shop = { userId };
  if (shopId) where.shopId = shopId;
  if (status) where.status = status;
  if (keyword) {
    where.OR = [
      { postingNumber: { contains: keyword } },
      { domesticTrackingNumber: { contains: keyword } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, pageSize };
}
```

**优势**：
- Route 层只负责参数转换
- Service 层可被 Worker 复用（如导出订单报表）
- Service 层可被 CLI 复用（如批量查询订单）

---

### 示例 3：权限检查

**Before（权限检查分散在各处）**：
```typescript
// routes/order.ts
app.put('/orders/:id', async (request, reply) => {
  const { id } = request.params;
  const userId = (request as any).user.userId;

  // 权限检查
  const order = await prisma.order.findFirst({
    where: { id, shop: { userId } },
  });
  if (!order) {
    return reply.status(404).send({ code: 0, msg: '订单不存在或无权限' });
  }

  // 更新逻辑
  await prisma.order.update({ where: { id }, data: { ... } });
  return reply.send({ code: 1 });
});
```

**After（权限检查在 Service 层）**：
```typescript
// routes/order.ts
app.put('/orders/:id', async (request, reply) => {
  const { id } = request.params;
  const userId = (request as any).user.userId;

  // 调用 Service 层（内置权限检查）
  const hasAccess = await orderService.checkOrderOwnership(id, userId);
  if (!hasAccess) {
    return reply.status(404).send({ code: 0, msg: '订单不存在或无权限' });
  }

  await orderService.updateOrderTracking(id, { ... });
  return reply.send({ code: 1 });
});

// services/order.service.ts
export async function checkOrderOwnership(orderId: string, userId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shop: { userId } },
  });
  return !!order;
}
```

---

## 迁移指南

### 步骤 1：识别可迁移的逻辑

查找以下模式：
- 直接调用 `prisma.*`
- 复杂的查询构建（多个 `where` 条件）
- 业务逻辑（计算、转换、验证）
- 权限检查（`shop: { userId }`）

### 步骤 2：创建 Service 文件

```bash
# 创建 Service 文件
touch apps/server/src/services/shop.service.ts
```

### 步骤 3：提取业务逻辑

```typescript
// services/shop.service.ts
import { prisma } from '../lib/prisma.js';
import type { Shop } from '@prisma/client';

export async function getUserShops(userId: string): Promise<Shop[]> {
  return prisma.shop.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}
```

### 步骤 4：Route 层调用 Service

```typescript
// routes/shop.ts
import * as shopService from '../services/shop.service.js';

app.get('/shops', async (request, reply) => {
  const userId = (request as any).user.userId;
  const shops = await shopService.getUserShops(userId);
  return reply.send({ code: 1, data: shops });
});
```

### 步骤 5：编写单元测试（可选）

```typescript
// services/shop.service.test.ts
import { describe, it, expect } from 'vitest';
import * as shopService from './shop.service.js';

describe('shopService', () => {
  it('should create shop', async () => {
    const shop = await shopService.createShop({
      userId: 'test-user',
      platform: 'OZON',
      name: 'Test Shop',
      apiKeyEncrypted: 'encrypted',
    });
    expect(shop.name).toBe('Test Shop');
  });
});
```

---

## 命名规范

### Service 文件命名
- `shop.service.ts` — 店铺服务
- `order.service.ts` — 订单服务
- `product.service.ts` — 商品服务
- `user.service.ts` — 用户服务

### 函数命名
- `get*` — 查询单个资源（`getShopById`）
- `list*` / `get*s` — 查询列表（`getUserShops`）
- `create*` — 创建资源（`createShop`）
- `update*` — 更新资源（`updateShop`）
- `delete*` — 删除资源（`deleteShop`）
- `check*` — 权限检查（`checkOrderOwnership`）
- `batch*` — 批量操作（`batchUpdateProductStatus`）

---

## 最佳实践

### 1. 输入验证在 Route 层
```typescript
// ✅ Route 层验证
const schema = z.object({ name: z.string().min(1) });
const parsed = schema.parse(request.body);
await shopService.createShop(parsed);

// ❌ Service 层验证（不推荐）
export async function createShop(input: any) {
  if (!input.name) throw new Error('name is required');
  // ...
}
```

### 2. 错误处理在 Route 层
```typescript
// ✅ Route 层捕获异常
try {
  await shopService.createShop(data);
  return reply.send({ code: 1 });
} catch (error) {
  return reply.status(500).send({ code: 0, msg: error.message });
}

// ❌ Service 层返回错误码（不推荐）
export async function createShop(input: any): Promise<{ code: number; msg?: string }> {
  // ...
}
```

### 3. 权限检查分两层
```typescript
// Route 层：用户级权限（authenticate）
app.get('/shops', authenticate, async (request, reply) => {
  const userId = (request as any).user.userId;
  const shops = await shopService.getUserShops(userId);
  return reply.send({ code: 1, data: shops });
});

// Service 层：数据级权限（checkOwnership）
export async function getShopById(shopId: string, userId: string): Promise<Shop | null> {
  return prisma.shop.findFirst({
    where: { id: shopId, userId }, // 数据级权限
  });
}
```

### 4. 事务在 Service 层
```typescript
// ✅ Service 层管理事务
export async function transferBalance(fromUserId: string, toUserId: string, amount: number) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: fromUserId }, data: { balance: { decrement: amount } } }),
    prisma.user.update({ where: { id: toUserId }, data: { balance: { increment: amount } } }),
  ]);
}

// ❌ Route 层管理事务（不推荐）
app.post('/transfer', async (request, reply) => {
  await prisma.$transaction([...]);
});
```

---

## 迁移优先级

### P0（立即迁移）
- `collect.ts` (72K) — 采集逻辑复杂，需要 Worker 复用
- `product.ts` (39K) — 商品 CRUD 频繁，需要优化
- `order.ts` (30K) — 订单处理复杂，需要统计复用

### P1（逐步迁移）
- `shop.ts` (34K) — 店铺管理
- `admin.ts` (29K) — 管理员操作

### P2（可选迁移）
- 其他小文件（< 10K）— 暂时不迁移

---

## 注意事项

1. **渐进式迁移** — 不要一次性重构所有文件，逐个迁移
2. **保持兼容** — 迁移过程中保持 API 兼容，避免破坏现有功能
3. **测试覆盖** — 迁移后运行测试，确保功能正常
4. **文档更新** — 更新 API 文档，标注哪些接口已迁移
5. **性能监控** — 迁移后监控性能，确保无性能退化
