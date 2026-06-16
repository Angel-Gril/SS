'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { explainOzonError, explainOzonErrors, formatOzonErrorMessage, type OzonErrorHint } from 'shared/ozon-error-hints';
import { isFallbackPictureJob, resolveListingPictureStage, type ListingPictureStageTone } from 'shared/listing-picture-stage';
import { StatusBadge, modeLabel, type Status, type JobRow } from './listing-job-list';

interface PushItem {
  offer_id: string;
  product_id?: number;
  status: 'imported' | 'failed' | 'pending';
  errors?: Array<{ code?: string; message?: string; description?: string; field?: string; level?: string; state?: string }>;
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

function pictureStageClass(tone: ListingPictureStageTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'info':
      return 'border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
    default:
      return 'border-muted bg-muted/50 text-muted-foreground';
  }
}

function pictureStageBadgeClass(tone: ListingPictureStageTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300';
    case 'warning':
      return 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300';
    case 'error':
      return 'border-destructive/40 text-destructive';
    case 'info':
      return 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300';
    default:
      return 'border-muted-foreground/30 text-muted-foreground';
  }
}

function isBlockingImportError(item: PushItem): boolean {
  if (item.status === 'failed') return true;
  return (item.errors || []).some((error) => {
    const level = String(error.level || '').toLowerCase();
    const state = String(error.state || '').toLowerCase();
    return level === 'error' || state === 'declined';
  });
}

export function ListingJobDetailDialog({
  jobId,
  onClose,
  onRefreshed,
}: { jobId: string; onClose: () => void; onRefreshed: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const res = await api.get<DetailData>(`/api/listing/tasks/${jobId}`);
    if (res.code === 1 && res.data) setData(res.data);
    setLoading(false);
  }

  async function refresh(silent = false) {
    if (refreshing) return;
    setRefreshing(true);
    const res = await api.post<{ status: Status }>(`/api/listing/tasks/${jobId}/refresh`, {});
    if (res.code === 1) {
      if (!silent) toast({ title: '已从 OZON 拉取最新状态' });
      await load(silent);
      onRefreshed();
    } else if (!silent) {
      toast({ title: res.msg || '刷新失败', variant: 'destructive' });
    }
    setRefreshing(false);
  }

  useEffect(() => {
    load();
  }, [jobId]);

  const mode = data ? modeLabel(data.payload) : null;
  const jobErrorHint = data?.error ? explainOzonError(data.error) : null;
  const pictureUploads = data?.payload?.pictureUploads || [];
  const pictureProblemCount = pictureUploads.filter((it) => it.status !== 'uploaded').length
    + (data?.payload?.pictureUploadError ? 1 : 0);
  const pictureUploadStatus = data?.payload?.pictureUploadStatus;
  const pictureActivationPending = data?.payload?.pictureActivationPending || [];
  const pictureActivationPendingCount = Number(data?.payload?.pictureActivationPendingCount || pictureActivationPending.length || 0);
  const pictureStage = data
    ? resolveListingPictureStage({ status: data.status, payload: data.payload })
    : null;
  const fallbackPictureJob = isFallbackPictureJob(data?.payload);
  const showPictureStage = !!pictureStage && (
    fallbackPictureJob
    || !!pictureUploadStatus
    || pictureUploads.length > 0
    || pictureActivationPendingCount > 0
    || !!data?.payload?.pictureUploadError
  );
  const needsLegacyFallbackPictureRefresh = !!data
    && fallbackPictureJob
    && data.status === 'SUCCESS'
    && !pictureUploadStatus
    && pictureUploads.length === 0;
  const shouldAutoRefresh = !!data && (
    data.status === 'RUNNING'
    || pictureUploadStatus === 'pending'
    || pictureActivationPendingCount > 0
    || needsLegacyFallbackPictureRefresh
  );
  const canManualRefresh = !!data && (
    data.status !== 'SUCCESS'
    || fallbackPictureJob
    || pictureUploadStatus === 'pending'
    || pictureUploadStatus === 'failed'
    || pictureActivationPendingCount > 0
  );

  useEffect(() => {
    if (!shouldAutoRefresh || refreshing) return;
    const timer = window.setTimeout(() => {
      void refresh(true);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [jobId, shouldAutoRefresh, refreshing, data?.payload?.pictureUploadPendingCount, pictureActivationPendingCount]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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
                <span className="text-muted-foreground">失败数：</span>
                <span className={data.payload?.failedCount ? 'text-destructive font-medium' : ''}>
                  {data.payload?.failedCount ?? 0}
                </span>
              </div>
              <div><span className="text-muted-foreground">提交时间：</span>{data.startedAt ? new Date(data.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
              <div><span className="text-muted-foreground">完成时间：</span>{data.finishedAt ? new Date(data.finishedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
              <div className="col-span-2"><span className="text-muted-foreground">OZON Task ID：</span><code className="bg-muted px-1.5 py-0.5 rounded text-xs">{data.payload?.taskId ?? '—'}</code></div>
              {showPictureStage && pictureStage.code !== 'not_applicable' && (
                <div className={`col-span-2 rounded-md border px-3 py-2 ${pictureStageClass(pictureStage.tone)}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">图片阶段：</span>
                    <Badge variant="outline" className={`text-[10px] ${pictureStageBadgeClass(pictureStage.tone)}`}>
                      {pictureStage.label}{pictureStage.countLabel ? ` ${pictureStage.countLabel}` : ''}
                    </Badge>
                    <span className="text-xs">{pictureStage.description}</span>
                  </div>
                </div>
              )}
              {mode && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">模式：</span>
                  <Badge variant="outline" className={`text-[10px] ${mode.cls}`}>{mode.text}</Badge>
                </div>
              )}
              <div className="col-span-2">
                <div className="text-muted-foreground mb-1">源 SKU：</div>
                {data.payload?.sourceSkus?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {data.payload.sourceSkus.map((sku, i) => (
                      <code key={i} className="bg-muted px-1.5 py-0.5 rounded text-xs">{sku}</code>
                    ))}
                  </div>
                ) : '—'}
              </div>
            </div>

            {data.error && (
              <div className="border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2 text-destructive text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  {jobErrorHint && <Badge variant="outline" className="text-[10px] border-destructive/30">{jobErrorHint.label}</Badge>}
                  <span>{formatOzonErrorMessage(data.error)}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => refresh(false)} disabled={refreshing || !canManualRefresh}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                从 OZON 拉取最新状态
              </Button>
            </div>

            {(pictureUploads.length > 0 || pictureActivationPendingCount > 0 || data.payload?.pictureUploadError) && (
              <div className="border rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-muted flex items-center justify-between">
                  <div className="font-medium">图片补传诊断</div>
                  <Badge
                    variant={pictureProblemCount ? 'destructive' : 'outline'}
                    className={`text-[10px] ${!pictureProblemCount && pictureStage ? pictureStageBadgeClass(pictureStage.tone) : ''}`}
                  >
                    {pictureProblemCount ? `${pictureProblemCount} 个异常` : (pictureStage?.label || '正常')}
                  </Badge>
                </div>
                {data.payload?.pictureUploadError && (
                  <div className="px-3 py-2 text-xs text-destructive border-t break-words">
                    {data.payload.pictureUploadError}
                  </div>
                )}
                {pictureActivationPendingCount > 0 && (
                  <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-t">
                    {pictureActivationPendingCount} 个商品图片已提交但 Ozon 商品详情暂未返回图片，系统会继续刷新确认。
                  </div>
                )}
                {pictureUploads.length > 0 && (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/70">
                      <tr>
                        <th className="text-left px-3 py-2">OFFER ID</th>
                        <th className="text-left px-3 py-2">PRODUCT ID</th>
                        <th className="text-left px-3 py-2 w-20">状态</th>
                        <th className="text-left px-3 py-2">图片</th>
                        <th className="text-left px-3 py-2">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pictureUploads.map((it, i) => {
                        const label = it.status === 'uploaded' ? '已补传' : it.status === 'skipped' ? '未补传' : '失败';
                        const badgeClass = it.status === 'uploaded' ? 'bg-emerald-600' : it.status === 'skipped' ? 'bg-amber-500' : 'bg-destructive';
                        return (
                          <tr key={`${it.offerId}-${i}`} className="border-t">
                            <td className="px-3 py-2"><code>{it.offerId}</code></td>
                            <td className="px-3 py-2">{it.productId || '-'}</td>
                            <td className="px-3 py-2"><Badge className={`${badgeClass} text-white text-[10px]`}>{label}</Badge></td>
                            <td className="px-3 py-2">
                              {it.firstImage ? (
                                <button
                                  type="button"
                                  className="text-left underline-offset-2 hover:underline"
                                  onClick={() => window.open(it.firstImage, '_blank')}
                                >
                                  {it.imageCount} 张 / 已解析 {it.resolvedCount} 张
                                </button>
                              ) : `${it.imageCount} 张 / 已解析 ${it.resolvedCount} 张`}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground break-words">{it.message || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {data.payload?.items && data.payload.items.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 w-14">图</th>
                      <th className="text-left px-3 py-2">OFFER ID</th>
                      <th className="text-left px-3 py-2">PRODUCT ID</th>
                      <th className="text-left px-3 py-2 w-20">状态</th>
                      <th className="text-left px-3 py-2">错误信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payload.items.map((it, i) => {
                      const cls = it.status === 'imported' ? 'bg-emerald-600' : it.status === 'failed' ? 'bg-destructive' : 'bg-amber-500';
                      const txt = it.status === 'imported' ? '成功' : it.status === 'failed' ? '失败' : '处理中';
                      const img = data.payload?.offerImages?.[it.offer_id];
                      const blockingError = isBlockingImportError(it);
                      const hints = Array.from(new Map((it.errors || [])
                        .map((error) => explainOzonError(error))
                        .filter((hint): hint is OzonErrorHint => !!hint)
                        .map((hint) => [hint.code, hint])).values());
                      const messages = explainOzonErrors(it.errors || []);
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
                          <td className="px-3 py-2"><Badge className={`${cls} text-white text-[10px]`}>{txt}</Badge></td>
                          <td className={`px-3 py-2 ${blockingError ? 'text-destructive' : 'text-amber-700'}`}>
                            {messages.length ? (
                              <div className="space-y-1">
                                {hints.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {hints.map((hint) => (
                                      <Badge
                                        key={hint.code}
                                        variant="outline"
                                        className={`text-[10px] ${blockingError ? 'border-destructive/30' : 'border-amber-300 text-amber-700'}`}
                                      >
                                        {hint.label}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                {!blockingError && (
                                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                                    成功后诊断
                                  </Badge>
                                )}
                                <div className="space-y-0.5 break-words">
                                  {messages.map((message, index) => <div key={index}>{message}</div>)}
                                </div>
                              </div>
                            ) : '—'}
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
