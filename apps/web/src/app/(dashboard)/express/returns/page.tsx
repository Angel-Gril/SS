'use client';

import { useEffect, useState } from 'react';
import { Package, Loader2, Search, Truck, MapPin, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface ReturnRow {
  id: string;
  platformReturnId: string;
  postingNumber: string | null;
  status: string;
  reason: string | null;
  product: any;
  quantity: number;
  amount: string | null;
  currency: string;
  returnedToWarehouse: boolean;
  acceptedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
  shop: { name: string; platform: string };
}

export default function ExpressReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: ReturnRow[] }>(`/api/returns?${params}`);
    if (res.code === 1 && res.data) { setRows(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / limit);
  const inTransit = rows.filter((r) => !r.returnedToWarehouse).length;
  const arrived = rows.filter((r) => r.returnedToWarehouse).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">退货物流</h1>
        <p className="text-muted-foreground text-sm mt-1">跟踪退货包裹的物流状态和到仓情况</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Truck className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">运输中</div>
              <div className="text-xl font-bold">{inTransit}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <MapPin className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">已到仓</div>
              <div className="text-xl font-bold">{arrived}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">总退货件</div>
              <div className="text-xl font-bold">{total}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索订单号 / 退货编号" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>退货编号</TableHead>
                <TableHead>关联订单</TableHead>
                <TableHead>商品</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>退货原因</TableHead>
                <TableHead>物流状态</TableHead>
                <TableHead>退货时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    暂无退货物流记录。请先在退货管理中同步数据。
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.platformReturnId}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.postingNumber || '-'}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{r.product?.name || '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{r.reason || '-'}</TableCell>
                  <TableCell>
                    {r.returnedToWarehouse ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 已到仓
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="gap-1">
                        <Truck className="h-3 w-3" /> 运输中
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.returnedAt ? formatDate(r.returnedAt) : formatDate(r.createdAt)}
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
    </div>
  );
}
