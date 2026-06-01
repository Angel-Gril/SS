# Ozon 列表页 Premium 数据增强方案（实战版）

## 目标

在 Ozon 列表页每个商品卡片下方注入 **30+ 字段数据卡片**，包含：

- 基础信息（价格、评分、库存）
- Premium 数据（30天销量、GMV、加购率、浏览量）
- ERP 状态（已采集、已上架、利润预估）

**核心原则：** 能拿到数据就拿，拿不到就降级显示，不要因为权限问题导致整个功能不可用。

---

## 数据来源分析

### 1. Ozon 公开 API（无需登录）

**接口：** `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=...`

**可获取字段：**

- SKU / product_id
- 标题
- 当前价格
- 原价 / 折扣
- 评分
- 评论数
- 图片列表
- 变体信息
- 基础属性（从 widgetStates 解析）

**优点：** 稳定、快速、无权限限制
**缺点：** 无销售数据、无卖家信息

---

### 2. Seller Analytics API（需要 seller 登录 + Premium）

**接口：** `https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/data/v3`

**请求示例：**

```json
{
  "filters": {
    "sku": ["123456789"]
  },
  "sort": { "field": "soldCount", "order": "desc" },
  "page": 1,
  "pageSize": 20
}
```

**可获取字段（Premium Plus）：**

- soldCount: 30天销量
- soldSum: 30天销售额
- salesDynamics: 销量环比
- avgPrice: 平均售价
- minSellerPrice: 最低卖家价
- convToCartPdp: 加购率
- views: 浏览量
- stock: 库存
- brand: 品牌
- category1/category3: 类目
- sellerId/sellerName: 卖家信息
- salesSchema: 发货模式
- avgDeliveryDays: 配送天数
- nullableCreateDate: 上架时间

**鉴权方式：**

- Cookie: `sc_company_id`
- Header: `x-o3-company-id`

**限制：**

- 需要 Premium Plus 订阅
- 无订阅时返回 403 或空数据
- 有频率限制（建议缓存）

---

### 3. Seller Search API（需要 seller 登录）

**接口：** `https://seller.ozon.ru/api/v1/search`

**请求示例：**

```json
{
  "query": "123456789",
  "filters": {},
  "page": 1,
  "pageSize": 20
}
```

**可获取字段：**

- 商品详情
- 重量 / 尺寸
- 属性列表
- 变体信息
- 库存状态

**优点：** 不需要 Premium，只需要 seller 登录
**缺点：** 无销售数据

---

### 4. SS ERP 自有数据

**接口：** `POST /api/collect/batch-snapshot`

**可获取字段：**

- 是否已采集
- 采集时间
- 采集价格
- 图片数量
- 是否已上架
- 上架状态
- 最近错误
- 利润预估（基于采购价 + 物流费 + 佣金）

---

## 数据获取策略

### 优先级瀑布流

```
1. 先查 SS ERP 缓存（10分钟有效）
   ↓ 未命中
2. 查 Ozon 公开 API（获取基础信息）
   ↓ 同时
3. 尝试 Seller Analytics API（获取 Premium 数据）
   ↓ 如果 403/无权限
4. 降级到 Seller Search API（获取部分信息）
   ↓ 如果未登录 seller
5. 只显示公开数据 + ERP 状态
```

### 缓存策略

| 数据类型     | 缓存时长 | 存储位置                             |
| ------------ | -------- | ------------------------------------ |
| 公开数据     | 30 分钟  | chrome.storage.local                 |
| Premium 数据 | 10 分钟  | chrome.storage.local + ERP 后端      |
| ERP 状态     | 5 分钟   | chrome.storage.local                 |
| 失败状态     | 30 分钟  | chrome.storage.local（避免重复请求） |

---

## 字段分层展示

### 默认显示（6-8 个核心字段）

```
┌─────────────────────────────────────┐
│ SS ERP · 已采集                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 30天销量    126 单    📈 +12%       │
│ 30天GMV     ₽82,300   💰 利润率 18% │
│ 当前价格    ₽1,999    📦 库存 38    │
│ 卖家        XXX       ⭐ 4.7 (234)  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ [展开详情] [查看ERP] [重新采集]      │
└─────────────────────────────────────┘
```

### 展开后显示（30+ 字段）

**销售数据：**

- 30天销量
- 30天销售额
- 销量环比
- GMV 环比
- 平均售价
- 最低卖家价
- 加购率
- 浏览量
- 转化率

**商品信息：**

- SKU
- 品牌
- 一级类目
- 三级类目
- 库存
- 重量
- 长宽高
- 图片数量
- 变体数量

**卖家信息：**

- 卖家 ID
- 卖家名称
- 发货模式
- 配送天数
- 在售天数

**ERP 数据：**

- 采集状态
- 采集时间
- 采集价格
- 上架状态
- 利润预估
- 物流费用
- 最近错误

---

## 开发计划

### Phase 1：后端接口（1 天）

#### 1.1 批量快照接口

**文件：** `apps/server/src/routes/collect.ts`

```typescript
app.post('/batch-snapshot', async (request, reply) => {
  const { skus } = request.body as { skus: string[] };
  const { userId } = (request as any).user;

  const records = await prisma.supplyGoods.findMany({
    where: {
      userId,
      sourceProductId: { in: skus },
    },
    select: {
      sourceProductId: true,
      title: true,
      sourceUrl: true,
      status: true,
      createdAt: true,
      metadata: true,
    },
  });

  const result: Record<string, any> = {};
  records.forEach((r) => {
    result[r.sourceProductId] = {
      collected: true,
      collectId: r.id,
      title: r.title,
      status: r.status,
      lastCollectedAt: r.createdAt,
      price: r.metadata?.price,
      imageCount: r.metadata?.imageCount,
      listed: r.status === 'listed',
      lastError: r.metadata?.lastError,
    };
  });

  return reply.send({ code: 1, data: result });
});
```

#### 1.2 Premium 数据缓存接口

**文件：** `apps/server/src/routes/ozon-analytics.ts`（新建）

```typescript
// 存储 Premium 数据快照
app.post('/cache', async (request, reply) => {
  const { sku, metrics, source } = request.body;
  const { userId } = (request as any).user;

  await prisma.ozonAnalyticsCache.create({
    data: {
      userId,
      sku,
      metrics,
      source,
      capturedAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return reply.send({ code: 1 });
});

// 读取缓存
app.get('/cache', async (request, reply) => {
  const { sku } = request.query as { sku: string };
  const { userId } = (request as any).user;

  const cache = await prisma.ozonAnalyticsCache.findFirst({
    where: {
      userId,
      sku,
      expiresAt: { gt: new Date() },
    },
    orderBy: { capturedAt: 'desc' },
  });

  if (!cache) {
    return reply.send({ code: 0, msg: 'No cache' });
  }

  return reply.send({ code: 1, data: cache.metrics });
});
```

#### 1.3 数据库 Schema

**文件：** `apps/server/prisma/schema.prisma`

```prisma
model OzonAnalyticsCache {
  id          String   @id @default(uuid())
  userId      String
  sku         String
  metrics     Json     // 存储完整的 Premium 数据
  source      String   // 'seller-analytics' | 'seller-search'
  capturedAt  DateTime
  expiresAt   DateTime

  user        User     @relation(fields: [userId], references: [id])

  @@index([userId, sku])
  @@index([expiresAt])
}
```

---

### Phase 2：扩展数据获取层（2 天）

#### 2.1 Ozon API 封装

**文件：** `apps/extension/src/services/ozon-api.ts`（新建）

```typescript
export class OzonAPI {
  // 获取公开数据
  static async fetchPublicData(url: string): Promise<any> {
    const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    return {
      sku: this.extractSKU(data),
      title: this.extractTitle(data),
      price: this.extractPrice(data),
      rating: this.extractRating(data),
      // ... 其他字段
    };
  }

  // 获取 Premium 数据
  static async fetchPremiumData(skus: string[]): Promise<any> {
    const companyId = await this.getCompanyId();
    if (!companyId) return null;

    const res = await fetch(
      'https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/data/v3',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-o3-company-id': companyId,
        },
        body: JSON.stringify({
          filters: { sku: skus },
          page: 1,
          pageSize: skus.length,
        }),
      },
    );

    if (!res.ok) return null;
    return res.json();
  }

  // 获取 seller cookie
  private static async getCompanyId(): Promise<string | null> {
    const cookies = await chrome.cookies.getAll({
      domain: 'seller.ozon.ru',
      name: 'sc_company_id',
    });
    return cookies[0]?.value || null;
  }
}
```

#### 2.2 数据聚合层

**文件：** `apps/extension/src/services/product-data-aggregator.ts`（新建）

```typescript
export class ProductDataAggregator {
  async fetchProductData(sku: string, url: string): Promise<ProductData> {
    // 1. 先查 ERP 缓存
    const erpCache = await this.fetchERPCache(sku);
    if (erpCache && !this.isExpired(erpCache, 10 * 60 * 1000)) {
      return erpCache;
    }

    // 2. 并行获取多个数据源
    const [publicData, premiumData, erpStatus] = await Promise.all([
      OzonAPI.fetchPublicData(url),
      OzonAPI.fetchPremiumData([sku]),
      this.fetchERPStatus(sku),
    ]);

    // 3. 合并数据
    const merged = {
      ...publicData,
      ...premiumData?.items?.[0],
      ...erpStatus,
      _sources: {
        public: !!publicData,
        premium: !!premiumData,
        erp: !!erpStatus,
      },
    };

    // 4. 缓存到 ERP
    if (premiumData) {
      await this.cacheToERP(sku, merged);
    }

    return merged;
  }
}
```

---

### Phase 3：UI 注入层（2 天）

#### 3.1 列表页扫描

**文件：** `apps/extension/src/content/ozon-list-overlay.ts`

```typescript
class OzonListEnhancer {
  private observer: IntersectionObserver;
  private processedSkus = new Set<string>();

  init() {
    // 使用 IntersectionObserver 监听商品卡片进入视口
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.injectCard(entry.target as HTMLElement);
          }
        });
      },
      { threshold: 0.1 },
    );

    // 监听 DOM 变化
    const mutationObserver = new MutationObserver(() => {
      this.scanProducts();
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.scanProducts();
  }

  private scanProducts() {
    const cards = document.querySelectorAll('div[data-index]:not([data-ss-enhanced])');
    cards.forEach((card) => {
      card.setAttribute('data-ss-enhanced', '1');
      this.observer.observe(card);
    });
  }

  private async injectCard(card: HTMLElement) {
    const link = card.querySelector('a');
    if (!link) return;

    const sku = this.extractSKU(link.href);
    if (!sku || this.processedSkus.has(sku)) return;

    this.processedSkus.add(sku);

    // 显示加载状态
    const placeholder = this.createPlaceholder();
    card.appendChild(placeholder);

    // 获取数据
    const data = await aggregator.fetchProductData(sku, link.href);

    // 替换为真实卡片
    placeholder.remove();
    const infoCard = this.createInfoCard(data);
    card.appendChild(infoCard);
  }
}
```

#### 3.2 信息卡片组件

**文件：** `apps/extension/src/components/ProductInfoCard.ts`

```typescript
export function createInfoCard(data: ProductData): HTMLElement {
  const card = document.createElement('div');
  card.className = 'ss-erp-info-card';
  card.innerHTML = `
    <div class="ss-erp-card-compact">
      ${renderHeader(data)}
      ${renderMetrics(data)}
      ${renderActions(data)}
    </div>
    <div class="ss-erp-card-expanded" style="display: none;">
      ${renderAllFields(data)}
    </div>
  `;

  // 绑定展开/收起事件
  card.querySelector('.ss-expand-btn')?.addEventListener('click', () => {
    card.querySelector('.ss-erp-card-expanded')?.classList.toggle('show');
  });

  return card;
}

function renderMetrics(data: ProductData): string {
  const hasPremium = data._sources.premium;

  return `
    <div class="ss-metrics">
      <div class="ss-metric">
        <span class="label">30天销量</span>
        <span class="value ${hasPremium ? '' : 'locked'}">
          ${hasPremium ? data.soldCount : '🔒 需要 Premium'}
        </span>
      </div>
      <div class="ss-metric">
        <span class="label">30天GMV</span>
        <span class="value ${hasPremium ? '' : 'locked'}">
          ${hasPremium ? `₽${data.soldSum}` : '🔒 需要 Premium'}
        </span>
      </div>
      <div class="ss-metric">
        <span class="label">当前价格</span>
        <span class="value">₽${data.price}</span>
      </div>
      <div class="ss-metric">
        <span class="label">库存</span>
        <span class="value">${data.stock || '未知'}</span>
      </div>
    </div>
  `;
}
```

---

### Phase 4：样式设计（1 天）

**文件：** `apps/extension/src/content/ozon-list-overlay.css`

```css
.ss-erp-info-card {
  margin-top: 12px;
  background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
  border: 1px solid #e9ecef;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.ss-erp-card-compact {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ss-metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.ss-metric {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.ss-metric .label {
  color: #6c757d;
  font-size: 13px;
}

.ss-metric .value {
  color: #212529;
  font-weight: 600;
  font-size: 14px;
}

.ss-metric .value.locked {
  color: #adb5bd;
  font-size: 12px;
}

.ss-metric .value.highlight {
  color: #0d6efd;
}
```

---

## 性能优化

### 1. 批量请求

不要每个 SKU 单独请求，改为批量：

```typescript
class BatchQueue {
  private queue: string[] = [];
  private timer: any;

  add(sku: string) {
    this.queue.push(sku);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  private async flush() {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, 20); // 每批最多 20 个
    const data = await OzonAPI.fetchPremiumData(batch);

    // 分发数据
    batch.forEach((sku) => {
      this.emit(sku, data[sku]);
    });
  }
}
```

### 2. 缓存优先

```typescript
async function fetchWithCache(sku: string): Promise<any> {
  // 1. 内存缓存
  if (memCache.has(sku)) {
    return memCache.get(sku);
  }

  // 2. chrome.storage 缓存
  const stored = await chrome.storage.local.get(`premium_${sku}`);
  if (stored && Date.now() - stored.timestamp < 10 * 60 * 1000) {
    memCache.set(sku, stored.data);
    return stored.data;
  }

  // 3. 请求接口
  const data = await OzonAPI.fetchPremiumData([sku]);

  // 4. 更新缓存
  memCache.set(sku, data);
  await chrome.storage.local.set({
    [`premium_${sku}`]: {
      data,
      timestamp: Date.now(),
    },
  });

  return data;
}
```

---

## 风险控制

### 1. 频率限制

```typescript
class RateLimiter {
  private requests: number[] = [];

  async acquire(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < 60000);

    if (this.requests.length >= 30) {
      // 每分钟最多 30 次请求
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    this.requests.push(now);
  }
}
```

### 2. 错误降级

```typescript
async function fetchPremiumDataSafe(sku: string): Promise<any> {
  try {
    return await OzonAPI.fetchPremiumData([sku]);
  } catch (error) {
    if (error.status === 403) {
      // 无权限，缓存失败状态 30 分钟
      await chrome.storage.local.set({
        [`premium_failed_${sku}`]: Date.now(),
      });
    }
    return null;
  }
}
```

---

## 测试计划

### 1. 单元测试

- ✅ SKU 提取逻辑
- ✅ 数据合并逻辑
- ✅ 缓存读写
- ✅ 批量队列

### 2. 集成测试

- ✅ 公开 API 调用
- ✅ Premium API 调用（有权限 / 无权限）
- ✅ ERP 接口调用
- ✅ 数据聚合

### 3. 性能测试

- ✅ 100 个商品卡片注入时间 < 3s
- ✅ 滚动流畅度 > 30fps
- ✅ 内存占用 < 100MB

### 4. 用户测试

- ✅ 未登录 ERP：提示登录
- ✅ 未登录 seller：只显示公开数据
- ✅ 无 Premium：显示锁定状态
- ✅ 有 Premium：显示完整数据

---

## 交付清单

### 后端

- ✅ `POST /api/collect/batch-snapshot`
- ✅ `POST /api/ozon-analytics/cache`
- ✅ `GET /api/ozon-analytics/cache`
- ✅ `OzonAnalyticsCache` 数据表
- ✅ Migration 文件

### 扩展

- ✅ `ozon-api.ts` - API 封装
- ✅ `product-data-aggregator.ts` - 数据聚合
- ✅ `ozon-list-overlay.ts` - 列表页注入
- ✅ `ProductInfoCard.ts` - 信息卡片组件
- ✅ `ozon-list-overlay.css` - 样式

### 文档

- ✅ API 文档
- ✅ 数据字段说明
- ✅ 用户使用指南

---

## 时间估算

| 阶段     | 工作量   | 说明                |
| -------- | -------- | ------------------- |
| Phase 1  | 1 天     | 后端接口 + 数据库   |
| Phase 2  | 2 天     | 扩展数据获取层      |
| Phase 3  | 2 天     | UI 注入层           |
| Phase 4  | 1 天     | 样式设计            |
| 测试     | 1 天     | 单元测试 + 集成测试 |
| **总计** | **7 天** | 包含测试和优化      |

---

**版本：** v2.0 (实战版)
**更新时间：** 2026-05-31
**状态：** 待开发
