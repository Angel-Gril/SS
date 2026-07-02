'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, TestTube2, Package, Trash2, Loader2, Pencil, Eye, EyeOff, Video, Upload } from 'lucide-react';
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

interface OzonVideoProbeResult {
  ok: boolean;
  status: 'auto_publish_ready' | 'uploaded_temp_video_url' | 'uploaded_not_video_asset' | 'upload_failed';
  message: string;
  uploadedUrl?: string;
  videoAsset?: {
    videoId: string;
    assetUrl: string;
    masterUrl: string;
    coverUrl: string;
  };
}

const VIDEO_PROBE_MAX_BYTES = 8 * 1024 * 1024;

export default function OzonShopsPage() {
  const systemDialog = useSystemDialog();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShopId, setEditShopId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [videoProbeShopId, setVideoProbeShopId] = useState('');

  async function loadShops() {
    setLoading(true);
    const res = await api.get<Shop[]>('/api/shops');
    if (res.code === 1 && res.data) {
      const ozonShops = res.data.filter((s) => s.platform === 'OZON');
      setShops(ozonShops);
      setVideoProbeShopId((current) => (
        current && ozonShops.some((shop) => shop.id === current)
          ? current
          : (ozonShops[0]?.id || '')
      ));
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

  async function handleVideoProbe(id: string, file?: File) {
    let payload: { dataUrl?: string; filename?: string } = {};
    if (file) {
      const type = (file.type || '').toLowerCase();
      if (type && type !== 'video/mp4') {
        toast({ title: '视频探针：仅支持 MP4', variant: 'destructive' });
        return;
      }
      if (file.size > VIDEO_PROBE_MAX_BYTES) {
        toast({ title: '视频探针：文件过大', description: '请选择 8MB 以内的 MP4 测试文件', variant: 'destructive' });
        return;
      }
      payload = { dataUrl: await readVideoProbeFile(file), filename: file.name };
    }

    setActionLoading((s) => ({ ...s, [id]: file ? 'video-probe-file' : 'video-probe' }));
    const res = await api.post<OzonVideoProbeResult>(`/api/shops/${id}/ozon-video-probe`, payload);
    setActionLoading((s) => {
      const { [id]: _, ...rest } = s;
      return rest;
    });

    const data = res.data;
    const ready = res.code === 1 && data?.status === 'auto_publish_ready';
    const tempReady = res.code === 1 && data?.status === 'uploaded_temp_video_url';
    const title = ready
      ? '视频探针：可自动挂载商品视频'
      : tempReady
      ? '视频探针：已上传到 Ozon 临时视频素材'
      : '视频探针：暂不可自动挂载商品视频';
    const description = ready
      ? `已返回 Ozon 视频资产 videoId=${data?.videoAsset?.videoId || ''}`
      : tempReady
      ? (data?.message || `已返回临时视频 URL：${data?.uploadedUrl || ''}`)
      : (data?.message || res.msg || '未拿到 Ozon 视频资产');
    toast({
      title,
      description,
      variant: ready || tempReady ? 'default' : 'destructive',
    });
  }

  async function handleVideoProbeFileSelect(id: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await handleVideoProbe(id, file);
  }

  async function handleDelete(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '删除 Ozon 店铺',
      message: '确认删除此店铺？此操作会删除该店铺下所有商品和订单数据。',
      confirmText: '删除店铺',
      tone: 'destructive',
    });
    if (!confirmed) return;
    setActionLoading((s) => ({ ...s, [id]: 'delete' }));
    try {
      const res = await api.delete(`/api/shops/${id}`);
      toast({
        title: res.code === 1 ? '删除成功' : (res.msg || '删除失败'),
        variant: res.code === 1 ? 'default' : 'destructive',
      });
      if (res.code === 1) loadShops();
    } catch (e: any) {
      toast({ title: `删除失败: ${e.message || '网络错误'}`, variant: 'destructive' });
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
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">Ozon 视频上传探针</div>
              <p className="text-sm text-muted-foreground">
                复用店铺已同步的 Ozon 登录态，测试本地 MP4 是否会返回可自动挂载的 Ozon 视频资产。
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                选择店铺
                <select
                  value={videoProbeShopId}
                  onChange={(event) => setVideoProbeShopId(event.target.value)}
                  className="h-9 min-w-[180px] rounded-md border bg-background px-3 text-sm text-foreground"
                  disabled={loading || shops.length === 0}
                >
                  {shops.length === 0 ? (
                    <option value="">暂无 OZON 店铺</option>
                  ) : shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>{shop.name}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                onClick={() => videoProbeShopId && handleVideoProbe(videoProbeShopId)}
                disabled={!videoProbeShopId || !!actionLoading[videoProbeShopId]}
              >
                {actionLoading[videoProbeShopId] === 'video-probe' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Video className="h-4 w-4" />
                )}
                自动探针
              </Button>
              <input
                id="ozon-video-probe-file-main"
                type="file"
                accept="video/mp4"
                className="hidden"
                onChange={(event) => videoProbeShopId && handleVideoProbeFileSelect(videoProbeShopId, event)}
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById('ozon-video-probe-file-main')?.click()}
                disabled={!videoProbeShopId || !!actionLoading[videoProbeShopId]}
              >
                {actionLoading[videoProbeShopId] === 'video-probe-file' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                选择本地 MP4
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : shops.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">还没有添加任何 OZON 店铺</p>
              <Button className="mt-4" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                添加第一个店铺
              </Button>
            </div>
          ) : (
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
                {shops.map((shop) => (
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
                          onClick={() => handleVideoProbe(shop.id)}
                          disabled={!!actionLoading[shop.id]}
                          title="视频探针"
                        >
                          {actionLoading[shop.id] === 'video-probe' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Video className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <input
                          id={`ozon-video-probe-file-${shop.id}`}
                          type="file"
                          accept="video/mp4"
                          className="hidden"
                          onChange={(event) => handleVideoProbeFileSelect(shop.id, event)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => document.getElementById(`ozon-video-probe-file-${shop.id}`)?.click()}
                          disabled={!!actionLoading[shop.id]}
                          title="选择本地 MP4 视频探针"
                        >
                          {actionLoading[shop.id] === 'video-probe-file' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
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
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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

function readVideoProbeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取视频文件失败'));
    reader.readAsDataURL(file);
  });
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
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!shopId) { setDetail(null); setShowKey(false); return; }
    setLoading(true);
    api.get(`/api/shops/${shopId}`).then((res: any) => {
      if (res.code === 1 && res.data) {
        setDetail(res.data);
        setName(res.data.name || '');
        setClientId(res.data.clientId || '');
        setApiKey(res.data.apiKey || '');
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
    if (apiKey !== detail?.apiKey) body.apiKey = apiKey;

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
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono flex-1"
                />
                <Button type="button" size="icon" variant="outline" onClick={() => setShowKey(!showKey)} title={showKey ? '隐藏' : '显示'}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">API Key 已加密存储，此处显示的是解密后的原始值</p>
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
