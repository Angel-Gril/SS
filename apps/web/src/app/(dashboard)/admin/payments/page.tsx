'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, Plus, QrCode, RefreshCw, Upload, XCircle } from 'lucide-react';
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
import { useSystemDialog } from '@/components/system-dialog-provider';
import { api, uploadDirect } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

type ViewKey = 'recharges' | 'providers' | 'qrcodes' | 'logs';

interface Provider {
  id: string;
  type: string;
  name: string;
  isEnabled: boolean;
  priority: number;
  gatewayUrl: string | null;
  merchantId: string | null;
  supportedMethods: string[];
  minAmount: string;
  maxAmount: string;
  dailyLimit: string | null;
  feeRate: string | null;
  feeFixed: string | null;
  feePayer: string;
}

interface ManualQr {
  id: string;
  method: string;
  name: string;
  qrcodeImage: string;
  accountName: string | null;
  minAmount: string;
  maxAmount: string;
  dailyLimit: string | null;
  weight: number;
  isEnabled: boolean;
}

interface RechargeOrder {
  id: string;
  orderNo: string;
  amount: string;
  actualAmount: string;
  paymentMethod: string;
  paymentType: string;
  status: string;
  proofImage: string | null;
  proofNote: string | null;
  createdAt: string;
  user?: { phone: string; nickname: string | null; accountCode: string | null };
  provider?: { name: string };
}

interface NotifyLog {
  id: string;
  providerId: string;
  orderId: string | null;
  signValid: boolean | null;
  isSuccess: boolean;
  errorMessage: string | null;
  response: string | null;
  createdAt: string;
  provider?: { name: string };
  order?: RechargeOrder | null;
}

const emptyProvider = {
  type: 'epay',
  name: '',
  isEnabled: false,
  priority: 0,
  gatewayUrl: '',
  merchantId: '',
  merchantKey: '',
  supportedMethods: 'alipay,wxpay',
  minAmount: '10',
  maxAmount: '5000',
  dailyLimit: '',
  feeRate: '',
  feeFixed: '',
  feePayer: 'platform',
};

const emptyQr = {
  method: 'alipay',
  name: '',
  qrcodeImage: '',
  accountName: '',
  minAmount: '10',
  maxAmount: '5000',
  dailyLimit: '',
  weight: '100',
  isEnabled: true,
};

export default function AdminPaymentsPage() {
  const systemDialog = useSystemDialog();
  const [view, setView] = useState<ViewKey>('recharges');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [qrcodes, setQrcodes] = useState<ManualQr[]>([]);
  const [recharges, setRecharges] = useState<RechargeOrder[]>([]);
  const [logs, setLogs] = useState<NotifyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerDialog, setProviderDialog] = useState<Provider | null | 'new'>(null);
  const [qrDialog, setQrDialog] = useState<ManualQr | null | 'new'>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [providerRes, qrRes, rechargeRes, logRes] = await Promise.all([
      api.get<Provider[]>('/api/admin/payments/providers'),
      api.get<ManualQr[]>('/api/admin/payments/qrcodes'),
      api.get<{ total: number; rows: RechargeOrder[] }>('/api/admin/payments/recharges?limit=50'),
      api.get<{ total: number; rows: NotifyLog[] }>('/api/admin/payments/notify-logs?limit=30'),
    ]);
    if (providerRes.code === 1 && providerRes.data) setProviders(providerRes.data);
    if (qrRes.code === 1 && qrRes.data) setQrcodes(qrRes.data);
    if (rechargeRes.code === 1 && rechargeRes.data) setRecharges(rechargeRes.data.rows);
    if (logRes.code === 1 && logRes.data) setLogs(logRes.data.rows);
    setLoading(false);
  }

  async function approve(id: string) {
    const res = await api.post(`/api/admin/payments/recharges/${id}/approve`);
    if (res.code === 1) {
      toast({ title: '已审核入账' });
      loadAll();
    } else {
      toast({ title: res.msg || '审核失败', variant: 'destructive' });
    }
  }

  async function reject(id: string) {
    const reason = await systemDialog.prompt({
      title: '拒绝充值',
      message: '请输入拒绝原因。',
      placeholder: '例如：凭证不清晰、金额不一致',
      confirmText: '确认拒绝',
      tone: 'destructive',
    });
    if (!reason) return;
    const res = await api.post(`/api/admin/payments/recharges/${id}/reject`, { reason });
    if (res.code === 1) {
      toast({ title: '已拒绝' });
      loadAll();
    } else {
      toast({ title: res.msg || '操作失败', variant: 'destructive' });
    }
  }

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> 充值与支付
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">易支付自动充值与人工转账审核</p>
        </div>
        <Button size="sm" variant="outline" onClick={loadAll}>
          <RefreshCw className="h-4 w-4" /> 刷新
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['recharges', '充值订单'],
          ['providers', '支付网关'],
          ['qrcodes', '人工收款码'],
          ['logs', '回调日志'],
        ].map(([key, label]) => (
          <Button key={key} size="sm" variant={view === key ? 'default' : 'outline'} onClick={() => setView(key as ViewKey)}>
            {label}
          </Button>
        ))}
      </div>

      {view === 'recharges' && (
        <RechargeTable rows={recharges} onApprove={approve} onReject={reject} />
      )}
      {view === 'providers' && (
        <ProviderTable rows={providers} onCreate={() => setProviderDialog('new')} onEdit={setProviderDialog} />
      )}
      {view === 'qrcodes' && (
        <QrTable rows={qrcodes} onCreate={() => setQrDialog('new')} onEdit={setQrDialog} />
      )}
      {view === 'logs' && <NotifyLogTable rows={logs} />}

      {providerDialog && (
        <ProviderDialog
          provider={providerDialog === 'new' ? null : providerDialog}
          onClose={() => setProviderDialog(null)}
          onSuccess={() => { setProviderDialog(null); loadAll(); }}
        />
      )}
      {qrDialog && (
        <QrDialog
          qr={qrDialog === 'new' ? null : qrDialog}
          onClose={() => setQrDialog(null)}
          onSuccess={() => { setQrDialog(null); loadAll(); }}
        />
      )}
    </div>
  );
}

function RechargeTable({ rows, onApprove, onReject }: { rows: RechargeOrder[]; onApprove: (id: string) => void; onReject: (id: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">充值订单</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>订单</TableHead>
              <TableHead>通道</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>凭证</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <div className="font-medium">{order.user?.nickname || '-'}</div>
                  <div className="font-mono text-xs text-muted-foreground">{order.user?.phone || '-'}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{order.orderNo}</TableCell>
                <TableCell>{order.paymentType === 'manual' ? '人工充值' : order.provider?.name || '-'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(order.actualAmount)}</TableCell>
                <TableCell><StatusBadge status={order.status} /></TableCell>
                <TableCell className="max-w-48">
                  {order.proofImage ? (
                    <a href={order.proofImage} target="_blank" rel="noreferrer" className="text-primary text-xs">查看截图</a>
                  ) : <span className="text-muted-foreground text-xs">{order.proofNote || '-'}</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                <TableCell>
                  {order.paymentType === 'manual' && ['pending', 'proof_submitted'].includes(order.status) ? (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => onApprove(order.id)}><CheckCircle2 className="h-3.5 w-3.5" /> 通过</Button>
                      <Button size="sm" variant="outline" onClick={() => onReject(order.id)}><XCircle className="h-3.5 w-3.5" /> 拒绝</Button>
                    </div>
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

function ProviderTable({ rows, onCreate, onEdit }: { rows: Provider[]; onCreate: () => void; onEdit: (p: Provider) => void }) {
  async function testProvider(id: string) {
    const res = await api.post<{ sign: string }>(`/api/admin/payments/providers/${id}/test`);
    if (res.code === 1) toast({ title: '签名测试通过', description: res.data?.sign });
    else toast({ title: res.msg || '测试失败', variant: 'destructive' });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">支付网关</CardTitle>
        <Button size="sm" onClick={onCreate}><Plus className="h-4 w-4" /> 新建网关</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>PID</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>限额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell className="font-medium">{provider.name}</TableCell>
                <TableCell className="font-mono text-xs">{provider.merchantId || '-'}</TableCell>
                <TableCell>{provider.supportedMethods.map(methodLabel).join(' / ')}</TableCell>
                <TableCell>{formatCurrency(provider.minAmount)} - {formatCurrency(provider.maxAmount)}</TableCell>
                <TableCell><Badge variant={provider.isEnabled ? 'success' : 'secondary'}>{provider.isEnabled ? '启用' : '停用'}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => onEdit(provider)}>编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => testProvider(provider.id)}>测试</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function QrTable({ rows, onCreate, onEdit }: { rows: ManualQr[]; onCreate: () => void; onEdit: (qr: ManualQr) => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">人工收款码</CardTitle>
        <Button size="sm" onClick={onCreate}><QrCode className="h-4 w-4" /> 新建收款码</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>收款人</TableHead>
              <TableHead>限额</TableHead>
              <TableHead>权重</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((qr) => (
              <TableRow key={qr.id}>
                <TableCell className="font-medium">{qr.name}</TableCell>
                <TableCell>{methodLabel(qr.method)}</TableCell>
                <TableCell>{qr.accountName || '-'}</TableCell>
                <TableCell>{formatCurrency(qr.minAmount)} - {formatCurrency(qr.maxAmount)}</TableCell>
                <TableCell>{qr.weight}</TableCell>
                <TableCell><Badge variant={qr.isEnabled ? 'success' : 'secondary'}>{qr.isEnabled ? '启用' : '停用'}</Badge></TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => onEdit(qr)}>编辑</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NotifyLogTable({ rows }: { rows: NotifyLog[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">支付回调日志</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>网关</TableHead>
              <TableHead>订单</TableHead>
              <TableHead>验签</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>响应</TableHead>
              <TableHead>错误</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{log.provider?.name || log.providerId}</TableCell>
                <TableCell className="font-mono text-xs">{log.order?.orderNo || log.orderId || '-'}</TableCell>
                <TableCell><Badge variant={log.signValid ? 'success' : 'destructive'}>{log.signValid ? '通过' : '失败'}</Badge></TableCell>
                <TableCell><Badge variant={log.isSuccess ? 'success' : 'destructive'}>{log.isSuccess ? '成功' : '失败'}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{log.response || '-'}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{log.errorMessage || '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ProviderDialog({ provider, onClose, onSuccess }: { provider: Provider | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    ...emptyProvider,
    ...(provider ? {
      type: provider.type,
      name: provider.name,
      isEnabled: provider.isEnabled,
      priority: provider.priority,
      gatewayUrl: provider.gatewayUrl || '',
      merchantId: provider.merchantId || '',
      merchantKey: '',
      supportedMethods: provider.supportedMethods.join(','),
      minAmount: provider.minAmount,
      maxAmount: provider.maxAmount,
      dailyLimit: provider.dailyLimit || '',
      feeRate: provider.feeRate || '',
      feeFixed: provider.feeFixed || '',
      feePayer: provider.feePayer,
    } : {}),
  });
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      ...form,
      isEnabled: !!form.isEnabled,
      priority: Number(form.priority),
      supportedMethods: form.supportedMethods.split(',').map((v) => v.trim()).filter(Boolean),
      minAmount: Number(form.minAmount),
      maxAmount: Number(form.maxAmount),
      dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : null,
      feeRate: form.feeRate ? Number(form.feeRate) : null,
      feeFixed: form.feeFixed ? Number(form.feeFixed) : null,
    };
    const res = provider
      ? await api.put(`/api/admin/payments/providers/${provider.id}`, payload)
      : await api.post('/api/admin/payments/providers', payload);
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: provider ? '网关已保存' : '网关已创建' });
      onSuccess();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{provider ? '编辑支付网关' : '新建支付网关'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="名称" value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <Field label="网关地址" value={form.gatewayUrl} onChange={(gatewayUrl) => setForm({ ...form, gatewayUrl })} placeholder="https://pay.example.com" />
            <Field label="商户 PID" value={form.merchantId} onChange={(merchantId) => setForm({ ...form, merchantId })} />
            <Field label="商户 KEY" value={form.merchantKey} onChange={(merchantKey) => setForm({ ...form, merchantKey })} type="password" placeholder={provider ? '留空保持不变' : ''} />
            <Field label="渠道" value={form.supportedMethods} onChange={(supportedMethods) => setForm({ ...form, supportedMethods })} />
            <Field label="优先级" value={String(form.priority)} onChange={(priority) => setForm({ ...form, priority: Number(priority) })} type="number" />
            <Field label="最小金额" value={form.minAmount} onChange={(minAmount) => setForm({ ...form, minAmount })} type="number" />
            <Field label="最大金额" value={form.maxAmount} onChange={(maxAmount) => setForm({ ...form, maxAmount })} type="number" />
            <Field label="费率" value={form.feeRate} onChange={(feeRate) => setForm({ ...form, feeRate })} type="number" placeholder="0.015" />
            <Field label="固定手续费" value={form.feeFixed} onChange={(feeFixed) => setForm({ ...form, feeFixed })} type="number" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
              启用
            </label>
            <select value={form.feePayer} onChange={(e) => setForm({ ...form, feePayer: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="platform">平台承担手续费</option>
              <option value="user">用户承担手续费</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} 保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QrDialog({ qr, onClose, onSuccess }: { qr: ManualQr | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    ...emptyQr,
    ...(qr ? {
      method: qr.method,
      name: qr.name,
      qrcodeImage: qr.qrcodeImage,
      accountName: qr.accountName || '',
      minAmount: qr.minAmount,
      maxAmount: qr.maxAmount,
      dailyLimit: qr.dailyLimit || '',
      weight: String(qr.weight),
      isEnabled: qr.isEnabled,
    } : {}),
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      ...form,
      minAmount: Number(form.minAmount),
      maxAmount: Number(form.maxAmount),
      dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : null,
      weight: Number(form.weight),
    };
    const res = qr
      ? await api.put(`/api/admin/payments/qrcodes/${qr.id}`, payload)
      : await api.post('/api/admin/payments/qrcodes', payload);
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: qr ? '收款码已保存' : '收款码已创建' });
      onSuccess();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  async function uploadQrFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    const result = await uploadDirect(file);
    setUploading(false);
    if (!result.ok) {
      toast({ title: result.msg, variant: 'destructive' });
      return;
    }
    setForm((prev) => ({ ...prev, qrcodeImage: result.url }));
    toast({ title: '收款码已上传' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{qr ? '编辑收款码' : '新建收款码'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="名称" value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <div className="space-y-2">
              <Label>渠道</Label>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="alipay">支付宝</option>
                <option value="wxpay">微信支付</option>
              </select>
            </div>
            <Field label="收款人" value={form.accountName} onChange={(accountName) => setForm({ ...form, accountName })} />
            <div className="space-y-2">
              <Label>二维码图片</Label>
              <div className="flex gap-2">
                <Input value={form.qrcodeImage} onChange={(e) => setForm({ ...form, qrcodeImage: e.target.value })} placeholder="图片 URL" />
                <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input px-3 text-sm">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadQrFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
            <Field label="最小金额" value={form.minAmount} onChange={(minAmount) => setForm({ ...form, minAmount })} type="number" />
            <Field label="最大金额" value={form.maxAmount} onChange={(maxAmount) => setForm({ ...form, maxAmount })} type="number" />
            <Field label="权重" value={form.weight} onChange={(weight) => setForm({ ...form, weight })} type="number" />
            <Field label="日限额" value={form.dailyLimit} onChange={(dailyLimit) => setForm({ ...form, dailyLimit })} type="number" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
            启用
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting || uploading}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} 保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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
  };
  return map[method] || method;
}
