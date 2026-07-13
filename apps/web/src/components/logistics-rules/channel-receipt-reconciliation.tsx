'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { normalizeChannelReceiptReconciliation } from '@/components/logistics-rules/workbench-state.mjs';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ReceiptStatus = 'APPLIED' | 'FAILED';

interface ReceiptRecord {
  receiptId: string;
  assignmentId: string;
  releaseId: string;
  releaseSequence: number;
  effectiveChecksum: string;
  status: ReceiptStatus;
  failureCode: string | null;
  extensionVersion: string;
  appliedAt: string | null;
  receivedAt: string;
  deviceLabel: string;
}

interface ReceiptReconciliation {
  channelId: string;
  currentSequence: number;
  retiredAt: string | null;
  summary: {
    total: number;
    byStatus: { APPLIED: number; FAILED: number };
    expected: number | null;
    pending: number | null;
  };
  records: ReceiptRecord[];
}

interface ChannelReceiptReconciliationProps {
  channelId: string;
}

const EMPTY_RECONCILIATION: ReceiptReconciliation = {
  channelId: '',
  currentSequence: 0,
  retiredAt: null,
  summary: {
    total: 0,
    byStatus: { APPLIED: 0, FAILED: 0 },
    expected: null,
    pending: null,
  },
  records: [],
};

function formatReceiptDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return status === 'APPLIED' ? (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      已应用
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      失败
    </Badge>
  );
}

export function ChannelReceiptReconciliation({ channelId }: ChannelReceiptReconciliationProps) {
  const [data, setData] = useState<ReceiptReconciliation>(EMPTY_RECONCILIATION);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const requestVersion = useRef(0);

  const loadReceipts = useCallback(async () => {
    const selectedChannelId = channelId.trim();
    const version = ++requestVersion.current;
    if (!selectedChannelId) {
      setData(EMPTY_RECONCILIATION);
      setLoadState('idle');
      setErrorMessage('');
      return;
    }

    setData({ ...EMPTY_RECONCILIATION, channelId: selectedChannelId });
    setLoadState('loading');
    setErrorMessage('');
    try {
      const response = await api.get<unknown>(
        `/api/admin/logistics-rules/channels/${encodeURIComponent(channelId)}/receipts?limit=50`,
      );
      if (version !== requestVersion.current) return;
      if (response.code !== 1 || !response.data) {
        setLoadState('error');
        setErrorMessage(response.msg || '服务器未返回设备回执');
        return;
      }
      const normalized = normalizeChannelReceiptReconciliation(
        response.data as Record<string, unknown>,
      ) as ReceiptReconciliation;
      if (normalized.channelId && normalized.channelId !== selectedChannelId) {
        setLoadState('error');
        setErrorMessage('回执所属 Channel 与当前选择不一致');
        return;
      }
      setData(normalized);
      setLoadState('ready');
    } catch (error) {
      if (version !== requestVersion.current) return;
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : '网络请求失败');
    }
  }, [channelId]);

  useEffect(() => {
    void loadReceipts();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadReceipts]);

  const pendingDisplay =
    data.summary.expected === null
      ? '-'
      : `${data.summary.pending ?? '-'} / ${data.summary.expected}`;

  return (
    <section aria-labelledby="receipt-reconciliation-title" className="space-y-3 border-t pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="receipt-reconciliation-title" className="text-base font-semibold">
            设备应用回执
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            核对扩展是否已应用当前发布；这里只显示设备标签和发布结果。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadReceipts()}
          disabled={!channelId.trim() || loadState === 'loading'}
          title="刷新设备应用回执"
        >
          {loadState === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新回执
        </Button>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-y border-y text-sm sm:grid-cols-4 sm:divide-y-0">
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">已接收</dt>
          <dd className="mt-1 font-semibold tabular-nums">{data.summary.total}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">已应用</dt>
          <dd className="mt-1 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {data.summary.byStatus.APPLIED}
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">失败</dt>
          <dd className="mt-1 font-semibold tabular-nums text-destructive">
            {data.summary.byStatus.FAILED}
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">待确认 / 预期</dt>
          <dd className="mt-1 font-semibold tabular-nums">{pendingDisplay}</dd>
        </div>
      </dl>

      {loadState === 'loading' && data.records.length === 0 && (
        <div className="flex min-h-28 items-center justify-center gap-2 border-y text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载设备回执
        </div>
      )}

      {loadState === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
          <div className="flex min-w-0 items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadReceipts()}>
            重新加载回执
          </Button>
        </div>
      )}

      {loadState === 'ready' && data.records.length === 0 && (
        <div className="border-y bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          尚无设备应用回执
        </div>
      )}

      {data.records.length > 0 && (
        <div className="overflow-x-auto border-y">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-24 px-3 py-2 font-medium">Sequence</th>
                <th className="w-24 px-3 py-2 font-medium">状态</th>
                <th className="w-40 px-3 py-2 font-medium">设备</th>
                <th className="w-24 px-3 py-2 font-medium">扩展版本</th>
                <th className="w-44 px-3 py-2 font-medium">失败代码</th>
                <th className="w-48 px-3 py-2 font-medium">应用 / 接收时间</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.records.map((receipt) => (
                <tr key={receipt.receiptId}>
                  <td className="px-3 py-3 font-mono text-xs tabular-nums">
                    {receipt.releaseSequence}
                  </td>
                  <td className="px-3 py-3">
                    <ReceiptStatusBadge status={receipt.status} />
                  </td>
                  <td className="truncate px-3 py-3" title={receipt.deviceLabel || undefined}>
                    {receipt.deviceLabel || '-'}
                  </td>
                  <td className="break-words px-3 py-3 font-mono text-xs">
                    {receipt.extensionVersion || '-'}
                  </td>
                  <td className="break-all px-3 py-3 font-mono text-xs text-muted-foreground">
                    {receipt.failureCode || '-'}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div>{formatReceiptDate(receipt.appliedAt)}</div>
                    <div className="mt-1">收到：{formatReceiptDate(receipt.receivedAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
