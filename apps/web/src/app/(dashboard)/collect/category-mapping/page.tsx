'use client';

import { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import {
  buildOzonCategoryTargetFormPatch,
  searchOzonCategoryTargets,
  type OzonCategoryTarget,
} from '@/lib/category-mapping-targets';
import { formatDate } from '@/lib/utils';

interface CategoryMapping {
  id: string;
  userId: string | null;
  sourcePlatform: string;
  sourceCategoryId: string | null;
  sourceCategoryName: string | null;
  sourceCategoryPath: string | null;
  targetPlatform: string;
  targetCategoryId: number;
  targetTypeId: number;
  targetCategoryName: string | null;
  targetCategoryPath: string | null;
  defaultWeightG: number | null;
  defaultLengthMm: number | null;
  defaultWidthMm: number | null;
  defaultHeightMm: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Shop {
  id: string;
  name: string;
  platform: string;
  status?: string | null;
}

const emptyForm = {
  sourcePlatform: '1688',
  sourceCategoryId: '',
  sourceCategoryName: '',
  sourceCategoryPath: '',
  targetCategoryId: '',
  targetTypeId: '',
  targetCategoryName: '',
  targetCategoryPath: '',
  defaultWeightG: '',
  defaultLengthMm: '',
  defaultWidthMm: '',
  defaultHeightMm: '',
  notes: '',
};

type MappingForm = typeof emptyForm;

const PLATFORM_LABELS: Record<string, string> = {
  '1688': '1688',
  pinduoduo: '拼多多',
  taobao: '淘宝',
  other: '其他',
};

export default function CategoryMappingPage() {
  const [rows, setRows] = useState<CategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sourcePlatform, setSourcePlatform] = useState('1688');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryMapping | null>(null);
  const [form, setForm] = useState<MappingForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [ozonShops, setOzonShops] = useState<Shop[]>([]);
  const [targetShopId, setTargetShopId] = useState('');
  const [targetCategoryTree, setTargetCategoryTree] = useState<unknown[]>([]);
  const [targetCategoryLoadedShopId, setTargetCategoryLoadedShopId] = useState('');
  const [targetCategoryQuery, setTargetCategoryQuery] = useState('');
  const [targetCategoryLoading, setTargetCategoryLoading] = useState(false);
  const targetCategoryResults = searchOzonCategoryTargets(targetCategoryTree, targetCategoryQuery, { limit: 20 });

  useEffect(() => { fetchRows(); }, [search, sourcePlatform]);
  useEffect(() => { fetchShops(); }, []);

  async function fetchRows() {
    setLoading(true);
    const params = new URLSearchParams();
    if (sourcePlatform) params.set('sourcePlatform', sourcePlatform);
    if (search) params.set('search', search);
    const res = await api.get<CategoryMapping[]>(`/api/supply/category-mappings?${params}`);
    if (res.code === 1 && res.data) setRows(res.data);
    setLoading(false);
  }

  async function fetchShops() {
    const res = await api.get<Shop[]>('/api/shops');
    if (res.code === 1 && res.data) {
      const shops = res.data.filter((shop) => shop.platform === 'OZON');
      setOzonShops(shops);
      if (!targetShopId && shops[0]) setTargetShopId(shops[0].id);
    }
  }

  function updateForm(key: keyof MappingForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, sourcePlatform });
    setTargetCategoryQuery('');
    setDialogOpen(true);
  }

  function openEdit(row: CategoryMapping) {
    setEditing(row);
    setForm({
      sourcePlatform: row.sourcePlatform || '1688',
      sourceCategoryId: row.sourceCategoryId || '',
      sourceCategoryName: row.sourceCategoryName || '',
      sourceCategoryPath: row.sourceCategoryPath || '',
      targetCategoryId: String(row.targetCategoryId || ''),
      targetTypeId: String(row.targetTypeId || ''),
      targetCategoryName: row.targetCategoryName || '',
      targetCategoryPath: row.targetCategoryPath || '',
      defaultWeightG: row.defaultWeightG ? String(row.defaultWeightG) : '',
      defaultLengthMm: row.defaultLengthMm ? String(row.defaultLengthMm) : '',
      defaultWidthMm: row.defaultWidthMm ? String(row.defaultWidthMm) : '',
      defaultHeightMm: row.defaultHeightMm ? String(row.defaultHeightMm) : '',
      notes: row.notes || '',
    });
    setTargetCategoryQuery(row.targetCategoryName || row.targetCategoryPath || '');
    setDialogOpen(true);
  }

  async function fetchTargetCategories() {
    if (!targetShopId) {
      toast({ title: '请先选择 OZON 店铺', variant: 'destructive' });
      return;
    }
    setTargetCategoryLoading(true);
    const res = await api.get<unknown[]>(`/api/listing/categories?shopId=${encodeURIComponent(targetShopId)}`);
    setTargetCategoryLoading(false);
    if (res.code === 1 && Array.isArray(res.data)) {
      setTargetCategoryTree(res.data);
      setTargetCategoryLoadedShopId(targetShopId);
    } else {
      toast({ title: res.msg || '获取 OZON 类目失败', variant: 'destructive' });
    }
  }

  function selectTargetCategory(target: OzonCategoryTarget) {
    const patch = buildOzonCategoryTargetFormPatch(target);
    setForm((prev) => ({ ...prev, ...patch }));
    setTargetCategoryQuery(target.label);
  }

  function buildPayload() {
    return {
      sourcePlatform: form.sourcePlatform,
      sourceCategoryId: form.sourceCategoryId || undefined,
      sourceCategoryName: form.sourceCategoryName || undefined,
      sourceCategoryPath: form.sourceCategoryPath || undefined,
      targetCategoryId: Number(form.targetCategoryId),
      targetTypeId: Number(form.targetTypeId),
      targetCategoryName: form.targetCategoryName || undefined,
      targetCategoryPath: form.targetCategoryPath || undefined,
      defaultWeightG: form.defaultWeightG ? Number(form.defaultWeightG) : undefined,
      defaultLengthMm: form.defaultLengthMm ? Number(form.defaultLengthMm) : undefined,
      defaultWidthMm: form.defaultWidthMm ? Number(form.defaultWidthMm) : undefined,
      defaultHeightMm: form.defaultHeightMm ? Number(form.defaultHeightMm) : undefined,
      notes: form.notes || undefined,
    };
  }

  async function handleSave() {
    if (!form.sourceCategoryId && !form.sourceCategoryName && !form.sourceCategoryPath) {
      toast({ title: '来源类目 ID、名称或路径至少填写一项', variant: 'destructive' });
      return;
    }
    if (!form.targetCategoryId || !form.targetTypeId) {
      toast({ title: '请填写 OZON 类目 ID 和 type ID', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const res = editing
      ? await api.put<CategoryMapping>(`/api/supply/category-mappings/${editing.id}`, buildPayload())
      : await api.post<CategoryMapping>('/api/supply/category-mappings', buildPayload());
    setSaving(false);
    if (res.code === 1) {
      toast({ title: editing ? '类目映射已更新' : '类目映射已创建' });
      setDialogOpen(false);
      await fetchRows();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  async function handleDelete(row: CategoryMapping) {
    if (!window.confirm(`确认删除映射 ${row.sourceCategoryName || row.sourceCategoryId || row.id}？`)) return;
    const res = await api.delete(`/api/supply/category-mappings/${row.id}`);
    if (res.code === 1) {
      toast({ title: '已删除' });
      await fetchRows();
    } else {
      toast({ title: res.msg || '删除失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">类目映射</h1>
          <p className="text-muted-foreground text-sm mt-1">维护 1688/淘宝/拼多多 来源类目到 OZON 类目和 type 的默认映射</p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          新增映射
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={sourcePlatform}
              onChange={(event) => setSourcePlatform(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
            >
              <option value="1688">1688</option>
              <option value="taobao">淘宝</option>
              <option value="pinduoduo">拼多多</option>
              <option value="other">其他</option>
            </select>
            <form
              className="flex gap-2 sm:flex-1 sm:max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchInput.trim());
              }}
            >
              <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索来源类目 / OZON 类目" className="h-9" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground sm:ml-auto">共 {rows.length} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>来源类目</TableHead>
                  <TableHead>目标 OZON</TableHead>
                  <TableHead>默认尺寸</TableHead>
                  <TableHead>范围</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">暂无类目映射</TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{PLATFORM_LABELS[row.sourcePlatform] || row.sourcePlatform}</Badge>
                        <span className="font-medium truncate">{row.sourceCategoryName || row.sourceCategoryId || row.sourceCategoryPath || '-'}</span>
                      </div>
                      {row.sourceCategoryPath && <div className="text-xs text-muted-foreground mt-1 truncate">{row.sourceCategoryPath}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">category {row.targetCategoryId} / type {row.targetTypeId}</div>
                      {(row.targetCategoryName || row.targetCategoryPath) && (
                        <div className="text-xs text-muted-foreground mt-1 truncate max-w-xs">{row.targetCategoryName || row.targetCategoryPath}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>重量 {row.defaultWeightG ? `${row.defaultWeightG}g` : '-'}</div>
                      <div>
                        {row.defaultLengthMm || row.defaultWidthMm || row.defaultHeightMm
                          ? `${row.defaultLengthMm || '-'} x ${row.defaultWidthMm || '-'} x ${row.defaultHeightMm || '-'} mm`
                          : '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.userId ? 'success' : 'secondary'}>{row.userId ? '我的映射' : '全局默认'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {row.userId ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(row)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(row)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">只读</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden">
            {loading ? (
              <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">暂无类目映射</div>
            ) : (
              <div className="divide-y">
                {rows.map((row) => (
                  <div key={row.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{PLATFORM_LABELS[row.sourcePlatform] || row.sourcePlatform}</Badge>
                          <Badge variant={row.userId ? 'success' : 'secondary'}>{row.userId ? '我的映射' : '全局默认'}</Badge>
                        </div>
                        <div className="mt-2 font-medium text-sm leading-5 break-words">
                          {row.sourceCategoryName || row.sourceCategoryId || row.sourceCategoryPath || '-'}
                        </div>
                        {row.sourceCategoryPath && <div className="mt-1 text-xs text-muted-foreground break-words">{row.sourceCategoryPath}</div>}
                      </div>
                      {row.userId ? (
                        <div className="flex shrink-0 gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDelete(row)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="font-mono text-xs">category {row.targetCategoryId} / type {row.targetTypeId}</div>
                      {(row.targetCategoryName || row.targetCategoryPath) && (
                        <div className="mt-1 text-xs text-muted-foreground break-words">{row.targetCategoryName || row.targetCategoryPath}</div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                      <div>
                        <div>默认重量</div>
                        <div className="mt-0.5 text-foreground">{row.defaultWeightG ? `${row.defaultWeightG}g` : '-'}</div>
                      </div>
                      <div>
                        <div>默认尺寸</div>
                        <div className="mt-0.5 text-foreground">
                          {row.defaultLengthMm || row.defaultWidthMm || row.defaultHeightMm
                            ? `${row.defaultLengthMm || '-'} x ${row.defaultWidthMm || '-'} x ${row.defaultHeightMm || '-'} mm`
                            : '-'}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div>更新时间</div>
                        <div className="mt-0.5 text-foreground">{formatDate(row.updatedAt)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? '编辑类目映射' : '新增类目映射'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">来源平台</Label>
                <select
                  value={form.sourcePlatform}
                  onChange={(event) => updateForm('sourcePlatform', event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="1688">1688</option>
                  <option value="taobao">淘宝</option>
                  <option value="pinduoduo">拼多多</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <Field label="来源类目 ID" value={form.sourceCategoryId} onChange={(value) => updateForm('sourceCategoryId', value)} placeholder="可选" />
              <Field label="来源类目名称" value={form.sourceCategoryName} onChange={(value) => updateForm('sourceCategoryName', value)} placeholder="手机壳" />
            </div>
            <Field label="来源类目路径" value={form.sourceCategoryPath} onChange={(value) => updateForm('sourceCategoryPath', value)} placeholder="数码配件 > 手机配件 > 手机壳" />

            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
                <div className="space-y-1">
                  <Label className="text-xs">OZON 店铺</Label>
                  <select
                    value={targetShopId}
                    onChange={(event) => {
                      setTargetShopId(event.target.value);
                      setTargetCategoryTree([]);
                      setTargetCategoryLoadedShopId('');
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {ozonShops.length === 0 ? (
                      <option value="">暂无 OZON 店铺</option>
                    ) : (
                      ozonShops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)
                    )}
                  </select>
                </div>
                <form
                  className="space-y-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    fetchTargetCategories();
                  }}
                >
                  <Label className="text-xs">OZON 类目搜索</Label>
                  <div className="flex gap-2">
                    <Input
                      value={targetCategoryQuery}
                      onChange={(event) => setTargetCategoryQuery(event.target.value)}
                      placeholder="俄文名称 / category ID / type ID"
                      className="h-9"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={targetCategoryLoading || !targetShopId}>
                      {targetCategoryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </form>
              </div>
              {targetCategoryLoadedShopId ? (
                targetCategoryResults.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto rounded-md border bg-background">
                    {targetCategoryResults.map((target) => (
                      <button
                        key={`${target.categoryId}:${target.typeId}`}
                        type="button"
                        onClick={() => selectTargetCategory(target)}
                        className="flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{target.label}</span>
                          <span className="mt-1 block font-mono text-xs text-muted-foreground">category {target.categoryId} / type {target.typeId}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border bg-background px-3 py-6 text-center text-sm text-muted-foreground">暂无匹配类目</div>
                )
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="OZON 类目 ID *" value={form.targetCategoryId} onChange={(value) => updateForm('targetCategoryId', value)} type="number" />
              <Field label="OZON type ID *" value={form.targetTypeId} onChange={(value) => updateForm('targetTypeId', value)} type="number" />
              <Field label="OZON 类目名称" value={form.targetCategoryName} onChange={(value) => updateForm('targetCategoryName', value)} placeholder="Чехлы" />
              <Field label="OZON 类目路径" value={form.targetCategoryPath} onChange={(value) => updateForm('targetCategoryPath', value)} placeholder="Электроника > Аксессуары" />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <Field label="默认重量 g" value={form.defaultWeightG} onChange={(value) => updateForm('defaultWeightG', value)} type="number" />
              <Field label="长 mm" value={form.defaultLengthMm} onChange={(value) => updateForm('defaultLengthMm', value)} type="number" />
              <Field label="宽 mm" value={form.defaultWidthMm} onChange={(value) => updateForm('defaultWidthMm', value)} type="number" />
              <Field label="高 mm" value={form.defaultHeightMm} onChange={(value) => updateForm('defaultHeightMm', value)} type="number" />
            </div>

            <Field label="备注" value={form.notes} onChange={(value) => updateForm('notes', value)} placeholder="可选" />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
