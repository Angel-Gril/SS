'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { sourcePlatformLabel } from '@/lib/source-platforms';
import { StatusBadge, modeLabel, type Status, type JobRow } from './listing-job-list';

interface PushItem {
  offer_id: string;
  product_id?: number;
  status: 'imported' | 'failed' | 'pending';
  errors?: Array<{ code?: string; message?: string; description?: string; field?: string; state?: string; level?: string }>;
}

interface DetailData {
  id: string;
  status: Status;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  payload: (JobRow['payload'] & { items?: PushItem[] }) | null;
  shopName: string;
  platform: string;
}

export function ListingJobDetailDialog({
  jobId,
  onClose,
  onRefreshed,
}: { jobId: string; onClose: () => void; onRefreshed: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get<DetailData>(`/api/listing/tasks/${jobId}`);
    if (res.code === 1 && res.data) setData(res.data);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    const res = await api.post<{ status: Status }>(`/api/listing/tasks/${jobId}/refresh`, {});
    if (res.code === 1) {
      toast({ title: '已从 OZON 拉取最新状态' });
      await load();
      onRefreshed();
    } else {
      toast({ title: res.msg || '刷新失败', variant: 'destructive' });
    }
    setRefreshing(false);
  }

  useEffect(() => {
    load();
  }, [jobId]);

  const mode = data ? modeLabel(data.payload) : null;
  const sourcePlatforms = data?.payload?.sourcePlatforms || [];
  const sourceSkus = data?.payload?.sourceSkus || [];
  const ozonSkus = data?.payload?.ozonSkus || [];
  const ozonProductIds = data?.payload?.ozonProductIds || [];
  const ozonOfferIds = data?.payload?.ozonOfferIds || [];
  const listingSources = data?.payload?.listingSources || [];
  const canRefresh = !!data && (data.payload?.entry === '1688-listing' || (data.status !== 'SUCCESS' && data.status !== 'FAILED'));

  const renderCodes = (values: string[], formatValue: (value: string) => string = (value) => value) => (
    values.length ? (
      <div className="flex flex-wrap gap-1">
        {values.map((value, i) => (
          <code key={`${value}-${i}`} className="bg-muted px-1.5 py-0.5 rounded text-xs">{formatValue(value)}</code>
        ))}
      </div>
    ) : '—'
  );

  function sourceValue(source: Record<string, unknown> | undefined, key: string) {
    const value = source?.[key];
    return value == null ? '' : String(value).trim();
  }

  function listingSourceFor(offerId: string, index: number) {
    return listingSources.find((source) => sourceValue(source, 'offerId') === offerId) || listingSources[index];
  }

  function itemErrorText(item: PushItem) {
    const messages = (item.errors || [])
      .map((error) => error.message || error.description || error.code || error.field || '')
      .filter(Boolean);
    return messages.length ? messages.join('; ') : '—';
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogTitle>上架任务详情</DialogTitle>
        {loading || !data ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin inline-block" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span className="text-muted-foreground">店铺：</span>{data.shopName}</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">状态：</span><StatusBadge s={data.status} /></div>
              <div><span className="text-muted-foreground">商品数：</span>{data.payload?.itemCount ?? '—'}</div>
              <div>
                <span className="text-muted-foreground">成功数：</span>
                <span className={data.payload?.importedCount ? 'text-emerald-600 font-medium' : ''}>
                  {data.payload?.importedCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">失败数：</span>
                <span className={data.payload?.failedCount ? 'text-destructive font-medium' : ''}>
                  {data.payload?.failedCount ?? 0}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">处理中：</span>
                <span className={data.payload?.pendingCount ? 'text-amber-600 font-medium' : ''}>
                  {data.payload?.pendingCount ?? 0}
                </span>
              </div>
              <div><span className="text-muted-foreground">提交时间：</span>{data.startedAt ? new Date(data.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
              <div><span className="text-muted-foreground">完成时间：</span>{data.finishedAt ? new Date(data.finishedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
              <div><span className="text-muted-foreground">刷新时间：</span>{data.payload?.lastRefreshedAt ? new Date(data.payload.lastRefreshedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
              <div className="col-span-2"><span className="text-muted-foreground">OZON Task ID：</span><code className="bg-muted px-1.5 py-0.5 rounded text-xs">{data.payload?.taskId ?? '—'}</code></div>
              {mode && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">模式：</span>
                  <Badge variant="outline" className={`text-[10px] ${mode.cls}`}>{mode.text}</Badge>
                </div>
              )}
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">货源平台：</div>
                {renderCodes(sourcePlatforms, sourcePlatformLabel)}
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">货源 SKU：</div>
                {renderCodes(sourceSkus)}
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">Ozon SKU：</div>
                {renderCodes(ozonSkus)}
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Ozon Product ID：</div>
                {renderCodes(ozonProductIds)}
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Ozon Offer ID：</div>
                {renderCodes(ozonOfferIds)}
              </div>
            </div>

            {data.error && (
              <div className="border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2 text-destructive text-xs">
                {data.error}
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || !canRefresh}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                {data.payload?.entry === '1688-listing' && (data.status === 'SUCCESS' || data.status === 'FAILED')
                  ? '重新拉取 Ozon 结果'
                  : '从 OZON 拉取最新状态'}
              </Button>
            </div>

            {data.payload?.items && data.payload.items.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 w-14">图</th>
                      <th className="text-left px-3 py-2">OFFER ID</th>
                      <th className="text-left px-3 py-2">PRODUCT ID</th>
                      <th className="text-left px-3 py-2">来源追踪</th>
                      <th className="text-left px-3 py-2 w-20">状态</th>
                      <th className="text-left px-3 py-2">错误信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payload.items.map((it, i) => {
                      const cls = it.status === 'imported' ? 'bg-emerald-600' : it.status === 'failed' ? 'bg-destructive' : 'bg-amber-500';
                      const txt = it.status === 'imported' ? '成功' : it.status === 'failed' ? '失败' : '处理中';
                      const img = data.payload?.offerImages?.[it.offer_id];
                      const source = listingSourceFor(it.offer_id, i);
                      const sourcePlatform = sourceValue(source, 'sourcePlatform');
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">
                            {img ? (
                              <img
                                src={img}
                                alt=""
                                className="h-10 w-10 rounded object-cover border cursor-pointer hover:opacity-80"
                                onClick={() => window.open(img, '_blank')}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="h-10 w-10 rounded border bg-muted" />
                            )}
                          </td>
                          <td className="px-3 py-2"><code>{it.offer_id}</code></td>
                          <td className="px-3 py-2">{it.product_id || '-'}</td>
                          <td className="px-3 py-2">
                            {source ? (
                              <div className="space-y-1">
                                <div className="flex flex-wrap gap-1">
                                  {sourcePlatform && (
                                    <Badge variant="outline" className="text-[10px]">{sourcePlatformLabel(sourcePlatform)}</Badge>
                                  )}
                                  {sourceValue(source, 'sourceSkuId') && (
                                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">货源 {sourceValue(source, 'sourceSkuId')}</code>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {sourceValue(source, 'ozonSku') && (
                                    <code className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded text-[11px]">Ozon SKU {sourceValue(source, 'ozonSku')}</code>
                                  )}
                                  {sourceValue(source, 'ozonProductId') && (
                                    <code className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded text-[11px]">PID {sourceValue(source, 'ozonProductId')}</code>
                                  )}
                                  {sourceValue(source, 'ozonOfferId') && (
                                    <code className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded text-[11px]">Offer {sourceValue(source, 'ozonOfferId')}</code>
                                  )}
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2"><Badge className={`${cls} text-white text-[10px]`}>{txt}</Badge></td>
                          <td className="px-3 py-2 text-destructive break-all">
                            {itemErrorText(it)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
