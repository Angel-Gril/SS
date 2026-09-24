'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, TestTube2, Package, CircleOff, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Shop {
  id: string;
  platform: string;
  name: string;
  clientId: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'ERROR';
  lastSyncAt: string | null;
  errorMessage: string | null;
  productCount: number;
  orderCount: number;
  createdAt: string;
}

interface ShopDetail {
  id: string;
  platform: string;
  name: string;
  clientId: string | null;
  apiKeyConfigured: boolean;
  status: 'ACTIVE' | 'DISABLED' | 'ERROR';
  createdAt: string;
}

export default function OzonShopsPage() {
  const systemDialog = useSystemDialog();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShopId, setEditShopId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  async function loadShops() {
    setLoading(true);
    const res = await api.get<Shop[]>('/api/shops');
    if (res.code === 1 && res.data) {
      setShops(res.data.filter((s) => s.platform === 'OZON'));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadShops();
  }, []);

  async function handleTest(id: string) {
    setActionLoading((s) => ({ ...s, [id]: 'test' }));
    const res = await api.post<{ name: string }>(`/api/shops/${id}/test`);
    setActionLoading((s) => {
      const { [id]: _, ...rest } = s;
      return rest;
    });
    toast({
      title: res.code === 1 ? `连接成功: ${res.data?.name || ''}` : '连接失败',
      description: res.msg,
      variant: res.code === 1 ? 'default' : 'destructive',
    });
    if (res.code === 1) loadShops();
  }

  async function handleSync(id: string) {
    setActionLoading((s) => ({ ...s, [id]: 'sync' }));
    const res = await api.post(`/api/shops/${id}/sync-products`);
    setActionLoading((s) => {
      const { [id]: _, ...rest } = s;
      return rest;
    });
    toast({
      title: res.code === 1 ? '同步任务已创建' : '同步失败',
      description: res.msg,
      variant: res.code === 1 ? 'default' : 'destructive',
    });
  }

  async function handleDelete(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '停用 Ozon 店铺',
      message: '停用后将撤销设备和物流授权，商品与订单不再出现在日常运营视图。历史记录仍保留用于费用、物流和审计追溯。',
      confirmText: '停用店铺',
      tone: 'destructive',
    });
    if (!confirmed) return;
    setActionLoading((s) => ({ ...s, [id]: 'delete' }));
    try {
      const res = await api.delete(`/api/shops/${id}`);
      toast({
        title: res.code === 1 ? '店铺已停用' : (res.msg || '停用失败'),
        variant: res.code === 1 ? 'default' : 'destructive',
      });
      if (res.code === 1) loadShops();
    } catch (e: any) {
      toast({ title: `停用失败: ${e.message || '网络错误'}`, variant: 'destructive' });
    }
    setActionLoading((s) => { const { [id]: _, ...rest } = s; return rest; });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OZON 店铺管理</h1>
          <p className="text-muted-foreground mt-1">管理您的 OZON 卖家店铺，同步商品和订单</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          添加店铺
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>店铺名称</TableHead>
                <TableHead>Client ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">商品数</TableHead>
                <TableHead className="text-right">订单数</TableHead>
                <TableHead>最近同步</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-48 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : shops.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-48 text-center">
                    <p className="text-muted-foreground">还没有添加任何 OZON 店铺</p>
                    <Button className="mt-4" onClick={() => setAddOpen(true)}>
                      <Plus className="h-4 w-4" />
                      添加第一个店铺
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                shops.map((shop) => (
                  <TableRow key={shop.id}>
                    <TableCell className="font-medium">{shop.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {shop.clientId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={shop.status} message={shop.errorMessage} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{shop.productCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{shop.orderCount}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {shop.lastSyncAt ? formatDate(shop.lastSyncAt) : '从未同步'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditShopId(shop.id)}
                          title="编辑店铺"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleTest(shop.id)}
                          disabled={!!actionLoading[shop.id]}
                          title="测试连接"
                        >
                          {actionLoading[shop.id] === 'test' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <TestTube2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSync(shop.id)}
                          disabled={!!actionLoading[shop.id] || shop.status !== 'ACTIVE'}
                          title="同步商品"
                        >
                          {actionLoading[shop.id] === 'sync' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          title="查看商品"
                        >
                          <a href={`/products?shopId=${shop.id}`}>
                            <Package className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(shop.id)}
                          title="停用店铺"
                        >
                          <CircleOff className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddShopDialog open={addOpen} onOpenChange={setAddOpen} onSuccess={loadShops} />
      <EditShopDialog shopId={editShopId} onClose={() => setEditShopId(null)} onSuccess={loadShops} />
    </div>
  );
}

function StatusBadge({ status, message }: { status: string; message: string | null }) {
  if (status === 'ACTIVE') return <Badge variant="success">正常</Badge>;
  if (status === 'ERROR')
    return (
      <Badge variant="destructive" title={message || ''}>
        异常
      </Badge>
    );
  return <Badge variant="secondary">已禁用</Badge>;
}

function AddShopDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.post('/api/shops', {
      platform: 'OZON',
      name,
      clientId,
      apiKey,
    });
    setSubmitting(false);

    if (res.code === 1) {
      toast({ title: '店铺添加成功，请测试连接' });
      setName('');
      setClientId('');
      setApiKey('');
      onOpenChange(false);
      onSuccess();
    } else {
      toast({ title: res.msg || '添加失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 OZON 店铺</DialogTitle>
          <DialogDescription>
            从 OZON 卖家中心 → 设置 → API Key 获取 Client ID 和 API Key
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shop-name">店铺名称</Label>
            <Input
              id="shop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="便于识别的店铺别名"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="OZON Seller Client-Id"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="OZON Seller Api-Key"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
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

function EditShopDialog({ shopId, onClose, onSuccess }: {
  shopId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!shopId) { setDetail(null); setApiKey(''); return; }
    setLoading(true);
    api.get<ShopDetail>(`/api/shops/${shopId}`).then((res) => {
      if (res.code === 1 && res.data) {
        setDetail(res.data);
        setName(res.data.name || '');
        setClientId(res.data.clientId || '');
        setApiKey('');
      }
      setLoading(false);
    });
  }, [shopId]);

  async function handleSave() {
    if (!shopId) return;
    setSubmitting(true);
    const body: Record<string, string> = {};
    if (name !== detail?.name) body.name = name;
    if (clientId !== detail?.clientId) body.clientId = clientId;
    if (apiKey.trim()) body.apiKey = apiKey.trim();

    if (Object.keys(body).length === 0) {
      toast({ title: '没有修改' });
      setSubmitting(false);
      return;
    }

    const res = await api.put(`/api/shops/${shopId}`, body);
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '店铺信息已更新' });
      onSuccess();
      onClose();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!shopId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑店铺</DialogTitle>
          <DialogDescription>查看和修改店铺的 API 凭证信息</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>店铺名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
                placeholder={detail.apiKeyConfigured ? 'API Key 已配置，留空则不修改' : '输入 Ozon Seller Api-Key'}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {detail.apiKeyConfigured
                  ? 'API Key 已安全保存且不会回显；留空则不修改，输入新值将替换现有 Key。'
                  : '尚未配置 API Key，请输入新值。'}
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              状态: {detail.status} | 创建时间: {formatDate(detail.createdAt)}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={submitting || loading}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
