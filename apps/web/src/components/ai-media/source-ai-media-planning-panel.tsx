'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ClipboardCheck, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { SourceAiMediaSuitePanel } from './source-ai-media-suite-panel';
import {
  buildAiMediaPlanReviewRequest,
  canApproveAiMediaPlan,
  canRegenerateAiMediaPlan,
  clearWorkflowSubmissionIntent,
  formatAiMediaPlanningGoal,
  formatAiMediaPlanningIdentity,
  formatAiMediaPlanningSlotKey,
  loadWorkflowSubmissionIntent,
  normalizeAiMediaPlanBundle,
  resolveWorkflowSubmissionIntent,
  saveWorkflowSubmissionIntent,
  type AiMediaPlanBundle,
  type AiMediaPlanCurationDecision,
  type AiMediaPlanPayload,
  type AiMediaPlanSlot,
  type WorkflowIntentStorage,
  type WorkflowSubmissionIntent,
} from '@/lib/ai-media-workflow';

const REVIEWABLE = new Set(['PENDING']);

const REVIEW_STATUS_LABEL: Record<AiMediaPlanBundle['plan']['reviewStatus'], string> = {
  NOT_READY: '未就绪',
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

const DISPOSITION_LABEL: Record<AiMediaPlanCurationDecision['disposition'], string> = {
  keep: '保留',
  reject: '剔除',
  manual: '人工确认',
};

const REASON_LABEL: Record<string, string> = {
  INVALID_URL: 'URL 无效',
  UNSUPPORTED_MEDIA_TYPE: '格式不支持',
  MEDIA_TYPE_UNKNOWN: '格式未知',
  DIMENSIONS_UNKNOWN: '尺寸未知',
  TOO_SMALL: '尺寸过小',
  TOO_LARGE: '尺寸过大',
  EXTREME_ASPECT_RATIO: '比例异常',
  DUPLICATE: '重复图',
  DECORATIVE: '装饰图',
  SOURCE_ROLE_UNKNOWN: '来源角色未知',
  UNSUPPORTED_SOURCE_ROLE: '来源角色不支持',
  CANDIDATE_LIMIT: '候选数超限',
  SELECTION_LIMIT: '选择数超限',
  MODEL_REJECTED: '模型拒绝',
  MODEL_MANUAL: '模型要求人工',
  MODEL_NOT_SELECTED: '模型未选择',
  CONTINUITY_GROUP_INCOMPLETE: '连续组不完整',
  CONTINUITY_GROUP_INVALID: '连续组无效',
  CONTINUITY_GROUP_MODEL_CONFLICT: '连续组冲突',
};

function storage(): WorkflowIntentStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function operationKey(prefix = 'plan-review') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function reviewStorageKey(planId: string, decision: 'APPROVE' | 'REJECT') {
  return `ss-erp:ai-media-plan-review:${encodeURIComponent(planId)}:${decision.toLowerCase()}`;
}

function statusVariant(status: AiMediaPlanBundle['plan']['reviewStatus']) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'REJECTED') return 'destructive' as const;
  if (status === 'PENDING') return 'warning' as const;
  return 'outline' as const;
}

function curationVariant(disposition: AiMediaPlanCurationDecision['disposition']) {
  if (disposition === 'keep') return 'success' as const;
  if (disposition === 'reject') return 'destructive' as const;
  return 'warning' as const;
}

function slotLabel(slot: AiMediaPlanSlot) {
  return formatAiMediaPlanningGoal(slot.goal);
}

function shortJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text && text.length > 320 ? `${text.slice(0, 320)}...` : text || '-';
  } catch {
    return '-';
  }
}

function PlanSummary({ bundle }: { bundle: AiMediaPlanBundle }) {
  const { plan, currentVersion } = bundle;
  const curation = currentVersion?.curation;
  const payload = currentVersion?.planPayload;
  const readySlots = payload?.slots.filter((slot) => slot.status === 'READY').length || 0;
  const totalSlots = payload?.slots.length || 0;
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div className="border bg-muted/20 px-3 py-2">
        <div className="text-muted-foreground">审核状态</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(plan.reviewStatus)}>{REVIEW_STATUS_LABEL[plan.reviewStatus]}</Badge>
          <span>修订 {plan.revision}</span>
        </div>
      </div>
      <div className="border bg-muted/20 px-3 py-2">
        <div className="text-muted-foreground">策展候选</div>
        <div className="mt-1 font-medium">{curation?.selectedCandidateIds.length || 0} / {curation?.consideredCandidateIds.length || 0}</div>
      </div>
      <div className="border bg-muted/20 px-3 py-2">
        <div className="text-muted-foreground">兼容组</div>
        <div className="mt-1 font-medium">{payload?.compatibilityGroups.length || 0} 组</div>
      </div>
      <div className="border bg-muted/20 px-3 py-2">
        <div className="text-muted-foreground">槽位</div>
        <div className="mt-1 font-medium">{readySlots} / {totalSlots} 可用</div>
      </div>
    </div>
  );
}

function CurationDetails({ curation }: { curation: NonNullable<AiMediaPlanBundle['currentVersion']>['curation'] }) {
  if (!curation) {
    return <p className="text-xs text-muted-foreground">服务端未返回策展证据，无法审核候选选择。</p>;
  }
  return (
    <details className="border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4" />
        <span>图片策展与原因</span>
        <Badge variant="outline">{curation.mode}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{curation.decisions.length} 条决策</span>
      </summary>
      <div className="space-y-2 border-t px-3 py-3">
        {curation.fallbackReason ? <div className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">回退原因：{curation.fallbackReason}</div> : null}
        {curation.selectionTarget ? <div className="text-xs text-muted-foreground">目标选择 {curation.selectionTarget.selectedCount} / {curation.selectionTarget.eligibleCount}，{curation.selectionTarget.met ? '已满足规则' : '需要人工确认'}</div> : null}
        {!curation.decisions.length ? <p className="text-xs text-muted-foreground">没有候选决策。</p> : (
          <div className="max-h-96 space-y-1 overflow-auto pr-1">
            {curation.decisions.map((decision) => (
              <div key={decision.candidateId} className="grid min-w-0 gap-1 border bg-background px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="break-all font-mono">{decision.candidateId}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {decision.reasonCodes.length ? decision.reasonCodes.map((reason) => <Badge key={reason} variant="outline">{REASON_LABEL[reason] || reason}</Badge>) : <span className="text-muted-foreground">无规则阻断</span>}
                  </div>
                </div>
                <Badge variant={curationVariant(decision.disposition)}>{DISPOSITION_LABEL[decision.disposition]}</Badge>
                <span className="text-muted-foreground">{decision.contentRole} · {decision.translation}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function CompatibilityDetails({ payload }: { payload: AiMediaPlanPayload | null }) {
  if (!payload) return <p className="text-xs text-muted-foreground">服务端未返回槽位计划，当前仅可查看计划元数据。</p>;
  return (
    <details className="border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4" /><span>商品/SKU 兼容组</span><span className="ml-auto text-xs text-muted-foreground">{payload.compatibilityGroups.length} 组</span>
      </summary>
      <div className="space-y-1 border-t px-3 py-3">
        {!payload.compatibilityGroups.length ? <p className="text-xs text-muted-foreground">没有可用兼容组。</p> : payload.compatibilityGroups.map((group) => (
          <div key={group.groupKey} className="grid min-w-0 gap-1 border bg-background px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="break-all font-mono">{group.groupKey}</div>
            <div className="min-w-0 break-words text-muted-foreground">SKU：{group.skuKeys.length ? group.skuKeys.map(formatAiMediaPlanningIdentity).join('、') : '-'}<br />身份签名：{group.identitySignature}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

function SlotDetails({ payload }: { payload: AiMediaPlanPayload | null }) {
  if (!payload) return null;
  return (
    <details className="border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4" /><span>套图槽位与证据</span><span className="ml-auto text-xs text-muted-foreground">{payload.slots.length} 个槽位</span>
      </summary>
      <div className="max-h-[34rem] space-y-1 overflow-auto border-t px-3 py-3">
        {!payload.slots.length ? <p className="text-xs text-muted-foreground">尚未分配槽位。</p> : payload.slots.map((slot) => (
          <div key={slot.slotKey} className="min-w-0 border bg-background px-2 py-2 text-xs">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-all font-mono">{formatAiMediaPlanningSlotKey(slot.slotKey)}</span>
              <Badge variant={slot.status === 'READY' ? 'success' : 'warning'}>{slot.status === 'READY' ? '可执行' : '需人工'}</Badge>
              <span className="text-muted-foreground">{slotLabel(slot)} · {slot.aspectRatio}</span>
            </div>
            <div className="mt-1 break-words text-muted-foreground">归属：{slot.ownership.level === 'sku' ? 'SKU' : '兼容组'} / {formatAiMediaPlanningIdentity(slot.ownership.key)}</div>
            <div className="mt-1 break-words">引用：{slot.references.length ? slot.references.map((reference) => `${reference.candidateId} [${reference.evidenceIds.join(', ') || '无证据'}]`).join('；') : '无引用，需人工选择'}</div>
            <div className="mt-1 break-words text-muted-foreground">事实证据：{slot.factEvidenceIds.join(', ') || '无'} · 安全约束 {slot.safetyConstraints.length} 条 · 验收 {slot.acceptanceChecks.length} 条</div>
          </div>
        ))}
      </div>
    </details>
  );
}

export function SourceAiMediaPlanningPanel({
  targetId,
  enabled = true,
  planningEnabled = false,
  selectedSkuKeys = [],
}: {
  targetId: string;
  enabled?: boolean;
  planningEnabled?: boolean;
  selectedSkuKeys?: string[];
}) {
  const [bundle, setBundle] = useState<AiMediaPlanBundle | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reviewing, setReviewing] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [creating, setCreating] = useState(false);
  const requestVersion = useRef(0);
  const contextVersion = useRef(0);
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;
  const reviewIntents = useRef(new Map<string, WorkflowSubmissionIntent>());
  const createIntent = useRef<WorkflowSubmissionIntent | null>(null);
  const regenerationAllowed = !bundle || canRegenerateAiMediaPlan(bundle.plan);
  const approvalReady = bundle ? canApproveAiMediaPlan(bundle) : false;

  const load = useCallback(async (quiet = false) => {
    if (!enabled) {
      setLoading(false);
      setBundle(null);
      setError('');
      return;
    }
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get<unknown>(`/api/ai-images/plans/current?contextType=collect&contextId=${encodeURIComponent(targetId)}`);
      if (version !== requestVersion.current) return;
      if (result.code !== 1) {
        if (String(result.code).toUpperCase() === 'AI_MEDIA_PLANNING_NOT_FOUND') {
          setBundle(null);
          setError('');
        } else {
          setBundle(null);
          setError(result.msg || '图片策展计划加载失败');
        }
        return;
      }
      if (result.data === null || result.data === undefined) {
        setBundle(null);
        setError('');
        return;
      }
      const normalized = normalizeAiMediaPlanBundle(result.data);
      if (!normalized) {
        setBundle(null);
        setError('服务端返回的图片策展计划格式无效');
        return;
      }
      setBundle(normalized);
      setError('');
    } catch (caught) {
      if (version === requestVersion.current) setError(caught instanceof Error ? caught.message : '网络错误，请重试');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [enabled, targetId]);

  useEffect(() => {
    contextVersion.current += 1;
    requestVersion.current += 1;
    reviewIntents.current.clear();
    createIntent.current = null;
    setBundle(null);
    setError('');
    setNote('');
    setCreating(false);
    setReviewing(null);
    void load();
    return () => {
      contextVersion.current += 1;
      requestVersion.current += 1;
    };
  }, [load]);

  async function createPlan() {
    if (!planningEnabled || creating || !regenerationAllowed) return;
    const operationContextVersion = contextVersion.current;
    const operationTargetId = targetId;
    const isCurrentOperation = () => operationContextVersion === contextVersion.current
      && operationTargetId === targetIdRef.current;
    const storageValue = storage();
    const normalizedSkuKeys = [...new Set(selectedSkuKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 50);
    const fingerprint = JSON.stringify({
      targetId,
      selectedSkuKeys: normalizedSkuKeys,
      previousPlan: bundle ? {
        id: bundle.plan.id,
        revision: bundle.plan.revision,
        reviewStatus: bundle.plan.reviewStatus,
        staleAt: bundle.plan.staleAt,
        sourceCurrent: bundle.plan.sourceCurrent,
      } : null,
    });
    const storageKey = `ss-erp:ai-media-plan-create:${encodeURIComponent(targetId)}`;
    const intent = resolveWorkflowSubmissionIntent(
      createIntent.current || loadWorkflowSubmissionIntent(storageValue, storageKey),
      fingerprint,
      () => operationKey('plan-create'),
    );
    createIntent.current = intent;
    saveWorkflowSubmissionIntent(storageValue, storageKey, intent);
    setCreating(true);
    try {
      const result = await api.post<unknown>('/api/ai-images/plans', {
        context: { type: 'collect', id: targetId },
        idempotencyKey: intent.idempotencyKey,
        ...(normalizedSkuKeys.length ? { selectedSkuKeys: normalizedSkuKeys } : {}),
      });
      if (!isCurrentOperation()) return;
      if (result.code !== 1) {
        const code = String(result.code).toUpperCase();
        if (code.includes('INVALID') || code.includes('CONTEXT_CHANGED') || code.includes('IDEMPOTENCY')) {
          createIntent.current = null;
          clearWorkflowSubmissionIntent(storageValue, storageKey);
        }
        toast({ title: '图片策展计划生成失败', description: result.msg, variant: 'destructive' });
        return;
      }
      const normalized = normalizeAiMediaPlanBundle(result.data);
      if (normalized) setBundle(normalized);
      else await load(true);
      if (!isCurrentOperation()) return;
      setError('');
      setNote('');
      createIntent.current = null;
      clearWorkflowSubmissionIntent(storageValue, storageKey);
      toast({ title: '图片策展计划已生成' });
    } catch (caught) {
      if (!isCurrentOperation()) return;
      toast({ title: '图片策展计划生成请求失败', description: caught instanceof Error ? caught.message : '网络错误；可安全重试', variant: 'destructive' });
      await load(true);
    } finally {
      if (isCurrentOperation()) setCreating(false);
    }
  }

  async function review(decision: 'APPROVE' | 'REJECT') {
    if (!planningEnabled || !bundle || reviewing || !REVIEWABLE.has(bundle.plan.reviewStatus)
      || bundle.plan.staleAt || bundle.plan.sourceCurrent === false
      || (decision === 'APPROVE' && !approvalReady)) return;
    const operationContextVersion = contextVersion.current;
    const operationTargetId = targetId;
    const isCurrentOperation = () => operationContextVersion === contextVersion.current
      && operationTargetId === targetIdRef.current;
    const plan = bundle.plan;
    const storageValue = storage();
    const storageKey = reviewStorageKey(plan.id, decision);
    const fingerprint = JSON.stringify({ planId: plan.id, revision: plan.revision, decision, note: note.trim() });
    const intent = resolveWorkflowSubmissionIntent(
      reviewIntents.current.get(decision) || loadWorkflowSubmissionIntent(storageValue, storageKey),
      fingerprint,
      operationKey,
    );
    reviewIntents.current.set(decision, intent);
    saveWorkflowSubmissionIntent(storageValue, storageKey, intent);
    setReviewing(decision);
    try {
      const body = buildAiMediaPlanReviewRequest({
        expectedRevision: plan.revision,
        operationKey: intent.idempotencyKey,
        decision,
        note,
      });
      const result = await api.post<unknown>(`/api/ai-images/plans/${encodeURIComponent(plan.id)}/review`, body);
      if (!isCurrentOperation()) return;
      if (result.code !== 1) {
        const code = String(result.code).toUpperCase();
        if (code.includes('REVISION_CONFLICT') || code.includes('STATE_CONFLICT') || code.includes('STALE') || code.includes('NOT_FOUND')) {
          reviewIntents.current.delete(decision);
          clearWorkflowSubmissionIntent(storageValue, storageKey);
          await load(true);
          if (!isCurrentOperation()) return;
        }
        toast({ title: decision === 'APPROVE' ? '计划审核失败' : '计划拒绝失败', description: result.msg, variant: 'destructive' });
        return;
      }
      const normalized = normalizeAiMediaPlanBundle(result.data);
      if (normalized) setBundle(normalized);
      else await load(true);
      if (!isCurrentOperation()) return;
      reviewIntents.current.delete(decision);
      clearWorkflowSubmissionIntent(storageValue, storageKey);
      setNote('');
      toast({ title: decision === 'APPROVE' ? '图片策展计划已通过' : '图片策展计划已拒绝' });
    } catch (caught) {
      if (!isCurrentOperation()) return;
      toast({ title: '计划审核请求失败', description: caught instanceof Error ? caught.message : '网络错误；可安全重试', variant: 'destructive' });
      await load(true);
    } finally {
      if (isCurrentOperation()) setReviewing(null);
    }
  }

  if (!enabled) {
    return (
      <section className="space-y-2 border-t pt-4" aria-label="图片策展计划">
        <div className="flex items-center gap-2 text-sm font-medium"><ClipboardCheck className="h-4 w-4" />图片策展计划</div>
        <p className="text-xs text-muted-foreground">AI 媒体工作流未启用，计划读取与审核不可用。</p>
      </section>
    );
  }
  if (loading) return <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载图片策展计划</div>;

  return (
    <section className="space-y-3 border-t pt-4" aria-label="图片策展计划">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="h-4 w-4" /><h3 className="text-sm font-medium">图片策展计划</h3>{bundle ? <Badge variant={statusVariant(bundle.plan.reviewStatus)}>{REVIEW_STATUS_LABEL[bundle.plan.reviewStatus]}</Badge> : <Badge variant="outline">未生成</Badge>}</div>
          <p className="mt-1 text-xs text-muted-foreground">展示候选选择、SKU 兼容组和套图槽位证据；未通过审核不会进入执行。</p>
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={() => void load()} title="刷新图片策展计划" aria-label="刷新图片策展计划"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {error ? <div className="break-words border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {!error && !bundle ? <div className="space-y-3 border border-dashed px-3 py-3 text-sm text-muted-foreground">
        <p>尚未生成图片策展计划。</p>
        {planningEnabled ? <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" onClick={() => void createPlan()} disabled={creating}><ClipboardCheck className="h-3.5 w-3.5" />{creating ? '生成中' : '生成规则策展计划'}</Button><span className="text-xs">使用当前已确认采集快照，不调用 Provider。</span></div> : <p className="text-xs">当前阶段仅开放读取与审核，计划生成能力未对该账号开放。</p>}
      </div> : null}
      {bundle ? (
        <>
          <PlanSummary bundle={bundle} />
          {bundle.plan.staleAt || bundle.plan.sourceCurrent === false ? <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>计划对应的采集快照已变化，当前计划只能查看，不能审核或执行。{bundle.plan.staleReasons.length ? ` 原因：${bundle.plan.staleReasons.join('、')}` : ''}</span></div> : null}
          {regenerationAllowed ? <div className="flex flex-wrap items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><span>{bundle.plan.reviewStatus === 'REJECTED' ? '当前计划已拒绝，可保留审计记录并重新规划。' : '当前计划已过期，可基于最新采集快照重新规划。'}</span>{planningEnabled ? <Button type="button" size="sm" variant="outline" onClick={() => void createPlan()} disabled={creating}><RefreshCw className="h-3.5 w-3.5" />{creating ? '生成中' : '基于当前快照重新生成'}</Button> : <span>计划生成能力未对该账号开放。</span>}</div> : null}
          {!bundle.currentVersion ? <div className="border border-dashed px-3 py-3 text-xs text-muted-foreground">计划没有可读取的当前版本，审核入口已关闭。</div> : <>
            <CurationDetails curation={bundle.currentVersion.curation} />
            <CompatibilityDetails payload={bundle.currentVersion.planPayload} />
            <SlotDetails payload={bundle.currentVersion.planPayload} />
            {bundle.currentVersion.planPayload?.verifiedFacts.length ? <details className="border"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4" />事实证据 <span className="ml-auto text-xs text-muted-foreground">{bundle.currentVersion.planPayload.verifiedFacts.length} 条</span></summary><div className="max-h-64 space-y-1 overflow-auto border-t px-3 py-3">{bundle.currentVersion.planPayload.verifiedFacts.map((fact) => <div key={`${fact.path}:${fact.evidenceIds.join(',')}`} className="border bg-background px-2 py-2 text-xs"><div className="break-all font-mono">{fact.path}</div><div className="mt-1 break-words">{shortJson(fact.value)}</div><div className="mt-1 break-all text-muted-foreground">证据：{fact.evidenceIds.join(', ') || '无'}</div></div>)}</div></details> : null}
          </>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>版本 {bundle.currentVersion?.version || bundle.plan.latestVersion || '-'}</span>{bundle.currentVersion?.sourceCaptureSnapshotId ? <span className="break-all font-mono">快照 {bundle.currentVersion.sourceCaptureSnapshotId}</span> : null}</div>
          {REVIEWABLE.has(bundle.plan.reviewStatus) && !approvalReady ? <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">计划仍有待人工补选或证据不完整的槽位，当前不能通过审核。</div> : null}
          {planningEnabled && REVIEWABLE.has(bundle.plan.reviewStatus) && !bundle.plan.staleAt && bundle.plan.sourceCurrent !== false ? <div className="space-y-2 border px-3 py-3"><label className="block text-xs font-medium" htmlFor={`ai-media-plan-review-note-${targetId}`}>审核备注（可选）</label><textarea id={`ai-media-plan-review-note-${targetId}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2_000} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="记录人工确认或拒绝原因" /><div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => void review('APPROVE')} disabled={Boolean(reviewing) || !approvalReady}><Check className="h-3.5 w-3.5" />{reviewing === 'APPROVE' ? '提交中' : '通过计划'}</Button><Button type="button" size="sm" variant="outline" onClick={() => void review('REJECT')} disabled={Boolean(reviewing)}><X className="h-3.5 w-3.5" />{reviewing === 'REJECT' ? '提交中' : '拒绝计划'}</Button></div></div> : null}
          <SourceAiMediaSuitePanel targetId={targetId} plan={bundle.plan} />
        </>
      ) : null}
    </section>
  );
}
