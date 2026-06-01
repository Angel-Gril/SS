# ERP 性能优化方案

## 一、前端性能优化

### 1. 订单列表页面优化

#### 问题
- 20+ 个 useState，频繁重渲染
- 缺少 useMemo/useCallback
- useEffect 依赖过多

#### 解决方案
```typescript
// 1. 合并相关 state
const [filters, setFilters] = useState({
  status: '',
  shopId: '',
  search: '',
  searchField: 'all',
  serviceTagId: '',
  shipmentUrgency: '',
  hasTracking: '',
  startDate: '',
  endDate: '',
});

// 2. 使用 useMemo 缓存计算结果
const filteredOrders = useMemo(() => {
  // 过滤逻辑
}, [orders, filters]);

// 3. 使用 useCallback 缓存函数
const loadOrders = useCallback(async () => {
  // 加载逻辑
}, [filters, page]);

// 4. 防抖搜索
const debouncedSearch = useMemo(
  () => debounce((value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
  }, 300),
  []
);
```

### 2. 虚拟滚动（大数据量时）

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

// 只渲染可见区域的订单
const virtualizer = useVirtualizer({
  count: orders.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 80,
});
```

### 3. 减少毛玻璃效果

```css
/* 只在侧边栏使用，其他地方用普通背景 */
.glass-effect {
  backdrop-filter: blur(10px); /* 从 20px 降到 10px */
}
```

---

## 二、后端同步优化

### 1. 汇率缓存（最重要！）

#### 当前问题
每个订单的每个商品都调用 `getRate()`，4887 个订单 × 平均 2 个商品 = 约 10000 次数据库查询

#### 解决方案
```typescript
// 在同步开始时预加载所有汇率
async function syncOrdersCore(shopId: string, since: string, shop: any) {
  // 预加载汇率缓存
  const rateCache = new Map<string, number>();
  const currencies = ['USD', 'CNY', 'RUB', 'EUR', 'KZT', 'BYN'];
  const orderDate = new Date();
  
  for (const currency of currencies) {
    const { rate } = await getRate(currency, orderDate);
    rateCache.set(currency, rate);
  }
  
  const rubToCny = rateCache.get('RUB')!;
  
  // 使用缓存的汇率
  const calculateTotalAmount = (products: any[]) => {
    let total = 0;
    for (const p of products) {
      const price = parseFloat(p.price);
      const currencyCode = (p as any).currency_code?.toUpperCase() || 'RUB';
      
      if (currencyCode === 'RUB') {
        total += price * p.quantity;
      } else {
        const rateToCny = rateCache.get(currencyCode) || 1;
        const priceInCny = price * rateToCny;
        const priceInRub = priceInCny / rubToCny;
        total += priceInRub * p.quantity;
      }
    }
    return Math.round(total * 100) / 100;
  };
}
```

### 2. 批量数据库操作

#### 当前问题
每个订单单独 upsert，4887 个订单 = 4887 次数据库操作

#### 解决方案
```typescript
// 收集所有订单，批量 upsert
const ordersToUpsert = [];
for (const posting of result.postings) {
  ordersToUpsert.push({
    // 订单数据
  });
}

// 批量插入（每 100 个一批）
for (let i = 0; i < ordersToUpsert.length; i += 100) {
  const batch = ordersToUpsert.slice(i, i + 100);
  await prisma.$transaction(
    batch.map(order => 
      prisma.order.upsert({
        where: { shopId_platformOrderId: { shopId, platformOrderId: order.platformOrderId } },
        create: order,
        update: order,
      })
    )
  );
}
```

### 3. 并发处理

```typescript
// 使用 Promise.all 并发处理多个店铺
async function syncAllShops() {
  const shops = await prisma.shop.findMany({ where: { status: 'ACTIVE' } });
  
  // 最多 5 个店铺并发同步
  const concurrency = 5;
  for (let i = 0; i < shops.length; i += concurrency) {
    const batch = shops.slice(i, i + concurrency);
    await Promise.all(
      batch.map(shop => addOrderSyncJob(shop.id))
    );
  }
}
```

### 4. 增量同步优化

```typescript
// 只同步最近 7 天的订单（而不是 90 天）
const sinceDate = since || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

// 定时任务：每小时同步一次
// 全量同步：用户手动触发时才同步 90 天
```

### 5. 图片获取优化

```typescript
// 并发获取图片，而不是串行
async function enrichItemsWithImages(shopId: string, products: any[]) {
  const imagePromises = products.map(async (p) => {
    // 并发获取图片
    const image = await getProductImage(shopId, p.sku);
    return { ...p, image };
  });
  
  return Promise.all(imagePromises);
}
```

---

## 三、预期效果

### 前端优化后
- ✅ 页面响应速度提升 50%+
- ✅ 搜索/筛选更流畅
- ✅ 减少不必要的重渲染

### 后端优化后
- ✅ 同步速度提升 **10-20 倍**
- ✅ 4887 个订单从 **5-10 分钟** 降到 **30-60 秒**
- ✅ 数据库查询从 10000+ 次降到 100 次以内
- ✅ 支持多店铺并发同步

---

## 四、实施优先级

### 🔥 高优先级（立即实施）
1. **汇率缓存** - 最大性能瓶颈
2. **批量数据库操作** - 减少 95% 的数据库调用
3. **前端 state 合并** - 减少重渲染

### 🟡 中优先级（本周内）
4. 并发处理
5. 图片获取优化
6. 防抖搜索

### 🟢 低优先级（有时间再做）
7. 虚拟滚动
8. 减少毛玻璃效果

---

## 五、监控指标

### 前端
- 页面加载时间
- 首次渲染时间（FCP）
- 交互响应时间（TTI）

### 后端
- 同步耗时
- 数据库查询次数
- API 响应时间

需要我开始实施这些优化吗？
