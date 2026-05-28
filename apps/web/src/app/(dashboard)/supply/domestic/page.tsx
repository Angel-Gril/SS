'use client';

import { useEffect, useState } from 'react';
import { Truck, Loader2, Search, Package, TrendingUp, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface SupplyItem {
  id: string;
  title: string;
  sourcePlatform: string | null;
  supplier: string | null;
  purchasePrice: string | null;
  currency: string;
  sku: string | null;
  status: string;
  createdAt: string;
}

export default function SupplyDomesticPage() {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit), status: 'active' });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: SupplyItem[] }>(`/api/supply?${params}`);
    if (res.code === 1 && res.data) { setItems(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / limit);
  const totalCost = items.reduce((sum, i) => sum + (Number(i.purchasePrice) || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">国内货盘</h1>
        <p className="text-muted-foreground text-sm mt-1">国内仓库货盘管理，跟踪采购和库存状态</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">货源总数</div>
              <div className="text-xl font-bold">{total}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">采购总成本</div>
              <div className="text-xl font-bold">CNY {totalCost.toFixed(2)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">待采购</div>
              <div className="text-xl font-bold">{items.filter((i) => !i.purchasePrice).length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索商品名 / 供应商" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
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
                <TableHead>来源</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">采购价</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>添加时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    暂无国内货盘数据。请先在"货源管理"中添加货源。
                  </TableCell>
                </TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-sm max-w-xs truncate">{item.title}</TableCell>
                  <TableCell>
                    {item.sourcePlatform ? <Badge variant="outline">{item.sourcePlatform}</Badge> : '-'}
                  </TableCell>
                  <TableCell className="text-sm">{item.supplier || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{item.sku || '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.purchasePrice ? `${item.currency} ${item.purchasePrice}` : (
                      <Badge variant="warning">待定价</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'active' ? 'success' : 'secondary'}>
                      {item.status === 'active' ? '在售' : '停售'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
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
