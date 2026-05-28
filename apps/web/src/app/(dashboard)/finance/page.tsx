'use client';

import { useEffect, useState } from 'react';
import { Wallet, Loader2, CreditCard, Snowflake, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

interface AccountInfo {
  id: string;
  userId: string;
  balance: string;
  creditLimit: string;
  billingMode: string;
  frozenAmount: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  orderId: string | null;
  description: string | null;
  operator: string | null;
  createdAt: string;
}

export default function FinancePage() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const limit = 20;
// PLACEHOLDER_FINANCE_CONTINUE

  async function loadAccount() {
    const res = await api.get<AccountInfo>('/api/account');
    if (res.code === 1 && res.data) setAccount(res.data);
  }

  async function loadTransactions() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);
    const res = await api.get<{ total: number; rows: Transaction[] }>(`/api/account/transactions?${params}`);
    if (res.code === 1 && res.data) {
      setTransactions(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => { loadAccount(); }, []);
  useEffect(() => { loadTransactions(); }, [page, typeFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">财务管理</h1>
          <p className="text-muted-foreground mt-1">账户余额与交易流水</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            api.download(`/api/export/transactions`, `transactions_${new Date().toISOString().slice(0, 10)}.csv`);
          }}
        >
          <FileDown className="h-4 w-4" /> 导出流水
        </Button>
      </div>

      {account && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Wallet className="h-4 w-4" /> 账户余额
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{formatCurrency(account.balance)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Snowflake className="h-4 w-4" /> 冻结金额
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{formatCurrency(account.frozenAmount)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <CreditCard className="h-4 w-4" /> 账户模式
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={account.billingMode === 'monthly' ? 'warning' : 'secondary'}>
                {account.billingMode === 'monthly' ? '月结' : '预充值'}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">月结额度</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">
                {account.billingMode === 'monthly' ? formatCurrency(account.creditLimit) : '-'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">交易流水</CardTitle>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">全部类型</option>
            <option value="recharge">充值</option>
            <option value="deduct_service">服务费</option>
            <option value="deduct_shipping">快递费</option>
            <option value="refund">退款</option>
            <option value="adjustment">调整</option>
          </select>
        </CardHeader>
        <CardContent className="p-0">
          {loading && transactions.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">暂无记录</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead className="text-right">余额</TableHead>
                  <TableHead>关联订单</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell><TxnTypeBadge type={txn.type} /></TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <span className={Number(txn.amount) < 0 ? 'text-destructive' : 'text-orange-600'}>
                        {Number(txn.amount) > 0 ? '+' : ''}{txn.amount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{txn.balanceAfter}</TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{txn.orderId || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{txn.description || '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(txn.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
    </div>
  );
}

function TxnTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' | 'warning' }> = {
    recharge: { label: '充值', variant: 'success' },
    deduct_service: { label: '服务费', variant: 'destructive' },
    deduct_shipping: { label: '快递费', variant: 'destructive' },
    refund: { label: '退款', variant: 'warning' },
    adjustment: { label: '调整', variant: 'secondary' },
  };
  const info = map[type] || { label: type, variant: 'secondary' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}
