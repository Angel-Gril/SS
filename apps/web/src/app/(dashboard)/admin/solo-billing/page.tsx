'use client';

import { useEffect, useState } from 'react';
import { Loader2, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

interface BillingRow {
  id: string;
  userId: string;
  month: string;
  orderCount: number;
  totalFee: string;
  paidAt: string | null;
  createdAt: string;
  user: { phone: string; nickname: string | null } | null;
}

export default function SoloBillingPage() {
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  async function load() {
    setLoading(true);
    const res = await api.get<BillingRow[]>(`/api/admin/solo-billing?month=${month}`);
    if (res.code === 1 && res.data) setRows(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, [month]);

  const totalOrders = rows.reduce((s, r) => s + r.orderCount, 0);
  const totalFee = rows.reduce((s, r) => s + parseFloat(r.totalFee), 0);

  function exportCSV() {
    const header = '月份,用户,手机号,订单数,总费用,生成时间\n';
    const body = rows.map((r) =>
      `${r.month},${r.user?.nickname || '-'},${r.user?.phone || '-'},${r.orderCount},${r.totalFee},${new Date(r.createdAt).toLocaleString()}`
    ).join('\n');
    const blob = new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solo-billing-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SoloSeller 账单</h1>
          <p className="text-muted-foreground mt-1">个人卖家月度服务费汇总</p>
        </div>
        <div className="flex gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />刷新</Button>
          <Button variant="outline" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1" />导出 CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">用户数</div>
            <div className="text-2xl font-bold mt-1">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">总订单数</div>
            <div className="text-2xl font-bold mt-1">{totalOrders}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">总服务费</div>
            <div className="text-2xl font-bold mt-1 text-orange-600">¥{totalFee.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{month} 月度明细</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>手机号</TableHead>
                <TableHead className="text-right">订单数</TableHead>
                <TableHead className="text-right">总费用</TableHead>
                <TableHead>生成时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                    该月暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.user?.nickname || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{r.user?.phone || '-'}</TableCell>
                    <TableCell className="text-right">{r.orderCount}</TableCell>
                    <TableCell className="text-right font-medium">¥{r.totalFee}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
