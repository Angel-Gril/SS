'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { ListingJobDetailDialog } from './listing-job-detail-dialog';

export type Status = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface JobRow {
  id: string;
  status: Status;
  payload: {
    taskId?: number;
    mode?: 'follow' | 'clone' | 'follow-by-sku' | '1688' | 'batch';
    entry?: 'collect-page' | 'listing-page' | '1688-listing' | 'manual-batch';
    sourceSkus?: string[];
    sourcePlatforms?: string[];
    ozonSkus?: string[];
    ozonProductIds?: string[];
    ozonOfferIds?: string[];
    offerIds?: string[];
    offerImages?: Record<string, string> | null;
    listingSources?: Array<Record<string, unknown>>;
    itemCount?: number;
    sourceItemCount?: number;
    failedCount?: number;
    importedCount?: number;
    pendingCount?: number;
    resultStatus?: 'submitted' | 'pending' | 'imported' | 'partial_failed' | 'failed';
    lastRefreshedAt?: string;
  } | null;
  errorMessage: string | null;
  createdAt: string;
  shop: { name: string; platform: string };
}

const STATUS_BADGE: Record<Status, { text: string; cls: string }> = {
  PENDING: { text: '待执行', cls: 'bg-zinc-500' },
  RUNNING: { text: '上架中', cls: 'bg-amber-500' },
  SUCCESS: { text: '成功', cls: 'bg-emerald-600' },
  FAILED: { text: '失败', cls: 'bg-destructive' },
};

export function StatusBadge({ s }: { s: Status }) {
  const v = STATUS_BADGE[s];
  return <Badge className={`${v.cls} text-white`}>{v.text}</Badge>;
}

// 根据 payload.mode + 是否多变体场景生成标签文本
export function modeLabel(payload: JobRow['payload']): { text: string; cls: string } {
  const mode = payload?.mode;
  const itemCount = payload?.itemCount ?? 0;
  const sourceCount = payload?.sourceItemCount ?? 0;
  const isMultiVariant = sourceCount > 0 && itemCount > sourceCount;

  if (mode === '1688') {
    return {
      text: '1688 上架',
      cls: 'border-sky-300 text-sky-700 bg-sky-50 dark:bg-sky-950 dark:text-sky-300',
    };
  }
  if (mode === 'batch') {
    return {
      text: '批量上架',
      cls: 'border-zinc-300 text-zinc-700 bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300',
    };
  }

  // mode 空时兜底显示跟卖（兼容老数据）
  const baseAction = mode === 'clone' ? '复制' : '跟卖';
  const text = isMultiVariant ? `多SKU变体${baseAction}` : baseAction;
  const cls = mode === 'clone'
    ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300'
    : 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300';
  return { text, cls };
}

interface Props {
  // 按上架来源过滤：'listing-page' = 改款页发起；'collect-page' = 采集跟卖页发起
  entryFilter?: 'collect-page' | 'listing-page' | '1688-listing' | null;
  // 按模式过滤：'follow' = 跟卖；'clone' = 复制
  modeFilter?: 'follow' | 'clone' | null;
  // 卡片标题文案
  title?: string;
  // 是否带图标主色（emerald / 默认）
  accentEmerald?: boolean;
  // limit
  limit?: number;
  // 外部动作完成后触发重新加载，比如提交新的 1688 上架任务后刷新记录列表
  refreshToken?: number | string;
}

export function ListingJobList({
  entryFilter = null,
  modeFilter = null,
  title = '上架记录',
  accentEmerald = false,
  limit = 30,
  refreshToken = 0,
}: Props) {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit) });
    if (entryFilter && entryFilter !== 'collect-page') params.set('entry', entryFilter);
    const res = await api.get<{ rows: JobRow[] }>(`/api/listing/tasks?${params.toString()}`);
    if (res.code === 1 && res.data?.rows) {
      let filtered = res.data.rows;
      if (entryFilter) {
        filtered = filtered.filter((r) => {
          const e = r.payload?.entry;
          if (entryFilter === '1688-listing') return e === '1688-listing';
          // listing-page：必须明确写了 listing-page；老数据/没有 entry 字段的不显示在改款页
          if (entryFilter === 'listing-page') return e === 'listing-page';
          // collect-page：明确 collect-page，或老数据（兼容历史记录）
          return e === 'collect-page' || !e;
        });
      }
      if (modeFilter) {
        filtered = filtered.filter((r) => {
          const m = r.payload?.mode;
          if (modeFilter === 'clone') return m === 'clone';
          return m !== 'clone'; // follow + follow-by-sku + 老数据
        });
      }
      setRows(filtered);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [entryFilter, modeFilter, limit, refreshToken]);

  const accent = accentEmerald ? 'border-emerald-200 dark:border-emerald-900' : '';
  const iconColor = accentEmerald ? 'text-emerald-600' : 'text-muted-foreground';

  return (
    <Card className={accent}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <ScrollText className={`h-4 w-4 ${iconColor}`} />
          {title}
          {rows.length > 0 && <span className="text-xs text-muted-foreground font-normal">共 {rows.length} 条</span>}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="ml-1 text-xs">刷新</span>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {loading && rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">暂无记录</div>
        ) : (
          rows.map((row) => <JobCard key={row.id} row={row} onOpenDetail={() => setDetailId(row.id)} />)
        )}
      </CardContent>

      {detailId && (
        <ListingJobDetailDialog
          jobId={detailId}
          onClose={() => setDetailId(null)}
          onRefreshed={() => load()}
        />
      )}
    </Card>
  );
}

function JobCard({ row, onOpenDetail }: { row: JobRow; onOpenDetail: () => void }) {
  const sourceSkus = row.payload?.sourceSkus || [];
  const sourcePlatforms = row.payload?.sourcePlatforms || [];
  const ozonSkus = row.payload?.ozonSkus || [];
  const offerIds = row.payload?.offerIds || [];
  const total = row.payload?.itemCount ?? 0;
  const failed = row.payload?.failedCount ?? 0;
  const imported = row.payload?.importedCount ?? (row.status === 'SUCCESS' ? Math.max(0, total - failed) : 0);
  const pending = row.payload?.pendingCount ?? 0;
  const mode = modeLabel(row.payload);

  return (
    <div className="rounded-lg border p-3 sm:p-4 transition-colors hover:bg-muted/30 space-y-2.5">
      {/* 头部：店铺 + 模式 + 状态 + 时间 + 详情按钮 */}
      <div className="flex items-center flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm">{row.shop?.name}</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{row.shop?.platform}</span>
        </div>
        <Badge variant="outline" className={`text-[10px] ${mode.cls}`}>{mode.text}</Badge>
        <StatusBadge s={row.status} />
        {sourcePlatforms.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            货源平台 {sourcePlatforms.join(' / ')}
          </span>
        )}
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            共 {total}
            {imported > 0 && <span className="text-emerald-600"> · {imported} 成功</span>}
            {failed > 0 && <span className="text-destructive"> · {failed} 失败</span>}
            {pending > 0 && <span className="text-amber-600"> · {pending} 处理中</span>}
          </span>
        )}
        {row.payload?.lastRefreshedAt && (
          <span className="text-[11px] text-muted-foreground">
            刷新 {new Date(row.payload.lastRefreshedAt).toLocaleString('zh-CN', { hour12: false })}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
        <Button size="sm" variant="outline" onClick={onOpenDetail} className="h-7 text-xs">
          详情
        </Button>
      </div>

      {/* 主体：货源 SKU + Ozon SKU + 新 offer_id */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">货源 SKU（{sourceSkus.length}）</div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {sourceSkus.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              sourceSkus.slice(0, 8).map((sku, i) => (
                <code key={i} className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{sku}</code>
              ))
            )}
            {sourceSkus.length > 8 && (
              <button onClick={onOpenDetail} className="text-[11px] text-primary hover:underline">
                +{sourceSkus.length - 8} 更多
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Ozon SKU（{ozonSkus.length}）</div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {ozonSkus.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              ozonSkus.slice(0, 8).map((sku, i) => (
                <code key={i} className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded text-[11px]">{sku}</code>
              ))
            )}
            {ozonSkus.length > 8 && (
              <button onClick={onOpenDetail} className="text-[11px] text-primary hover:underline">
                +{ozonSkus.length - 8} 更多
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">新 offer_id（{offerIds.length}）</div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {offerIds.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              offerIds.slice(0, 8).map((oid, i) => {
                const img = row.payload?.offerImages?.[oid];
                return (
                  <div key={i} className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950 rounded px-1 py-0.5">
                    {img && (
                      <img
                        src={img}
                        alt=""
                        className="h-7 w-7 rounded object-cover border border-emerald-200 dark:border-emerald-800 cursor-pointer hover:opacity-80"
                        onClick={(e) => { e.stopPropagation(); window.open(img, '_blank'); }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <code className="text-[11px] text-emerald-700 dark:text-emerald-400">{oid}</code>
                  </div>
                );
              })
            )}
            {offerIds.length > 8 && (
              <button onClick={onOpenDetail} className="text-[11px] text-primary hover:underline self-center">
                +{offerIds.length - 8} 更多
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 错误信息 */}
      {row.errorMessage && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-1 break-all">
          {row.errorMessage}
        </div>
      )}
    </div>
  );
}
