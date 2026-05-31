# TanStack Query 集成指南

本文档介绍如何使用 TanStack Query 优化列表页的数据管理。

---

## 为什么使用 TanStack Query？

### 传统方式的问题
```typescript
// ❌ 传统方式：手动管理状态
const [items, setItems] = useState<T[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  async function fetch() {
    setLoading(true);
    const res = await api.get('/api/xxx');
    if (res.code === 1) setItems(res.data);
    setLoading(false);
  }
  fetch();
}, []);
```

**问题**：
- 重复的加载状态管理
- 无缓存，每次切换页面都重新请求
- 无后台刷新，数据可能过期
- 无乐观更新，操作反馈慢
- 无错误重试，网络抖动易失败

### TanStack Query 的优势
```typescript
// ✅ TanStack Query：自动管理
const { items, loading } = useResourceQuery<T>({
  endpoint: '/api/xxx',
  queryKey: ['xxx'],
});
```

**优势**：
- ✅ **自动缓存** — 30 秒内不重复请求
- ✅ **后台刷新** — 窗口重新聚焦时自动更新
- ✅ **乐观更新** — 操作立即反馈，失败自动回滚
- ✅ **智能重试** — 网络错误自动重试 1 次
- ✅ **垃圾回收** — 5 分钟后自动清理未使用的缓存
- ✅ **DevTools** — 可视化查看缓存状态

---

## 快速开始

### 1. 使用 `useResourceQuery` Hook

```typescript
import { useResourceQuery } from '@/hooks/use-resource-query';

interface ServiceTag {
  id: string;
  name: string;
  color: string;
  fee: string;
}

export default function ServiceTagsPage() {
  const { items, loading, create, update, remove } = useResourceQuery<ServiceTag>({
    endpoint: '/api/admin/service-tags',
    queryKey: ['admin', 'service-tags'], // 唯一标识，用于缓存
  });

  // 创建
  async function handleCreate(data: Partial<ServiceTag>) {
    const success = await create(data);
    if (success) {
      // 自动刷新列表，无需手动调用 refresh()
    }
  }

  // 更新
  async function handleUpdate(id: string, data: Partial<ServiceTag>) {
    await update(id, data);
  }

  // 删除
  async function handleDelete(id: string) {
    await remove(id);
  }

  return (
    <div>
      {loading ? <Loader /> : items.map((item) => <div key={item.id}>{item.name}</div>)}
    </div>
  );
}
```

---

## API 参考

### `useResourceQuery<T>(options)`

**参数**：
- `endpoint: string` — API 端点（如 `/api/admin/service-tags`）
- `queryKey: string[]` — 查询键，用于缓存标识（如 `['admin', 'service-tags']`）
- `onError?: (error: string) => void` — 错误回调（可选）

**返回值**：
- `items: T[]` — 数据列表
- `loading: boolean` — 加载状态
- `error: string | null` — 错误信息
- `refresh: () => void` — 手动刷新
- `create: (data: Partial<T>) => Promise<boolean>` — 创建资源
- `update: (id: string, data: Partial<T>) => Promise<boolean>` — 更新资源
- `remove: (id: string) => Promise<boolean>` — 删除资源

---

## 高级用法

### 1. 手动刷新

```typescript
const { items, refresh } = useResourceQuery<T>({
  endpoint: '/api/xxx',
  queryKey: ['xxx'],
});

// 手动触发刷新（通常不需要，CRUD 操作会自动刷新）
<Button onClick={refresh}>刷新</Button>
```

### 2. 错误处理

```typescript
const { items, error } = useResourceQuery<T>({
  endpoint: '/api/xxx',
  queryKey: ['xxx'],
  onError: (error) => {
    console.error('加载失败:', error);
    // 自定义错误处理
  },
});

if (error) {
  return <div>加载失败: {error}</div>;
}
```

### 3. 依赖查询

```typescript
// 只有当 shopId 存在时才查询
const { items } = useResourceQuery<Product>({
  endpoint: `/api/shops/${shopId}/products`,
  queryKey: ['shops', shopId, 'products'],
  enabled: !!shopId, // 条件查询
});
```

### 4. 查询键设计

查询键用于缓存标识，设计原则：
- **层级化** — `['admin', 'service-tags']` 优于 `['service-tags']`
- **包含参数** — `['shops', shopId, 'products']` 优于 `['products']`
- **唯一性** — 不同查询必须有不同的 key

**示例**：
```typescript
// ✅ 好的设计
['admin', 'users']                    // 管理员用户列表
['admin', 'users', userId]            // 单个用户详情
['shops', shopId, 'products']         // 店铺商品列表
['shops', shopId, 'products', 'active'] // 店铺活跃商品

// ❌ 不好的设计
['users']                             // 太宽泛，可能冲突
['products']                          // 缺少上下文
['data']                              // 无意义
```

---

## 缓存策略

### 默认配置
```typescript
{
  staleTime: 30_000,        // 30 秒内认为数据新鲜
  gcTime: 5 * 60_000,       // 5 分钟后清理缓存
  refetchOnWindowFocus: false, // 窗口聚焦不自动刷新
  retry: 1,                 // 失败重试 1 次
}
```

### 自定义配置

如需修改全局配置，编辑 `src/components/providers.tsx`：

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,    // 改为 60 秒
      retry: 2,             // 改为重试 2 次
    },
  },
});
```

---

## 迁移指南

### 从 `useResourceList` 迁移到 `useResourceQuery`

**步骤 1：替换 Hook**
```diff
- import { useResourceList } from '@/hooks/use-resource-list';
+ import { useResourceQuery } from '@/hooks/use-resource-query';

- const { items, loading, create, update, remove } = useResourceList<T>({
+ const { items, loading, create, update, remove } = useResourceQuery<T>({
    endpoint: '/api/admin/service-tags',
+   queryKey: ['admin', 'service-tags'],
  });
```

**步骤 2：移除手动 refresh 调用**
```diff
  async function handleSave() {
    const success = await create(data);
    if (success) {
      setShowDialog(false);
-     refresh(); // TanStack Query 自动刷新，无需手动调用
    }
  }
```

**完成！** 其他代码无需修改。

---

## 性能对比

### 场景：用户在服务标签页和费用模板页之间切换

**传统方式**：
1. 打开服务标签页 → 请求 `/api/admin/service-tags`（200ms）
2. 切换到费用模板页 → 请求 `/api/admin/fee-templates`（200ms）
3. 切回服务标签页 → **再次请求** `/api/admin/service-tags`（200ms）
4. 总耗时：**600ms**，3 次请求

**TanStack Query**：
1. 打开服务标签页 → 请求 `/api/admin/service-tags`（200ms）
2. 切换到费用模板页 → 请求 `/api/admin/fee-templates`（200ms）
3. 切回服务标签页 → **从缓存读取**（0ms）
4. 总耗时：**400ms**，2 次请求

**性能提升：33%**

---

## DevTools

TanStack Query 提供可视化 DevTools，方便调试。

### 启用 DevTools

编辑 `src/components/providers.tsx`：

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### 使用 DevTools

1. 打开应用，右下角会出现 TanStack Query 图标
2. 点击图标打开 DevTools
3. 查看所有查询的状态、缓存、重试次数等

---

## 常见问题

### Q: 为什么数据没有自动刷新？
A: 检查 `queryKey` 是否正确。不同的 `queryKey` 会被视为不同的查询。

### Q: 如何禁用缓存？
A: 设置 `staleTime: 0`，每次都重新请求。

### Q: 如何实现乐观更新？
A: 使用 `useMutation` 的 `onMutate` 回调，手动更新缓存。（高级用法，暂不推荐）

### Q: 如何清除缓存？
A: 调用 `queryClient.invalidateQueries({ queryKey })`。

---

## 最佳实践

1. **统一查询键命名** — 使用 `['admin', 'resource']` 格式
2. **避免过度缓存** — 实时性要求高的数据设置较短的 `staleTime`
3. **合理使用 refresh** — CRUD 操作会自动刷新，无需手动调用
4. **错误处理** — 使用 `onError` 回调记录错误日志
5. **DevTools 调试** — 开发环境启用 DevTools，生产环境禁用

---

## 下一步

- [ ] 迁移所有管理页面到 `useResourceQuery`
- [ ] 添加分页支持（`useInfiniteQuery`）
- [ ] 添加搜索/筛选支持（查询键包含参数）
- [ ] 添加乐观更新（提升操作反馈速度）
