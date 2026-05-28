'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface AccountRow {
  userId: string;
  phone: string;
  nickname: string | null;
  role: string;
  balance: string;
  creditLimit: string;
  billingMode: string;
  frozenAmount: string;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rechargeTarget, setRechargeTarget] = useState<AccountRow | null>(null);
  const [editTarget, setEditTarget] = useState<AccountRow | null>(null);
  const limit = 20;
// PLACEHOLDER_ADMIN_ACCOUNTS

  async function loadAccounts() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: AccountRow[] }>(`/api/admin/accounts?${params}`);
    if (res.code === 1 && res.data) {
      setAccounts(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => { loadAccounts(); }, [page]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    loadAccounts();
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">账户管理</h1>
        <p className="text-muted-foreground mt-1">管理用户账户余额、计费模式和充值</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">用户账户列表</CardTitle>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索手机号/昵称"
              className="w-48"
            />
            <Button type="submit" size="sm" variant="outline">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">暂无数据</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead className="text-right">余额</TableHead>
                  <TableHead>模式</TableHead>
                  <TableHead className="text-right">月结额度</TableHead>
                  <TableHead className="text-right">冻结</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acc) => (
                  <TableRow key={acc.userId}>
                    <TableCell className="font-medium">{acc.nickname || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{acc.phone}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <span className={Number(acc.balance) < 0 ? 'text-destructive' : ''}>
                        {formatCurrency(acc.balance)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={acc.billingMode === 'monthly' ? 'warning' : 'secondary'}>
                        {acc.billingMode === 'monthly' ? '月结' : '预充值'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {acc.billingMode === 'monthly' ? formatCurrency(acc.creditLimit) : '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(acc.frozenAmount)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setRechargeTarget(acc)}>
                          <Wallet className="h-3 w-3 mr-1" /> 充值
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(acc)}>
                          设置
                        </Button>
                      </div>
                    </TableCell>
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

      {rechargeTarget && (
        <RechargeDialog
          account={rechargeTarget}
          onClose={() => setRechargeTarget(null)}
          onSuccess={() => { setRechargeTarget(null); loadAccounts(); }}
        />
      )}

      {editTarget && (
        <EditAccountDialog
          account={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); loadAccounts(); }}
        />
      )}
    </div>
  );
}
// PLACEHOLDER_DIALOGS

function RechargeDialog({ account, onClose, onSuccess }: { account: AccountRow; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast({ title: '请输入有效金额', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post(`/api/admin/accounts/${account.userId}/recharge`, {
      amount: Number(amount),
      description: desc || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '充值成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '充值失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>充值 - {account.nickname || account.phone}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>当前余额</Label>
            <div className="text-lg font-bold">{formatCurrency(account.balance)}</div>
          </div>
          <div className="space-y-2">
            <Label>充值金额 (元)</Label>
            <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="请输入金额" required />
          </div>
          <div className="space-y-2">
            <Label>备注 (可选)</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="充值备注" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              确认充值
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountDialog({ account, onClose, onSuccess }: { account: AccountRow; onClose: () => void; onSuccess: () => void }) {
  const [billingMode, setBillingMode] = useState(account.billingMode);
  const [creditLimit, setCreditLimit] = useState(account.creditLimit);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.put(`/api/admin/accounts/${account.userId}`, {
      billingMode,
      creditLimit: Number(creditLimit),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '更新成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '更新失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>账户设置 - {account.nickname || account.phone}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>计费模式</Label>
            <select
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="prepaid">预充值</option>
              <option value="monthly">月结</option>
            </select>
          </div>
          {billingMode === 'monthly' && (
            <div className="space-y-2">
              <Label>月结额度 (元)</Label>
              <Input type="number" step="0.01" min="0" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="月结额度" />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
