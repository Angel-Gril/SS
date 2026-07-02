'use client';

import { useEffect, useState } from 'react';
import { Plus, ArrowDownToLine, ArrowUpFromLine, Search, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface InventoryItem {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  costPrice: string | null;
  location: string | null;
  remark: string | null;
  updatedAt: string;
}

interface InventoryRecord {
  id: string;
  sku: string;
  productName: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  costPrice: string | null;
  reason: string | null;
  createdAt: string;
}

export default function InventoryPage() {
  const systemDialog = useSystemDialog();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'items' | 'records'>('items');
  const [addOpen, setAddOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordType, setRecordType] = useState<'IN' | 'OUT'>('IN');
  const limit = 20;

  async function loadItems() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: InventoryItem[] }>(`/api/inventory?${params}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  async function loadRecords() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    const res = await api.get<{ total: number; rows: InventoryRecord[] }>(`/api/inventory/records?${params}`);
    if (res.code === 1 && res.data) {
      setRecords(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (tab === 'items') loadItems();
    else loadRecords();
  }, [tab, page, search]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  }

  async function handleDelete(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '删除库存项',
      message: '确认删除此库存项？',
      confirmText: '删除',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.delete(`/api/inventory/${id}`);
    toast({ title: res.msg, variant: res.code === 1 ? 'default' : 'destructive' });
    if (res.code === 1) loadItems();
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">库存管理</h1>
          <p className="text-muted-foreground mt-1">管理商品库存、入库和出库</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setRecordType('IN'); setRecordOpen(true); }}>
            <ArrowDownToLine className="h-4 w-4" /> 入库
          </Button>
          <Button variant="outline" onClick={() => { setRecordType('OUT'); setRecordOpen(true); }}>
            <ArrowUpFromLine className="h-4 w-4" /> 出库
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> 新增库存
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <Button size="sm" variant={tab === 'items' ? 'default' : 'outline'} onClick={() => { setTab('items'); setPage(0); }}>
                库存列表
              </Button>
              <Button size="sm" variant={tab === 'records' ? 'default' : 'outline'} onClick={() => { setTab('records'); setPage(0); }}>
                出入库记录
              </Button>
            </div>
            {tab === 'items' && (
              <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-sm ml-4">
                <Input placeholder="搜索 SKU / 商品名" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
                <Button type="submit" size="sm" variant="outline"><Search className="h-3.5 w-3.5" /></Button>
              </form>
            )}
            <span className="ml-auto text-sm text-muted-foreground">共 {total} 条</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : tab === 'items' ? (
            items.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">暂无库存数据</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>商品名称</TableHead>
                    <TableHead className="text-right">库存数量</TableHead>
                    <TableHead className="text-right">成本价</TableHead>
                    <TableHead>库位</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        <span className={item.quantity <= 0 ? 'text-destructive' : ''}>{item.quantity}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.costPrice ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{item.location || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : (
            records.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">暂无出入库记录</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类型</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>商品名称</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">成本价</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><RecordTypeBadge type={r.type} /></TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell>{r.productName}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.costPrice ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.reason || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一页</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onSuccess={loadItems} />
      <RecordDialog open={recordOpen} onOpenChange={setRecordOpen} type={recordType} onSuccess={() => { loadItems(); loadRecords(); }} />
    </div>
  );
}

function RecordTypeBadge({ type }: { type: string }) {
  if (type === 'IN') return <Badge variant="success">入库</Badge>;
  if (type === 'OUT') return <Badge variant="warning">出库</Badge>;
  return <Badge variant="secondary">调整</Badge>;
}

function AddItemDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ sku: '', productName: '', quantity: '0', costPrice: '', location: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.post('/api/inventory', {
      sku: form.sku,
      productName: form.productName,
      quantity: Number(form.quantity) || 0,
      costPrice: form.costPrice ? Number(form.costPrice) : undefined,
      location: form.location || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '创建成功' });
      setForm({ sku: '', productName: '', quantity: '0', costPrice: '', location: '' });
      onOpenChange(false);
      onSuccess();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>新增库存项</DialogTitle><DialogDescription>添加一个新的 SKU 到库存系统</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required /></div>
            <div className="space-y-1"><Label>商品名称</Label><Input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>初始数量</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div className="space-y-1"><Label>成本价</Label><Input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></div>
            <div className="space-y-1"><Label>库位</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({ open, onOpenChange, type, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; type: 'IN' | 'OUT'; onSuccess: () => void }) {
  const [form, setForm] = useState({ sku: '', quantity: '', costPrice: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.post('/api/inventory/record', {
      sku: form.sku,
      type,
      quantity: Number(form.quantity),
      costPrice: form.costPrice ? Number(form.costPrice) : undefined,
      reason: form.reason || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setForm({ sku: '', quantity: '', costPrice: '', reason: '' });
      onOpenChange(false);
      onSuccess();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{type === 'IN' ? '入库操作' : '出库操作'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="输入已有 SKU" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>数量</Label><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></div>
            <div className="space-y-1"><Label>成本价 (可选)</Label><Input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label>原因 (可选)</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="采购入库 / 订单出库 / 盘点调整" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}确认{type === 'IN' ? '入库' : '出库'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
