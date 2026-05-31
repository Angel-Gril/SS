# 通用业务组件使用指南

本文档介绍如何使用通用业务组件快速构建 CRUD 页面。

---

## 组件清单

### 1. `useResourceList` Hook
**路径**: `src/hooks/use-resource-list.ts`

封装资源列表的 CRUD 操作，自动处理加载状态、错误提示、数据刷新。

**API**:
```typescript
const { items, loading, refresh, create, update, remove } = useResourceList<T>({
  endpoint: '/api/admin/xxx',
  onError?: (error: string) => void,
});
```

### 2. `ResourceListLayout` 组件
**路径**: `src/components/resource-list-layout.tsx`

封装列表页的通用布局：标题、创建按钮、加载状态、空状态。

**Props**:
- `title` — 页面标题
- `description` — 页面描述（可选）
- `loading` — 加载状态
- `isEmpty` — 是否为空
- `emptyMessage` — 空状态提示
- `onCreateClick` — 创建按钮点击回调
- `createLabel` — 创建按钮文本（默认"新增"）
- `children` — 列表内容

### 3. `ResourceDialog` 组件
**路径**: `src/components/resource-dialog.tsx`

封装资源编辑对话框的通用布局和保存/取消逻辑。

**Props**:
- `open` — 对话框打开状态
- `onOpenChange` — 状态变更回调
- `title` — 对话框标题
- `children` — 表单内容
- `onSave` — 保存回调
- `saving` — 保存中状态
- `saveLabel` — 保存按钮文本（默认"保存"）
- `cancelLabel` — 取消按钮文本（默认"取消"）

### 4. 表单字段组件
**路径**: `src/components/form-fields.tsx`

封装常用表单字段的布局和交互。

**组件**:
- `FormField` — 通用字段容器（Label + 字段 + 描述）
- `TextField` — 文本输入字段
- `SelectField` — 下拉选择字段
- `CheckboxField` — 复选框字段

---

## 使用示例

### 完整示例：服务标签管理页面

```tsx
'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useResourceList } from '@/hooks/use-resource-list';
import { ResourceListLayout } from '@/components/resource-list-layout';
import { ResourceDialog } from '@/components/resource-dialog';
import { TextField, SelectField, CheckboxField } from '@/components/form-fields';

interface ServiceTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  fee: string;
  needInspection: boolean;
  sortOrder: number;
}

const COLORS = [
  { value: 'green', label: '绿色', class: 'bg-green-500' },
  { value: 'yellow', label: '黄色', class: 'bg-yellow-500' },
  { value: 'red', label: '红色', class: 'bg-red-500' },
];

export default function ServiceTagsPage() {
  // 1. 使用 useResourceList Hook 管理数据
  const { items, loading, create, update, remove } = useResourceList<ServiceTag>({
    endpoint: '/api/admin/service-tags',
  });

  // 2. 对话框状态
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<ServiceTag | null>(null);
  const [form, setForm] = useState({
    name: '',
    color: 'green',
    description: '',
    fee: '0',
    needInspection: false,
    sortOrder: 0,
  });
  const [saving, setSaving] = useState(false);

  // 3. 打开创建对话框
  function openCreate() {
    setEditing(null);
    setForm({ name: '', color: 'green', description: '', fee: '0', needInspection: false, sortOrder: items.length + 1 });
    setShowDialog(true);
  }

  // 4. 打开编辑对话框
  function openEdit(tag: ServiceTag) {
    setEditing(tag);
    setForm({
      name: tag.name,
      color: tag.color,
      description: tag.description || '',
      fee: tag.fee,
      needInspection: tag.needInspection,
      sortOrder: tag.sortOrder,
    });
    setShowDialog(true);
  }

  // 5. 保存（创建或更新）
  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = { ...form, fee: parseFloat(form.fee) || 0 };
    const success = editing ? await update(editing.id, payload) : await create(payload);
    setSaving(false);
    if (success) setShowDialog(false);
  }

  // 6. 删除
  async function handleDelete(id: string) {
    if (confirm('确定删除？')) await remove(id);
  }

  return (
    <>
      {/* 列表布局 */}
      <ResourceListLayout
        title="服务标签设置"
        description="配置仓库服务类型和对应费用，用户下单时可选择"
        loading={loading}
        isEmpty={items.length === 0}
        onCreateClick={openCreate}
        createLabel="新增标签"
      >
        <div className="space-y-2">
          {items.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
              <div className={`w-4 h-4 rounded-full bg-${tag.color}-500`} />
              <div className="flex-1">
                <span className="font-medium">{tag.name}</span>
                {tag.description && <span className="text-sm text-muted-foreground ml-2">{tag.description}</span>}
              </div>
              <span className="text-sm font-mono">{parseFloat(tag.fee) > 0 ? `¥${tag.fee}` : '免费'}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(tag)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(tag.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </ResourceListLayout>

      {/* 编辑对话框 */}
      <ResourceDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        title={editing ? '编辑标签' : '新增标签'}
        onSave={handleSave}
        saving={saving}
      >
        <TextField
          label="标签名称"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          placeholder="如：拆包验视"
          required
        />

        <SelectField
          label="颜色"
          value={form.color}
          onChange={(v) => setForm({ ...form, color: v })}
          options={COLORS}
        />

        <TextField
          label="描述"
          value={form.description}
          onChange={(v) => setForm({ ...form, description: v })}
          placeholder="可选"
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="服务费 (元)"
            value={form.fee}
            onChange={(v) => setForm({ ...form, fee: v })}
            type="number"
          />
          <TextField
            label="排序"
            value={String(form.sortOrder)}
            onChange={(v) => setForm({ ...form, sortOrder: parseInt(v) || 0 })}
            type="number"
          />
        </div>

        <CheckboxField
          label="需要验视流程（入库后需验视通过才能出库）"
          checked={form.needInspection}
          onChange={(v) => setForm({ ...form, needInspection: v })}
        />
      </ResourceDialog>
    </>
  );
}
```

---

## 代码对比

### 重构前（164 行）
- 手动管理 loading、items、showDialog、editing、form、saving 状态
- 手动实现 fetchTags、openCreate、openEdit、handleSave、handleDelete
- 重复的布局代码（标题、按钮、Card、加载状态、空状态）
- 重复的表单字段布局（Label + Input + 描述）

### 重构后（~120 行）
- `useResourceList` 自动管理 CRUD 操作
- `ResourceListLayout` 封装列表布局
- `ResourceDialog` 封装对话框布局
- `TextField/SelectField/CheckboxField` 封装表单字段
- **减少 ~27% 代码量，提升可维护性**

---

## 适用场景

适合以下类型的页面：
- ✅ 管理后台的 CRUD 页面（用户、标签、模板、配置等）
- ✅ 列表 + 创建/编辑对话框的标准布局
- ✅ 简单的表单字段（文本、下拉、复选框）

不适合：
- ❌ 复杂的多步骤表单
- ❌ 需要自定义布局的页面
- ❌ 非标准的 CRUD 操作（如批量操作、拖拽排序）

---

## 扩展建议

### 1. 添加批量操作支持
```typescript
// useResourceList 添加 bulkDelete
const bulkDelete = useCallback(async (ids: string[]): Promise<boolean> => {
  const res = await api.post(`${endpoint}/bulk-delete`, { ids });
  // ...
}, [endpoint, refresh]);
```

### 2. 添加搜索/筛选支持
```typescript
// useResourceList 添加 query 参数
const { items, loading, setQuery } = useResourceList<T>({
  endpoint: '/api/admin/xxx',
  query: { status: 'active', keyword: '' },
});
```

### 3. 添加分页支持
```typescript
// useResourceList 添加 pagination
const { items, loading, page, pageSize, total, setPage } = useResourceList<T>({
  endpoint: '/api/admin/xxx',
  pagination: true,
});
```

---

## 迁移指南

### 步骤 1：识别可迁移的页面
查找符合以下特征的页面：
- 使用 `useState` 管理 `loading`、`items`、`showDialog`、`editing`、`form`
- 有 `fetch*`、`openCreate`、`openEdit`、`handleSave`、`handleDelete` 函数
- 布局为：标题 + 创建按钮 + Card + 列表 + 对话框

### 步骤 2：替换数据管理逻辑
```diff
- const [items, setItems] = useState<T[]>([]);
- const [loading, setLoading] = useState(true);
- async function fetchItems() { ... }
+ const { items, loading, create, update, remove } = useResourceList<T>({
+   endpoint: '/api/admin/xxx',
+ });
```

### 步骤 3：替换布局组件
```diff
- <div className="space-y-6">
-   <div className="flex items-center justify-between">
-     <h1 className="text-2xl font-bold">标题</h1>
-     <Button onClick={openCreate}>新增</Button>
-   </div>
-   <Card>...</Card>
- </div>
+ <ResourceListLayout
+   title="标题"
+   loading={loading}
+   isEmpty={items.length === 0}
+   onCreateClick={openCreate}
+ >
+   {/* 列表内容 */}
+ </ResourceListLayout>
```

### 步骤 4：替换对话框
```diff
- <Dialog open={showDialog} onOpenChange={setShowDialog}>
-   <DialogContent>
-     <DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>
-     {/* 表单 */}
-     <DialogFooter>
-       <Button onClick={() => setShowDialog(false)}>取消</Button>
-       <Button onClick={handleSave}>保存</Button>
-     </DialogFooter>
-   </DialogContent>
- </Dialog>
+ <ResourceDialog
+   open={showDialog}
+   onOpenChange={setShowDialog}
+   title="..."
+   onSave={handleSave}
+   saving={saving}
+ >
+   {/* 表单 */}
+ </ResourceDialog>
```

### 步骤 5：替换表单字段
```diff
- <div className="space-y-2">
-   <Label>名称 *</Label>
-   <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
- </div>
+ <TextField
+   label="名称"
+   value={form.name}
+   onChange={(v) => setForm({ ...form, name: v })}
+   required
+ />
```

---

## 注意事项

1. **类型安全**：确保泛型 `T` 包含 `id: string` 字段
2. **错误处理**：`useResourceList` 已内置 toast 提示，无需手动处理
3. **刷新时机**：CRUD 操作成功后自动刷新，无需手动调用 `refresh()`
4. **表单验证**：在 `handleSave` 中添加自定义验证逻辑
5. **样式定制**：所有组件支持 `className` prop 覆盖样式
