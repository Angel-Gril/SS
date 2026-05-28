'use client';

import { useEffect, useState } from 'react';
import { PackageMinus, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface OutboundRecord {
  id: string;
  type: 'OUT';
  quantity: number;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  item?: { sku: string; productName: string };
}

export default function OutboundPage() {
  const [records, setRecords] = useState<OutboundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ type: 'OUT', offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: OutboundRecord[] }>(`/api/inventory/records?${params}`);
    if (res.code === 1 && res.data) { setRecords(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">库存发货</h1>
        <p className="text-muted-foreground text-sm mt-1">从本地库存出库发货的记录</p>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索 SKU / 商品名" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-64" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条出库记录</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>商品</TableHead><TableHead>出库数量</TableHead><TableHead>原因</TableHead><TableHead>操作人</TableHead><TableHead>出库时间</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">暂无出库记录</TableCell></TableRow>
              ) : records.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell className="font-mono text-xs">{rec.item?.sku || '-'}</TableCell>
                  <TableCell>{rec.item?.productName || '-'}</TableCell>
                  <TableCell><Badge variant="secondary">-{rec.quantity}</Badge></TableCell>
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
    </div>
  );
}
