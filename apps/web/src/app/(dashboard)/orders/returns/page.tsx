'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';

interface Shop { id: string; name: string; platform: string; }

interface ReturnRow {
  id: string;
  shopId: string;
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

interface ReturnStats {
  total: number;
  byStatus: Record<string, number>;
}

export default function OrderReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [stats, setStats] = useState<ReturnStats | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [shopId, setShopId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
    loadStats();
  }, []);

  useEffect(() => { fetchData(); }, [search, page, shopId, status]);

  async function loadStats() {
    const res = await api.get<ReturnStats>('/api/returns/stats');
    if (res.code === 1 && res.data) setStats(res.data);
  }

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    if (shopId) params.set('shopId', shopId);
    if (status) params.set('status', status);
    const res = await api.get<{ total: number; rows: ReturnRow[] }>(`/api/returns?${params}`);
    if (res.code === 1 && res.data) { setRows(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleSync() {
    const target = shopId || shops.find((s) => s.platform === 'OZON')?.id;
    if (!target) {
      toast({ title: '请先添加 OZON 店铺', variant: 'destructive' });
      return;
    }
    setSyncing(true);
    const res = await api.post('/api/returns/sync', { shopId: target });
    setSyncing(false);
    toast({
      title: res.code === 1 ? '同步完成' : '同步失败',
      description: res.msg,
      variant: res.code === 1 ? 'default' : 'destructive',
    });
    if (res.code === 1) {
      loadStats();
      fetchData();
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">退货管理</h1>
          <p className="text-muted-foreground text-sm mt-1">查看 OZON 平台退货记录和处理状态</p>
        </div>
        <Button onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          同步退货
        </Button>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <StatMini label="总退货" value={String(stats.total)} />
          <StatMini label="已退回仓库" value={String(stats.byStatus.returned_to_seller || 0)} />
          <StatMini label="处理中" value={String(stats.byStatus.processing || 0)} highlight />
          <StatMini label="待审核" value={String(stats.byStatus.awaiting_review || 0)} highlight />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={shopId}
              onChange={(e) => { setShopId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部店铺</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部状态</option>
              {stats && Object.keys(stats.byStatus).map((s) => (
                <option key={s} value={s}>{s} ({stats.byStatus[s]})</option>
              ))}
            </select>
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input
                placeholder="搜索订单号 / 退货编号"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9"
              />
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
                <TableHead>店铺</TableHead>
                <TableHead>商品</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>退回仓库</TableHead>
                <TableHead>退货时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                    暂无退货记录。请点击右上角“同步退货”从 OZON 拉取数据。
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.platformReturnId}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.postingNumber || '-'}</TableCell>
                  <TableCell><Badge variant="outline">{r.shop.platform}</Badge> <span className="ml-1.5 text-sm">{r.shop.name}</span></TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{r.product?.name || '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.amount ? formatCurrency(r.amount, r.currency) : '-'}</TableCell>
                  <TableCell><ReturnStatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{r.reason || '-'}</TableCell>
                  <TableCell>
                    {r.returnedToWarehouse ? <Badge variant="success">已退回</Badge> : <Badge variant="secondary">未退回</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.returnedAt ? formatDate(r.returnedAt) : formatDate(r.createdAt)}</TableCell>
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

function ReturnStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'default' }> = {
    returned_to_seller: { label: '已退回卖家', variant: 'success' },
    awaiting_return: { label: '等待退货', variant: 'warning' },
    processing: { label: '处理中', variant: 'default' },
    awaiting_review: { label: '待审核', variant: 'warning' },
    rejected: { label: '已拒绝', variant: 'destructive' },
    accepted: { label: '已接受', variant: 'success' },
  };
  const info = map[status] || { label: status, variant: 'secondary' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function StatMini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold mt-1 ${highlight ? 'text-amber-600 dark:text-amber-400' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
