'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Ban, CircleDollarSign, Loader2, RefreshCw } from 'lucide-react';
import { api, type ApiResponse } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CostStatus = 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED';
type ReconciliationOutcome = 'SETTLED' | 'RELEASED';

interface CostSettlement {
  id: string;
  kind: string;
  actorUserId: string;
  actualCostMinor: number | null;
  billedUnits: number;
  reason: string | null;
  createdAt: string;
}

interface CostReconciliationItem {
  id: string;
  ownerUserId: string;
  workflowId: string | null;
  jobId: string;
  provider: string;
  model: string;
  operation: string;
  currency: string;
  estimatedCostMinor: number;
  maximumCostMinor: number;
  status: CostStatus;
  evidenceHash: string;
  providerRequestId: string | null;
  providerAcceptedAt: string | null;
  reconciliationRequiredAt: string | null;
  updatedAt: string;
  job: {
    status: string;
    errorCode: string | null;
    providerJobId: string | null;
    providerDispatchedAt: string | null;
  } | null;
  settlements: CostSettlement[];
}

interface CostReconciliationList {
  items: CostReconciliationItem[];
  limit: number;
}

interface DecisionState {
  item: CostReconciliationItem;
  outcome: ReconciliationOutcome;
  requestId: string;
}

export function AiCostReconciliationPanel() {
  const { toast } = useToast();
  const [items, setItems] = useState<CostReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [decision, setDecision] = useState<DecisionState | null>(null);
  const [actualCostMinor, setActualCostMinor] = useState('');
  const [billedUnits, setBilledUnits] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const response = await api.get<CostReconciliationList>('/api/admin/ai-cost-reconciliations?limit=50');
      if (response.code === 1 && response.data) {
        setItems(response.data.items);
      } else if (!quiet) {
        toast({ title: '成本对账队列加载失败', description: response.msg, variant: 'destructive' });
      }
    } catch {
      if (!quiet) toast({ title: '成本对账队列加载失败', description: '无法连接服务器', variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (!decision) void load(true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [decision, load]);

  function openDecision(item: CostReconciliationItem, outcome: ReconciliationOutcome) {
    setDecision({ item, outcome, requestId: createReconciliationRequestId() });
    setActualCostMinor(outcome === 'SETTLED' ? '' : '0');
    setBilledUnits(outcome === 'SETTLED' ? '' : '0');
    setReason('');
    setConfirmed(false);
  }

  function closeDecision() {
    if (submitting) return;
    setDecision(null);
  }

  async function submitDecision() {
    if (!decision || !confirmed || reason.trim().length < 10) return;
    const cost = Number(actualCostMinor);
    const units = Number(billedUnits);
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(units) || units < 0) {
      toast({ title: '费用或计费单位无效', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    let response: ApiResponse<CostReconciliationItem>;
    try {
      response = await api.post<CostReconciliationItem>(
        `/api/admin/ai-cost-reconciliations/${decision.item.id}/reconcile`,
        {
          requestId: decision.requestId,
          expectedStatus: decision.item.status,
          expectedEvidenceHash: decision.item.evidenceHash,
          outcome: decision.outcome,
          actualCostMinor: decision.outcome === 'SETTLED' ? cost : 0,
          billedUnits: decision.outcome === 'SETTLED' ? units : 0,
          reason: reason.trim(),
        },
      );
    } catch {
      toast({ title: '成本对账未提交', description: '无法连接服务器，可使用同一窗口重试。', variant: 'destructive' });
      return;
    } finally {
      setSubmitting(false);
    }
    if (response.code !== 1) {
      toast({
        title: '成本对账未提交',
        description: response.msg || '记录可能已经变化，请刷新后重试。',
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: decision.outcome === 'SETTLED' ? '已确认 Provider 计费' : '已确认 Provider 未计费',
      description: '审计结算已写入，相关任务可重新判断是否允许重试。',
    });
    setDecision(null);
    await load(true);
  }

  return (
    <section aria-labelledby="ai-cost-reconciliation-title" className="space-y-4 border-t pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="ai-cost-reconciliation-title" className="flex items-center gap-2 text-base font-semibold">
            <CircleDollarSign className="h-5 w-5" /> AI Provider 成本对账
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            仅处理提交结果不确定或 Provider 已接收但本地结果未知的任务。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> 刷新队列
        </Button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在读取待对账记录
        </div>
      ) : items.length === 0 ? (
        <div className="border py-10 text-center text-sm text-muted-foreground">
          当前没有待人工确认的 Provider 成本记录。
        </div>
      ) : (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">状态 / 时间</th>
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">预留</th>
                <th className="px-3 py-2 font-medium">证据</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="px-3 py-3">
                    <Badge variant="destructive">{statusLabel(item.status)}</Badge>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(item.reconciliationRequiredAt)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs">{item.jobId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.operation} · {item.job?.status || 'UNKNOWN'}
                    </div>
                    {item.job?.errorCode ? (
                      <div className="mt-1 max-w-64 break-words text-xs text-destructive">{item.job.errorCode}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <div>{item.provider}</div>
                    <div className="text-xs text-muted-foreground">{item.model}</div>
                    <div className="mt-1 max-w-56 break-all font-mono text-xs text-muted-foreground">
                      {item.providerRequestId || item.job?.providerJobId || '尚无 Provider ID'}
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    <div>{item.maximumCostMinor} {item.currency} minor</div>
                    <div className="text-xs text-muted-foreground">预计 {item.estimatedCostMinor}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="max-w-72 break-words text-xs">
                      {item.settlements[0]?.reason || '等待人工核对 Provider 后台'}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {item.evidenceHash.slice(0, 12)}…
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openDecision(item, 'RELEASED')}>
                        <Ban className="mr-1.5 h-4 w-4" /> 未计费
                      </Button>
                      <Button size="sm" onClick={() => openDecision(item, 'SETTLED')}>
                        <BadgeCheck className="mr-1.5 h-4 w-4" /> 已计费
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open) closeDecision(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {decision?.outcome === 'SETTLED' ? '确认 Provider 已计费' : '确认 Provider 未计费'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-cost-actual">实际费用（最小货币单位）</Label>
                <Input
                  id="ai-cost-actual"
                  type="number"
                  min="0"
                  step="1"
                  value={actualCostMinor}
                  onChange={(event) => setActualCostMinor(event.target.value)}
                  disabled={decision?.outcome === 'RELEASED'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-cost-units">计费单位</Label>
                <Input
                  id="ai-cost-units"
                  type="number"
                  min="0"
                  step="1"
                  value={billedUnits}
                  onChange={(event) => setBilledUnits(event.target.value)}
                  disabled={decision?.outcome === 'RELEASED'}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-cost-reason">核对证据说明</Label>
              <textarea
                id="ai-cost-reason"
                rows={4}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value.replace(/[\r\n]+/gu, ' '))}
                className="w-full resize-y border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="记录 Provider 控制台、账单或工单中的核对结论，不要粘贴密钥。"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>我已在 Provider 后台核对该请求，并确认本次结果将写入不可变审计记录。</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDecision} disabled={submitting}>取消</Button>
            <Button
              onClick={() => void submitDecision()}
              disabled={submitting || !confirmed || reason.trim().length < 10}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              写入对账结果
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function statusLabel(status: CostStatus): string {
  return status === 'SUBMISSION_UNCERTAIN' ? '提交结果不确定' : '等待核对结果';
}

function createReconciliationRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatDate(value: string | null): string {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}
