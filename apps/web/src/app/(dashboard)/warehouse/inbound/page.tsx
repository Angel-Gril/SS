'use client';

import { useEffect, useState } from 'react';
import { PackagePlus, Loader2, Search, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface InboundRecord {
  id: string;
  type: 'IN';
  quantity: number;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  item?: { sku: string; productName: string };
}

export default function InboundPage() {
  const [records, setRecords] = useState<InboundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [formData, setFormData] = useState({ trackingNumber: '', sku: '', quantity: '1', source: '' });
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ type: 'IN', offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: InboundRecord[] }>(`/api/inventory/records?${params}`);
    if (res.code === 1 && res.data) { setRecords(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleInbound() {
    toast({ title: '入库成功', description: `${formData.sku} x${formData.quantity} 已入库` });
    setShowDialog(false);
    fetchData();
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">快递入库</h1>
          <p className="text-muted-foreground text-sm mt-1">快递到仓后扫码入库，记录入库信息</p>
        </div>
        <Button onClick={() => setShowDialog(true)}>
          <PackagePlus className="mr-2 h-4 w-4" /> 快递入库
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-blue-100 text-blue-600"><PackagePlus className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">今日入库</p><p className="text-2xl font-bold">{records.filter(r => new Date(r.createdAt).toDateString() === new Date().toDateString()).length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-green-100 text-green-600"><Truck className="h-5 w-5" /></div><div><p className="text-sm text-muted-foreground">总入库</p><p className="text-2xl font-bold">{total}</p></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索快递单号/SKU" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-64" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>商品</TableHead><TableHead>数量</TableHead><TableHead>来源/备注</TableHead><TableHead>操作人</TableHead><TableHead>入库时间</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">暂无入库记录</TableCell></TableRow>
              ) : records.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell className="font-mono text-xs">{rec.item?.sku || '-'}</TableCell>
                  <TableCell>{rec.item?.productName || '-'}</TableCell>
                  <TableCell><Badge variant="default">+{rec.quantity}</Badge></TableCell>
                  <TableCell>{rec.reason || '-'}</TableCell>
                  <TableCell>{rec.operator || '-'}</TableCell>
                  <TableCell className="text-sm">{formatDate(rec.createdAt)}</TableCell>
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

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>快递入库</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div><label className="text-sm font-medium">快递单号</label><Input value={formData.trackingNumber} onChange={(e) => setFormData({...formData, trackingNumber: e.target.value})} placeholder="扫描或输入快递单号" /></div>
            <div><label className="text-sm font-medium">商品 SKU</label><Input value={formData.sku} onChange={(e) => setFormData({...formData, sku: e.target.value})} placeholder="商品 SKU" /></div>
            <div><label className="text-sm font-medium">数量</label><Input type="number" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: e.target.value})} min="1" /></div>
            <div><label className="text-sm font-medium">来源</label><Input value={formData.source} onChange={(e) => setFormData({...formData, source: e.target.value})} placeholder="如: 拼多多/淘宝/1688" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={handleInbound}>确认入库</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
