# 第三方参考工具扩展功能分析与 SS ERP 优化方案

## 一、第三方参考工具核心功能分析

### 1. 列表页商品信息注入（核心差异点）

**实现方式：**

- 通过 `showTileGridDesktop_2()` 函数，每 500ms 扫描页面上的商品卡片
- 提取商品基础信息（SKU、价格、标题、评分、评论数）存入 `SKUDATA_pic` 对象
- 调用后端 API 获取详细数据（30天销量、销售额、卖家信息、物流信息等）
- 将数据以卡片形式注入到商品卡片下方

**注入的数据字段（共 24 个）：**

```javascript
{
  sellerId: '卖家ID',
  sellerName: '卖家名称',
  brand: '品牌',
  category1: '一级类目',
  category3: '三级类目',
  soldCount: '30天销量',
  soldSum: '30天销售额',
  salesDynamics: '30天销售变化',
  avgPrice: '平均售价',
  minSellerPrice: '最低售价',
  convToCartPdp: '加购率',
  views: '浏览量',
  volume: '体积/公斤',
  salesSchema: '发货模式',
  avgDeliveryDays: '配送天数',
  stock: '库存',
  nullableCreateDate: '出售时间',
  zwews: '包裹重量（点击获取）'
}
```

**UI 展示：**

- 卡片式设计，蓝色主题
- 数据分层展示（标题 + 键值对列表）
- 重点数据高亮（销量、销售额、加购率、卖家信息）
- 支持点击获取重量（通过加购物车 API）

---

### 2. 数据分析面板

**功能：**

- 顶部浮动工具栏（固定在页面顶部）
- 提供 4 个快捷入口：
  - 1688 订单查询
  - 淘宝订单查询
  - 拼多多订单查询
  - 自动滚动（用于批量加载商品）
- 数据导出功能（支持自定义字段勾选）

**数据导出字段（30+ 个）：**

```
商品编码、一级类目、三级类目、月销量、月销售额、月销售变化、
平均价格、最低售价、品牌、曝光量、曝光转化率、开售天数、
加购率、结算率、推广点击占比、开售天数、出单时间、平均运输时间、
库存、体积、重量、供应商、配送方式、跟卖数量等
```

---

### 3. 利润计算器（ozon-profit.js）

**功能：**

- 实时计算商品利润
- 支持多种物流方式选择
- 汇率自动转换（CNY ↔ RUB）
- 成本结构分析：
  - 采购成本
  - 物流费用
  - OZON 佣金
  - 其他费用

---

### 4. 重量获取（反向工程 OZON API）

**实现原理：**

```javascript
async function getWaith(sku) {
  // 1. 获取当前购物车商品
  const cart = await fetch('https://www.ozon.ru/api/composer-api.bx/_action/summary');

  // 2. 清空购物车
  await fetch('https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fcart', {
    method: 'POST',
    body: JSON.stringify({ name: 'deleteItems', params: cartItemIds }),
  });

  // 3. 添加目标商品到购物车
  await fetch('https://www.ozon.ru/api/composer-api.bx/_action/v2/addToCart', {
    method: 'POST',
    body: JSON.stringify([{ id: Number(sku), quantity: 1 }]),
  });

  // 4. 访问购物车页面，从 HTML 中提取重量信息
  const html = await fetch('https://www.ozon.ru/cart?tab=0');
  const match = html.match(/"info":"[^•]+•\s*([^"]+)/);
  return match ? match[1].trim() : null;
}
```

**优点：**

- 无需 API Key
- 实时获取准确重量

**缺点：**

- 会干扰用户购物车
- 频繁调用可能被限流

---

## 二、SS ERP 扩展当前状态

### 现有功能

1. ✅ 商品详情页采集（完整）
2. ✅ 列表页批量采集（仅采集按钮）
3. ✅ 图片水印处理
4. ✅ 一键上架 OZON
5. ✅ 与 ERP 后端通信

### 缺失功能

1. ❌ 列表页商品信息直观展示
2. ❌ 数据分析面板
3. ❌ 利润计算器
4. ❌ 重量获取
5. ❌ 数据导出

---

## 三、优化方案

### 方案 A：轻量级注入（推荐）

**目标：** 在列表页商品卡片下方注入关键信息，不影响原有布局

**实现步骤：**

#### 1. 后端 API 增强

在 `apps/server/src/routes/collect.ts` 添加新接口：

```typescript
// 批量获取商品快照信息（用于列表页展示）
app.post('/batch-snapshot', async (request, reply) => {
  const { skus } = request.body as { skus: string[] };

  // 从 CollectRecord 表查询已采集的商品
  const records = await prisma.collectRecord.findMany({
    where: { sourceProductId: { in: skus } },
    select: {
      sourceProductId: true,
      title: true,
      price: true,
      originalPrice: true,
      rating: true,
      reviewCount: true,
      createdAt: true,
      metadata: true, // JSON 字段，存储扩展信息
    },
  });

  return reply.send({ code: 1, data: records });
});
```

#### 2. 扩展前端注入逻辑

在 `apps/extension/src/content/ozon-list.ts` 添加：

```typescript
// 扫描列表页商品
function injectProductInfo() {
  const cards = document.querySelectorAll('div[data-index]:not([data-ss-injected])');

  cards.forEach(async (card) => {
    card.setAttribute('data-ss-injected', '1');

    const link = card.querySelector('a');
    if (!link) return;

    const sku = extractSKU(link.href);
    if (!sku) return;

    // 从后端获取快照数据
    const snapshot = await fetchSnapshot(sku);

    if (snapshot) {
      // 注入信息卡片
      const infoCard = createInfoCard(snapshot);
      card.appendChild(infoCard);
    } else {
      // 显示"采集到 ERP"按钮
      const collectBtn = createCollectButton(sku);
      card.appendChild(collectBtn);
    }
  });
}

// 每 500ms 扫描一次（与第三方参考工具相同）
setInterval(injectProductInfo, 500);
```

#### 3. 信息卡片 UI 设计

```typescript
function createInfoCard(snapshot: ProductSnapshot) {
  return `
    <div class="ss-erp-card">
      <div class="ss-erp-card-header">
        <span class="ss-erp-badge">已采集</span>
        <span class="ss-erp-time">${formatTime(snapshot.createdAt)}</span>
      </div>
      <div class="ss-erp-card-body">
        <div class="ss-erp-row">
          <span class="label">采集价格</span>
          <span class="value">${snapshot.price} ₽</span>
        </div>
        <div class="ss-erp-row">
          <span class="label">评分/评论</span>
          <span class="value">${snapshot.rating} ⭐ (${snapshot.reviewCount})</span>
        </div>
        <div class="ss-erp-row">
          <span class="label">采集时间</span>
          <span class="value">${formatDate(snapshot.createdAt)}</span>
        </div>
      </div>
      <div class="ss-erp-card-footer">
        <button class="ss-erp-btn-primary" data-sku="${snapshot.sourceProductId}">
          查看详情
        </button>
        <button class="ss-erp-btn-secondary" data-sku="${snapshot.sourceProductId}">
          重新采集
        </button>
      </div>
    </div>
  `;
}
```

**样式设计：**

- 使用 SS ERP 品牌色（与官网首页一致）
- 卡片式布局，圆角 + 阴影
- 响应式设计，不破坏原有布局

---

### 方案 B：完整数据分析面板（进阶）

**目标：** 提供与第三方参考工具类似的数据分析能力

**需要的数据源：**

1. **OZON 官方 API**（需要卖家授权）
   - 商品销量数据
   - 库存数据
   - 物流信息

2. **第三方数据服务**（需要付费）
   - 市场分析数据（销量、销售额、趋势）
   - 同类产品分析
   - 类目排名

3. **爬虫数据**（合规风险）
   - 从 OZON 前端抓取公开数据
   - 需要处理反爬虫机制

**实现难度：**

- 🔴 高：需要稳定的数据源
- 🔴 高：需要大量数据存储和计算
- 🟡 中：UI 开发工作量大

**建议：**

- 短期不推荐（投入产出比低）
- 可作为付费增值功能
- 优先完成方案 A

---

## 四、推荐实施路线

### Phase 1：轻量级注入（1-2 天）

1. ✅ 后端添加 `/api/collect/batch-snapshot` 接口
2. ✅ 扩展添加列表页扫描逻辑
3. ✅ 设计并实现信息卡片 UI
4. ✅ 添加"查看详情"跳转到 ERP
5. ✅ 添加"重新采集"快捷操作

**效果：**

- 用户在列表页可以直观看到哪些商品已采集
- 一键跳转到 ERP 查看详情
- 减少重复采集

---

### Phase 2：数据增强（3-5 天）

1. ✅ 在 `CollectRecord.metadata` 存储更多字段：
   - 采集时的库存
   - 采集时的评分/评论数
   - 采集时的价格历史
2. ✅ 添加价格变动提醒
3. ✅ 添加库存变动提醒
4. ✅ 添加评分变动提醒

**效果：**

- 用户可以追踪商品变化
- 辅助选品决策

---

### Phase 3：数据分析（可选，2-3 周）

1. ⚠️ 对接第三方数据服务（如有）
2. ⚠️ 开发数据分析面板
3. ⚠️ 开发利润计算器
4. ⚠️ 开发数据导出功能

**效果：**

- 提供与第三方参考工具类似的数据分析能力
- 作为付费增值功能

---

## 五、技术要点

### 1. 性能优化

**问题：** 每 500ms 扫描 DOM 可能影响性能

**解决方案：**

- 使用 `IntersectionObserver` 监听商品卡片进入视口
- 只处理可见区域的商品
- 使用 `requestIdleCallback` 在浏览器空闲时处理

```typescript
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        injectProductInfo(entry.target);
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1 },
);

// 监听所有商品卡片
document.querySelectorAll('div[data-index]').forEach((card) => {
  observer.observe(card);
});
```

---

### 2. 数据缓存

**问题：** 频繁请求后端影响性能

**解决方案：**

- 在扩展中使用 `chrome.storage.local` 缓存快照数据
- 设置 5 分钟过期时间
- 后台定期同步

```typescript
async function fetchSnapshot(sku: string) {
  // 1. 先从缓存读取
  const cached = await chrome.storage.local.get(`snapshot_${sku}`);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return cached.data;
  }

  // 2. 缓存过期，从后端获取
  const data = await fetch(`/api/collect/batch-snapshot`, {
    method: 'POST',
    body: JSON.stringify({ skus: [sku] }),
  }).then((r) => r.json());

  // 3. 更新缓存
  await chrome.storage.local.set({
    [`snapshot_${sku}`]: {
      data: data.data[0],
      timestamp: Date.now(),
    },
  });

  return data.data[0];
}
```

---

### 3. UI 一致性

**要求：** 注入的卡片样式与 SS ERP 品牌一致

**实现：**

- 使用 CSS Variables 定义品牌色
- 与官网首页保持一致的设计语言
- 支持深色模式

```css
:root {
  --ss-primary: #005bff;
  --ss-primary-hover: #0051e0;
  --ss-bg: #ffffff;
  --ss-border: #e9ebef;
  --ss-text: #0a0c14;
  --ss-text-muted: #6b7280;
}

.ss-erp-card {
  background: var(--ss-bg);
  border: 1px solid var(--ss-border);
  border-radius: 12px;
  padding: 16px;
  margin-top: 12px;
  box-shadow: 0 2px 8px rgba(10, 12, 20, 0.08);
}
```

---

## 六、总结

### 第三方参考工具的核心优势

1. ✅ 列表页直观展示商品数据（30+ 字段）
2. ✅ 数据分析面板（销量、趋势、利润）
3. ✅ 重量获取（反向工程 OZON API）
4. ✅ 数据导出（自定义字段）

### SS ERP 的差异化方向

1. ✅ 与自有 ERP 深度集成（第三方参考工具依赖第三方）
2. ✅ 图片水印 + 存储（第三方参考工具无此功能）
3. ✅ 一键上架 OZON（第三方参考工具需手动）
4. ✅ 订单同步 + 财务统计（第三方参考工具无此功能）

### 推荐优先级

1. 🔥 **Phase 1**：轻量级注入（快速见效，投入产出比高）
2. 🟡 **Phase 2**：数据增强（提升用户体验）
3. ⚪ **Phase 3**：数据分析（可选，作为付费功能）

---

## 七、接口设计

### 1. 批量快照接口

```typescript
POST /api/collect/batch-snapshot

Request:
{
  "skus": ["123456789", "987654321"]
}

Response:
{
  "code": 1,
  "data": [
    {
      "sourceProductId": "123456789",
      "title": "商品标题",
      "price": "1999",
      "originalPrice": "2999",
      "rating": "4.5",
      "reviewCount": 1234,
      "createdAt": "2026-05-31T10:00:00Z",
      "metadata": {
        "stock": 100,
        "priceHistory": [
          { "price": "1999", "date": "2026-05-31" }
        ]
      }
    }
  ]
}
```

### 2. 快速采集接口（列表页一键采集）

```typescript
POST /api/collect/quick-collect

Request:
{
  "sku": "123456789",
  "url": "https://www.ozon.ru/product/...",
  "basicInfo": {
    "title": "商品标题",
    "price": "1999",
    "rating": "4.5",
    "reviewCount": 1234
  }
}

Response:
{
  "code": 1,
  "msg": "采集成功",
  "data": {
    "collectId": "uuid",
    "status": "pending" // pending | processing | completed | failed
  }
}
```

---

**文档版本：** v1.0
**更新时间：** 2026-05-31
**作者：** SS ERP Team
