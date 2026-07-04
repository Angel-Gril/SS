'use client';

import { useEffect, useState } from 'react';
import { Loader2, Truck, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Bill {
  id: string;
  shopId: string;
  orderId: string | null;
  trackingNumber: string;
  weight: number | null;
  fee: string;
  country: string | null;
  shippingMethod: string | null;
  status: string;
  settledAt: string | null;
  remark: string | null;
  createdAt: string;
}

interface Summary {
  shopId: string;
  shopName: string;
  platform: string;
  totalCount: number;
  totalFee: string;
  pendingCount: number;
  pendingFee: string;
}

export default function LogisticsBillPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const limit = 20;
// PLACEHOLDER_LOGISTICS_CONTINUE

  async function loadBills() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const res = await api.get<{ total: number; rows: Bill[] }>(`/api/logistics-bills?${params}`);
    if (res.code === 1 && res.data) {
      setBills(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  async function loadSummary() {
    const res = await api.get<Summary[]>('/api/logistics-bills/summary');
    if (res.code === 1 && res.data) setSummary(res.data);
  }

  async function handleSettle() {
    if (selected.size === 0) return;
    const res = await api.post<any>('/api/logistics-bills/settle', { ids: Array.from(selected) });
    if (res.code === 1) {
      setSelected(new Set());
      loadBills();
      loadSummary();
    }
  }

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { loadBills(); }, [page, statusFilter]);

  const totalPages = Math.ceil(total / limit);
  const pendingBills = bills.filter((b) => b.status === 'pending');
  const allPendingSelected = pendingBills.length > 0 && pendingBills.every((b) => selected.has(b.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">物流账单</h1>
          <p className="text-muted-foreground mt-1">物流费用明细与结算管理</p>
        </div>
        {selected.size > 0 && (
          <Button onClick={handleSettle}>
            <CheckCircle className="h-4 w-4" /> 批量结算 ({selected.size})
          </Button>
        )}
      </div>

      {summary.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {summary.map((s) => (
            <Card key={s.shopId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Truck className="h-4 w-4" /> {s.shopName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{s.totalCount} 单</div>
                <div className="text-xs text-muted-foreground mt-1">
                  总费用: ¥{s.totalFee} · 待结算: ¥{s.pendingFee} ({s.pendingCount}单)
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">账单明细</CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="pending">待结算</option>
            <option value="settled">已结算</option>
          </select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    disabled={pendingBills.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(pendingBills.map((b) => b.id)));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                    className="rounded"
                  />
                </TableHead>
                <TableHead>物流单号</TableHead>
                <TableHead>重量(g)</TableHead>
                <TableHead>费用</TableHead>
                <TableHead>国家</TableHead>
                <TableHead>运输方式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-muted-foreground">
                    暂无账单
                  </TableCell>
                </TableRow>
              ) : (
                bills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell>
                      {bill.status === 'pending' && (
                        <input
                          type="checkbox"
                          checked={selected.has(bill.id)}
                          onChange={() => toggleSelect(bill.id)}
                          className="rounded"
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{bill.trackingNumber}</TableCell>
                    <TableCell>{bill.weight ?? '-'}</TableCell>
                    <TableCell className="font-medium tabular-nums">¥{bill.fee}</TableCell>
                    <TableCell>{bill.country || '-'}</TableCell>
                    <TableCell>{bill.shippingMethod || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={bill.status === 'settled' ? 'success' : 'warning'}>
                        {bill.status === 'settled' ? '已结算' : '待结算'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(bill.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页 · 共 {total} 条</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一页</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
