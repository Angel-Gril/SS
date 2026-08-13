'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import {
  browserOneClickReviewDraftHref,
  parseBrowserOneClickReviewFailure,
  parseBrowserOneClickReviewHandoff,
} from '@/lib/browser-one-click-review';
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

function browserOneClickFailureLabel(errorCode: string): string {
  const labels: Record<string, string> = {
    SOURCE_CAPTURE_ADAPTER_UNAVAILABLE: 'ERP 来源采集服务不可用',
    SOURCE_LISTING_WORKFLOW_NOT_INTERACTIVE: '来源商品审核工作流暂不可用',
    BROWSER_ONE_CLICK_EXPECTED_SKUS_REQUIRED: '任务缺少预期 SKU',
    BROWSER_ONE_CLICK_SKU_COVERAGE_INCOMPLETE: '浏览器数据未覆盖全部 SKU',
    BROWSER_ONE_CLICK_SKU_UNKNOWN: '浏览器返回了任务外 SKU',
    BROWSER_ONE_CLICK_SKU_DUPLICATE: '浏览器返回了重复 SKU',
    BROWSER_ONE_CLICK_CAPTURE_PARTIAL_FAILURE: '部分商品采集失败',
    SOURCE_LISTING_DRAFT_COVERAGE_INCOMPLETE: '审核草稿未覆盖全部商品',
    SOURCE_LISTING_DRAFT_COVERAGE_AMBIGUOUS: '审核草稿商品映射重复',
  };
  return labels[errorCode] || '来源采集或审核草稿生成失败';
}

function browserOneClickFailureStage(errorCode: string): string {
  if (errorCode.includes('CAPTURE')) return '采集失败';
  if (errorCode.includes('DRAFT') || errorCode.includes('SOURCE_LISTING')) return '草稿失败';
  return '交接失败';
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

function videoStatusLabel(status: string): string {
  switch (status) {
    case 'uploaded':
      return '已上架';
    case 'pending':
      return '待确认';
    case 'skipped':
    case 'manual_required':
      return '未自动上架';
    case 'failed':
      return '失败';
    default:
      return status || '未知';
  }
}

function videoStatusBadgeClass(status: string): string {
  switch (status) {
    case 'uploaded':
      return 'bg-emerald-600';
    case 'pending':
      return 'bg-blue-600';
    case 'skipped':
    case 'manual_required':
      return 'bg-amber-500';
    case 'failed':
      return 'bg-destructive';
    default:
      return 'bg-zinc-500';
  }
}

function videoPublishStatusLabel(status?: string): string {
  switch (status) {
    case 'success':
      return '视频已上架';
    case 'pending':
      return '视频待确认';
    case 'partial_pending':
      return '部分视频待确认';
    case 'partial_failed':
      return '部分视频未上架';
    case 'manual_required':
      return '视频待手动处理';
    case 'partial_manual_required':
      return '部分视频待手动处理';
    case 'failed':
      return '视频上架失败';
    default:
      return '视频诊断';
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

function isBrowserOneClickPreHandoffStage(stage: unknown): boolean {
  return stage === 'preparing_browser_data' || stage === 'collecting';
}

export function ListingJobDetailDialog({
  jobId,
  onClose,
  onRefreshed,
}: { jobId: string; onClose: () => void; onRefreshed: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const loadRequestVersion = useRef(0);
  const refreshRequestVersion = useRef(0);

  async function load(silent = false): Promise<boolean> {
    const requestVersion = ++loadRequestVersion.current;
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<DetailData>(`/api/listing/tasks/${encodeURIComponent(jobId)}`);
      if (loadRequestVersion.current !== requestVersion) return false;
      if (res.code === 1 && res.data) {
        setData(res.data);
        return true;
      } else {
        setLoadError(res.msg || '任务详情加载失败');
      }
    } catch (error) {
      if (loadRequestVersion.current !== requestVersion) return false;
      setLoadError(error instanceof Error ? error.message : '任务详情加载失败');
    } finally {
      if (loadRequestVersion.current === requestVersion) setLoading(false);
    }
    return false;
  }

  async function refresh(silent = false) {
    if (refreshing) return;
    const requestVersion = ++refreshRequestVersion.current;
    setRefreshing(true);
    try {
      const res = await api.post<{ status: Status }>(`/api/listing/tasks/${encodeURIComponent(jobId)}/refresh`, {});
      if (refreshRequestVersion.current !== requestVersion) return;
      if (res.code === 1) {
        if (!silent) toast({ title: '已从 OZON 拉取最新状态' });
        await load(silent);
        if (refreshRequestVersion.current === requestVersion) onRefreshed();
      } else if (!silent) {
        toast({ title: res.msg || '刷新失败', variant: 'destructive' });
      }
    } catch (error) {
      if (!silent && refreshRequestVersion.current === requestVersion) {
        toast({
          title: '刷新失败',
          description: error instanceof Error ? error.message : '网络请求失败',
          variant: 'destructive',
        });
      }
    } finally {
      if (refreshRequestVersion.current === requestVersion) setRefreshing(false);
    }
  }

  useEffect(() => {
    setData(null);
    setLoadError('');
    setRefreshing(false);
    void load();
    return () => {
      loadRequestVersion.current += 1;
      refreshRequestVersion.current += 1;
    };
  }, [jobId]);

  const mode = data ? modeLabel(data.payload) : null;
  const jobErrorHint = data?.error ? explainOzonError(data.error) : null;
  const importInfoError = data?.payload?.lastImportInfoError || null;
  const importInfoCheckedAt = data?.payload?.lastImportInfoCheckedAt || null;
  const importInfoSource = data?.payload?.ozonImportInfoSource || null;
  const pictureUploads = data?.payload?.pictureUploads || [];
  const pictureUploadedCount = pictureUploads.filter((it) => it.status === 'uploaded').length;
  const pictureBlockedCount = pictureUploads.filter((it) => it.status !== 'uploaded').length;
  const pictureProblemCount = pictureBlockedCount + (data?.payload?.pictureUploadError ? 1 : 0);
  const pictureUploadStatus = data?.payload?.pictureUploadStatus;
  const pictureActivationPending = data?.payload?.pictureActivationPending || [];
  const picturePendingCount = Number(data?.payload?.pictureUploadPendingCount || 0);
  const pictureActivationPendingCount = Number(data?.payload?.pictureActivationPendingCount || pictureActivationPending.length || 0);
  const videoTrace = data?.payload?.videoTrace || [];
  const videoPublishedCount = Number(data?.payload?.videoPublishedCount || 0);
  const videoFailedCount = Number(data?.payload?.videoPublishFailedCount || 0);
  const videoSkippedCount = Number(data?.payload?.videoPublishSkippedCount || 0);
  const videoPendingCount = Number(data?.payload?.videoPublishPendingCount || 0);
  const videoProblemCount = videoFailedCount;
  const videoPublishStatus = data?.payload?.videoPublishStatus;
  const normalizedVideoPublishStatus = videoPublishStatus === 'failed' && videoFailedCount === 0 && videoSkippedCount > 0
    ? 'manual_required'
    : videoPublishStatus;
  const pictureStage = data
    ? resolveListingPictureStage({ status: data.status, payload: data.payload })
    : null;
  const payloadRecord = data?.payload as Record<string, unknown> | null;
  const browserOneClickSource = payloadRecord?.source === 'browser-one-click-listing';
  const rawReviewHandoff = payloadRecord?.browserOneClickPublishHandoff;
  const reviewHandoff = browserOneClickSource
    ? parseBrowserOneClickReviewHandoff(rawReviewHandoff)
    : null;
  const rawReviewFailure = payloadRecord?.browserOneClickReviewFailure;
  const reviewFailure = reviewHandoff ? null : parseBrowserOneClickReviewFailure(rawReviewFailure);
  const reviewFailureMarked = !reviewHandoff
    && browserOneClickSource
    && data?.status === 'FAILED'
    && (
      payloadRecord?.stage === 'review_handoff_failed'
      || rawReviewFailure != null
    );
  const reviewHandoffInvalid = !reviewHandoff
    && !reviewFailureMarked
    && browserOneClickSource
    && (payloadRecord?.stage === 'review_required' || rawReviewHandoff != null);
  const hasOzonTaskId = Number.isFinite(Number(data?.payload?.taskId))
    && Number(data?.payload?.taskId) > 0;
  const browserOneClickNeedsErpPolling = !!data
    && browserOneClickSource
    && data.status === 'RUNNING'
    && isBrowserOneClickPreHandoffStage(payloadRecord?.stage)
    && !hasOzonTaskId
    && !reviewHandoff
    && !reviewFailureMarked
    && !reviewHandoffInvalid;
  const canRefreshOzon = !browserOneClickSource || hasOzonTaskId;
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
  const shouldAutoRefresh = !!data && canRefreshOzon && !reviewHandoff && !reviewFailureMarked && !reviewHandoffInvalid && (
    data.status === 'RUNNING'
    || pictureUploadStatus === 'pending'
    || pictureUploadStatus === 'partial_pending'
    || pictureActivationPendingCount > 0
    || needsLegacyFallbackPictureRefresh
  );
  const canManualRefresh = !!data && canRefreshOzon && !reviewHandoff && !reviewFailureMarked && !reviewHandoffInvalid && (
    data.status !== 'SUCCESS'
    || (data.status === 'SUCCESS' && Number(data.payload?.failedCount || 0) > 0)
    || fallbackPictureJob
    || pictureUploadStatus === 'pending'
    || pictureUploadStatus === 'partial_pending'
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

  useEffect(() => {
    if (!browserOneClickNeedsErpPolling) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const loaded = await load(true);
      if (cancelled) return;
      if (loaded) onRefreshed();
      timer = window.setTimeout(() => void poll(), 15000);
    };
    timer = window.setTimeout(() => void poll(), 15000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, browserOneClickNeedsErpPolling]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogTitle>上架任务详情</DialogTitle>
        {loading && !data ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin inline-block" />
          </div>
        ) : !data ? (
          <div className="py-8 text-center text-sm">
            <p className="text-destructive">{loadError || '任务详情加载失败'}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {loadError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {loadError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span className="text-muted-foreground">店铺：</span>{data.shopName}</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">状态：</span><StatusBadge s={data.status} reviewRequired={Boolean(reviewHandoff)} reviewFailed={reviewFailureMarked} reviewInvalid={reviewHandoffInvalid} /></div>
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

            {reviewHandoff && (
              <section
                aria-labelledby="browser-one-click-review-heading"
                className="border border-amber-200 bg-amber-50 rounded-md px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="border-amber-400 text-amber-800 dark:border-amber-700 dark:text-amber-200">
                    需要审核
                  </Badge>
                  <h2 id="browser-one-click-review-heading" className="font-medium text-sm">
                    一键上架草稿
                  </h2>
                </div>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  商品尚未发布。请逐项打开草稿，完成内容审核后再提交上架。
                </p>

                {reviewHandoff.drafts.length > 0 ? (
                  <div className="mt-3 divide-y divide-amber-200 border-y border-amber-200 dark:divide-amber-800 dark:border-amber-800">
                    {reviewHandoff.drafts.map((draft, index) => {
                      const draftHref = browserOneClickReviewDraftHref(draft);
                      return (
                        <div
                          key={`${draft.draftId}:${draft.draftVersion ?? ''}:${draft.revision ?? ''}:${index}`}
                          className="flex min-w-0 items-center justify-between gap-3 py-2"
                        >
                          <div className="min-w-0 text-xs">
                            <div className="truncate font-mono" title={draft.draftId}>{draft.draftId}</div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-amber-800 dark:text-amber-300">
                              {draft.supplyGoodsId && <span>商品 {draft.supplyGoodsId}</span>}
                              {draft.skuKey && <span>SKU {draft.skuKey}</span>}
                              {draft.draftVersion != null && <span>版本 {draft.draftVersion}</span>}
                              {draft.revision != null && <span>修订 {draft.revision}</span>}
                            </div>
                          </div>
                          {draftHref ? (
                            <Button asChild variant="outline" size="sm" className="h-8 shrink-0 bg-background">
                              <Link
                                href={draftHref}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`审核草稿 ${draft.draftId}`}
                              >
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                打开草稿
                              </Link>
                            </Button>
                          ) : (
                            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">入口信息不完整</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-amber-800 dark:text-amber-200">
                    暂无可打开的草稿，请查看下方失败原因。
                  </div>
                )}

                {reviewHandoff.failures.length > 0 && (
                  <div className="mt-3 border-t border-amber-200 pt-2 text-xs dark:border-amber-800">
                    <div className="font-medium">草稿创建失败</div>
                    <ul className="mt-1 space-y-1 text-amber-800 dark:text-amber-200">
                      {reviewHandoff.failures.map((failure, index) => (
                        <li key={`${failure.supplyGoodsId ?? ''}:${failure.errorCode}:${index}`} className="break-words">
                          {failure.supplyGoodsId && <span className="mr-2">商品 {failure.supplyGoodsId}</span>}
                          <code>{failure.errorCode}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {reviewHandoffInvalid && (
              <section
                aria-labelledby="browser-one-click-review-invalid-heading"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-destructive"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">审核交接异常</Badge>
                  <h2 id="browser-one-click-review-invalid-heading" className="text-sm font-medium">
                    审核草稿身份数据不完整
                  </h2>
                </div>
                <p className="mt-1 text-xs">
                  任务不会自动发布，也不会查询 Ozon 状态。请记录任务 ID 并联系管理员修复交接数据。
                </p>
              </section>
            )}

            {reviewFailureMarked && (
              <section
                aria-labelledby="browser-one-click-review-failure-heading"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-destructive"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">审核交接失败</Badge>
                  <h2 id="browser-one-click-review-failure-heading" className="text-sm font-medium">
                    未生成完整的可审核草稿
                  </h2>
                </div>
                <p className="mt-1 text-xs">
                  任务已停止且不会发布。请根据下列诊断修复采集数据或 ERP 工作流后重新发起。
                </p>

                {reviewFailure ? (
                  <div className="mt-3 space-y-3 text-xs">
                    <div>
                      <span className="font-medium">主要原因：</span>
                      {browserOneClickFailureLabel(reviewFailure.errorCode)}
                      <code className="ml-2 break-all">{reviewFailure.errorCode}</code>
                    </div>

                    {reviewFailure.missingSkus.length > 0 && (
                      <div>
                        <div className="font-medium">缺失 SKU</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reviewFailure.missingSkus.map((sku, index) => (
                            <code key={`${sku}:${index}`} className="rounded bg-background/80 px-1.5 py-0.5">{sku}</code>
                          ))}
                        </div>
                      </div>
                    )}

                    {reviewFailure.unknownSkus.length > 0 && (
                      <div>
                        <div className="font-medium">任务外 SKU</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reviewFailure.unknownSkus.map((sku, index) => (
                            <code key={`${sku}:${index}`} className="rounded bg-background/80 px-1.5 py-0.5">{sku}</code>
                          ))}
                        </div>
                      </div>
                    )}

                    {reviewFailure.duplicateSkus.length > 0 && (
                      <div>
                        <div className="font-medium">重复 SKU</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reviewFailure.duplicateSkus.map((sku, index) => (
                            <code key={`${sku}:${index}`} className="rounded bg-background/80 px-1.5 py-0.5">{sku}</code>
                          ))}
                        </div>
                      </div>
                    )}

                    {reviewFailure.failures.length > 0 && (
                      <div>
                        <div className="font-medium">采集 / 草稿诊断</div>
                        <ul className="mt-1 space-y-1">
                          {reviewFailure.failures.map((failure, index) => (
                            <li key={`${failure.errorCode}:${failure.supplyGoodsId ?? ''}:${failure.sku ?? ''}:${index}`} className="break-words">
                              <span className="mr-2 font-medium">{browserOneClickFailureStage(failure.errorCode)}</span>
                              {failure.sku && <span className="mr-2">SKU {failure.sku}</span>}
                              {failure.supplyGoodsId && <span className="mr-2">商品 {failure.supplyGoodsId}</span>}
                              <code>{failure.errorCode}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs">
                    交接诊断数据格式异常，请记录任务 ID 并联系管理员排查。
                  </p>
                )}
              </section>
            )}

            {data.error && (
              <div className="border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2 text-destructive text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  {jobErrorHint && <Badge variant="outline" className="text-[10px] border-destructive/30">{jobErrorHint.label}</Badge>}
                  <span>{formatOzonErrorMessage(data.error)}</span>
                </div>
              </div>
            )}

            {importInfoError && (
              <div className="border border-amber-200 bg-amber-50 rounded-md px-3 py-2 text-amber-800 text-xs dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-200 dark:border-amber-700">
                    Ozon 状态查询
                  </Badge>
                  {importInfoSource && <span className="text-muted-foreground">来源：{importInfoSource}</span>}
                  {importInfoCheckedAt && <span className="text-muted-foreground">最近检查：{new Date(importInfoCheckedAt).toLocaleString('zh-CN', { hour12: false })}</span>}
                </div>
                <div className="mt-1 break-words">{formatOzonErrorMessage(importInfoError)}</div>
                <div className="mt-1 text-muted-foreground">任务未失败，系统会继续按 Task ID 和 offer_id 自动重试。</div>
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
                    {pictureProblemCount
                      ? `已上传 ${pictureUploadedCount} / 已阻塞 ${pictureBlockedCount} / 待补传 ${picturePendingCount}`
                      : (pictureStage?.label || '正常')}
                  </Badge>
                </div>
                {data.payload?.pictureUploadError && (
                  <div className="px-3 py-2 text-xs text-destructive border-t break-words">
                    {data.payload.pictureUploadError}
                  </div>
                )}
                {(pictureUploadedCount > 0 || pictureBlockedCount > 0 || picturePendingCount > 0) && (
                  <div className="px-3 py-2 text-xs border-t bg-muted/40">
                    已上传 {pictureUploadedCount} 个，已阻塞 {pictureBlockedCount} 个，待补传 {picturePendingCount} 个。
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

            {videoTrace.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-muted flex items-center justify-between">
                  <div className="font-medium">视频上架诊断</div>
                  <Badge
                    variant={videoProblemCount ? 'destructive' : 'outline'}
                    className={`text-[10px] ${videoProblemCount ? '' : 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300'}`}
                  >
                    {videoPublishStatusLabel(normalizedVideoPublishStatus)}
                  </Badge>
                </div>
                <div className="px-3 py-2 text-xs border-t bg-muted/40">
                  已上架 {videoPublishedCount} 个，待确认 {videoPendingCount} 个，未自动上架 {videoSkippedCount} 个，失败 {videoFailedCount} 个。
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-muted/70">
                    <tr>
                      <th className="text-left px-3 py-2">OFFER ID</th>
                      <th className="text-left px-3 py-2 w-24">状态</th>
                      <th className="text-left px-3 py-2">视频</th>
                      <th className="text-left px-3 py-2">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videoTrace.map((it, i) => (
                      <tr key={`${it.offerId}-${i}`} className="border-t">
                        <td className="px-3 py-2"><code>{it.offerId}</code></td>
                        <td className="px-3 py-2">
                          <Badge className={`${videoStatusBadgeClass(it.status)} text-white text-[10px]`}>
                            {videoStatusLabel(it.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {it.videoUrl ? (
                            <button
                              type="button"
                              className="text-left underline-offset-2 hover:underline"
                              onClick={() => window.open(it.videoUrl, '_blank')}
                            >
                              {it.name || it.videoUrl}
                            </button>
                          ) : `${it.videoCount || 0} 个`}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground break-words">{it.message || it.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      const img = data.payload?.offerImages?.[it.offer_id];
                      const blockingError = isBlockingImportError(it);
                      const cls = blockingError ? 'bg-destructive' : it.status === 'imported' ? 'bg-emerald-600' : it.status === 'failed' ? 'bg-destructive' : 'bg-amber-500';
                      const txt = blockingError ? '待更正' : it.status === 'imported' ? '成功' : it.status === 'failed' ? '失败' : '处理中';
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
