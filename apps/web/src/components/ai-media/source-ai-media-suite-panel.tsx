'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  ImageOff,
  Images,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
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
import { toast } from '@/components/ui/use-toast';
import {
  buildAiMediaSuiteCancelRequest,
  buildAiMediaSuiteClaimRequest,
  buildAiMediaSuiteDispatchRequest,
  buildAiMediaSuitePrepareRequest,
  buildAiMediaSuitePreviewRequest,
  buildAiMediaSuiteRetryRequest,
  clearWorkflowSubmissionIntent,
  formatAiMediaPlanningGoal,
  formatAiMediaPlanningIdentity,
  formatAiMediaPlanningSlotKey,
  loadWorkflowSubmissionIntent,
  normalizeAiMediaSuite,
  normalizeAiMediaSuitePreview,
  normalizeAiMediaSuiteReadiness,
  resolveAiMediaSuiteActions,
  resolveAiMediaSuiteClaimDecision,
  resolveAiMediaSuitePreparationDecision,
  resolveWorkflowSubmissionIntent,
  saveWorkflowSubmissionIntent,
  startAiMediaSuitePolling,
  type AiMediaPlanRecord,
  type AiMediaSuite,
  type AiMediaSuiteOutputAsset,
  type AiMediaSuitePreview,
  type AiMediaSuiteReadiness,
  type AiMediaSuiteSlot,
  type WorkflowIntentStorage,
} from '@/lib/ai-media-workflow';

const SUITE_STATUS_LABEL: Record<AiMediaSuite['status'], string> = {
  PLANNED: '准备中',
  QUEUED: '排队中',
  RUNNING: '生成中',
  PARTIAL_FAILURE: '部分失败',
  FAILED: '失败',
  SUCCEEDED: '已完成',
  CANCEL_REQUESTED: '取消中',
  CANCELLED: '已取消',
};

const SLOT_STATUS_LABEL: Record<AiMediaSuiteSlot['status'], string> = {
  PLANNED: '待准备',
  QUEUED: '排队中',
  RUNNING: '生成中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCEL_REQUESTED: '取消中',
  CANCELLED: '已取消',
};

function suiteImageUrl(value: string) {
  return /^https?:\/\//iu.test(value) ? value : apiUrl(value);
}

function operationKey(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function browserSessionStorage(): WorkflowIntentStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function intentKey(targetId: string, planId: string, scope: string) {
  return `ss-erp:ai-media-suite:${encodeURIComponent(targetId)}:${encodeURIComponent(planId)}:${scope}`;
}

function suiteStatusVariant(status: AiMediaSuite['status']) {
  if (status === 'SUCCEEDED') return 'success' as const;
  if (status === 'FAILED' || status === 'PARTIAL_FAILURE') return 'destructive' as const;
  if (status === 'QUEUED' || status === 'RUNNING' || status === 'CANCEL_REQUESTED') return 'warning' as const;
  return 'outline' as const;
}

function slotStatusVariant(status: AiMediaSuiteSlot['status']) {
  if (status === 'SUCCEEDED') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'QUEUED' || status === 'RUNNING' || status === 'CANCEL_REQUESTED') return 'warning' as const;
  return 'outline' as const;
}

function formatCost(cents: number) {
  return `${new Intl.NumberFormat('zh-CN').format(cents)} 分`;
}

function progressPercent(suite: AiMediaSuite) {
  if (!suite.itemCount) return 0;
  const completed = suite.counts.succeeded + suite.counts.failed + suite.counts.cancelled;
  return Math.max(0, Math.min(100, Math.round((completed / suite.itemCount) * 100)));
}

function responseEnqueuePending(value: unknown) {
  return Boolean(value && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).enqueuePending === true);
}

function SuiteOutputPreview({
  output,
  testOnly,
}: {
  output: AiMediaSuiteOutputAsset;
  testOnly: boolean;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const url = suiteImageUrl(output.url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="relative block h-20 w-20 overflow-hidden border bg-muted"
      title="打开套图候选"
      aria-label="打开套图候选"
    >
      {state !== 'error' ? (
        <img
          src={url}
          alt="套图候选"
          className="h-full w-full object-cover"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      ) : null}
      {state === 'loading' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-muted text-[10px] text-muted-foreground">加载中</span>
      ) : null}
      {state === 'error' ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted px-1 text-center text-[10px] text-muted-foreground">
          <ImageOff className="h-4 w-4" />加载失败
        </span>
      ) : null}
      {testOnly && state === 'loaded' ? (
        <span className="absolute bottom-0 left-0 right-0 bg-foreground/75 px-1 py-0.5 text-center text-[10px] text-background">测试输出</span>
      ) : null}
    </a>
  );
}

export function SourceAiMediaSuitePanel({
  targetId,
  plan,
}: {
  targetId: string;
  plan: AiMediaPlanRecord;
}) {
  const [readiness, setReadiness] = useState<AiMediaSuiteReadiness | null>(null);
  const [preview, setPreview] = useState<AiMediaSuitePreview | null>(null);
  const [suite, setSuite] = useState<AiMediaSuite | null>(null);
  const [activeSuite, setActiveSuite] = useState<AiMediaSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [suiteError, setSuiteError] = useState('');
  const [readinessError, setReadinessError] = useState('');
  const [enqueuePending, setEnqueuePending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const pendingActionsRef = useRef(new Set<string>());
  const contextVersion = useRef(0);
  const requestVersion = useRef(0);
  const readinessRequestVersion = useRef(0);
  const identityRef = useRef({
    targetId, planId: plan.id, planRevision: plan.revision, planVersionId: plan.currentVersionId,
  });
  identityRef.current = {
    targetId, planId: plan.id, planRevision: plan.revision, planVersionId: plan.currentVersionId,
  };

  const distinctActiveSuite = activeSuite && activeSuite.id !== suite?.id ? activeSuite : null;
  const actions = useMemo(
    () => resolveAiMediaSuiteActions({
      plan, readiness, preview, suite, activeSuite: distinctActiveSuite,
    }),
    [distinctActiveSuite, plan, preview, readiness, suite],
  );
  const activeActions = useMemo(
    () => resolveAiMediaSuiteActions({ plan, readiness, preview: null, suite: distinctActiveSuite }),
    [distinctActiveSuite, plan, readiness],
  );
  const mutationBusy = pendingActions.size > 0;
  const error = suiteError || readinessError;

  function isCurrentIdentity(snapshot: typeof identityRef.current, version: number) {
    const current = identityRef.current;
    return version === contextVersion.current
      && snapshot.targetId === current.targetId
      && snapshot.planId === current.planId
      && snapshot.planRevision === current.planRevision
      && snapshot.planVersionId === current.planVersionId;
  }

  function beginAction(key: string) {
    if (pendingActionsRef.current.size > 0) return false;
    pendingActionsRef.current.add(key);
    setPendingActions(new Set(pendingActionsRef.current));
    return true;
  }

  function endAction(key: string) {
    pendingActionsRef.current.delete(key);
    setPendingActions(new Set(pendingActionsRef.current));
  }

  function submissionIntent(scope: string, fingerprint: string) {
    const storage = browserSessionStorage();
    const storageKey = intentKey(targetId, plan.id, scope);
    const intent = resolveWorkflowSubmissionIntent(
      loadWorkflowSubmissionIntent(storage, storageKey),
      fingerprint,
      () => operationKey(scope),
    );
    saveWorkflowSubmissionIntent(storage, storageKey, intent);
    return { intent, storage, storageKey };
  }

  function clearSubmissionIntent(value: ReturnType<typeof submissionIntent>) {
    clearWorkflowSubmissionIntent(value.storage, value.storageKey);
  }

  function matchesCurrentPlan(candidate: AiMediaSuite | null | undefined): candidate is AiMediaSuite {
    return Boolean(candidate
      && candidate.planId === plan.id
      && plan.currentVersionId
      && candidate.planVersionId === plan.currentVersionId);
  }

  const loadCurrentSuite = useCallback(async (quiet = false): Promise<AiMediaSuite | null | undefined> => {
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    const request = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const [result, activeResult] = await Promise.all([
        api.get<unknown>(`/api/ai-images/suites/current?planId=${encodeURIComponent(identity.planId)}`),
        api.get<unknown>(`/api/ai-images/suites/active?planId=${encodeURIComponent(identity.planId)}`),
      ]);
      if (!isCurrentIdentity(identity, context) || request !== requestVersion.current) return undefined;
      if (result.code !== 1) {
        setSuiteError(result.msg || '套图任务加载失败');
        return undefined;
      }
      if (activeResult.code !== 1) {
        setSuiteError(activeResult.msg || '活动套图任务加载失败');
        return undefined;
      }
      const normalizedActive = activeResult.data === null || activeResult.data === undefined
        ? null
        : normalizeAiMediaSuite(activeResult.data);
      if (activeResult.data !== null && activeResult.data !== undefined
        && (!normalizedActive || normalizedActive.planId !== identity.planId
          || normalizedActive.planVersionId === identity.planVersionId)) {
        setSuiteError('服务端返回的活动套图任务格式无效');
        return undefined;
      }
      if (result.data === null || result.data === undefined) {
        setSuite(null);
        setActiveSuite(normalizedActive);
        setSuiteError('');
        if (!normalizedActive || (normalizedActive.status !== 'QUEUED'
          && normalizedActive.status !== 'CANCEL_REQUESTED')) setEnqueuePending(false);
        return null;
      }
      const normalized = normalizeAiMediaSuite(result.data);
      if (!normalized || normalized.planId !== identity.planId
        || normalized.planVersionId !== identity.planVersionId) {
        setSuiteError('服务端返回的套图任务格式无效');
        return undefined;
      }
      setSuite(normalized);
      setActiveSuite(normalizedActive);
      setSuiteError('');
      const recoveryPending = [normalized, normalizedActive].some((candidate) => candidate
        && (candidate.status === 'QUEUED' || candidate.status === 'CANCEL_REQUESTED'));
      if (!recoveryPending) setEnqueuePending(false);
      return normalized;
    } catch (caught) {
      if (isCurrentIdentity(identity, context) && request === requestVersion.current) {
        setSuiteError(caught instanceof Error ? caught.message : '套图任务加载失败');
      }
      return undefined;
    } finally {
      if (!quiet && isCurrentIdentity(identity, context) && request === requestVersion.current) setLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    const request = ++readinessRequestVersion.current;
    setPreview(null);
    setConfirmOpen(false);
    setLoading(true);
    const readinessRequest = api.get<unknown>('/api/ai-images/suites/readiness');
    const currentRequest = loadCurrentSuite(true);
    try {
      const [readinessResult] = await Promise.all([readinessRequest, currentRequest]);
      if (!isCurrentIdentity(identity, context) || request !== readinessRequestVersion.current) return;
      if (readinessResult.code !== 1 || !readinessResult.data) {
        setReadiness(null);
        setReadinessError(readinessResult.msg || '套图能力状态加载失败');
        return;
      }
      const normalizedReadiness = normalizeAiMediaSuiteReadiness(readinessResult.data);
      if (!normalizedReadiness) {
        setReadiness(null);
        setReadinessError('服务端返回的套图能力状态无效');
        return;
      }
      setReadiness(normalizedReadiness);
      setReadinessError('');
    } catch (caught) {
      if (isCurrentIdentity(identity, context) && request === readinessRequestVersion.current) {
        setReadinessError(caught instanceof Error ? caught.message : '套图能力状态加载失败');
      }
    } finally {
      if (isCurrentIdentity(identity, context) && request === readinessRequestVersion.current) setLoading(false);
    }
  }, [loadCurrentSuite]);

  useEffect(() => {
    contextVersion.current += 1;
    requestVersion.current += 1;
    readinessRequestVersion.current += 1;
    pendingActionsRef.current.clear();
    setPendingActions(new Set());
    setReadiness(null);
    setPreview(null);
    setSuite(null);
    setActiveSuite(null);
    setSuiteError('');
    setReadinessError('');
    setEnqueuePending(false);
    setConfirmOpen(false);
    void loadAll();
    return () => {
      contextVersion.current += 1;
      requestVersion.current += 1;
      readinessRequestVersion.current += 1;
    };
  }, [loadAll, plan.currentVersionId, plan.id, plan.revision, targetId]);

  useEffect(() => {
    if (!actions.shouldPoll && !activeActions.shouldPoll) return;
    return startAiMediaSuitePolling<number>({
      delayMs: 2_000,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
      canPoll: () => pendingActionsRef.current.size === 0,
      poll: () => loadCurrentSuite(true),
    });
  }, [actions.shouldPoll, activeActions.shouldPoll, loadCurrentSuite]);

  async function loadPreview() {
    if (!actions.canPreview || !beginAction('preview')) return;
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    try {
      const result = await api.post<unknown>('/api/ai-images/suites/preview', buildAiMediaSuitePreviewRequest(plan.id));
      if (!isCurrentIdentity(identity, context)) return;
      if (result.code !== 1 || !result.data) {
        toast({ title: '套图预览失败', description: result.msg, variant: 'destructive' });
        await loadCurrentSuite(true);
        return;
      }
      const normalized = normalizeAiMediaSuitePreview(result.data);
      if (!normalized || normalized.planId !== plan.id
        || normalized.planVersionId !== plan.currentVersionId
        || normalized.planRevision !== plan.revision) {
        setPreview(null);
        toast({ title: '套图预览已失效', description: '请刷新当前图片策展计划后重试', variant: 'destructive' });
        return;
      }
      setPreview(normalized);
      setSuiteError('');
    } catch (caught) {
      await loadCurrentSuite(true);
      if (isCurrentIdentity(identity, context)) {
        toast({ title: '套图预览失败', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
      }
    } finally {
      if (isCurrentIdentity(identity, context)) endAction('preview');
    }
  }

  async function dispatchPreparedSuite(current: AiMediaSuite, identity: typeof identityRef.current, context: number) {
    if (!matchesCurrentPlan(current) || current.status !== 'PLANNED' || current.revision !== 4
      || !isCurrentIdentity(identity, context)) return;
    const operation = submissionIntent(
      `dispatch:${current.id}`,
      JSON.stringify({ suiteId: current.id, revision: current.revision }),
    );
    try {
      const result = await api.post<unknown>(
        `/api/ai-images/suites/${encodeURIComponent(current.id)}/dispatch`,
        buildAiMediaSuiteDispatchRequest(current, operation.intent.idempotencyKey),
      );
      if (!isCurrentIdentity(identity, context)) return;
      if (result.code !== 1) {
        const recovered = await loadCurrentSuite(true);
        if (matchesCurrentPlan(recovered) && recovered.status !== 'PLANNED') {
          clearSubmissionIntent(operation);
          toast({ title: '套图生成已由服务器接收' });
        } else {
          toast({ title: '套图生成启动失败', description: result.msg, variant: 'destructive' });
        }
        return;
      }
      clearSubmissionIntent(operation);
      setEnqueuePending(responseEnqueuePending(result));
      await loadCurrentSuite(true);
      toast({ title: responseEnqueuePending(result) ? '套图任务已保存，等待队列恢复' : '套图生成已开始' });
    } catch (caught) {
      const recovered = await loadCurrentSuite(true);
      if (!isCurrentIdentity(identity, context)) return;
      if (matchesCurrentPlan(recovered) && recovered.status !== 'PLANNED') {
        toast({ title: '套图生成已由服务器接收' });
      } else {
        toast({ title: '套图生成状态待确认', description: caught instanceof Error ? caught.message : '网络错误；已保留本次操作，可安全重试', variant: 'destructive' });
      }
    }
  }

  async function prepareAndDispatch(initial: AiMediaSuite, identity: typeof identityRef.current, context: number) {
    let current = initial;
    if (current.revision < 4) {
      const operation = submissionIntent(
        `prepare:${current.id}`,
        JSON.stringify({ suiteId: current.id, planId: plan.id }),
      );
      try {
        const result = await api.post<unknown>(
          `/api/ai-images/suites/${encodeURIComponent(current.id)}/prepare`,
          buildAiMediaSuitePrepareRequest(operation.intent.idempotencyKey),
        );
        if (!isCurrentIdentity(identity, context)) return;
        if (result.code !== 1) {
          const recovered = await loadCurrentSuite(true);
          if (!matchesCurrentPlan(recovered) || recovered.revision < 4) {
            toast({ title: '套图准备失败', description: result.msg, variant: 'destructive' });
            return;
          }
          current = recovered;
        } else {
          const normalized = normalizeAiMediaSuite(result.data);
          const recovered = matchesCurrentPlan(normalized) ? normalized : await loadCurrentSuite(true);
          if (!matchesCurrentPlan(recovered)) {
            toast({ title: '套图准备状态待确认', description: '服务器未返回当前计划版本的套图任务', variant: 'destructive' });
            return;
          }
          current = recovered;
        }
      } catch (caught) {
        const recovered = await loadCurrentSuite(true);
        if (!isCurrentIdentity(identity, context)) return;
        if (!matchesCurrentPlan(recovered) || recovered.revision < 4) {
          toast({ title: '套图准备状态待确认', description: caught instanceof Error ? caught.message : '网络错误；已保留本次操作，可安全重试', variant: 'destructive' });
          return;
        }
        current = recovered;
      }
      if (matchesCurrentPlan(current) && current.revision >= 4) clearSubmissionIntent(operation);
    }
    const decision = resolveAiMediaSuitePreparationDecision({ plan, suite: current });
    if (decision === 'reconcile') {
      setSuite(current);
      await loadCurrentSuite(true);
      if (isCurrentIdentity(identity, context)) toast({ title: '套图状态已由服务器更新' });
      return;
    }
    if (decision !== 'dispatch') {
      await loadCurrentSuite(true);
      if (isCurrentIdentity(identity, context)) {
        toast({
          title: '套图准备状态待确认',
          description: '服务器未返回可继续派发的当前套图任务，请刷新后重试',
          variant: 'destructive',
        });
      }
      return;
    }
    await dispatchPreparedSuite(current, identity, context);
  }

  async function claimAndStart() {
    if (!preview || !actions.canClaim || !beginAction('start')) return;
    setConfirmOpen(false);
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    const operation = submissionIntent(
      'claim',
      JSON.stringify({ planId: plan.id, planRevision: plan.revision, previewHash: preview.previewHash }),
    );
    try {
      try {
        const result = await api.post<unknown>(
          '/api/ai-images/suites/claim',
          buildAiMediaSuiteClaimRequest({ plan, preview, idempotencyKey: operation.intent.idempotencyKey }),
        );
        if (!isCurrentIdentity(identity, context)) return;
        if (result.code !== 1) {
          const recovered = await loadCurrentSuite(true);
          const decision = resolveAiMediaSuiteClaimDecision({
            outcome: 'rejected', plan, preview, recoveredSuite: recovered,
          });
          if (decision.kind === 'manual-continue') {
            toast({
              title: '发现当前版本的套图任务',
              description: '无法证明它属于本次确认，请核对成本后点击继续。',
              variant: 'destructive',
            });
          } else {
            setPreview(null);
            toast({ title: '套图任务确认失败', description: result.msg, variant: 'destructive' });
          }
          return;
        }
        const claimed = normalizeAiMediaSuite(result.data);
        const decision = resolveAiMediaSuiteClaimDecision({
          outcome: 'accepted', plan, preview, claimedSuite: claimed,
        });
        if (decision.kind !== 'proceed') {
          await loadCurrentSuite(true);
          toast({ title: '套图任务状态待确认', description: '服务器未返回本次确认对应的套图任务，请刷新后重试', variant: 'destructive' });
          return;
        }
        clearSubmissionIntent(operation);
        await prepareAndDispatch(decision.suite, identity, context);
      } catch (caught) {
        const recovered = await loadCurrentSuite(true);
        if (!isCurrentIdentity(identity, context)) return;
        const decision = resolveAiMediaSuiteClaimDecision({
          outcome: 'unknown', plan, preview, recoveredSuite: recovered,
        });
        if (decision.kind === 'manual-continue') {
          toast({
            title: '套图任务状态待确认',
            description: '服务器已有当前版本任务，但无法证明它属于本次确认。请核对成本后点击继续。',
            variant: 'destructive',
          });
        } else {
          toast({ title: '套图任务状态待确认', description: caught instanceof Error ? caught.message : '网络错误；已保留本次确认，可安全重试', variant: 'destructive' });
        }
      }
    } finally {
      if (isCurrentIdentity(identity, context)) endAction('start');
    }
  }

  async function continueSuite() {
    if (!suite || (!actions.canPrepare && !actions.canDispatch) || !beginAction('continue')) return;
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    clearWorkflowSubmissionIntent(browserSessionStorage(), intentKey(targetId, plan.id, 'claim'));
    try {
      await prepareAndDispatch(suite, identity, context);
    } finally {
      if (isCurrentIdentity(identity, context)) endAction('continue');
    }
  }

  async function cancelSuite(candidate: AiMediaSuite, actionKey = 'cancel') {
    if (!beginAction(actionKey)) return;
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    const operation = submissionIntent(
      `cancel:${candidate.id}`,
      JSON.stringify({ suiteId: candidate.id, revision: candidate.revision }),
    );
    try {
      const result = await api.post<unknown>(
        `/api/ai-images/suites/${encodeURIComponent(candidate.id)}/cancel`,
        buildAiMediaSuiteCancelRequest(candidate, operation.intent.idempotencyKey),
      );
      if (!isCurrentIdentity(identity, context)) return;
      if (result.code !== 1) {
        await loadCurrentSuite(true);
        toast({ title: '套图取消失败', description: result.msg, variant: 'destructive' });
        return;
      }
      clearSubmissionIntent(operation);
      setEnqueuePending(responseEnqueuePending(result));
      await loadCurrentSuite(true);
      toast({ title: '已请求取消套图任务' });
    } catch (caught) {
      await loadCurrentSuite(true);
      if (isCurrentIdentity(identity, context)) {
        toast({ title: '套图取消状态待确认', description: caught instanceof Error ? caught.message : '网络错误；已保留本次操作，可安全重试', variant: 'destructive' });
      }
    } finally {
      if (isCurrentIdentity(identity, context)) endAction(actionKey);
    }
  }

  async function retrySlot(slot: AiMediaSuiteSlot) {
    if (!suite || !actions.retryableSlotIds.includes(slot.id) || !beginAction(`retry:${slot.id}`)) return;
    const identity = { ...identityRef.current };
    const context = contextVersion.current;
    const operation = submissionIntent(
      `retry:${suite.id}:${slot.id}`,
      JSON.stringify({ suiteId: suite.id, slotId: slot.id, slotRevision: slot.revision }),
    );
    try {
      const result = await api.post<unknown>(
        `/api/ai-images/suites/${encodeURIComponent(suite.id)}/slots/${encodeURIComponent(slot.id)}/retry`,
        buildAiMediaSuiteRetryRequest(slot, operation.intent.idempotencyKey),
      );
      if (!isCurrentIdentity(identity, context)) return;
      if (result.code !== 1) {
        await loadCurrentSuite(true);
        toast({ title: '槽位重试失败', description: result.msg, variant: 'destructive' });
        return;
      }
      clearSubmissionIntent(operation);
      setEnqueuePending(responseEnqueuePending(result));
      await loadCurrentSuite(true);
      toast({ title: '失败槽位已重新排队' });
    } catch (caught) {
      await loadCurrentSuite(true);
      if (isCurrentIdentity(identity, context)) {
        toast({ title: '槽位重试状态待确认', description: caught instanceof Error ? caught.message : '网络错误；已保留本次操作，可安全重试', variant: 'destructive' });
      }
    } finally {
      if (isCurrentIdentity(identity, context)) endAction(`retry:${slot.id}`);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载套图任务</div>;
  }

  const percent = suite ? progressPercent(suite) : 0;
  return (
    <section className="space-y-3 border-t pt-4" aria-label="AI 套图生成">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Images className="h-4 w-4" />
            <h3 className="text-sm font-medium">AI 套图生成</h3>
            {suite ? <Badge variant={suiteStatusVariant(suite.status)}>{SUITE_STATUS_LABEL[suite.status]}</Badge> : null}
            {suite && !actions.suiteCurrent ? <Badge variant="outline">历史版本</Badge> : null}
            {suite?.provider === 'fake' || (!suite && readiness?.testOnly) ? <Badge variant="outline">测试 Provider</Badge> : null}
          </div>
          {suite
            ? <p className="mt-1 break-words text-xs text-muted-foreground">已冻结：{suite.provider} / {suite.model} · 定价 {suite.pricingVersion}</p>
            : readiness ? <p className="mt-1 break-words text-xs text-muted-foreground">{readiness.provider.provider || 'Provider 未配置'} / {readiness.provider.model || '模型未配置'}</p> : null}
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={() => void loadAll()} disabled={loading || mutationBusy} title="刷新套图状态" aria-label="刷新套图状态"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error ? <div className="break-words border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {!actions.suiteCurrent && !actions.planCurrent ? <p className="text-xs text-muted-foreground">当前计划通过审核且来源快照未变化后可生成套图。</p> : null}
      {!actions.suiteCurrent && actions.planCurrent && readiness && !readiness.ready ? <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{readiness.reason}</div> : null}

      {!actions.suiteCurrent && actions.canPreview && !preview ? (
        <Button type="button" size="sm" variant="outline" onClick={() => void loadPreview()} disabled={mutationBusy}>
          {pendingActions.has('preview') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          预览套图任务
        </Button>
      ) : null}

      {!actions.suiteCurrent && preview ? <>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">槽位</div><div className="mt-1 font-medium">{preview.itemCount} 张</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">并发</div><div className="mt-1 font-medium">{preview.concurrencyLimit}</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">预计成本</div><div className="mt-1 font-medium">{formatCost(preview.estimatedCostCents)}</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">最高成本</div><div className="mt-1 font-medium">{formatCost(preview.maximumCostCents)}</div></div>
        </div>
        <details className="border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">生成槽位明细</summary>
          <div className="max-h-72 space-y-1 overflow-auto border-t px-3 py-3">
            {preview.slots.map((slot) => <div key={slot.slotKey} className="grid min-w-0 gap-1 border-b py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="font-medium">{formatAiMediaPlanningGoal(slot.goal)}</div><div className="break-all font-mono text-[11px] text-muted-foreground">{formatAiMediaPlanningSlotKey(slot.slotKey)}</div></div><span className="text-muted-foreground">{slot.references.length} 张参考图 · 上限 {formatCost(slot.maximumCostCents)}</span></div>)}
          </div>
        </details>
        <Button type="button" size="sm" onClick={() => setConfirmOpen(true)} disabled={!actions.canClaim || mutationBusy}><Play className="h-3.5 w-3.5" />确认生成套图</Button>
      </> : null}

      {enqueuePending ? <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">任务状态已保存，队列恢复扫描会继续处理。</div> : null}

      {distinctActiveSuite ? <div className="flex min-w-0 flex-col gap-3 border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{actions.blockedByActiveSuite ? '旧版本活动任务' : '旧版本准备记录'}</Badge><Badge variant={suiteStatusVariant(distinctActiveSuite.status)}>{SUITE_STATUS_LABEL[distinctActiveSuite.status]}</Badge></div>
          <div className="mt-1 break-words">{distinctActiveSuite.provider} / {distinctActiveSuite.model} · 定价 {distinctActiveSuite.pricingVersion}</div>
          <div className="mt-1 break-words">完成 {distinctActiveSuite.counts.succeeded + distinctActiveSuite.counts.failed + distinctActiveSuite.counts.cancelled} / {distinctActiveSuite.itemCount} · 修订 {distinctActiveSuite.revision}</div>
        </div>
        {activeActions.canCancel ? <Button type="button" size="sm" variant="outline" onClick={() => void cancelSuite(distinctActiveSuite, 'cancel-active')} disabled={mutationBusy}>{pendingActions.has('cancel-active') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}取消旧任务</Button> : null}
      </div> : null}

      {suite ? <>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">进度</div><div className="mt-1 font-medium">{suite.counts.succeeded + suite.counts.failed + suite.counts.cancelled} / {suite.itemCount}</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">成功</div><div className="mt-1 font-medium">{suite.counts.succeeded}</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">失败</div><div className="mt-1 font-medium">{suite.counts.failed}</div></div>
          <div className="border bg-muted/20 px-3 py-2"><div className="text-muted-foreground">最高成本</div><div className="mt-1 font-medium">{formatCost(suite.maximumCostCents)}</div></div>
        </div>
        <div className="h-1.5 w-full overflow-hidden bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="套图生成进度"><div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
        {readiness && !readiness.ready && actions.retryableSlotIds.length === 0 && suite.status !== 'SUCCEEDED' ? <p className="break-words text-xs text-muted-foreground">{readiness.reason}</p> : null}
        <div className="flex flex-wrap gap-2">
          {(actions.canPrepare || actions.canDispatch) ? <Button type="button" size="sm" onClick={() => void continueSuite()} disabled={mutationBusy}>{pendingActions.has('continue') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{actions.canPrepare ? '继续准备并生成' : '开始生成'}</Button> : null}
          {actions.canCancel && suite ? <Button type="button" size="sm" variant="outline" onClick={() => void cancelSuite(suite)} disabled={mutationBusy}>{pendingActions.has('cancel') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}取消套图</Button> : null}
        </div>
        <div className="space-y-2">
          {suite.slots.map((slot) => {
            const output = slot.outputAssets[0];
            const canRetry = actions.retryableSlotIds.includes(slot.id);
            return <div key={slot.id} className="grid min-w-0 gap-3 border px-3 py-3 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:items-center">
              {output ? <SuiteOutputPreview key={output.id} output={output} testOnly={suite.provider === 'fake'} /> : <div className="flex h-20 w-20 items-center justify-center border bg-muted"><Images className="h-5 w-5 text-muted-foreground" /></div>}
              <div className="min-w-0 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-medium">{formatAiMediaPlanningGoal(slot.goal)}</span><Badge variant={slotStatusVariant(slot.status)}>{SLOT_STATUS_LABEL[slot.status]}</Badge></div>
                <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{formatAiMediaPlanningSlotKey(slot.slotKey)}</div>
                <div className="mt-1 break-words text-muted-foreground">{slot.ownership.level === 'sku' ? 'SKU' : '兼容组'}：{formatAiMediaPlanningIdentity(slot.ownership.key)} · 第 {slot.attempt} 次尝试</div>
                {slot.errorCode ? <div className="mt-1 break-all text-destructive">{slot.errorCode}</div> : null}
                {slot.diagnostics.length ? <div className="mt-1 flex flex-wrap gap-1">{slot.diagnostics.map((code) => <Badge key={code} variant="outline">{code}</Badge>)}</div> : null}
              </div>
              {canRetry ? <Button type="button" size="icon" variant="outline" onClick={() => void retrySlot(slot)} disabled={mutationBusy} title="重试失败槽位" aria-label={`重试失败槽位 ${slot.slotKey}`}>{pendingActions.has(`retry:${slot.id}`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}</Button> : null}
            </div>;
          })}
        </div>
      </> : null}

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!mutationBusy) setConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认生成套图</DialogTitle>
            <DialogDescription>将创建 {preview?.itemCount || 0} 个槽位任务，最高成本 {formatCost(preview?.maximumCostCents || 0)}，并发上限 {preview?.concurrencyLimit || 0}。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm sm:grid-cols-2"><div className="border px-3 py-2"><div className="text-xs text-muted-foreground">Provider</div><div className="mt-1 break-all">{preview?.provider || '-'}</div></div><div className="border px-3 py-2"><div className="text-xs text-muted-foreground">模型</div><div className="mt-1 break-all">{preview?.model || '-'}</div></div></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={mutationBusy}>取消</Button>
            <Button type="button" onClick={() => void claimAndStart()} disabled={!actions.canClaim || mutationBusy}>{pendingActions.has('start') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}确认并开始</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
