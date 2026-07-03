'use client';

import { useEffect, useMemo, useState } from 'react';
import { Edit, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { useSystemDialog } from '@/components/system-dialog-provider';

type BlockType = 'BANNER' | 'QUICK_LINKS' | 'STEP_GROUP' | 'TUTORIALS' | 'UPDATE_CARD' | 'SUPPORT_LINKS' | 'CHECKLIST';
type TargetRole = 'ALL' | 'USER' | 'ADMIN' | 'STAFF';

interface DashboardContentBlock {
  id: string;
  key: string;
  type: BlockType;
  title: string;
  subtitle?: string | null;
  content: Record<string, unknown>;
  targetRole: TargetRole;
  enabled: boolean;
  sortOrder: number;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  key: string;
  type: BlockType;
  title: string;
  subtitle: string;
  contentText: string;
  targetRole: TargetRole;
  enabled: boolean;
  sortOrder: string;
  publishedAt: string;
  expiresAt: string;
}

const blockTypes: Array<{ value: BlockType; label: string }> = [
  { value: 'BANNER', label: '首页横幅' },
  { value: 'QUICK_LINKS', label: '快捷入口' },
  { value: 'STEP_GROUP', label: '运营步骤' },
  { value: 'TUTORIALS', label: '教程列表' },
  { value: 'UPDATE_CARD', label: '更新卡片' },
  { value: 'SUPPORT_LINKS', label: '帮助入口' },
  { value: 'CHECKLIST', label: '任务清单' },
];

const roleOptions: Array<{ value: TargetRole; label: string }> = [
  { value: 'ALL', label: '全部角色' },
  { value: 'USER', label: '用户' },
  { value: 'ADMIN', label: '管理员' },
  { value: 'STAFF', label: '仓库员' },
];

const contentTemplates: Record<BlockType, Record<string, unknown>> = {
  BANNER: {
    note: 'title/subtitle 字段会优先作为横幅内容，这里可补充 link 或 tags',
  },
  QUICK_LINKS: {
    links: [
      { label: '商品管理', href: '/products', description: '同步、价格、库存', icon: 'package' },
      { label: '店铺分析', href: '/shops/ozon/analytics', description: '图表和促销', icon: 'chart' },
    ],
  },
  STEP_GROUP: {
    groups: [
      {
        title: '开店前',
        tone: 'blue',
        items: [
          { title: '绑定 Ozon 店铺', href: '/shops/ozon' },
          { title: '同步 Cookie / companyId', href: '/shops/ozon' },
        ],
      },
    ],
  },
  TUTORIALS: {
    items: [
      { title: '插件安装与连接检查', href: '/help', description: '确认 ERP 后端、Ozon 登录态和扩展状态' },
    ],
  },
  UPDATE_CARD: {
    items: [],
  },
  SUPPORT_LINKS: {
    links: [
      { label: '帮助中心', href: '/help' },
      { label: '公告更新', href: '/announcements' },
    ],
  },
  CHECKLIST: {
    items: [
      { title: '检查 Ozon Cookie 是否有效', href: '/shops/ozon' },
    ],
  },
};

function emptyForm(type: BlockType = 'QUICK_LINKS'): FormState {
  return {
    key: '',
    type,
    title: '',
    subtitle: '',
    contentText: JSON.stringify(contentTemplates[type], null, 2),
    targetRole: 'ALL',
    enabled: true,
    sortOrder: '0',
    publishedAt: '',
    expiresAt: '',
  };
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoOrUndefined(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function typeLabel(type: string) {
  return blockTypes.find((item) => item.value === type)?.label || type;
}

export default function AdminDashboardContentPage() {
  const systemDialog = useSystemDialog();
  const [items, setItems] = useState<DashboardContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DashboardContentBlock | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    const res = await api.get<{ items: DashboardContentBlock[] }>('/api/dashboard-content/admin/list?pageSize=100');
    if (res.code === 1 && res.data) setItems(res.data.items);
    setLoading(false);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, DashboardContentBlock[]>();
    for (const item of items) {
      const list = map.get(item.type) || [];
      list.push(item);
      map.set(item.type, list);
    }
    return Array.from(map.entries());
  }, [items]);

  function openCreate(type: BlockType = 'QUICK_LINKS') {
    setEditing(null);
    setForm(emptyForm(type));
    setShowForm(true);
  }

  function openEdit(item: DashboardContentBlock) {
    setEditing(item);
    setForm({
      key: item.key,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle || '',
      contentText: JSON.stringify(item.content || {}, null, 2),
      targetRole: item.targetRole,
      enabled: item.enabled,
      sortOrder: String(item.sortOrder || 0),
      publishedAt: toLocalInput(item.publishedAt),
      expiresAt: toLocalInput(item.expiresAt),
    });
    setShowForm(true);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTypeChange(type: BlockType) {
    setForm((prev) => ({
      ...prev,
      type,
      contentText: prev.contentText.trim() && !editing
        ? JSON.stringify(contentTemplates[type], null, 2)
        : prev.contentText,
    }));
  }

  async function handleSubmit() {
    let content: Record<string, unknown>;
    try {
      const parsed = JSON.parse(form.contentText || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('内容必须是 JSON 对象');
      content = parsed;
    } catch (error: any) {
      toast({ title: '内容 JSON 无效', description: error?.message || '请检查格式', variant: 'destructive' });
      return;
    }

    if (!form.key.trim() || !form.title.trim()) {
      toast({ title: 'key 和标题不能为空', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        key: form.key.trim(),
        type: form.type,
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        content,
        targetRole: form.targetRole,
        enabled: form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
        publishedAt: toIsoOrUndefined(form.publishedAt),
        expiresAt: toIsoOrUndefined(form.expiresAt),
      };
      const res = editing
        ? await api.patch(`/api/dashboard-content/admin/${editing.id}`, payload)
        : await api.post('/api/dashboard-content/admin/create', payload);
      if (res.code === 1) {
        toast({ title: editing ? '已更新' : '已创建' });
        setShowForm(false);
        fetchData();
      } else {
        toast({ title: res.msg || '操作失败', variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: DashboardContentBlock) {
    const confirmed = await systemDialog.confirm({
      title: '删除首页内容',
      message: `确认删除「${item.title}」？`,
      confirmText: '删除',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.delete(`/api/dashboard-content/admin/${item.id}`);
    if (res.code === 1) {
      toast({ title: '已删除' });
      fetchData();
    } else {
      toast({ title: res.msg || '删除失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">首页内容管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">维护运营工作台的快捷入口、教程、步骤和横幅内容</p>
        </div>
        <Button onClick={() => openCreate()} className="gap-1.5">
          <Plus className="h-4 w-4" /> 新建内容
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">暂无自定义首页内容，用户首页会显示系统默认运营入口。</p>
            <Button size="sm" onClick={() => openCreate('QUICK_LINKS')}>创建快捷入口</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([type, list]) => (
            <section key={type} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{typeLabel(type)}</h2>
                <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
              </div>
              <div className="space-y-2">
                {list.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="flex items-start justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.title}</span>
                          <Badge variant={item.enabled ? 'success' : 'secondary'} className="text-[10px]">
                            {item.enabled ? '启用' : '停用'}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{item.targetRole}</Badge>
                          <Badge variant="outline" className="text-[10px]">排序 {item.sortOrder}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          key: {item.key}
                          {item.subtitle ? ` · ${item.subtitle}` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑首页内容' : '新建首页内容'}</DialogTitle>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>key</Label>
                <Input value={form.key} onChange={(event) => set('key', event.target.value)} placeholder="ozon-quick-links" disabled={!!editing} />
              </div>
              <div>
                <Label>类型</Label>
                <select
                  value={form.type}
                  onChange={(event) => handleTypeChange(event.target.value as BlockType)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {blockTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <Label>排序</Label>
                <Input type="number" value={form.sortOrder} onChange={(event) => set('sortOrder', event.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>标题</Label>
                <Input value={form.title} onChange={(event) => set('title', event.target.value)} />
              </div>
              <div>
                <Label>副标题</Label>
                <Input value={form.subtitle} onChange={(event) => set('subtitle', event.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>目标角色</Label>
                <select
                  value={form.targetRole}
                  onChange={(event) => set('targetRole', event.target.value as TargetRole)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {roleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <Label>发布时间</Label>
                <Input type="datetime-local" value={form.publishedAt} onChange={(event) => set('publishedAt', event.target.value)} />
              </div>
              <div>
                <Label>过期时间</Label>
                <Input type="datetime-local" value={form.expiresAt} onChange={(event) => set('expiresAt', event.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
              启用
            </label>

            <div>
              <Label>内容 JSON</Label>
              <textarea
                value={form.contentText}
                onChange={(event) => set('contentText', event.target.value)}
                className="mt-1 min-h-[260px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                spellCheck={false}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? '处理中...' : (editing ? '更新' : '创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
