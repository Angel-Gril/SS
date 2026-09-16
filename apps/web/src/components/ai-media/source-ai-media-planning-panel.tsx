'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ClipboardCheck, ImageIcon, Loader2, Pencil, RefreshCw, Save, ShieldCheck, X } from 'lucide-react';
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
import { useScopedSystemConfirmation } from '@/components/system-dialog-provider';
import { SourceAiMediaSuitePanel } from './source-ai-media-suite-panel';
import type {
  AiImageApplyResult,
  RunMediaMutation,
  SynchronizeAiMediaTarget,
} from './source-ai-media-state';
import {
  aiMediaPlanSlotDraftStorageKey,
  buildAiMediaPlanReviewRequest,
  buildAiMediaPlanSlotReferenceUpdateRequest,
  canToggleAiMediaPlanSlotCandidate,
  canApproveAiMediaPlan,
  canRegenerateAiMediaPlan,
  clearAiMediaPlanSlotDraft,
  clearWorkflowSubmissionIntent,
  formatAiMediaPlanningGoal,
  formatAiMediaPlanningIdentity,
  formatAiMediaPlanningSlotKey,
  loadAiMediaPlanSlotDraft,
  loadWorkflowSubmissionIntent,
  normalizeAiMediaPlanBundle,
  resolveAiMediaPlanSlotCandidateEditMode,
  resolveAiMediaPlanSlotCandidateOptions,
  resolveAiMediaPlanSlotDraftAuthority,
  resolveWorkflowSubmissionIntent,
  saveAiMediaPlanSlotDraft,
  saveWorkflowSubmissionIntent,
  type AiMediaPlanBundle,
  type AiMediaPlanCurationDecision,
  type AiMediaPlanPayload,
  type AiMediaPlanSlot,
  type AiMediaContextInput,
  type WorkflowIntentStorage,
  type WorkflowSubmissionIntent,
} from '@/lib/ai-media-workflow';

const REVIEWABLE = new Set(['PENDING']);

type PlanLoadOutcome =
  | { ok: true; bundle: AiMediaPlanBundle | null }
  | { ok: false; reason: 'disabled' | 'superseded' | 'request-failed' | 'invalid-response' };

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

function slotIntentStorageKey(planId: string, slotKey: string) {
  return `ss-erp:ai-media-plan-slot-intent:${encodeURIComponent(planId)}:${encodeURIComponent(slotKey)}`;
}

function sameReferences(left: string[], right: string[]) {
  return left.length === right.length && left.every((candidateId, index) => candidateId === right[index]);
}

function candidateImageUrl(value: string) {
  return /^https?:\/\//iu.test(value) ? value : apiUrl(value);
}

type SlotDraft = {
  planId: string;
  baseVersionId: string;
  baseRevision: number;
  slotKey: string;
  baselineReferenceCandidateIds: string[];
  referenceCandidateIds: string[];
};

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

function SlotDetails({
  payload,
  editable,
  onEdit,
}: {
  payload: AiMediaPlanPayload | null;
  editable: boolean;
  onEdit: (slot: AiMediaPlanSlot) => void;
}) {
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
              {editable ? <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7 shrink-0" onClick={() => onEdit(slot)} title="编辑槽位参考图" aria-label={`编辑槽位参考图 ${slotLabel(slot)}`}><Pencil className="h-3.5 w-3.5" /></Button> : null}
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
  targetUpdatedAt,
  enabled = true,
  planningEnabled = false,
  selectedSkuKeys = [],
  candidateInputs = [],
  candidateSnapshotId,
  mediaDraftDirty,
  mediaMutationBusy,
  runMediaMutation,
  onApplied,
  onConflictRefresh,
  onSlotDraftDirtyChange,
  onRegisterSlotDraftDiscard,
}: {
  targetId: string;
  targetUpdatedAt?: string;
  enabled?: boolean;
  planningEnabled?: boolean;
  selectedSkuKeys?: string[];
  candidateInputs?: AiMediaContextInput[];
  candidateSnapshotId?: string;
  mediaDraftDirty: boolean;
  mediaMutationBusy: boolean;
  runMediaMutation: RunMediaMutation;
  onApplied?: (result: AiImageApplyResult) => void;
  onConflictRefresh: SynchronizeAiMediaTarget;
  onSlotDraftDirtyChange?: (dirty: boolean) => void;
  onRegisterSlotDraftDiscard?: (discard: (() => void) | null) => void;
}) {
  const [bundle, setBundle] = useState<AiMediaPlanBundle | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reviewing, setReviewing] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [creating, setCreating] = useState(false);
  const [slotDraft, setSlotDraft] = useState<SlotDraft | null>(null);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotConflictRefreshing, setSlotConflictRefreshing] = useState(false);
  const [slotSaveConflict, setSlotSaveConflict] = useState('');
  const [slotConflictRequiresRebase, setSlotConflictRequiresRebase] = useState(false);
  const [slotSourceStaleConflict, setSlotSourceStaleConflict] = useState(false);
  const [recoverableSlotDraft, setRecoverableSlotDraft] = useState<ReturnType<typeof loadAiMediaPlanSlotDraft>>(null);
  const requestVersion = useRef(0);
  const contextVersion = useRef(0);
  const targetIdRef = useRef(targetId);
  targetIdRef.current = targetId;
  const reviewIntents = useRef(new Map<string, WorkflowSubmissionIntent>());
  const createIntent = useRef<WorkflowSubmissionIntent | null>(null);
  const slotIntents = useRef(new Map<string, WorkflowSubmissionIntent>());
  const slotSavingRef = useRef(false);
  slotSavingRef.current = slotSaving;
  const confirmSlotDiscard = useScopedSystemConfirmation(JSON.stringify([
    targetId, slotDraft, slotDialogOpen, slotSaving, slotConflictRefreshing,
  ]));
  const regenerationAllowed = !bundle || canRegenerateAiMediaPlan(bundle.plan);
  const approvalReady = bundle ? canApproveAiMediaPlan(bundle) : false;
  const currentPlanVersionId = bundle?.plan.currentVersionId || bundle?.currentVersion?.id || null;
  const slotDraftDirty = Boolean(slotDraft && (
    !sameReferences(slotDraft.referenceCandidateIds, slotDraft.baselineReferenceCandidateIds)
    || slotDraft.planId !== bundle?.plan.id
    || slotDraft.baseRevision !== bundle?.plan.revision
    || slotDraft.baseVersionId !== currentPlanVersionId
  ));
  const editedSlot = slotDraft && bundle?.currentVersion?.planPayload?.slots.find(
    (slot) => slot.slotKey === slotDraft.slotKey,
  ) || null;
  const candidateOptions = useMemo(() => {
    const payload = bundle?.currentVersion?.planPayload;
    const curation = bundle?.currentVersion?.curation;
    if (!editedSlot || !payload || !curation) return [];
    return resolveAiMediaPlanSlotCandidateOptions({
      slot: editedSlot,
      compatibilityGroups: payload.compatibilityGroups,
      consideredCandidateIds: curation.consideredCandidateIds,
      selectedCandidateIds: curation.selectedCandidateIds,
      draftCandidateIds: slotDraft?.referenceCandidateIds,
      inputs: candidateInputs,
    });
  }, [bundle?.currentVersion, candidateInputs, editedSlot, slotDraft?.referenceCandidateIds]);
  const slotReferencesStillSelectable = slotDraft?.referenceCandidateIds.every((candidateId) => (
    candidateOptions.some((option) => option.candidateId === candidateId && option.selectable)
  )) ?? false;
  const slotSourceCurrent = Boolean(bundle?.currentVersion
    && candidateSnapshotId
    && bundle.currentVersion.sourceCaptureSnapshotId === candidateSnapshotId
    && (!bundle.plan.sourceCaptureSnapshotId || bundle.plan.sourceCaptureSnapshotId === candidateSnapshotId));
  const slotEditingAllowed = Boolean(planningEnabled
    && bundle
    && ['PENDING', 'APPROVED', 'REJECTED'].includes(bundle.plan.reviewStatus)
    && !bundle.plan.staleAt
    && bundle.plan.sourceCurrent !== false
    && bundle.currentVersion?.planPayload?.manualSelectionAllowed
    && slotSourceCurrent);
  const slotDraftAuthority = slotDraft && bundle
    ? resolveAiMediaPlanSlotDraftAuthority({
      draft: slotDraft,
      plan: bundle.plan,
      currentVersionId: currentPlanVersionId,
    })
    : null;
  const slotCandidateEditMode = resolveAiMediaPlanSlotCandidateEditMode({
    editingAllowed: slotEditingAllowed,
    staleConflict: slotSourceStaleConflict,
    rebaseRequested: slotConflictRequiresRebase,
    authority: slotDraftAuthority,
  });
  const canRebaseSlotDraft = slotCandidateEditMode === 'version-conflict'
    && slotReferencesStillSelectable;
  const canRefreshSlotConflict = slotConflictRequiresRebase
    && slotCandidateEditMode === 'read-only'
    && !slotSourceStaleConflict
    && !slotSaving;

  const load = useCallback(async (quiet = false): Promise<PlanLoadOutcome> => {
    if (!enabled) {
      setLoading(false);
      setBundle(null);
      setError('');
      return { ok: false, reason: 'disabled' };
    }
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get<unknown>(`/api/ai-images/plans/current?contextType=collect&contextId=${encodeURIComponent(targetId)}`);
      if (version !== requestVersion.current) return { ok: false, reason: 'superseded' };
      if (result.code !== 1) {
        if (String(result.code).toUpperCase() === 'AI_MEDIA_PLANNING_NOT_FOUND') {
          setBundle(null);
          setError('');
          return { ok: true, bundle: null };
        } else {
          if (!quiet) setBundle(null);
          setError(result.msg || '图片策展计划加载失败');
          return { ok: false, reason: 'request-failed' };
        }
      }
      if (result.data === null || result.data === undefined) {
        setBundle(null);
        setError('');
        return { ok: true, bundle: null };
      }
      const normalized = normalizeAiMediaPlanBundle(result.data);
      if (!normalized) {
        if (!quiet) setBundle(null);
        setError('服务端返回的图片策展计划格式无效');
        return { ok: false, reason: 'invalid-response' };
      }
      setBundle(normalized);
      setError('');
      return { ok: true, bundle: normalized };
    } catch (caught) {
      if (version !== requestVersion.current) return { ok: false, reason: 'superseded' };
      setError(caught instanceof Error ? caught.message : '网络错误，请重试');
      return { ok: false, reason: 'request-failed' };
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [enabled, targetId]);

  useEffect(() => {
    contextVersion.current += 1;
    requestVersion.current += 1;
    reviewIntents.current.clear();
    createIntent.current = null;
    slotIntents.current.clear();
    setBundle(null);
    setError('');
    setNote('');
    setCreating(false);
    setReviewing(null);
    setSlotDraft(null);
    setSlotDialogOpen(false);
    setSlotSaving(false);
    setSlotConflictRefreshing(false);
    setSlotSaveConflict('');
    setSlotConflictRequiresRebase(false);
    setSlotSourceStaleConflict(false);
    setRecoverableSlotDraft(null);
    void load();
    return () => {
      contextVersion.current += 1;
      requestVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    onSlotDraftDirtyChange?.(slotDraftDirty);
    return () => {
      if (slotDraftDirty) onSlotDraftDirtyChange?.(false);
    };
  }, [onSlotDraftDirtyChange, slotDraftDirty]);

  useEffect(() => {
    onRegisterSlotDraftDiscard?.(() => discardSlotDraft());
    return () => onRegisterSlotDraftDiscard?.(null);
  }, [onRegisterSlotDraftDiscard, slotDraft?.planId, slotDraft?.slotKey]);

  useEffect(() => {
    if (!slotDraftDirty) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [slotDraftDirty]);

  useEffect(() => {
    if (!slotDraft || !slotDraftDirty) return;
    const storageValue = storage();
    saveAiMediaPlanSlotDraft(
      storageValue,
      aiMediaPlanSlotDraftStorageKey(slotDraft.planId, slotDraft.slotKey),
      {
        planId: slotDraft.planId,
        baseVersionId: slotDraft.baseVersionId,
        baseRevision: slotDraft.baseRevision,
        slotKey: slotDraft.slotKey,
        referenceCandidateIds: slotDraft.referenceCandidateIds,
        savedAt: Date.now(),
      },
    );
  }, [slotDraft, slotDraftDirty]);

  useEffect(() => {
    if (!slotDraft || !bundle || !slotDraftDirty) return;
    const authority = resolveAiMediaPlanSlotDraftAuthority({
      draft: slotDraft,
      plan: bundle.plan,
      currentVersionId: currentPlanVersionId,
    });
    if (authority === 'STALE_SOURCE') {
      setSlotSourceStaleConflict(true);
      setSlotConflictRequiresRebase(false);
      setSlotSaveConflict('来源图片快照已变化，请放弃当前修改并基于最新快照重新规划。');
      return;
    }
    if (slotSourceStaleConflict) return;
    if (authority === 'VERSION_CONFLICT') {
      setSlotSaveConflict('计划已在服务端变化。当前选择仍保留，请采用最新版本后重新确认。');
      setSlotConflictRequiresRebase(true);
    }
  }, [bundle, currentPlanVersionId, slotDraft, slotDraftDirty, slotSourceStaleConflict]);

  function openSlotEditor(slot: AiMediaPlanSlot) {
    if (!bundle?.currentVersion || !currentPlanVersionId || !slotEditingAllowed || slotSaving) return;
    if (slotDraftDirty && slotDraft?.slotKey !== slot.slotKey) {
      toast({ title: '请先保存或放弃当前槽位修改', variant: 'destructive' });
      return;
    }
    const baselineReferenceCandidateIds = slot.references.map((reference) => reference.candidateId);
    const storageValue = storage();
    const draftKey = aiMediaPlanSlotDraftStorageKey(bundle.plan.id, slot.slotKey);
    const storedDraft = loadAiMediaPlanSlotDraft(storageValue, draftKey);
    const exactStoredDraft = storedDraft
      && storedDraft.planId === bundle.plan.id
      && storedDraft.baseVersionId === currentPlanVersionId
      && storedDraft.baseRevision === bundle.plan.revision
      && storedDraft.slotKey === slot.slotKey
      ? storedDraft
      : null;
    setSlotDraft({
      planId: bundle.plan.id,
      baseVersionId: currentPlanVersionId,
      baseRevision: bundle.plan.revision,
      slotKey: slot.slotKey,
      baselineReferenceCandidateIds,
      referenceCandidateIds: exactStoredDraft?.referenceCandidateIds || baselineReferenceCandidateIds,
    });
    setRecoverableSlotDraft(exactStoredDraft ? null : storedDraft);
    setSlotSaveConflict(storedDraft && !exactStoredDraft
      ? '发现基于旧计划版本的未保存选择。为避免覆盖最新计划，系统没有自动恢复。'
      : '');
    setSlotConflictRequiresRebase(false);
    setSlotSourceStaleConflict(false);
    setSlotConflictRefreshing(false);
    setSlotDialogOpen(true);
  }

  function discardSlotDraft() {
    if (slotDraft) {
      const storageValue = storage();
      // Navigation may unmount this component while a request is still in flight.
      // Keep both the body and operation key until its outcome can be reconciled.
      if (!slotSavingRef.current) {
        clearAiMediaPlanSlotDraft(
          storageValue,
          aiMediaPlanSlotDraftStorageKey(slotDraft.planId, slotDraft.slotKey),
        );
        clearWorkflowSubmissionIntent(
          storageValue,
          slotIntentStorageKey(slotDraft.planId, slotDraft.slotKey),
        );
        slotIntents.current.delete(slotDraft.slotKey);
      }
    }
    setSlotDraft(null);
    setRecoverableSlotDraft(null);
    setSlotSaveConflict('');
    setSlotConflictRequiresRebase(false);
    setSlotSourceStaleConflict(false);
    setSlotConflictRefreshing(false);
    setSlotDialogOpen(false);
  }

  async function closeSlotEditor() {
    if (slotSaving || slotConflictRefreshing) return;
    if (slotDraftDirty && !await confirmSlotDiscard({
      message: '当前槽位参考图尚未保存，确认放弃这些修改？',
      confirmText: '放弃修改',
      tone: 'destructive',
    })) return;
    if (slotSavingRef.current) return;
    discardSlotDraft();
  }

  function refreshPlan() {
    if (slotDraftDirty) {
      toast({ title: '槽位参考图尚未保存', description: '请先保存或放弃当前修改，再刷新图片策展计划。' });
      return;
    }
    void load();
  }

  function reconcileSlotConflictRefresh(refreshed: PlanLoadOutcome) {
    if (!slotDraft) return;
    if (!refreshed.ok) {
      setSlotSaveConflict('计划已变化，但最新版本读取失败。当前草稿已锁定，读取成功前不能采用或保存。');
      return;
    }
    if (!refreshed.bundle) {
      setSlotSaveConflict('计划已变化且当前计划已不存在。当前草稿已锁定，请放弃修改。');
      return;
    }
    const authority = resolveAiMediaPlanSlotDraftAuthority({
      draft: slotDraft,
      plan: refreshed.bundle.plan,
      currentVersionId: refreshed.bundle.plan.currentVersionId || refreshed.bundle.currentVersion?.id || null,
    });
    if (authority === 'STALE_SOURCE') {
      setSlotConflictRequiresRebase(false);
      setSlotSourceStaleConflict(true);
      setSlotSaveConflict('来源图片快照已变化，请放弃当前修改并基于最新快照重新规划。');
    } else if (authority === 'VERSION_CONFLICT') {
      setSlotConflictRequiresRebase(true);
      setSlotSourceStaleConflict(false);
      setSlotSaveConflict('计划已在服务端变化。当前选择仍保留，请采用最新版本后重新确认。');
    } else {
      setSlotSaveConflict('计划冲突尚未在最新读取结果中解决。当前草稿已锁定，请稍后重新读取或放弃修改。');
    }
  }

  async function retrySlotConflictRefresh() {
    if (!canRefreshSlotConflict || slotConflictRefreshing || slotSaving) return;
    const operationContextVersion = contextVersion.current;
    const operationTargetId = targetId;
    const isCurrentOperation = () => operationContextVersion === contextVersion.current
      && operationTargetId === targetIdRef.current;
    setSlotConflictRefreshing(true);
    try {
      const refreshed = await load(true);
      if (isCurrentOperation()) reconcileSlotConflictRefresh(refreshed);
    } finally {
      if (isCurrentOperation()) setSlotConflictRefreshing(false);
    }
  }

  function toggleSlotCandidate(candidateId: string) {
    const option = candidateOptions.find((candidate) => candidate.candidateId === candidateId);
    if (!slotDraft || !option || slotSaving) return;
    const alreadySelected = slotDraft.referenceCandidateIds.includes(candidateId);
    if (!canToggleAiMediaPlanSlotCandidate({
      mode: slotCandidateEditMode,
      selected: alreadySelected,
      selectable: option.selectable,
    })) return;
    setSlotDraft((current) => {
      if (!current) return current;
      if (current.referenceCandidateIds.includes(candidateId)) {
        return {
          ...current,
          referenceCandidateIds: current.referenceCandidateIds.filter((value) => value !== candidateId),
        };
      }
      if (current.referenceCandidateIds.length >= 5) {
        toast({ title: '每个槽位最多选择 5 张参考图', variant: 'destructive' });
        return current;
      }
      return { ...current, referenceCandidateIds: [...current.referenceCandidateIds, candidateId] };
    });
  }

  function restoreOldSlotDraft() {
    if (!slotDraft || !recoverableSlotDraft) return;
    const selectable = new Set(candidateOptions.filter((option) => option.selectable).map((option) => option.candidateId));
    if (!recoverableSlotDraft.referenceCandidateIds.every((candidateId) => selectable.has(candidateId))) {
      toast({ title: '旧草稿包含当前不可用的参考图，无法恢复', variant: 'destructive' });
      return;
    }
    setSlotDraft((current) => current ? {
      ...current,
      referenceCandidateIds: [...recoverableSlotDraft.referenceCandidateIds],
    } : current);
    setRecoverableSlotDraft(null);
    setSlotSaveConflict('已载入旧草稿选择；保存前请重新核对。');
  }

  function rebaseSlotDraft() {
    if (!slotDraft || !bundle?.currentVersion || !currentPlanVersionId || !editedSlot
      || !canRebaseSlotDraft) return;
    const storageValue = storage();
    clearWorkflowSubmissionIntent(
      storageValue,
      slotIntentStorageKey(slotDraft.planId, slotDraft.slotKey),
    );
    slotIntents.current.delete(slotDraft.slotKey);
    setSlotDraft({
      ...slotDraft,
      planId: bundle.plan.id,
      baseVersionId: currentPlanVersionId,
      baseRevision: bundle.plan.revision,
      baselineReferenceCandidateIds: editedSlot.references.map((reference) => reference.candidateId),
    });
    setSlotSaveConflict('已切换到最新计划版本，请核对后保存。');
    setSlotConflictRequiresRebase(false);
    setSlotSourceStaleConflict(false);
  }

  async function saveSlotReferences() {
    if (!slotDraft || !bundle || slotSaving || !slotDraftDirty
      || slotCandidateEditMode !== 'current' || !slotReferencesStillSelectable) return;
    const operationContextVersion = contextVersion.current;
    const operationTargetId = targetId;
    const isCurrentOperation = () => operationContextVersion === contextVersion.current
      && operationTargetId === targetIdRef.current;
    const storageValue = storage();
    const intentKey = slotIntentStorageKey(slotDraft.planId, slotDraft.slotKey);
    const fingerprint = JSON.stringify({
      planId: slotDraft.planId,
      baseVersionId: slotDraft.baseVersionId,
      expectedRevision: slotDraft.baseRevision,
      slotKey: slotDraft.slotKey,
      referenceCandidateIds: slotDraft.referenceCandidateIds,
    });
    const intent = resolveWorkflowSubmissionIntent(
      slotIntents.current.get(slotDraft.slotKey) || loadWorkflowSubmissionIntent(storageValue, intentKey),
      fingerprint,
      () => operationKey('plan-slot-save'),
    );
    slotIntents.current.set(slotDraft.slotKey, intent);
    saveWorkflowSubmissionIntent(storageValue, intentKey, intent);
    let body;
    try {
      body = buildAiMediaPlanSlotReferenceUpdateRequest({
        expectedRevision: slotDraft.baseRevision,
        baseVersionId: slotDraft.baseVersionId,
        operationKey: intent.idempotencyKey,
        slotKey: slotDraft.slotKey,
        referenceCandidateIds: slotDraft.referenceCandidateIds,
      });
    } catch (caught) {
      toast({ title: '槽位参考图无效', description: caught instanceof Error ? caught.message : '请重新选择', variant: 'destructive' });
      return;
    }
    setSlotSaving(true);
    setSlotSaveConflict('');
    setSlotSourceStaleConflict(false);
    try {
      const path = `/api/ai-images/plans/${encodeURIComponent(slotDraft.planId)}/slot-references`;
      let result;
      try {
        result = await api.post<unknown>(path, body);
      } catch {
        if (!isCurrentOperation()) return;
        // An ambiguous transport failure is reconciled by replaying the exact operation key once.
        result = await api.post<unknown>(path, body);
      }
      if (!isCurrentOperation()) return;
      if (result.code !== 1) {
        const code = String(result.code || '').toUpperCase();
        if (code.includes('ACTIVE_SUITE_CONFLICT')) {
          setSlotConflictRequiresRebase(false);
          setSlotSourceStaleConflict(false);
          setSlotSaveConflict(result.msg || '当前计划版本已有可恢复的套图任务，请等待任务结束后重试保存。');
        } else if (code.includes('STALE')) {
          setSlotConflictRequiresRebase(false);
          setSlotSourceStaleConflict(true);
          setSlotSaveConflict(result.msg || '来源图片快照已变化，请放弃当前修改并基于最新快照重新规划。');
          const refreshed = await load(true);
          if (!isCurrentOperation()) return;
          if (!refreshed.ok) {
            setSlotSaveConflict('来源图片快照已变化，且最新计划读取失败。当前草稿已锁定，请稍后刷新或放弃修改。');
          }
        } else if (code.includes('REVISION_CONFLICT') || code.includes('STATE_CONFLICT')) {
          setSlotConflictRequiresRebase(true);
          setSlotSourceStaleConflict(false);
          setSlotSaveConflict(result.msg || '计划已变化，请刷新最新版本后重新应用当前选择。');
          const refreshed = await load(true);
          if (!isCurrentOperation()) return;
          reconcileSlotConflictRefresh(refreshed);
        } else {
          toast({ title: '槽位参考图保存失败', description: result.msg, variant: 'destructive' });
        }
        return;
      }
      const normalized = normalizeAiMediaPlanBundle(result.data);
      if (!normalized) {
        setSlotSaveConflict('保存结果格式无效；已保留本次操作，可使用同一请求安全核对。');
        return;
      }
      setBundle(normalized);
      clearAiMediaPlanSlotDraft(
        storageValue,
        aiMediaPlanSlotDraftStorageKey(slotDraft.planId, slotDraft.slotKey),
      );
      clearWorkflowSubmissionIntent(storageValue, intentKey);
      slotIntents.current.delete(slotDraft.slotKey);
      setSlotDraft(null);
      setRecoverableSlotDraft(null);
      setSlotDialogOpen(false);
      toast({ title: '槽位参考图已保存' });
    } catch (caught) {
      if (!isCurrentOperation()) return;
      setSlotSaveConflict('网络结果尚未确认。当前选择与操作标识已保留，再次保存会核对同一请求。');
      toast({ title: '槽位参考图保存结果待核对', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
    } finally {
      if (isCurrentOperation()) setSlotSaving(false);
    }
  }

  async function createPlan() {
    if (!planningEnabled || creating || !regenerationAllowed || slotDraftDirty) return;
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
      || slotDraftDirty
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
    <>
    <section className="space-y-3 border-t pt-4" aria-label="图片策展计划">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="h-4 w-4" /><h3 className="text-sm font-medium">图片策展计划</h3>{bundle ? <Badge variant={statusVariant(bundle.plan.reviewStatus)}>{REVIEW_STATUS_LABEL[bundle.plan.reviewStatus]}</Badge> : <Badge variant="outline">未生成</Badge>}</div>
          <p className="mt-1 text-xs text-muted-foreground">展示候选选择、SKU 兼容组和套图槽位证据；未通过审核不会进入执行。</p>
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={refreshPlan} disabled={slotSaving} title={slotDraftDirty ? '请先保存或放弃槽位修改' : '刷新图片策展计划'} aria-label="刷新图片策展计划"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {error ? <div className="break-words border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {!error && !bundle ? <div className="space-y-3 border border-dashed px-3 py-3 text-sm text-muted-foreground">
        <p>尚未生成图片策展计划。</p>
        {planningEnabled ? <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" onClick={() => void createPlan()} disabled={creating || slotDraftDirty}><ClipboardCheck className="h-3.5 w-3.5" />{creating ? '生成中' : '生成规则策展计划'}</Button><span className="text-xs">使用当前已确认采集快照，不调用 Provider。</span></div> : <p className="text-xs">当前阶段仅开放读取与审核，计划生成能力未对该账号开放。</p>}
      </div> : null}
      {bundle ? (
        <>
          <PlanSummary bundle={bundle} />
          {bundle.plan.staleAt || bundle.plan.sourceCurrent === false ? <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>计划对应的采集快照已变化，当前计划只能查看，不能审核或执行。{bundle.plan.staleReasons.length ? ` 原因：${bundle.plan.staleReasons.join('、')}` : ''}</span></div> : null}
          {regenerationAllowed ? <div className="flex flex-wrap items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><span>{bundle.plan.reviewStatus === 'REJECTED' ? '当前计划已拒绝，可保留审计记录并重新规划。' : '当前计划已过期，可基于最新采集快照重新规划。'}</span>{planningEnabled ? <Button type="button" size="sm" variant="outline" onClick={() => void createPlan()} disabled={creating || slotDraftDirty}><RefreshCw className="h-3.5 w-3.5" />{creating ? '生成中' : '基于当前快照重新生成'}</Button> : <span>计划生成能力未对该账号开放。</span>}</div> : null}
          {!bundle.currentVersion ? <div className="border border-dashed px-3 py-3 text-xs text-muted-foreground">计划没有可读取的当前版本，审核入口已关闭。</div> : <>
            <CurationDetails curation={bundle.currentVersion.curation} />
            <CompatibilityDetails payload={bundle.currentVersion.planPayload} />
            <SlotDetails payload={bundle.currentVersion.planPayload} editable={slotEditingAllowed} onEdit={openSlotEditor} />
            {bundle.currentVersion.planPayload?.verifiedFacts.length ? <details className="border"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4" />事实证据 <span className="ml-auto text-xs text-muted-foreground">{bundle.currentVersion.planPayload.verifiedFacts.length} 条</span></summary><div className="max-h-64 space-y-1 overflow-auto border-t px-3 py-3">{bundle.currentVersion.planPayload.verifiedFacts.map((fact) => <div key={`${fact.path}:${fact.evidenceIds.join(',')}`} className="border bg-background px-2 py-2 text-xs"><div className="break-all font-mono">{fact.path}</div><div className="mt-1 break-words">{shortJson(fact.value)}</div><div className="mt-1 break-all text-muted-foreground">证据：{fact.evidenceIds.join(', ') || '无'}</div></div>)}</div></details> : null}
          </>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>版本 {bundle.currentVersion?.version || bundle.plan.latestVersion || '-'}</span>{bundle.currentVersion?.sourceCaptureSnapshotId ? <span className="break-all font-mono">快照 {bundle.currentVersion.sourceCaptureSnapshotId}</span> : null}</div>
          {REVIEWABLE.has(bundle.plan.reviewStatus) && !approvalReady ? <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">计划仍有待人工补选或证据不完整的槽位，当前不能通过审核。</div> : null}
          {planningEnabled && REVIEWABLE.has(bundle.plan.reviewStatus) && !bundle.plan.staleAt && bundle.plan.sourceCurrent !== false ? <div className="space-y-2 border px-3 py-3"><label className="block text-xs font-medium" htmlFor={`ai-media-plan-review-note-${targetId}`}>审核备注（可选）</label><textarea id={`ai-media-plan-review-note-${targetId}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2_000} rows={2} disabled={slotDraftDirty} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" placeholder="记录人工确认或拒绝原因" /><div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => void review('APPROVE')} disabled={Boolean(reviewing) || !approvalReady || slotDraftDirty}><Check className="h-3.5 w-3.5" />{reviewing === 'APPROVE' ? '提交中' : '通过计划'}</Button><Button type="button" size="sm" variant="outline" onClick={() => void review('REJECT')} disabled={Boolean(reviewing) || slotDraftDirty}><X className="h-3.5 w-3.5" />{reviewing === 'REJECT' ? '提交中' : '拒绝计划'}</Button></div></div> : null}
          <SourceAiMediaSuitePanel
            targetId={targetId}
            targetUpdatedAt={targetUpdatedAt}
            plan={bundle.plan}
            mediaDraftDirty={mediaDraftDirty || slotDraftDirty}
            mediaMutationBusy={mediaMutationBusy}
            runMediaMutation={runMediaMutation}
            onApplied={onApplied}
            onConflictRefresh={onConflictRefresh}
          />
        </>
      ) : null}
    </section>
    <Dialog open={slotDialogOpen} onOpenChange={(open) => { if (!open) closeSlotEditor(); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑槽位参考图</DialogTitle>
          <DialogDescription>
            {editedSlot ? `${slotLabel(editedSlot)} · ${formatAiMediaPlanningIdentity(editedSlot.ownership.key)} · ${editedSlot.aspectRatio}` : '选择当前槽位使用的参考商品图'}
          </DialogDescription>
        </DialogHeader>
        {slotDraft ? <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="max-w-full break-all font-mono">{formatAiMediaPlanningSlotKey(slotDraft.slotKey)}</Badge>
            <span className="text-muted-foreground">已选 {slotDraft.referenceCandidateIds.length} / 5</span>
            {slotDraftDirty ? <Badge variant="warning">未保存</Badge> : <Badge variant="outline">无修改</Badge>}
          </div>
          {slotSaveConflict ? <div className="space-y-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="break-words">{slotSaveConflict}</p>
            <div className="flex flex-wrap gap-2">
              {recoverableSlotDraft ? <Button type="button" size="sm" variant="outline" onClick={restoreOldSlotDraft}>载入旧选择</Button> : null}
              {slotConflictRequiresRebase ? <Button type="button" size="sm" variant="outline" onClick={rebaseSlotDraft} disabled={!canRebaseSlotDraft}>采用最新版本并保留选择</Button> : null}
              {canRefreshSlotConflict ? <Button type="button" size="sm" variant="outline" onClick={() => void retrySlotConflictRefresh()} disabled={slotConflictRefreshing || slotSaving}>{slotConflictRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}重新读取最新版本</Button> : null}
            </div>
          </div> : null}
          {!slotSourceCurrent ? <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">当前商品图片快照与计划不一致，参考图编辑已暂停。</div> : null}
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {candidateOptions.map((option) => {
              const selectedIndex = slotDraft.referenceCandidateIds.indexOf(option.candidateId);
              const selected = selectedIndex >= 0;
              const reason = option.reasonCode === 'NOT_CURATED'
                ? '未被当前策展计划选中'
                : option.reasonCode === 'SLOT_INCOMPATIBLE'
                  ? '与当前 SKU/兼容组不匹配'
                  : option.reasonCode === 'SOURCE_UNAVAILABLE'
                    ? '当前快照中不可用'
                    : '';
              const sourceUrl = option.input?.assetUrl || option.input?.sourceUrl || '';
              return <button
                key={option.candidateId}
                type="button"
                onClick={() => toggleSlotCandidate(option.candidateId)}
                disabled={slotSaving || !canToggleAiMediaPlanSlotCandidate({
                  mode: slotCandidateEditMode,
                  selected,
                  selectable: option.selectable,
                })}
                aria-pressed={selected}
                title={reason || (selected ? '取消选择参考图' : '选择参考图')}
                className={`relative min-w-0 border bg-background p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55 ${selected ? 'border-primary ring-1 ring-primary' : ''}`}
              >
                <div className="relative aspect-square w-full overflow-hidden bg-muted">
                  {sourceUrl ? <img src={candidateImageUrl(sourceUrl)} alt="参考图候选" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-7 w-7" /></div>}
                  {selected ? <span className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground">{selectedIndex + 1}</span> : null}
                </div>
                <div className="mt-1 break-all font-mono text-[11px] leading-4">{option.candidateId}</div>
                <div className="break-words text-[11px] leading-4 text-muted-foreground">{reason || option.input?.role || '可选参考图'}</div>
              </button>;
            })}
          </div>
          {!candidateOptions.length ? <div className="border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">当前计划没有可显示的参考图候选。</div> : null}
        </div> : null}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={closeSlotEditor} disabled={slotSaving || slotConflictRefreshing}>放弃修改</Button>
          <Button type="button" onClick={() => void saveSlotReferences()} disabled={slotSaving || slotCandidateEditMode !== 'current' || !slotDraftDirty || !slotReferencesStillSelectable}>
            {slotSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {slotSaving ? '保存中' : slotSaveConflict.includes('网络结果') ? '核对保存结果' : '保存槽位'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
