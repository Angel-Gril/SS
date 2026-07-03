'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';

export type OzonSyncType = 'PRODUCT_PULL' | 'ORDER_PULL';

interface OzonSyncShop {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastSyncAt: string | null;
  notificationEnabled: boolean;
  notifyPath: string | null;
}

interface OzonSyncActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultShopId?: string;
  defaultTypes?: OzonSyncType[];
  defaultSinceDays?: number;
  title?: string;
  onQueued?: () => void;
}

const typeLabels: Record<OzonSyncType, string> = {
  PRODUCT_PULL: '在线商品',
  ORDER_PULL: '订单',
};

export function OzonSyncActionDialog({
  open,
  onOpenChange,
  defaultShopId,
  defaultTypes = ['PRODUCT_PULL', 'ORDER_PULL'],
  defaultSinceDays = 90,
  title = '同步 Ozon 数据',
  onQueued,
}: OzonSyncActionDialogProps) {
  const [shops, setShops] = useState<OzonSyncShop[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<OzonSyncType>>(new Set(defaultTypes));
  const [sinceDays, setSinceDays] = useState(String(defaultSinceDays));
  const [lastResult, setLastResult] = useState<{ queued: number; skipped: number } | null>(null);
  const defaultTypesKey = defaultTypes.join(',');

  useEffect(() => {
    if (!open) return;
    setSelectedTypes(new Set(defaultTypes));
    setSinceDays(String(defaultSinceDays));
    setLastResult(null);
    setLoading(true);
    api.get<{ rows: OzonSyncShop[] }>('/api/ozon-sync/shops').then((res) => {
      if (res.code === 1 && res.data?.rows) {
        setShops(res.data.rows);
        const activeRows = res.data.rows.filter((shop) => shop.status === 'ACTIVE');
        const defaultSelection = defaultShopId
          ? activeRows.filter((shop) => shop.id === defaultShopId).map((shop) => shop.id)
          : activeRows.slice(0, 1).map((shop) => shop.id);
        setSelectedShopIds(new Set(defaultSelection));
      } else {
        toast({ title: res.msg || '读取 Ozon 店铺失败', variant: 'destructive' });
      }
    }).finally(() => setLoading(false));
  }, [open, defaultShopId, defaultSinceDays, defaultTypesKey]);

  const selectedActiveCount = useMemo(
    () => shops.filter((shop) => selectedShopIds.has(shop.id) && shop.status === 'ACTIVE').length,
    [shops, selectedShopIds],
  );

  function toggleShop(id: string) {
    setSelectedShopIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleType(type: OzonSyncType) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function rotateToken(shopId: string) {
    const res = await api.post<{ token: string; notifyPath: string }>(`/api/ozon-sync/shops/${shopId}/notification-token`);
    if (res.code !== 1 || !res.data) {
      toast({ title: res.msg || '生成通知地址失败', variant: 'destructive' });
      return;
    }
    setShops((rows) => rows.map((shop) => (
      shop.id === shopId
        ? { ...shop, notificationEnabled: true, notifyPath: res.data!.notifyPath }
        : shop
    )));
    toast({ title: '通知地址已生成' });
  }

  async function copyNotifyUrl(path: string) {
    const fullUrl = apiUrl(path);
    await navigator.clipboard.writeText(fullUrl);
    toast({ title: '通知地址已复制' });
  }

  async function submit() {
    const syncTypes = Array.from(selectedTypes);
    const shopIds = Array.from(selectedShopIds);
    if (!shopIds.length || !syncTypes.length) return;

    setSubmitting(true);
    const parsedDays = Math.max(1, Number(sinceDays) || 90);
    const since = syncTypes.includes('ORDER_PULL')
      ? new Date(Date.now() - parsedDays * 24 * 3600 * 1000).toISOString()
      : undefined;
    const res = await api.post<{ queued: unknown[]; skipped: unknown[] }>('/api/ozon-sync/trigger', {
      shopIds,
      syncTypes,
      since,
    });
    setSubmitting(false);

    if (res.code !== 1) {
      toast({ title: res.msg || '创建同步任务失败', variant: 'destructive' });
      return;
    }
    const queued = res.data?.queued?.length || 0;
    const skipped = res.data?.skipped?.length || 0;
    setLastResult({ queued, skipped });
    toast({ title: `已创建 ${queued} 个同步任务${skipped ? `，跳过 ${skipped} 个` : ''}` });
    onQueued?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            选择店铺和数据类型后创建同步任务。Ozon 通知地址用于在 seller 后台配置事件触发同步，定时同步仍可作为兜底。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">店铺</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedShopIds(new Set(shops.filter((shop) => shop.status === 'ACTIVE').map((shop) => shop.id)))}
                >
                  全选可用
                </Button>
              </div>
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {shops.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">暂无 Ozon 店铺</div>
                ) : shops.map((shop) => (
                  <div key={shop.id} className="rounded-md border p-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-gray-300"
                        checked={selectedShopIds.has(shop.id)}
                        disabled={shop.status !== 'ACTIVE'}
                        onChange={() => toggleShop(shop.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{shop.name}</span>
                          <Badge variant={shop.status === 'ACTIVE' ? 'secondary' : 'destructive'} className="text-[10px]">
                            {shop.status}
                          </Badge>
                          {shop.notificationEnabled && (
                            <Badge variant="outline" className="text-[10px]">通知已配置</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          上次同步：{shop.lastSyncAt ? new Date(shop.lastSyncAt).toLocaleString('zh-CN') : '暂无'}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(event) => { event.preventDefault(); rotateToken(shop.id); }}>
                            {shop.notificationEnabled ? '重置通知地址' : '生成通知地址'}
                          </Button>
                          {shop.notifyPath && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(event) => { event.preventDefault(); copyNotifyUrl(shop.notifyPath!); }}>
                              <Copy className="h-3 w-3" />
                              复制 URL
                            </Button>
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-md border bg-muted/30 p-3">
              <div>
                <div className="mb-2 text-sm font-medium">同步内容</div>
                {(['PRODUCT_PULL', 'ORDER_PULL'] as OzonSyncType[]).map((type) => (
                  <label key={type} className="mb-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(type)}
                      onChange={() => toggleType(type)}
                      className="rounded border-gray-300"
                    />
                    {typeLabels[type]}
                  </label>
                ))}
              </div>

              {selectedTypes.has('ORDER_PULL') && (
                <div>
                  <label className="text-xs text-muted-foreground">订单同步窗口（天）</label>
                  <select
                    value={sinceDays}
                    onChange={(event) => setSinceDays(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="30">最近 30 天</option>
                    <option value="90">最近 90 天</option>
                    <option value="365">最近 1 年</option>
                  </select>
                </div>
              )}

              <div className="rounded-md bg-background p-3 text-xs text-muted-foreground">
                已选 {selectedActiveCount} 个可用店铺，{selectedTypes.size} 类数据。
              </div>

              {lastResult && (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <div>已创建 {lastResult.queued} 个任务{lastResult.skipped ? `，跳过 ${lastResult.skipped} 个异常店铺` : ''}。</div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={submit} disabled={loading || submitting || selectedActiveCount === 0 || selectedTypes.size === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            创建同步任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
