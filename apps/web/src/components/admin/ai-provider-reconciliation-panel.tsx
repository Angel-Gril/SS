'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { api, type ApiResponse } from '@/lib/api';
import {
  aiProviderReconciliationActions,
  createAiProviderReconciliationRequestId,
  type AiProviderReconciliationAction,
  type AiProviderReconciliationItem,
  type AiProviderReconciliationList,
  type AiProviderReconciliationListStatus,
  type AiProviderReconciliationStatus,
} from '@/lib/ai-provider-reconciliation';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

interface DecisionState {
  item: AiProviderReconciliationItem;
  action: AiProviderReconciliationAction;
  requestId: string;
}

const ACTION_TEXT: Record<AiProviderReconciliationAction, {
  button: string;
  title: string;
  description: string;
  success: string;
}> = {
  RESUME: {
    button: '恢复核对',
    title: '恢复 Provider 任务核对',
    description: '绑定同一个 Provider 任务并恢复查询，不会再次提交付费任务。',
    success: 'Provider 任务已恢复核对',
  },
  NOT_SUBMITTED: {
    button: '确认未提交',
    title: '确认 Provider 未接收任务',
    description: '该结论会终止结果核对并释放未结算成本。',
    success: '已确认 Provider 未接收任务',
  },
  NO_OUTPUT: {
    button: '确认无输出',
    title: '确认 Provider 没有可恢复输出',
    description: '该结论会终止结果核对，但不会替代独立的 Provider 成本结算。',
    success: '已确认 Provider 没有可恢复输出',
  },
};

export function AiProviderReconciliationPanel() {
  const { toast } = useToast();
  const [items, setItems] = useState<AiProviderReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AiProviderReconciliationListStatus>('MANUAL_REVIEW');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const [decision, setDecision] = useState<DecisionState | null>(null);
  const [providerJobId, setProviderJobId] = useState('');
  const [providerAcceptedAt, setProviderAcceptedAt] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (options: { quiet?: boolean; cursor?: string } = {}) => {
    const { quiet = false, cursor } = options;
    const append = Boolean(cursor);
    const sequence = append ? requestSequence.current : requestSequence.current + 1;
    if (!append) requestSequence.current = sequence;
    if (append) setLoadingMore(true);
    else if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const query = `limit=50&status=${encodeURIComponent(statusFilter)}`
        + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const response = await api.get<AiProviderReconciliationList>(
        `/api/admin/ai-provider-reconciliations?${query}`,
      );
      if (sequence !== requestSequence.current) return;
      if (response.code === 1 && response.data && response.data.status === statusFilter) {
        setItems((current) => {
          if (!append) return response.data!.items;
          const known = new Set(current.map((item) => item.id));
          return [...current, ...response.data!.items.filter((item) => !known.has(item.id))];
        });
        setNextCursor(response.data.nextCursor && response.data.nextCursor !== cursor
          ? response.data.nextCursor
          : null);
      } else if (!quiet) {
        toast({ title: 'Provider 结果核对队列加载失败', description: response.msg, variant: 'destructive' });
      }
    } catch {
      if (!quiet) {
        toast({ title: 'Provider 结果核对队列加载失败', description: '无法连接服务器', variant: 'destructive' });
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (!decision) void load({ quiet: true });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [decision, load]);

  function openDecision(item: AiProviderReconciliationItem, action: AiProviderReconciliationAction) {
    if (!aiProviderReconciliationActions(item).includes(action)) return;
    setDecision({ item, action, requestId: createAiProviderReconciliationRequestId() });
    setProviderJobId(item.providerJobId || item.costProviderJobId || '');
    setProviderAcceptedAt(item.providerAcceptedAt || '');
    setReason('');
    setConfirmed(false);
  }

  function closeDecision() {
    if (!submitting) setDecision(null);
  }

  async function submitDecision() {
    if (!decision || !confirmed || reason.trim().length < 10) return;
    let acceptedAt: string | undefined;
    if (decision.action === 'RESUME') {
      const parsedAcceptedAt = new Date(providerAcceptedAt);
      if (!providerJobId.trim() || Number.isNaN(parsedAcceptedAt.getTime())) {
        toast({ title: '请填写准确的 Provider 任务 ID 和接收时间', variant: 'destructive' });
        return;
      }
      acceptedAt = parsedAcceptedAt.toISOString();
    }

    setSubmitting(true);
    let response: ApiResponse<AiProviderReconciliationItem>;
    try {
      response = await api.post<AiProviderReconciliationItem>(
        `/api/admin/ai-provider-reconciliations/${encodeURIComponent(decision.item.id)}/resolve`,
        {
          requestId: decision.requestId,
          expectedStatus: 'MANUAL_REVIEW',
          expectedRevision: decision.item.revision,
          expectedEvidenceHash: decision.item.evidenceHash,
          action: decision.action,
          ...(decision.action === 'RESUME' ? {
            providerJobId: providerJobId.trim(),
            providerAcceptedAt: acceptedAt,
          } : {}),
          reason: reason.trim(),
        },
      );
    } catch {
      toast({
        title: 'Provider 结果核对未提交',
        description: '网络响应未确认，可在同一窗口使用相同请求重试。',
        variant: 'destructive',
      });
      return;
    } finally {
      setSubmitting(false);
    }

    if (response.code !== 1) {
      toast({
        title: 'Provider 结果核对未提交',
        description: response.msg || '记录可能已变化，请刷新后重新确认。',
        variant: 'destructive',
      });
      setDecision(null);
      await load({ quiet: true });
      return;
    }
    toast({ title: ACTION_TEXT[decision.action].success });
    setDecision(null);
    await load({ quiet: true });
  }

  return (
    <section aria-labelledby="ai-provider-reconciliation-title" className="space-y-4 border-t pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="ai-provider-reconciliation-title" className="flex items-center gap-2 text-base font-semibold">
            <ShieldAlert className="h-5 w-5" /> AI Provider 结果核对
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            恢复已提交任务的结果状态；Provider 成本仍由下方独立账本处理。
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="ai-provider-reconciliation-status" className="sr-only">核对状态</label>
          <select
            id="ai-provider-reconciliation-status"
            value={statusFilter}
            onChange={(event) => {
              requestSequence.current += 1;
              setStatusFilter(event.target.value as AiProviderReconciliationListStatus);
              setDecision(null);
              setItems([]);
              setNextCursor(null);
            }}
            className="h-9 min-w-36 border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="MANUAL_REVIEW">需要人工处理</option>
            <option value="ALL">全部未解决</option>
            <option value="PENDING">等待核对</option>
            <option value="RUNNING">核对中</option>
            <option value="RETRY_WAIT">等待再次核对</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void load({ quiet: true })} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />刷新队列
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />正在读取 Provider 结果核对任务
        </div>
      ) : items.length === 0 ? (
        <div className="border py-10 text-center text-sm text-muted-foreground">
          当前没有待核对的 Provider 结果。
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto border">
            <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">核对状态</th>
                <th className="px-3 py-2 font-medium">任务 / 范围</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">调度 / 截止</th>
                <th className="px-3 py-2 font-medium">最近证据</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => {
                const actions = aiProviderReconciliationActions(item);
                return (
                  <tr key={item.id} className="align-top">
                    <td className="px-3 py-3">
                      <Badge variant={providerReconciliationVariant(item.status)}>
                        {providerReconciliationLabel(item.status)}
                      </Badge>
                      <div className="mt-2 text-xs text-muted-foreground">
                        第 {item.attemptCount} 次核对 · 修订 {item.revision}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">成本 {item.costStatus || '无记录'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs">{item.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {operationLabel(item.operation)} · {item.jobStatus}
                      </div>
                      <div className="mt-1 max-w-64 break-words text-xs text-muted-foreground">
                        {contextLabel(item)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{item.provider}</div>
                      <div className="text-xs text-muted-foreground">{item.model}</div>
                      <div className="mt-1 max-w-60 break-all font-mono text-xs text-muted-foreground">
                        {item.providerJobId || '尚未绑定 Provider 任务 ID'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div>下次：{formatDate(item.nextAt)}</div>
                      <div className="mt-1 text-muted-foreground">截止：{formatDate(item.deadlineAt)}</div>
                      <div className="mt-1 text-muted-foreground">调度开始：{formatDate(item.providerDispatchedAt)}</div>
                      {item.providerAcceptedAt ? (
                        <div className="mt-1 text-muted-foreground">Provider 接收：{formatDate(item.providerAcceptedAt)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-72 break-words text-xs">
                        {item.lastProviderStatus ? `Provider: ${item.lastProviderStatus}` : '尚无 Provider 状态'}
                      </div>
                      {item.lastErrorCode ? (
                        <div className="mt-1 max-w-72 break-words text-xs text-destructive">
                          {item.lastErrorCode}{item.lastErrorMessage ? ` · ${item.lastErrorMessage}` : ''}
                        </div>
                      ) : null}
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {item.evidenceHash.slice(0, 12)}...
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {actions.length ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {actions.map((action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant={action === 'RESUME' ? 'default' : 'outline'}
                              onClick={() => openDecision(item, action)}
                            >
                              {action === 'RESUME'
                                ? <RotateCcw className="mr-1.5 h-4 w-4" />
                                : <Ban className="mr-1.5 h-4 w-4" />}
                              {ACTION_TEXT[action].button}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-right text-xs text-muted-foreground">
                          {item.status === 'MANUAL_REVIEW' && !item.workflowId
                            ? '独立任务暂不可人工处理'
                            : '自动核对中'}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
          {nextCursor ? (
            <div className="flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void load({ cursor: nextCursor })}
              >
                {loadingMore
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <ChevronDown className="mr-2 h-4 w-4" />}
                {loadingMore ? '正在加载' : '加载更多'}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open) closeDecision(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {decision ? ACTION_TEXT[decision.action].title : '核对 Provider 任务'}
            </DialogTitle>
            <DialogDescription>
              {decision ? ACTION_TEXT[decision.action].description : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border bg-muted/30 px-3 py-2 text-xs">
              <div className="break-all font-mono">{decision?.item.id}</div>
              <div className="mt-1 text-muted-foreground">
                {decision?.item.provider} / {decision?.item.model} · 修订 {decision?.item.revision}
              </div>
            </div>
            {decision?.action === 'RESUME' ? (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-provider-job-id">Provider 任务 ID</Label>
                  <Input
                    id="ai-provider-job-id"
                    value={providerJobId}
                    maxLength={500}
                    onChange={(event) => setProviderJobId(event.target.value)}
                    placeholder="填写 Provider 后台中的准确任务 ID"
                    disabled={Boolean(decision.item.providerJobId || decision.item.costProviderJobId)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-provider-accepted-at">Provider 接收时间</Label>
                  <Input
                    id="ai-provider-accepted-at"
                    value={providerAcceptedAt}
                    onChange={(event) => setProviderAcceptedAt(event.target.value)}
                    placeholder="2026-07-21T12:00:00.000Z"
                    disabled={Boolean(decision.item.providerAcceptedAt)}
                  />
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="ai-provider-resolution-reason">核对证据说明</Label>
              <textarea
                id="ai-provider-resolution-reason"
                rows={4}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value.replace(/[\r\n]+/gu, ' '))}
                className="w-full resize-y border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="记录 Provider 控制台、任务查询或工单中的证据，不要粘贴密钥。"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>我已核对准确的 Provider 任务证据，并确认该决定会写入不可变审计记录。</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDecision} disabled={submitting}>取消</Button>
            <Button
              variant={decision?.action === 'RESUME' ? 'default' : 'destructive'}
              onClick={() => void submitDecision()}
              disabled={submitting
                || !confirmed
                || reason.trim().length < 10
                || (decision?.action === 'RESUME' && (!providerJobId.trim() || !providerAcceptedAt.trim()))}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {decision ? ACTION_TEXT[decision.action].button : '提交核对'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function providerReconciliationLabel(status: AiProviderReconciliationStatus): string {
  return ({
    NOT_REQUIRED: '无需核对',
    PENDING: '等待核对',
    RUNNING: '核对中',
    RETRY_WAIT: '等待再次核对',
    MANUAL_REVIEW: '需要人工处理',
    RECOVERED: '结果已恢复',
    NO_OUTPUT: '已确认无输出',
    NOT_SUBMITTED: '已确认未提交',
    CANCELLED_OUTPUT_RETAINED: '取消后保留输出',
  } as const)[status];
}

function providerReconciliationVariant(
  status: AiProviderReconciliationStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  if (status === 'MANUAL_REVIEW') return 'destructive';
  if (status === 'RUNNING') return 'secondary';
  if (status === 'PENDING' || status === 'RETRY_WAIT') return 'warning';
  if (status === 'RECOVERED') return 'success';
  return 'outline';
}

function operationLabel(operation: string): string {
  return ({
    IMAGE_TRANSLATE: '图片翻译',
    IMAGE_TO_IMAGE: '参考改图',
    TEXT_TO_IMAGE: '文字生图',
    FULL_EDIT: '全图编辑',
    INPAINT: '局部重绘',
  } as Record<string, string>)[operation] || operation;
}

function contextLabel(item: AiProviderReconciliationItem): string {
  const context = item.context;
  if (!context?.id) return item.workflowId ? `工作流 ${item.workflowId}` : '无工作流上下文';
  return [context.type, context.id, context.skuKey, context.slotKey].filter(Boolean).join(' · ');
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}
