'use client';

import { useEffect, useState } from 'react';
import { Package, Loader2, Plus, Search, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { sourcePlatformLabel } from '@/lib/source-platforms';
import { formatDate } from '@/lib/utils';

interface SupplyItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  supplier: string | null;
  purchasePrice: string | null;
  currency: string;
  sku: string | null;
  mappedProductId: string | null;
  status: string;
  createdAt: string;
}

export default function SupplyGoodsPage() {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: SupplyItem[] }>(`/api/supply?${params}`);
    if (res.code === 1 && res.data) { setItems(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await api.delete(`/api/supply/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchData(); }
    else toast({ title: res.msg, variant: 'destructive' });
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">货源管理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理采购货源、供应商信息和价格对比</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> 添加货源
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索商品名 / 供应商 / SKU" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名称</TableHead>
                <TableHead>来源平台</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">采购价</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    暂无货源。点击"添加货源"录入采购信息。
                  </TableCell>
                </TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-sm max-w-xs">
                    <div className="truncate">{item.title}</div>
                    {item.sourceUrl && (
                      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 mt-0.5">
                        查看源链接 <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.sourcePlatform ? (
                      <Badge variant="outline">{sourcePlatformLabel(item.sourcePlatform)}</Badge>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-sm">{item.supplier || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{item.sku || '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.purchasePrice ? `${item.currency} ${item.purchasePrice}` : '-'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(item.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateSupplyDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); fetchData(); }} />
    </div>
  );
}

function CreateSupplyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourcePlatform, setSourcePlatform] = useState('1688');
  const [supplier, setSupplier] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sku, setSku] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!title) { toast({ title: '请填写商品名称', variant: 'destructive' }); return; }
    setSubmitting(true);
    const res = await api.post('/api/supply', {
      title, sourcePlatform,
      sourceUrl: sourceUrl || undefined,
      supplier: supplier || undefined,
      purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
      sku: sku || undefined,
      notes: notes || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '货源已添加' });
      setTitle(''); setSourceUrl(''); setSupplier(''); setPurchasePrice(''); setSku(''); setNotes('');
      onCreated();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>添加货源</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">商品名称 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="商品名称" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">来源平台</Label>
              <select value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="1688">1688</option>
                <option value="pinduoduo">拼多多</option>
                <option value="pdd">拼多多(PDD)</option>
                <option value="taobao">淘宝</option>
                <option value="tmall">天猫</option>
                <option value="jd">京东</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">采购价 (CNY)</Label>
              <Input type="number" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">源链接</Label>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://detail.1688.com/offer/... / 淘宝 / 天猫 / 京东 / 拼多多商品链接" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">供应商</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="供应商名称" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="商品编号" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">备注</Label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="采购备注..." className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !title}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
