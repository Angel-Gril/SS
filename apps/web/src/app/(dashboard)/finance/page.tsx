'use client';

import { useEffect, useState } from 'react';
import {
  CreditCard,
  ExternalLink,
  FileDown,
  Loader2,
  QrCode,
  Snowflake,
  Upload,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, uploadDirect } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

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

interface PaymentProvider {
  id: string;
  name: string;
  supportedMethods: string[];
  minAmount: string;
  maxAmount: string;
  feeRate: string | null;
  feeFixed: string | null;
  feePayer: string;
}

interface ManualQr {
  id: string;
  method: string;
  name: string;
  accountName: string | null;
  qrcodeImage: string;
  minAmount: string;
  maxAmount: string;
}

interface PaymentMethods {
  auto: PaymentProvider[];
  manual: ManualQr[];
}

interface RechargeOrder {
  id: string;
  orderNo: string;
  amount: string;
  fee: string;
  actualAmount: string;
  paymentMethod: string;
  paymentType: string;
  status: string;
  payUrl: string | null;
  qrcodeUrl: string | null;
  proofImage: string | null;
  proofNote: string | null;
  createdAt: string;
  expireAt: string;
  manualQrCode?: ManualQr | null;
}

export default function FinancePage() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recharges, setRecharges] = useState<RechargeOrder[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods>({ auto: [], manual: [] });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const limit = 20;

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

  async function loadRecharges() {
    const res = await api.get<{ total: number; rows: RechargeOrder[] }>('/api/recharges?limit=8');
    if (res.code === 1 && res.data) setRecharges(res.data.rows);
  }

  async function loadPaymentMethods() {
    const res = await api.get<PaymentMethods>('/api/recharges/payment-methods');
    if (res.code === 1 && res.data) setPaymentMethods(res.data);
  }

  useEffect(() => {
    loadAccount();
    loadPaymentMethods();
    loadRecharges();
  }, []);
  useEffect(() => { loadTransactions(); }, [page, typeFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">财务管理</h1>
          <p className="text-muted-foreground mt-1">账户余额与交易流水</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setRechargeOpen(true)}>
            <CreditCard className="h-4 w-4" /> 充值
          </Button>
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

      <RechargeOrdersCard rows={recharges} onRefresh={() => { loadRecharges(); loadAccount(); loadTransactions(); }} />

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

      {rechargeOpen && (
        <RechargeDialog
          methods={paymentMethods}
          onClose={() => setRechargeOpen(false)}
          onSuccess={() => {
            setRechargeOpen(false);
            loadRecharges();
            loadAccount();
            loadTransactions();
          }}
        />
      )}
    </div>
  );
}

function RechargeOrdersCard({ rows, onRefresh }: { rows: RechargeOrder[]; onRefresh: () => void }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">最近充值订单</CardTitle>
        <Button size="sm" variant="outline" onClick={onRefresh}>刷新</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>方式</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.orderNo}</TableCell>
                <TableCell>{order.paymentType === 'manual' ? '人工充值' : methodLabel(order.paymentMethod)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(order.actualAmount)}</TableCell>
                <TableCell><RechargeStatusBadge status={order.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                <TableCell>
                  {order.payUrl && order.status === 'pending' ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={order.payUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> 支付
                      </a>
                    </Button>
                  ) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RechargeDialog({
  methods,
  onClose,
  onSuccess,
}: {
  methods: PaymentMethods;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const defaultProvider = methods.auto[0];
  const defaultManual = methods.manual[0];
  const [paymentType, setPaymentType] = useState<'auto' | 'manual'>(defaultProvider ? 'auto' : 'manual');
  const [amount, setAmount] = useState('100');
  const [paymentMethod, setPaymentMethod] = useState(defaultProvider?.supportedMethods[0] || defaultManual?.method || 'alipay');
  const [providerId, setProviderId] = useState(defaultProvider?.id || '');
  const [createdOrder, setCreatedOrder] = useState<RechargeOrder | null>(null);
  const [proofNote, setProofNote] = useState('');
  const [proofImage, setProofImage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast({ title: '请输入有效金额', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post<RechargeOrder>('/api/recharges', {
      amount: Number(amount),
      paymentMethod,
      paymentType,
      providerId: paymentType === 'auto' ? providerId || undefined : undefined,
    });
    setSubmitting(false);
    if (res.code !== 1 || !res.data) {
      toast({ title: res.msg || '创建充值订单失败', variant: 'destructive' });
      return;
    }
    setCreatedOrder(res.data);
    if (res.data.payUrl) window.open(res.data.payUrl, '_blank', 'noopener,noreferrer');
    toast({ title: '充值订单已创建' });
  }

  async function uploadProofFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    const result = await uploadDirect(file);
    setUploading(false);
    if (!result.ok) {
      toast({ title: result.msg, variant: 'destructive' });
      return;
    }
    setProofImage(result.url);
    toast({ title: '凭证图片已上传' });
  }

  async function submitProof() {
    if (!createdOrder) return;
    if (!proofImage && !proofNote.trim()) {
      toast({ title: '请上传截图或填写付款备注', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post(`/api/recharges/${createdOrder.id}/upload-proof`, {
      proofImage: proofImage || undefined,
      proofNote: proofNote || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '付款凭证已提交' });
      onSuccess();
    } else {
      toast({ title: res.msg || '提交失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>账户充值</DialogTitle>
        </DialogHeader>
        {!createdOrder ? (
          <form onSubmit={createOrder} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>充值金额</Label>
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>充值方式</Label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as 'auto' | 'manual')}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="auto" disabled={methods.auto.length === 0}>在线支付</option>
                  <option value="manual" disabled={methods.manual.length === 0}>人工转账</option>
                </select>
              </div>
            </div>

            {paymentType === 'auto' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>支付网关</Label>
                  <select
                    value={providerId}
                    onChange={(e) => {
                      const next = methods.auto.find((p) => p.id === e.target.value);
                      setProviderId(e.target.value);
                      setPaymentMethod(next?.supportedMethods[0] || 'alipay');
                    }}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {methods.auto.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>支付渠道</Label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {(methods.auto.find((p) => p.id === providerId)?.supportedMethods || ['alipay', 'wxpay']).map((method) => (
                      <option key={method} value={method}>{methodLabel(method)}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>收款渠道</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {[...new Set(methods.manual.map((q) => q.method))].map((method) => (
                    <option key={method} value={method}>{methodLabel(method)}</option>
                  ))}
                </select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={submitting || (paymentType === 'auto' && methods.auto.length === 0) || (paymentType === 'manual' && methods.manual.length === 0)}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建订单
              </Button>
            </DialogFooter>
          </form>
        ) : createdOrder.paymentType === 'manual' ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="rounded-md border bg-white p-2">
                {createdOrder.qrcodeUrl ? (
                  <img src={createdOrder.qrcodeUrl} alt="收款码" className="h-40 w-40 object-contain" />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-muted-foreground">
                    <QrCode className="h-12 w-12" />
                  </div>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="font-mono">{createdOrder.orderNo}</div>
                <div>金额：<span className="font-semibold">{formatCurrency(createdOrder.amount)}</span></div>
                <div>渠道：{methodLabel(createdOrder.paymentMethod)}</div>
                <div>状态：<RechargeStatusBadge status={createdOrder.status} /></div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>付款截图</Label>
                <Input type="file" accept="image/*" onChange={(e) => uploadProofFile(e.target.files?.[0] || null)} disabled={uploading} />
                {proofImage && <div className="truncate text-xs text-muted-foreground">{proofImage}</div>}
              </div>
              <div className="space-y-2">
                <Label>付款备注</Label>
                <Input value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="订单号后6位或转账备注" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
              <Button onClick={submitProof} disabled={submitting || uploading}>
                {submitting || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                提交凭证
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-4">
              <div className="font-mono text-sm">{createdOrder.orderNo}</div>
              <div className="mt-2 text-2xl font-semibold">{formatCurrency(createdOrder.amount)}</div>
              <div className="mt-2"><RechargeStatusBadge status={createdOrder.status} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
              {createdOrder.payUrl && (
                <Button asChild>
                  <a href={createdOrder.payUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> 打开支付页
                  </a>
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function RechargeStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' | 'warning' }> = {
    pending: { label: '待支付', variant: 'warning' },
    proof_submitted: { label: '待审核', variant: 'warning' },
    paid: { label: '已到账', variant: 'success' },
    rejected: { label: '已拒绝', variant: 'destructive' },
    cancelled: { label: '已取消', variant: 'secondary' },
    timeout: { label: '已超时', variant: 'secondary' },
    failed: { label: '失败', variant: 'destructive' },
  };
  const info = map[status] || { label: status, variant: 'secondary' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function methodLabel(method: string) {
  const map: Record<string, string> = {
    alipay: '支付宝',
    wxpay: '微信支付',
    qqpay: 'QQ 钱包',
    manual: '人工转账',
  };
  return map[method] || method;
}
