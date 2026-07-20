'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Columns2, ImageIcon, Languages, Loader2, Plus, RefreshCw, RotateCcw, ScanLine, Square, Trash2, WandSparkles, X } from 'lucide-react';
import { api, apiUrl, type ApiResponse } from '@/lib/api';
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
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { confirmAiImageMaskDraftDiscard } from '@/lib/ai-image-mask';
import { SourceAiMediaPlanningPanel } from './source-ai-media-planning-panel';
import {
  SourceAiImageMaskEditor,
  type SourceAiImageMaskEditorHandle,
} from './source-ai-image-mask-editor';
import {
  createLatestLoadCoordinator,
  isMediaMutationConflict,
  type AiImageApplyResult,
  type LatestLoadRequest,
  type RefreshAiMediaTarget,
  type RunMediaMutation,
  type SynchronizeAiMediaTarget,
} from './source-ai-media-state';
import {
  appendAiMediaWorkflowHistoryPage,
  aiMediaWorkflowPollInterval,
  aiMediaWorkflowReviewOutput,
  buildAiImageEditWorkflowRequest,
  buildImageTranslationWorkflowRequest,
  clearWorkflowSubmissionIntent,
  describeAiMediaReadiness,
  isAiMediaWorkflowInputCurrent,
  isDefinitiveWorkflowSubmissionFailure,
  loadWorkflowSubmissionIntent,
  mergeAiMediaWorkflowHistoryHead,
  normalizeAiMediaWorkflowPage,
  normalizeAiMediaWorkflowPriorityPage,
  normalizeImageTranslationTerminologies,
  resolveWorkflowSubmissionIntent,
  saveWorkflowSubmissionIntent,
  shouldRefreshAiMediaWorkflow,
  type AiImageEditMaskAsset,
  type AiImageTranslationTerminology,
  type AiMediaCapabilities,
  type AiMediaContextResponse,
  type AiMediaInternalizedAsset,
  type AiMediaOperation,
  type AiMediaWorkflow,
  type AiMediaWorkflowJob,
  type AiMediaWorkflowPage,
  type AiMediaWorkflowPriorityPage,
  type WorkflowIntentStorage,
  type WorkflowSubmissionIntent,
} from '@/lib/ai-media-workflow';
import {
  aiMediaApplicationIntentStorageKey,
  aiMediaTargetApplicationsPath,
  appendAiMediaApplicationLedgerPage,
  buildAiMediaApplicationRequest,
  buildAiMediaApplicationRollbackRequest,
  clearAiMediaApplicationIntent,
  isDefinitiveAiMediaApplicationFailure,
  loadAiMediaApplicationIntent,
  normalizeAiMediaApplicationCapability,
  normalizeAiMediaApplicationLedger,
  normalizeAiMediaApplicationMutationResult,
  projectAiMediaApplicationImageUrls,
  resolveAiMediaApplicationIntent,
  resolveAiMediaApplicationRecovery,
  resolveAiMediaApplicationTargetStaleVersion,
  saveAiMediaApplicationIntent,
  type AiMediaApplicationIntent,
  type AiMediaApplicationLedger,
  type AiMediaApplicationMode,
  type AiMediaApplicationMutation,
  type AiMediaApplicationMutationResult,
} from '@/lib/ai-media-application';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
const AI_MASK_HISTORY_GUARD_KEY = '__ssErpAiMaskDraftGuard';
const AI_MEDIA_APPLICATION_POLL_INTERVAL_MS = 30_000;
const STATUS_LABEL: Record<AiMediaWorkflow['status'], string> = {
  QUEUED: '排队中', RUNNING: '处理中', SUCCEEDED: '待审核', FAILED: '失败',
  CANCEL_REQUESTED: '取消中', CANCELLED: '已取消',
};

function imageUrl(value: string) {
  return /^https?:\/\//iu.test(value) ? value : apiUrl(value);
}

function idempotencyKey(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function browserSessionStorage(): WorkflowIntentStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function intentStorageKey(targetId: string, scope: string) {
  return `ss-erp:ai-media-intent:${encodeURIComponent(targetId)}:${scope}`;
}

function normalizeLanguageForFingerprint(value: string) {
  return value.trim().toLowerCase();
}

function maskHistoryState(token: string) {
  const current = window.history.state;
  return {
    ...(current && typeof current === 'object' ? current : {}),
    [AI_MASK_HISTORY_GUARD_KEY]: token,
  };
}

function workflowOperationLabel(operation: AiMediaOperation) {
  return operation === 'IMAGE_TRANSLATE'
    ? '图片翻译'
    : operation === 'FULL_EDIT'
      ? '全图编辑'
      : operation === 'INPAINT'
        ? '局部重绘'
        : '参考改图';
}

function workflowScopeLabel(workflow: AiMediaWorkflow) {
  if (workflow.contextSkuKey && workflow.contextSlotKey) {
    return `${workflow.contextSkuKey} · ${workflow.contextSlotKey}`;
  }
  if (workflow.contextSkuKey) return workflow.contextSkuKey;
  if (workflow.contextSlotKey) return workflow.contextSlotKey;
  return '商品级';
}

function priorityHeadSignature(workflows: AiMediaWorkflow[]) {
  return workflows.map((workflow) => workflow.id).sort().join('|');
}

function applicationRollbackReason(reason: string | null) {
  if (reason === 'ALREADY_ROLLED_BACK') return '已回滚';
  if (reason === 'NOT_FRONTIER') return '需先回滚较新的应用';
  if (reason === 'TARGET_CHANGED') return '商品图片后来已变化';
  if (reason === 'TARGET_STATE_INVALID') return '商品图片状态无法自动恢复';
  if (reason === 'LEGACY_APPLICATION') return '历史应用没有可逆快照';
  if (reason === 'NOT_APPLY') return '回滚操作记录';
  return reason === 'READY' ? '可回滚' : '不可回滚';
}

function applicationResultAsLegacyApply(
  result: AiMediaApplicationMutationResult,
  expectedTargetId: string,
): AiImageApplyResult | null {
  const images = projectAiMediaApplicationImageUrls(result.target.images);
  const editedImages = projectAiMediaApplicationImageUrls(result.target.editedImages);
  if (result.application.kind !== 'APPLY'
    || result.target.id !== expectedTargetId
    || images.length === 0) return null;
  return {
    jobId: result.application.jobId,
    mode: result.application.mode,
    targetType: 'collect',
    targetId: result.target.id,
    targetUpdatedAt: result.target.updatedAt,
    images,
    editedImages,
  };
}

export function SourceAiMediaPanel({
  target,
  selectedSkuKeys,
  mediaDraftDirty,
  onApplied,
  mediaMutationBusy,
  runMediaMutation,
  onConflictRefresh,
  onMaskDraftDirtyChange,
}: {
  target: { type: 'collect'; id: string; label: string; updatedAt?: string };
  selectedSkuKeys?: string[];
  mediaDraftDirty: boolean;
  onApplied?: (result: AiImageApplyResult) => void;
  mediaMutationBusy: boolean;
  runMediaMutation: RunMediaMutation;
  onConflictRefresh: RefreshAiMediaTarget;
  onMaskDraftDirtyChange?: (dirty: boolean) => void;
}) {
  const [context, setContext] = useState<AiMediaContextResponse | null>(null);
  const [capabilities, setCapabilities] = useState<AiMediaCapabilities | null>(null);
  const [workflows, setWorkflows] = useState<AiMediaWorkflow[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyPriorityTruncated, setHistoryPriorityTruncated] = useState(false);
  const [historyPriorityLoading, setHistoryPriorityLoading] = useState(false);
  const [comparisonWorkflowIds, setComparisonWorkflowIds] = useState<string[]>([]);
  const [applicationLedger, setApplicationLedger] = useState<AiMediaApplicationLedger | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationLoadingMore, setApplicationLoadingMore] = useState(false);
  const [applicationLedgerError, setApplicationLedgerError] = useState('');
  const [applicationTargetStaleVersion, setApplicationTargetStaleVersion] = useState<string | null>(null);
  const [applicationTargetRefreshing, setApplicationTargetRefreshing] = useState(false);
  const [replaceConfirmWorkflowId, setReplaceConfirmWorkflowId] = useState<string | null>(null);
  const [rollbackConfirmApplicationId, setRollbackConfirmApplicationId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [candidateSource, setCandidateSource] = useState<AiMediaContextResponse['inputs'][number] | null>(null);
  const [operation, setOperation] = useState<AiMediaOperation>('IMAGE_TO_IMAGE');
  const [prompt, setPrompt] = useState('保持商品主体、颜色、结构和包装数量不变，优化为干净明亮的电商展示背景，不添加文字或 Logo。');
  const [editPrompt, setEditPrompt] = useState('保持商品主体、颜色、结构、包装数量和可见事实不变，只修改明确指定的区域或背景。');
  const [editNegativePrompt, setEditNegativePrompt] = useState('不要添加文字、Logo、认证、配件或不存在的商品细节。');
  const [sourceLanguage, setSourceLanguage] = useState('zh');
  const [targetLanguage, setTargetLanguage] = useState('ru');
  const [translationHint, setTranslationHint] = useState('翻译图片中的中文营销文案为自然、简洁的俄文，保留品牌、型号、数字和商品主体。');
  const [terminologies, setTerminologies] = useState<AiImageTranslationTerminology[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preparingSource, setPreparingSource] = useState(false);
  const [maskReady, setMaskReady] = useState(false);
  const [maskDirty, setMaskDirty] = useState(false);
  const [maskResetNonce, setMaskResetNonce] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const imageIntentRef = useRef<WorkflowSubmissionIntent | null>(null);
  const translationIntentRef = useRef<WorkflowSubmissionIntent | null>(null);
  const fullEditIntentRef = useRef<WorkflowSubmissionIntent | null>(null);
  const inpaintIntentRef = useRef<WorkflowSubmissionIntent | null>(null);
  const maskEditorRef = useRef<SourceAiImageMaskEditorHandle | null>(null);
  const retryIntentRef = useRef(new Map<string, WorkflowSubmissionIntent>());
  const applicationIntentRef = useRef(new Map<string, AiMediaApplicationIntent>());
  const workflowsRef = useRef<AiMediaWorkflow[]>([]);
  const targetIdRef = useRef(target.id);
  const targetUpdatedAtRef = useRef<string | null>(target.updatedAt || null);
  const historyLoadedTargetRef = useRef<string | null>(null);
  const historyNextCursorRef = useRef<string | null>(null);
  const historyExpandedRef = useRef(false);
  const historyPageGenerationRef = useRef(0);
  const priorityNextCursorRef = useRef<string | null>(null);
  const priorityPageGenerationRef = useRef(0);
  const priorityLoadingRef = useRef(false);
  const prioritySeenCursorsRef = useRef(new Set<string>());
  const priorityHeadSignatureRef = useRef('');
  const priorityWorkflowIdsRef = useRef(new Set<string>());
  const detailRefreshOffsetRef = useRef(0);
  const detailRefreshGenerationRef = useRef(0);
  const applicationLoadGenerationRef = useRef(0);
  const applicationPageGenerationRef = useRef(0);
  const applicationLastReadAtRef = useRef(0);
  const workflowPollingRef = useRef(false);
  const capabilitiesRef = useRef<AiMediaCapabilities | null>(null);
  const contextRef = useRef<AiMediaContextResponse | null>(null);
  const maskDirtyRef = useRef(false);
  const maskHistoryGuardRef = useRef<{ token: string | null; suppressNextPop: boolean }>({
    token: null,
    suppressNextPop: false,
  });
  const onMaskDraftDirtyChangeRef = useRef(onMaskDraftDirtyChange);
  onMaskDraftDirtyChangeRef.current = onMaskDraftDirtyChange;
  const imageIntentStorageKey = intentStorageKey(target.id, 'image-to-image');
  const translationIntentStorageKey = intentStorageKey(target.id, 'image-translate');
  const fullEditIntentStorageKey = intentStorageKey(target.id, 'full-edit');
  const inpaintIntentStorageKey = intentStorageKey(target.id, 'inpaint');
  targetIdRef.current = target.id;
  targetUpdatedAtRef.current = target.updatedAt || null;

  function operationReadiness(operationKey: AiMediaWorkflow['operation']) {
    return capabilities?.operations?.[operationKey] || null;
  }

  const updateMaskDirty = useCallback((dirty: boolean) => {
    maskDirtyRef.current = dirty;
    setMaskDirty(dirty);
    onMaskDraftDirtyChangeRef.current?.(dirty);
    if (typeof window === 'undefined') return;
    const guard = maskHistoryGuardRef.current;
    // A same-URL sentinel lets popstate ask before Next unmounts the editor.
    if (dirty && !guard.token) {
      guard.token = idempotencyKey('mask-draft');
      window.history.pushState(maskHistoryState(guard.token), '', window.location.href);
    } else if (!dirty && guard.token && !guard.suppressNextPop) {
      if (window.history.state?.[AI_MASK_HISTORY_GUARD_KEY] === guard.token) {
        guard.suppressNextPop = true;
        window.history.back();
      } else {
        guard.token = null;
        guard.suppressNextPop = false;
      }
    }
  }, []);

  const reconcileApplicationTargetVersion = useCallback((authoritativeTargetUpdatedAt?: string | null) => {
    setApplicationTargetStaleVersion((currentStaleVersion) => resolveAiMediaApplicationTargetStaleVersion({
      renderedTargetUpdatedAt: targetUpdatedAtRef.current,
      authoritativeTargetUpdatedAt,
      currentStaleVersion,
    }));
  }, []);

  const loadNextPriorityHistoryPage = useCallback(async (
    requestTargetId: string,
    requestedCursor: string,
  ) => {
    if (priorityLoadingRef.current) return;
    const generation = ++priorityPageGenerationRef.current;
    priorityLoadingRef.current = true;
    priorityNextCursorRef.current = requestedCursor;
    setHistoryPriorityLoading(true);
    try {
      if (prioritySeenCursorsRef.current.has(requestedCursor)) {
        throw new Error('Priority history cursor repeated');
      }
      const result: ApiResponse<AiMediaWorkflowPriorityPage> = await api.get<AiMediaWorkflowPriorityPage>(
        `/api/ai-images/workflows/priority?contextType=collect&contextId=${encodeURIComponent(requestTargetId)}&limit=100&cursor=${encodeURIComponent(requestedCursor)}`,
      );
      if (targetIdRef.current !== requestTargetId || generation !== priorityPageGenerationRef.current) return;
      const page: AiMediaWorkflowPriorityPage | null = result.code === 1
        ? normalizeAiMediaWorkflowPriorityPage(result.data)
        : null;
      if (!page) throw new Error(result.msg || 'Invalid priority history page');
      if (
        page.nextCursor === requestedCursor
        || Boolean(page.nextCursor && prioritySeenCursorsRef.current.has(page.nextCursor))
      ) throw new Error('Priority history cursor did not advance');
      prioritySeenCursorsRef.current.add(requestedCursor);
      setWorkflows((current) => appendAiMediaWorkflowHistoryPage(current, page.items));
      priorityNextCursorRef.current = page.nextCursor;
      setHistoryPriorityTruncated(Boolean(page.nextCursor));
    } catch {
      if (targetIdRef.current === requestTargetId && generation === priorityPageGenerationRef.current) {
        priorityNextCursorRef.current = requestedCursor;
        setHistoryPriorityTruncated(true);
      }
    } finally {
      if (targetIdRef.current === requestTargetId && generation === priorityPageGenerationRef.current) {
        priorityLoadingRef.current = false;
        setHistoryPriorityLoading(false);
      }
    }
  }, []);

  const readApplicationLedger = useCallback(async (
    requestTargetId: string,
    options: { beforeSequence?: number; operationKey?: string } = {},
  ): Promise<AiMediaApplicationLedger | undefined> => {
    const path = aiMediaTargetApplicationsPath(requestTargetId, {
      limit: 25,
      beforeSequence: options.beforeSequence,
      operationKey: options.operationKey,
    });
    try {
      const result = await api.get<unknown>(path);
      const normalized = result.code === 1 ? normalizeAiMediaApplicationLedger(result.data) : null;
      return normalized?.target.id === requestTargetId ? normalized : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const refreshApplicationLedger = useCallback(async (
    requestTargetId: string,
    operationKey?: string,
  ) => {
    const generation = ++applicationLoadGenerationRef.current;
    applicationPageGenerationRef.current += 1;
    setApplicationLoadingMore(false);
    applicationLastReadAtRef.current = Date.now();
    const ledger = await readApplicationLedger(requestTargetId, { operationKey });
    if (generation !== applicationLoadGenerationRef.current || targetIdRef.current !== requestTargetId) {
      return ledger;
    }
    if (ledger) {
      reconcileApplicationTargetVersion(ledger.target.updatedAt);
      setApplicationLedger(ledger);
      setApplicationLedgerError('');
    } else {
      setApplicationLedgerError('应用记录暂时无法读取，当前回滚状态可能不是最新，请刷新后重试');
    }
    return ledger;
  }, [readApplicationLedger, reconcileApplicationTargetVersion]);

  const synchronizeConfirmedApplicationTarget = useCallback(async (
    requestTargetId: string,
    confirmedTargetUpdatedAt: string,
  ) => {
    try {
      const refreshedTarget = await onConflictRefresh();
      if (targetIdRef.current !== requestTargetId) return false;
      const refreshedAt = refreshedTarget?.id === requestTargetId
        && typeof refreshedTarget.updatedAt === 'string'
        ? refreshedTarget.updatedAt
        : null;
      const synchronized = refreshedAt
        && Number.isFinite(Date.parse(refreshedAt))
        && Date.parse(refreshedAt) >= Date.parse(confirmedTargetUpdatedAt);
      if (!synchronized) {
        reconcileApplicationTargetVersion(confirmedTargetUpdatedAt);
        return false;
      }
      targetUpdatedAtRef.current = refreshedAt;
      reconcileApplicationTargetVersion(confirmedTargetUpdatedAt);
      return true;
    } catch {
      if (targetIdRef.current === requestTargetId) {
        reconcileApplicationTargetVersion(confirmedTargetUpdatedAt);
      }
      return false;
    }
  }, [onConflictRefresh, reconcileApplicationTargetVersion]);

  const synchronizeApplicationTarget = useCallback<SynchronizeAiMediaTarget>(async (
    expectedTargetUpdatedAt,
  ) => {
    const requestTargetId = targetIdRef.current;
    if (expectedTargetUpdatedAt) {
      return synchronizeConfirmedApplicationTarget(requestTargetId, expectedTargetUpdatedAt);
    }
    try {
      const refreshedTarget = await onConflictRefresh();
      if (targetIdRef.current !== requestTargetId
        || refreshedTarget?.id !== requestTargetId
        || typeof refreshedTarget.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(refreshedTarget.updatedAt))) return false;
      targetUpdatedAtRef.current = refreshedTarget.updatedAt;
      reconcileApplicationTargetVersion(
        applicationLedger?.target.id === requestTargetId
          ? applicationLedger.target.updatedAt
          : null,
      );
      return true;
    } catch {
      return false;
    }
  }, [applicationLedger, onConflictRefresh, reconcileApplicationTargetVersion, synchronizeConfirmedApplicationTarget]);

  const executeLoad = useCallback(async (request: LatestLoadRequest, isCurrent: () => boolean) => {
    try {
      const capabilitiesRequest = capabilitiesRef.current
        ? Promise.resolve({ code: 1, msg: '', data: capabilitiesRef.current })
        : api.get<AiMediaCapabilities>('/api/ai-images/capabilities');
      const [contextResult, historyResult, capabilitiesResult] = await Promise.all([
        api.get<AiMediaContextResponse>(`/api/ai-images/contexts/collect/${encodeURIComponent(request.targetId)}`),
        api.get<AiMediaWorkflowPage | AiMediaWorkflow[]>(`/api/ai-images/workflows?contextType=collect&contextId=${encodeURIComponent(request.targetId)}&limit=20&pageVersion=1`),
        capabilitiesRequest,
      ]);
      if (!isCurrent()) return;
      if (contextResult.code === 1 && contextResult.data) {
        const nextContext = contextResult.data;
        const currentContext = contextRef.current;
        const snapshotChanged = Boolean(
          currentContext
          && currentContext.snapshot.id !== nextContext.snapshot.id,
        );
        const discardDirtyMask = snapshotChanged
          && maskDirtyRef.current
          && request.interactive
          && confirmAiImageMaskDraftDiscard(true, (message) => window.confirm(
            `采集快照已更新。${message}`,
          ));
        if (snapshotChanged && maskDirtyRef.current && !discardDirtyMask) {
          setError('采集快照已更新，当前遮罩草稿已保留。请先提交或丢弃草稿，再刷新最新快照。');
        } else {
          if (discardDirtyMask) {
            updateMaskDirty(false);
            setMaskReady(false);
            setMaskResetNonce((current) => current + 1);
          }
          contextRef.current = nextContext;
          setContext(nextContext);
          setSelectedKey((current) => nextContext.inputs.some((input) => input.sourceMediaKey === current)
            ? current
            : nextContext.inputs[0]?.sourceMediaKey || '');
          setDisabled(false);
          setError('');
        }
      } else if (contextResult.msg?.includes('disabled') || contextResult.msg?.includes('未启用')) {
        const discardDirtyMask = maskDirtyRef.current
          && request.interactive
          && confirmAiImageMaskDraftDiscard(true, (message) => window.confirm(message));
        if (maskDirtyRef.current && !discardDirtyMask) {
          setError('AI 图片工作流状态已变化，当前遮罩草稿已保留。请先提交或丢弃草稿，再刷新。');
        } else {
          if (discardDirtyMask) updateMaskDirty(false);
          contextRef.current = null;
          setDisabled(true);
          setContext(null);
          setError('');
        }
      } else {
        setError(contextResult.msg || '图片上下文加载失败');
      }
      const historyPage = historyResult.code === 1
        ? normalizeAiMediaWorkflowPage(historyResult.data)
        : null;
      if (historyPage) {
        priorityWorkflowIdsRef.current = new Set(
          historyPage.priorityItems.map((workflow) => workflow.id),
        );
        const firstPageItems = mergeAiMediaWorkflowHistoryHead(
          historyPage.items,
          historyPage.priorityItems,
        );
        const replaceHistory = historyLoadedTargetRef.current !== request.targetId;
        historyLoadedTargetRef.current = request.targetId;
        setWorkflows((current) => replaceHistory
          ? firstPageItems
          : mergeAiMediaWorkflowHistoryHead(current, firstPageItems));
        if (replaceHistory || !historyExpandedRef.current) {
          historyNextCursorRef.current = historyPage.nextCursor;
          setHistoryNextCursor(historyPage.nextCursor);
        }
        if (replaceHistory) {
          prioritySeenCursorsRef.current.clear();
          priorityHeadSignatureRef.current = priorityHeadSignature(historyPage.priorityItems);
          priorityNextCursorRef.current = historyPage.priorityNextCursor || null;
          setHistoryPriorityTruncated(historyPage.priorityItemsTruncated);
        } else if (
          !priorityNextCursorRef.current
          && priorityHeadSignatureRef.current !== priorityHeadSignature(historyPage.priorityItems)
        ) {
          priorityHeadSignatureRef.current = priorityHeadSignature(historyPage.priorityItems);
          prioritySeenCursorsRef.current.clear();
          priorityNextCursorRef.current = historyPage.priorityNextCursor || null;
          setHistoryPriorityTruncated(historyPage.priorityItemsTruncated);
        }
      } else setError(historyResult.msg || '任务历史加载失败');
      if (capabilitiesResult.code === 1 && capabilitiesResult.data) {
        const applicationCapability = normalizeAiMediaApplicationCapability(
          capabilitiesResult.data.applications,
        );
        const normalizedCapabilities = {
          ...capabilitiesResult.data,
          ...(applicationCapability ? { applications: applicationCapability } : { applications: undefined }),
        };
        capabilitiesRef.current = normalizedCapabilities;
        setCapabilities(normalizedCapabilities);
      } else {
        capabilitiesRef.current = null;
        setCapabilities(null);
        if (capabilitiesResult.msg && !capabilitiesResult.msg.includes('disabled')) setError(capabilitiesResult.msg);
      }
      const shouldRefreshApplicationLedger = request.interactive
        || Date.now() - applicationLastReadAtRef.current >= AI_MEDIA_APPLICATION_POLL_INTERVAL_MS;
      if (shouldRefreshApplicationLedger) {
        const applicationGeneration = ++applicationLoadGenerationRef.current;
        applicationPageGenerationRef.current += 1;
        setApplicationLoadingMore(false);
        applicationLastReadAtRef.current = Date.now();
        const ledger = await readApplicationLedger(request.targetId);
        if (!isCurrent() || applicationGeneration !== applicationLoadGenerationRef.current) return;
        if (ledger) {
          reconcileApplicationTargetVersion(ledger.target.updatedAt);
          setApplicationLedger(ledger);
          setApplicationLedgerError('');
        } else {
          setApplicationLedgerError('应用记录暂时无法读取，当前回滚状态可能不是最新，请刷新后重试');
        }
      }
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : '网络错误，请重试');
    }
  }, [readApplicationLedger, reconcileApplicationTargetVersion, updateMaskDirty]);

  const loadCoordinatorRef = useRef<ReturnType<typeof createLatestLoadCoordinator> | null>(null);
  if (!loadCoordinatorRef.current) {
    loadCoordinatorRef.current = createLatestLoadCoordinator({ execute: executeLoad, onLoadingChange: setLoading });
  }
  loadCoordinatorRef.current.setTarget(target.id);
  useEffect(() => () => {
    loadCoordinatorRef.current?.invalidate();
    historyPageGenerationRef.current += 1;
    priorityPageGenerationRef.current += 1;
    priorityLoadingRef.current = false;
    prioritySeenCursorsRef.current.clear();
    priorityHeadSignatureRef.current = '';
    detailRefreshGenerationRef.current += 1;
    applicationLoadGenerationRef.current += 1;
    applicationPageGenerationRef.current += 1;
    applicationLastReadAtRef.current = 0;
    contextRef.current = null;
    maskDirtyRef.current = false;
  }, []);
  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);
  const load = useCallback((quiet = false, refreshCapabilities = false, interactive = false) => {
    if (refreshCapabilities) {
      capabilitiesRef.current = null;
      setCapabilities(null);
    }
    return loadCoordinatorRef.current!.load(quiet, interactive);
  }, []);

  const refreshActiveWorkflows = useCallback(async () => {
    const requestTargetId = targetIdRef.current;
    const generation = ++detailRefreshGenerationRef.current;
    const refreshableIds = workflowsRef.current
      .filter(shouldRefreshAiMediaWorkflow)
      .map((workflow) => workflow.id)
      .filter((workflowId) => !priorityWorkflowIdsRef.current.has(workflowId));
    const offset = refreshableIds.length
      ? detailRefreshOffsetRef.current % refreshableIds.length
      : 0;
    const activeIds = refreshableIds.length <= 20
      ? refreshableIds
      : Array.from({ length: 20 }, (_, index) => refreshableIds[(offset + index) % refreshableIds.length]!);
    detailRefreshOffsetRef.current = offset + activeIds.length;
    if (!activeIds.length) return;
    const results = await Promise.all(activeIds.map((workflowId) => api.get<AiMediaWorkflow>(
      `/api/ai-images/workflows/${encodeURIComponent(workflowId)}?contextType=collect&contextId=${encodeURIComponent(requestTargetId)}`,
    ).catch(() => null)));
    if (
      targetIdRef.current !== requestTargetId
      || generation !== detailRefreshGenerationRef.current
    ) return;
    const updates = new Map(results.flatMap((result) => (
      result?.code === 1 && result.data ? [[result.data.id, result.data] as const] : []
    )));
    if (!updates.size) return;
    setWorkflows((current) => current.map((workflow) => {
      const updated = updates.get(workflow.id);
      return updated
        ? mergeAiMediaWorkflowHistoryHead([workflow], [updated])[0] || workflow
        : workflow;
    }));
  }, []);

  useEffect(() => {
    contextRef.current = null;
    setLoading(true);
    setContext(null);
    setCapabilities(null);
    capabilitiesRef.current = null;
    setWorkflows([]);
    workflowsRef.current = [];
    historyLoadedTargetRef.current = null;
    historyNextCursorRef.current = null;
    historyExpandedRef.current = false;
    historyPageGenerationRef.current += 1;
    priorityPageGenerationRef.current += 1;
    priorityLoadingRef.current = false;
    priorityNextCursorRef.current = null;
    prioritySeenCursorsRef.current.clear();
    priorityHeadSignatureRef.current = '';
    detailRefreshGenerationRef.current += 1;
    applicationLoadGenerationRef.current += 1;
    applicationPageGenerationRef.current += 1;
    applicationLastReadAtRef.current = 0;
    priorityWorkflowIdsRef.current.clear();
    detailRefreshOffsetRef.current = 0;
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    setHistoryPriorityTruncated(false);
    setHistoryPriorityLoading(false);
    setComparisonWorkflowIds([]);
    setApplicationLedger(null);
    setApplicationLoading(false);
    setApplicationLoadingMore(false);
    setApplicationLedgerError('');
    setApplicationTargetStaleVersion(null);
    setApplicationTargetRefreshing(false);
    setReplaceConfirmWorkflowId(null);
    setRollbackConfirmApplicationId(null);
    setSelectedKey('');
    setCandidateSource(null);
    updateMaskDirty(false);
    setMaskReady(false);
    setError('');
    setDisabled(false);
    const storage = browserSessionStorage();
    imageIntentRef.current = loadWorkflowSubmissionIntent(storage, imageIntentStorageKey);
    translationIntentRef.current = loadWorkflowSubmissionIntent(storage, translationIntentStorageKey);
    fullEditIntentRef.current = loadWorkflowSubmissionIntent(storage, fullEditIntentStorageKey);
    inpaintIntentRef.current = loadWorkflowSubmissionIntent(storage, inpaintIntentStorageKey);
    retryIntentRef.current.clear();
    applicationIntentRef.current.clear();
    void load();
  }, [fullEditIntentStorageKey, imageIntentStorageKey, inpaintIntentStorageKey, load, target.id, translationIntentStorageKey, updateMaskDirty]);
  useEffect(() => {
    if (!applicationTargetStaleVersion || !target.updatedAt) return;
    const currentTimestamp = Date.parse(target.updatedAt);
    const confirmedTimestamp = Date.parse(applicationTargetStaleVersion);
    if (Number.isFinite(currentTimestamp) && Number.isFinite(confirmedTimestamp)
      && currentTimestamp >= confirmedTimestamp) {
      setApplicationTargetStaleVersion(null);
    }
  }, [applicationTargetStaleVersion, target.updatedAt]);
  const workflowPollInterval = aiMediaWorkflowPollInterval(workflows);
  useEffect(() => {
    if (!workflowPollInterval) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || workflowPollingRef.current || document.visibilityState === 'hidden') return;
      workflowPollingRef.current = true;
      try {
        await load(true);
        if (!cancelled) await refreshActiveWorkflows();
      } finally {
        workflowPollingRef.current = false;
      }
    };
    const timer = window.setInterval(
      () => void poll(),
      workflowPollInterval,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load, refreshActiveWorkflows, workflowPollInterval]);

  const selected = useMemo(() => (
    candidateSource
    && context
    && candidateSource.sourceCaptureSnapshotId === context.snapshot.id
      ? candidateSource
      : context?.inputs.find((input) => input.sourceMediaKey === selectedKey) || null
  ), [candidateSource, context, selectedKey]);
  useEffect(() => {
    setCandidateSource((current) => current && context
      && current.sourceCaptureSnapshotId === context.snapshot.id
      ? current
      : null);
  }, [context?.snapshot.id]);
  useEffect(() => {
    if (operation === 'INPAINT') setMaskReady(false);
  }, [candidateSource?.sourceMediaKey, operation, selectedKey]);
  useEffect(() => {
    if (!maskDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [maskDirty]);
  useEffect(() => {
    const handlePopState = () => {
      const guard = maskHistoryGuardRef.current;
      if (guard.suppressNextPop) {
        guard.suppressNextPop = false;
        guard.token = null;
        if (maskDirtyRef.current) {
          guard.token = idempotencyKey('mask-draft');
          window.history.pushState(maskHistoryState(guard.token), '', window.location.href);
        }
        return;
      }
      if (!maskDirtyRef.current || !guard.token) return;
      if (!confirmAiImageMaskDraftDiscard(true, (message) => window.confirm(message))) {
        window.history.pushState(maskHistoryState(guard.token), '', window.location.href);
        return;
      }
      guard.token = null;
      updateMaskDirty(false);
      window.setTimeout(() => window.history.back(), 0);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      const guard = maskHistoryGuardRef.current;
      const shouldRemoveGuard = Boolean(
        guard.token
        && !guard.suppressNextPop
        && window.history.state?.[AI_MASK_HISTORY_GUARD_KEY] === guard.token,
      );
      guard.token = null;
      guard.suppressNextPop = false;
      if (shouldRemoveGuard) window.history.back();
    };
  }, [updateMaskDirty]);
  const currentReadiness = operationReadiness(operation);
  const canCreateCurrentOperation = Boolean(
    capabilities?.webMediaEnabled
    && currentReadiness?.ready,
  );
  const refreshQuietly = useCallback(async () => {
    try {
      await load(true);
    } catch {
      // The next manual refresh can recover without changing the mutation result.
    }
  }, [load]);

  async function ensureSelectedSourceAsset(requireEditReady = false): Promise<AiMediaInternalizedAsset | null> {
    if (!selected) return null;
    if (selected.assetId && selected.assetUrl && selected.mimeType && (!requireEditReady || selected.editReady)) {
      return {
        id: selected.assetId,
        url: selected.assetUrl,
        mimeType: selected.mimeType,
        width: selected.width,
        height: selected.height,
        editReady: selected.editReady,
      };
    }
    const internalized = await api.post<AiMediaInternalizedAsset>(
      `/api/ai-images/contexts/collect/${encodeURIComponent(target.id)}/internalize`,
      { sourceMediaKey: selected.sourceMediaKey, purpose: requireEditReady ? 'EDIT' : 'GENERAL' },
    );
    if (internalized.code !== 1 || !internalized.data?.id) {
      toast({ title: '源图保存失败', description: internalized.msg, variant: 'destructive' });
      await refreshQuietly();
      return null;
    }
    const asset = internalized.data;
    setContext((current) => {
      if (!current) return current;
      const next = {
        ...current,
        inputs: current.inputs.map((input) => input.sourceMediaKey === selected.sourceMediaKey
        ? {
            ...input,
            assetId: asset.id,
            assetUrl: asset.url,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            editReady: asset.editReady,
            compatibleAssetIds: [...new Set([
              ...(input.compatibleAssetIds || []),
              ...(input.assetId ? [input.assetId] : []),
              asset.id,
            ])],
          }
        : input),
      };
      contextRef.current = next;
      return next;
    });
    return asset;
  }

  async function prepareInpaintSource() {
    if (!selected || preparingSource) return;
    setPreparingSource(true);
    try {
      const asset = await ensureSelectedSourceAsset(true);
      if (asset) toast({ title: '源图已准备，可开始绘制遮罩' });
    } catch (caught) {
      toast({
        title: '源图准备失败',
        description: caught instanceof Error ? caught.message : '网络错误',
        variant: 'destructive',
      });
    } finally {
      setPreparingSource(false);
    }
  }

  function confirmMaskDraftDiscard() {
    return confirmAiImageMaskDraftDiscard(maskDirty, (message) => window.confirm(message));
  }

  function selectOperation(next: AiMediaOperation) {
    if (next === operation) return;
    if (operation === 'INPAINT' && !confirmMaskDraftDiscard()) return;
    if (operation === 'INPAINT') {
      updateMaskDirty(false);
      setMaskReady(false);
      setMaskResetNonce((current) => current + 1);
    }
    if (next !== 'FULL_EDIT' && next !== 'INPAINT') setCandidateSource(null);
    setOperation(next);
  }

  function selectSource(nextSourceMediaKey: string) {
    if (!candidateSource && nextSourceMediaKey === selectedKey) return;
    if (operation === 'INPAINT' && !confirmMaskDraftDiscard()) return;
    if (operation === 'INPAINT') {
      updateMaskDirty(false);
      setMaskReady(false);
      setMaskResetNonce((current) => current + 1);
    }
    setCandidateSource(null);
    setSelectedKey(nextSourceMediaKey);
  }

  function selectCandidateSource(
    workflow: AiMediaWorkflow,
    output: NonNullable<AiMediaWorkflowJob['assets']>[number],
    nextOperation: 'FULL_EDIT' | 'INPAINT',
  ) {
    if (
      !context
      || workflow.status !== 'SUCCEEDED'
      || (workflow.operation !== 'FULL_EDIT' && workflow.operation !== 'INPAINT')
      || !output.editReady
      || output.sourceCaptureSnapshotId !== context.snapshot.id
    ) return;
    if (operation === 'INPAINT' && !confirmMaskDraftDiscard()) return;
    updateMaskDirty(false);
    setMaskReady(false);
    setMaskResetNonce((current) => current + 1);
    setCandidateSource({
      sourceMediaKey: `candidate:${output.id}`,
      role: 'generated-candidate',
      sourceUrl: output.url,
      assetId: output.id,
      assetUrl: output.url,
      mimeType: output.mimeType || null,
      width: output.width ?? null,
      height: output.height ?? null,
      editReady: true,
      sourceCaptureSnapshotId: output.sourceCaptureSnapshotId,
      contextSkuKey: workflow.contextSkuKey,
      contextSlotKey: workflow.contextSlotKey,
    });
    setOperation(nextOperation);
  }

  async function submit() {
    if (!selected || submitting) return;
    const readiness = operationReadiness(operation);
    if (!capabilities || !readiness) {
      toast({ title: '当前操作状态未知', description: '无法确认 AI 媒体能力，请刷新后重试', variant: 'destructive' });
      return;
    }
    if (!readiness.ready) {
      toast({
        title: '当前操作不可用',
        description: describeAiMediaReadiness(operation, readiness),
        variant: 'destructive',
      });
      return;
    }
    if (capabilities && !capabilities.webMediaEnabled) {
      toast({ title: 'Web 媒体工作台未启用', description: '当前账号只能查看已有任务', variant: 'destructive' });
      return;
    }
    if (operation === 'IMAGE_TO_IMAGE' && !prompt.trim()) return;
    if ((operation === 'FULL_EDIT' || operation === 'INPAINT') && !editPrompt.trim()) return;
    if (operation === 'INPAINT' && !maskReady) {
      toast({ title: '遮罩尚未完成', description: '请保留一部分原图，并绘制需要重绘的区域', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const storage = browserSessionStorage();
    try {
      const sourceAsset = await ensureSelectedSourceAsset(operation === 'FULL_EDIT' || operation === 'INPAINT');
      const assetId = sourceAsset?.id || null;
      if (!assetId) return;

      if (operation === 'IMAGE_TRANSLATE') {
        const normalizedTerms = normalizeImageTranslationTerminologies(terminologies);
        const normalizedSourceLanguage = normalizeLanguageForFingerprint(sourceLanguage);
        const normalizedTargetLanguage = normalizeLanguageForFingerprint(targetLanguage);
        const fingerprint = JSON.stringify({
          operation,
          assetId: assetId.trim(),
          sourceLanguage: normalizedSourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          translationHint: translationHint.trim(),
          normalizedTerms,
          targetId: target.id,
        });
        const intent = resolveWorkflowSubmissionIntent(
          translationIntentRef.current
            || loadWorkflowSubmissionIntent(storage, translationIntentStorageKey),
          fingerprint,
          () => idempotencyKey('image-translation'),
        );
        translationIntentRef.current = intent;
        saveWorkflowSubmissionIntent(storage, translationIntentStorageKey, intent);
        const payload = buildImageTranslationWorkflowRequest({
          sourceAssetId: assetId,
          sourceLanguage: normalizedSourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          domainHint: translationHint,
          terminologies: normalizedTerms,
          idempotencyKey: intent.idempotencyKey,
          contextId: target.id,
        });
        const result = await api.post<AiMediaWorkflow>('/api/ai-images/workflows', payload);
        if (result.code !== 1) {
          if (isDefinitiveWorkflowSubmissionFailure(result.code)) {
            translationIntentRef.current = null;
            clearWorkflowSubmissionIntent(storage, translationIntentStorageKey);
          }
          toast({ title: '图片翻译任务提交失败', description: result.msg, variant: 'destructive' });
          await refreshQuietly();
          return;
        }
        translationIntentRef.current = null;
        clearWorkflowSubmissionIntent(storage, translationIntentStorageKey);
        toast({ title: '图片翻译任务已提交' });
        await refreshQuietly();
        return;
      }

      if (operation === 'FULL_EDIT' || operation === 'INPAINT') {
        let maskAssetId: string | null = null;
        if (operation === 'INPAINT') {
          const maskDataUrl = await maskEditorRef.current?.exportMaskDataUrl();
          if (!maskDataUrl) throw new Error('遮罩 PNG 尚未准备完成');
          const mask = await api.post<AiImageEditMaskAsset>(
            `/api/ai-images/contexts/collect/${encodeURIComponent(target.id)}/edit-masks`,
            {
              sourceAssetId: assetId,
              skuKey: selected.contextSkuKey ?? null,
              slotKey: selected.contextSlotKey ?? null,
              maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
              maskDataUrl,
            },
          );
          if (mask.code !== 1 || !mask.data?.id) {
            toast({ title: '遮罩保存失败', description: mask.msg, variant: 'destructive' });
            await refreshQuietly();
            return;
          }
          maskAssetId = mask.data.id;
        }

        const fingerprint = JSON.stringify({
          operation,
          assetId: assetId.trim(),
          maskAssetId,
          editPrompt: editPrompt.trim(),
          editNegativePrompt: editNegativePrompt.trim(),
          targetId: target.id,
          contextSkuKey: selected.contextSkuKey ?? null,
          contextSlotKey: selected.contextSlotKey ?? null,
        });
        const intentRef = operation === 'FULL_EDIT' ? fullEditIntentRef : inpaintIntentRef;
        const storageKey = operation === 'FULL_EDIT' ? fullEditIntentStorageKey : inpaintIntentStorageKey;
        const intent = resolveWorkflowSubmissionIntent(
          intentRef.current || loadWorkflowSubmissionIntent(storage, storageKey),
          fingerprint,
          () => idempotencyKey(operation === 'FULL_EDIT' ? 'full-edit' : 'inpaint'),
        );
        intentRef.current = intent;
        saveWorkflowSubmissionIntent(storage, storageKey, intent);
        const payload = buildAiImageEditWorkflowRequest({
          operation,
          sourceAssetId: assetId,
          maskAssetId,
          userPrompt: editPrompt,
          userNegativePrompt: editNegativePrompt,
          idempotencyKey: intent.idempotencyKey,
          contextId: target.id,
          contextSkuKey: selected.contextSkuKey ?? null,
          contextSlotKey: selected.contextSlotKey ?? null,
        });
        const result = await api.post<AiMediaWorkflow>('/api/ai-images/workflows', payload);
        if (result.code !== 1) {
          if (isDefinitiveWorkflowSubmissionFailure(result.code)) {
            intentRef.current = null;
            clearWorkflowSubmissionIntent(storage, storageKey);
          }
          toast({
            title: operation === 'FULL_EDIT' ? '全图编辑任务提交失败' : '局部重绘任务提交失败',
            description: result.msg,
            variant: 'destructive',
          });
          await refreshQuietly();
          return;
        }
        intentRef.current = null;
        clearWorkflowSubmissionIntent(storage, storageKey);
        if (operation === 'INPAINT') {
          setMaskResetNonce((current) => current + 1);
          updateMaskDirty(false);
        }
        toast({ title: operation === 'FULL_EDIT' ? '全图编辑任务已提交' : '局部重绘任务已提交' });
        await refreshQuietly();
        return;
      }

      const fingerprint = JSON.stringify({ operation, assetId: assetId.trim(), prompt: prompt.trim(), targetId: target.id });
      const intent = resolveWorkflowSubmissionIntent(
        imageIntentRef.current || loadWorkflowSubmissionIntent(storage, imageIntentStorageKey),
        fingerprint,
        () => idempotencyKey('image-to-image'),
      );
      imageIntentRef.current = intent;
      saveWorkflowSubmissionIntent(storage, imageIntentStorageKey, intent);
      const result = await api.post<AiMediaWorkflow>('/api/ai-images/workflows', {
        operation: 'IMAGE_TO_IMAGE', sourceAssetId: assetId, prompt: prompt.trim(), count: 1,
        width: 1024, height: 1024, idempotencyKey: intent.idempotencyKey,
        context: { type: target.type, id: target.id },
      });
      if (result.code !== 1) {
        if (isDefinitiveWorkflowSubmissionFailure(result.code)) {
          imageIntentRef.current = null;
          clearWorkflowSubmissionIntent(storage, imageIntentStorageKey);
        }
        toast({ title: '改图任务提交失败', description: result.msg, variant: 'destructive' });
        await refreshQuietly();
        return;
      }
      imageIntentRef.current = null;
      clearWorkflowSubmissionIntent(storage, imageIntentStorageKey);
      toast({ title: '改图任务已提交' });
      await refreshQuietly();
    } catch (caught) {
      await refreshQuietly();
      toast({
        title: operation === 'IMAGE_TRANSLATE'
          ? '图片翻译任务提交失败'
          : operation === 'FULL_EDIT'
            ? '全图编辑任务提交失败'
            : operation === 'INPAINT'
              ? '局部重绘任务提交失败'
              : '改图任务提交失败',
        description: caught instanceof Error ? caught.message : '网络错误；已保留本次幂等请求，可重试',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function action<TResponse>(
    key: string,
    path: string,
    body: Record<string, unknown>,
    success: string,
    refreshTargetOnConflict = false,
  ): Promise<TResponse | null> {
    if (pendingAction) return null;
    setPendingAction(key);
    try {
      const result = await api.post<TResponse>(path, body);
      if (result.code !== 1) {
        if (refreshTargetOnConflict && isMediaMutationConflict(result)) {
          toast({ title: '商品图片已变化', description: '已刷新最新图片，请重新确认后再操作', variant: 'destructive' });
          try { await onConflictRefresh(); } catch { /* the workflow refresh remains authoritative */ }
          await refreshQuietly();
          return null;
        }
        toast({ title: '操作失败', description: result.msg, variant: 'destructive' });
        return null;
      }
      toast({ title: success });
      await refreshQuietly();
      return result.data || null;
    } catch (caught) {
      await refreshQuietly();
      toast({ title: '操作失败', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function retryWorkflow(workflow: AiMediaWorkflow) {
    const fingerprint = `${workflow.id}:${workflow.revision}`;
    const storage = browserSessionStorage();
    const storageKey = intentStorageKey(target.id, `retry:${workflow.id}`);
    const intent = resolveWorkflowSubmissionIntent(
      retryIntentRef.current.get(workflow.id)
        || loadWorkflowSubmissionIntent(storage, storageKey),
      fingerprint,
      () => idempotencyKey('retry'),
    );
    retryIntentRef.current.set(workflow.id, intent);
    saveWorkflowSubmissionIntent(storage, storageKey, intent);
    const result = await action<AiMediaWorkflow>(
      `retry:${workflow.id}`,
      `/api/ai-images/workflows/${workflow.id}/retry`,
      { expectedRevision: workflow.revision, idempotencyKey: intent.idempotencyKey },
      '已重新排队',
    );
    if (result) {
      retryIntentRef.current.delete(workflow.id);
      clearWorkflowSubmissionIntent(storage, storageKey);
    }
  }

  async function loadMoreHistory() {
    const cursor = historyNextCursorRef.current;
    if (!cursor || historyLoadingMore) return;
    const requestTargetId = target.id;
    const generation = ++historyPageGenerationRef.current;
    setHistoryLoadingMore(true);
    try {
      const result = await api.get<AiMediaWorkflowPage | AiMediaWorkflow[]>(
        `/api/ai-images/workflows?contextType=collect&contextId=${encodeURIComponent(requestTargetId)}&limit=20&pageVersion=1&cursor=${encodeURIComponent(cursor)}`,
      );
      if (
        generation !== historyPageGenerationRef.current
        || targetIdRef.current !== requestTargetId
        || historyNextCursorRef.current !== cursor
      ) return;
      const page = result.code === 1 ? normalizeAiMediaWorkflowPage(result.data) : null;
      if (!page) {
        toast({ title: '历史加载失败', description: result.msg || '服务端返回了无效分页结果', variant: 'destructive' });
        return;
      }
      historyExpandedRef.current = true;
      historyNextCursorRef.current = page.nextCursor;
      setHistoryNextCursor(page.nextCursor);
      setWorkflows((current) => appendAiMediaWorkflowHistoryPage(current, page.items));
    } catch (caught) {
      if (generation === historyPageGenerationRef.current && targetIdRef.current === requestTargetId) {
        toast({ title: '历史加载失败', description: caught instanceof Error ? caught.message : '网络错误', variant: 'destructive' });
      }
    } finally {
      if (generation === historyPageGenerationRef.current && targetIdRef.current === requestTargetId) {
        setHistoryLoadingMore(false);
      }
    }
  }

  function toggleCandidateComparison(workflowId: string) {
    setComparisonWorkflowIds((current) => current.includes(workflowId)
      ? current.filter((id) => id !== workflowId)
      : [...current.slice(-1), workflowId]);
  }

  async function loadMoreApplicationHistory() {
    const beforeSequence = applicationLedger?.nextBeforeSequence;
    if (!beforeSequence || applicationLoadingMore) return;
    const requestTargetId = target.id;
    const generation = ++applicationPageGenerationRef.current;
    setApplicationLoadingMore(true);
    try {
      const page = await readApplicationLedger(requestTargetId, { beforeSequence });
      if (generation !== applicationPageGenerationRef.current || targetIdRef.current !== requestTargetId) return;
      if (!page) {
        setApplicationLedgerError('应用记录分页暂时无法读取，请稍后重试');
        toast({ title: '应用记录加载失败', description: '服务端返回了无效分页结果', variant: 'destructive' });
        return;
      }
      reconcileApplicationTargetVersion(page.target.updatedAt);
      setApplicationLedgerError('');
      setApplicationLedger((current) => current
        ? appendAiMediaApplicationLedgerPage(current, page)
        : page);
    } finally {
      if (generation === applicationPageGenerationRef.current && targetIdRef.current === requestTargetId) {
        setApplicationLoadingMore(false);
      }
    }
  }

  async function applyWorkflow(
    workflow: AiMediaWorkflow,
    job: AiMediaWorkflow['jobs'][number],
    mode: AiMediaApplicationMode = 'append',
  ) {
    if (!context || !isAiMediaWorkflowInputCurrent(
      workflow,
      context.inputs,
      context.snapshot.id,
    )) {
      toast({ title: '源图版本已变化', description: '请基于当前采集快照重新生成候选图', variant: 'destructive' });
      await refreshQuietly();
      return;
    }
    if (applicationTargetStaleVersion) {
      toast({
        title: '商品图片尚未同步',
        description: '服务端已完成上一项图片操作，请先刷新商品图片再继续应用候选',
        variant: 'destructive',
      });
      return;
    }
    if (!target.updatedAt) {
      toast({ title: '商品版本缺失', description: '请刷新商品后重试', variant: 'destructive' });
      await onConflictRefresh();
      return;
    }
    if (mediaDraftDirty) {
      toast({ title: '图片筛选尚未保存', description: '请先保存或放弃当前图片筛选，再应用候选图' });
      return;
    }
    if (!capabilities?.applications?.applyEnabled) {
      toast({ title: '候选应用当前关闭', description: '已有应用历史与回滚仍可使用' });
      return;
    }
    if (mode === 'replace' && (
      workflow.operation !== 'IMAGE_TO_IMAGE'
      || !capabilities.applications.replaceOperations.includes(workflow.operation)
    )) {
      toast({ title: '当前候选不允许替换发布图', variant: 'destructive' });
      return;
    }

    const requestTargetId = target.id;
    const requestTargetUpdatedAt = target.updatedAt;
    const storage = browserSessionStorage();
    const storageKey = aiMediaApplicationIntentStorageKey(
      requestTargetId,
      'apply',
      `${workflow.id}:${mode}`,
    );
    const fingerprint = JSON.stringify({
      kind: 'APPLY', workflowId: workflow.id, jobId: job.id, mode,
      workflowRevision: workflow.revision, targetId: requestTargetId, targetUpdatedAt: requestTargetUpdatedAt,
    });
    const intent = resolveAiMediaApplicationIntent(
      applicationIntentRef.current.get(storageKey) || loadAiMediaApplicationIntent(storage, storageKey),
      fingerprint,
      () => idempotencyKey(`application-${mode}`),
    );
    applicationIntentRef.current.set(storageKey, intent);
    saveAiMediaApplicationIntent(storage, storageKey, intent);
    const clearIntent = () => {
      applicationIntentRef.current.delete(storageKey);
      clearAiMediaApplicationIntent(storage, storageKey);
    };
    const successTitle = mode === 'replace'
      ? '候选图已替换全部发布图'
      : workflow.operation === 'IMAGE_TRANSLATE'
        ? '翻译候选图已追加到商品'
        : workflow.operation === 'FULL_EDIT'
          ? '全图编辑候选已追加到商品'
          : workflow.operation === 'INPAINT'
            ? '局部重绘候选已追加到商品'
            : '候选图已追加到商品';
    const recover = async (message = '') => {
      const ledger = await refreshApplicationLedger(requestTargetId, intent.operationKey);
      if (targetIdRef.current !== requestTargetId) return;
      const recovery = resolveAiMediaApplicationRecovery({
        kind: 'APPLY', workflowId: workflow.id, operationKey: intent.operationKey,
        recoveredOperation: ledger?.recoveredOperation || null,
      });
      if (recovery === 'rolled_back' && ledger) {
        clearIntent();
        const targetSynchronized = await synchronizeConfirmedApplicationTarget(
          requestTargetId,
          ledger.target.updatedAt,
        );
        await refreshQuietly();
        if (targetIdRef.current !== requestTargetId) return;
        toast(targetSynchronized
          ? {
            title: '候选应用已被回滚',
            description: '服务器记录显示此次候选应用已经撤销，商品图片已刷新',
            variant: 'destructive',
          }
          : {
            title: '候选应用已回滚，商品图片待同步',
            description: '服务端状态已确认，但当前页面刷新失败；图片应用与回滚已暂停，请重新刷新商品图片',
            variant: 'destructive',
          });
        return;
      }
      if (recovery === 'confirmed' && ledger?.recoveredOperation) {
        clearIntent();
        const projection = applicationResultAsLegacyApply({
          contractVersion: ledger.contractVersion,
          application: ledger.recoveredOperation,
          target: ledger.target,
          replayed: true,
        }, requestTargetId);
        if (projection) onApplied?.(projection);
        else await onConflictRefresh();
        toast({ title: successTitle });
        await refreshQuietly();
        return;
      }
      if (recovery === 'conflict') {
        clearIntent();
        try { await onConflictRefresh(); } catch { /* the ledger remains authoritative */ }
        await refreshQuietly();
        toast({ title: '候选应用状态已变化', description: message || '请刷新后重新确认', variant: 'destructive' });
        return;
      }
      toast({
        title: '候选应用状态待确认',
        description: message || '暂时无法确认服务器结果；已保留本次操作，可安全重试',
        variant: 'destructive',
      });
    };

    setPendingAction(`apply:${workflow.id}:${mode}`);
    try {
      const body = buildAiMediaApplicationRequest({
        mode,
        operationKey: intent.operationKey,
        expectedWorkflowRevision: workflow.revision,
        expectedTargetUpdatedAt: requestTargetUpdatedAt,
        replaceConfirmed: mode === 'replace',
      });
      const execution = await runMediaMutation(() => api.post<unknown>(
        `/api/ai-images/workflows/${encodeURIComponent(workflow.id)}/applications`,
        body,
      ));
      if (!execution.started) {
        clearIntent();
        if (targetIdRef.current === requestTargetId) {
          toast({ title: '图片正在保存', description: '请等待当前图片操作完成后重试' });
        }
        return;
      }
      const response = execution.value!;
      if (targetIdRef.current !== requestTargetId) {
        if (response.code === 1) clearIntent();
        return;
      }
      const normalized = response.code === 1
        ? normalizeAiMediaApplicationMutationResult(response.data)
        : null;
      if (normalized
        && normalized.application.kind === 'APPLY'
        && normalized.application.workflowId === workflow.id
        && normalized.application.operationKey === intent.operationKey
        && normalized.target.id === requestTargetId) {
        const responseRecovery = resolveAiMediaApplicationRecovery({
          kind: 'APPLY', workflowId: workflow.id, operationKey: intent.operationKey,
          recoveredOperation: normalized.application,
        });
        if (responseRecovery === 'rolled_back') {
          clearIntent();
          const targetSynchronized = await synchronizeConfirmedApplicationTarget(
            requestTargetId,
            normalized.target.updatedAt,
          );
          await refreshApplicationLedger(requestTargetId);
          await refreshQuietly();
          if (targetIdRef.current !== requestTargetId) return;
          toast(targetSynchronized
            ? {
              title: '候选应用已被回滚',
              description: '服务器记录显示此次候选应用已经撤销，商品图片已刷新',
              variant: 'destructive',
            }
            : {
              title: '候选应用已回滚，商品图片待同步',
              description: '服务端状态已确认，但当前页面刷新失败；图片应用与回滚已暂停，请重新刷新商品图片',
              variant: 'destructive',
            });
          return;
        }
        clearIntent();
        const projection = applicationResultAsLegacyApply(normalized, requestTargetId);
        if (projection) onApplied?.(projection);
        else await onConflictRefresh();
        toast({ title: successTitle });
        await refreshApplicationLedger(requestTargetId);
        await refreshQuietly();
        return;
      }
      if (isDefinitiveAiMediaApplicationFailure(response.code)) {
        clearIntent();
        if (isMediaMutationConflict(response)) {
          try { await onConflictRefresh(); } catch { /* workflow refresh remains available */ }
          await refreshQuietly();
        }
        toast({ title: '候选应用失败', description: response.msg, variant: 'destructive' });
        return;
      }
      await recover(response.msg);
    } catch (caught) {
      await recover(caught instanceof Error ? caught.message : '网络响应未确认');
    } finally {
      setPendingAction(null);
      setReplaceConfirmWorkflowId(null);
    }
  }

  async function rollbackApplication(application: AiMediaApplicationMutation) {
    const ledger = applicationLedger;
    if (!ledger || ledger.frontier?.id !== application.id || !application.rollbackEligible) return;
    if (applicationTargetStaleVersion) {
      toast({
        title: '商品图片尚未同步',
        description: '请先刷新商品图片，再继续回滚应用记录',
        variant: 'destructive',
      });
      return;
    }
    if (mediaDraftDirty) {
      toast({ title: '图片筛选尚未保存', description: '请先保存或放弃当前图片筛选，再回滚应用' });
      return;
    }
    if (!capabilities?.applications?.rollbackEnabled) {
      toast({ title: '应用回滚当前不可用', variant: 'destructive' });
      return;
    }
    const requestTargetId = target.id;
    if (ledger.target.id !== requestTargetId) return;
    const storage = browserSessionStorage();
    const storageKey = aiMediaApplicationIntentStorageKey(requestTargetId, 'rollback', application.id);
    const fingerprint = JSON.stringify({
      kind: 'ROLLBACK', applicationId: application.id, applicationRevision: application.revision,
      workflowId: application.workflowId, workflowRevision: application.workflowRevisionAfter,
      targetId: requestTargetId, targetUpdatedAt: ledger.target.updatedAt,
    });
    const intent = resolveAiMediaApplicationIntent(
      applicationIntentRef.current.get(storageKey) || loadAiMediaApplicationIntent(storage, storageKey),
      fingerprint,
      () => idempotencyKey('application-rollback'),
    );
    applicationIntentRef.current.set(storageKey, intent);
    saveAiMediaApplicationIntent(storage, storageKey, intent);
    const clearIntent = () => {
      applicationIntentRef.current.delete(storageKey);
      clearAiMediaApplicationIntent(storage, storageKey);
    };
    const recover = async (message = '') => {
      const recoveredLedger = await refreshApplicationLedger(requestTargetId, intent.operationKey);
      if (targetIdRef.current !== requestTargetId) return;
      const recovery = resolveAiMediaApplicationRecovery({
        kind: 'ROLLBACK',
        workflowId: application.workflowId,
        applicationId: application.id,
        operationKey: intent.operationKey,
        recoveredOperation: recoveredLedger?.recoveredOperation || null,
      });
      if (recovery === 'confirmed') {
        clearIntent();
        const targetSynchronized = recoveredLedger
          ? await synchronizeConfirmedApplicationTarget(requestTargetId, recoveredLedger.target.updatedAt)
          : false;
        await refreshQuietly();
        if (targetIdRef.current !== requestTargetId) return;
        toast(targetSynchronized
          ? { title: '已回滚此次图片应用' }
          : {
            title: '回滚已完成，商品图片待同步',
            description: '服务端已完成回滚，但当前页面刷新失败；图片应用与回滚已暂停，请重新刷新商品图片',
            variant: 'destructive',
          });
        return;
      }
      if (recovery === 'conflict') {
        clearIntent();
        try { await onConflictRefresh(); } catch { /* the ledger remains authoritative */ }
        await refreshQuietly();
        toast({ title: '回滚状态已变化', description: message || '请刷新后重新确认', variant: 'destructive' });
        return;
      }
      toast({
        title: '回滚状态待确认',
        description: message || '暂时无法确认服务器结果；已保留本次操作，可安全重试',
        variant: 'destructive',
      });
    };

    setPendingAction(`rollback:${application.id}`);
    try {
      const execution = await runMediaMutation(() => api.post<unknown>(
        `/api/ai-images/applications/${encodeURIComponent(application.id)}/rollback`,
        buildAiMediaApplicationRollbackRequest({
          application,
          operationKey: intent.operationKey,
          expectedTargetUpdatedAt: ledger.target.updatedAt,
        }),
      ));
      if (!execution.started) {
        clearIntent();
        if (targetIdRef.current === requestTargetId) {
          toast({ title: '图片正在保存', description: '请等待当前图片操作完成后重试' });
        }
        return;
      }
      const response = execution.value!;
      if (targetIdRef.current !== requestTargetId) {
        if (response.code === 1) clearIntent();
        return;
      }
      const normalized = response.code === 1
        ? normalizeAiMediaApplicationMutationResult(response.data)
        : null;
      if (normalized
        && normalized.application.kind === 'ROLLBACK'
        && normalized.application.rollbackOfId === application.id
        && normalized.application.operationKey === intent.operationKey
        && normalized.target.id === requestTargetId) {
        clearIntent();
        await refreshApplicationLedger(requestTargetId);
        const targetSynchronized = await synchronizeConfirmedApplicationTarget(
          requestTargetId,
          normalized.target.updatedAt,
        );
        await refreshQuietly();
        if (targetIdRef.current !== requestTargetId) return;
        toast(targetSynchronized
          ? { title: '已回滚此次图片应用' }
          : {
            title: '回滚已完成，商品图片待同步',
            description: '服务端已完成回滚，但当前页面刷新失败；图片应用与回滚已暂停，请重新刷新商品图片',
            variant: 'destructive',
          });
        return;
      }
      if (isDefinitiveAiMediaApplicationFailure(response.code)) {
        clearIntent();
        if (isMediaMutationConflict(response)) {
          try { await onConflictRefresh(); } catch { /* application history remains available */ }
          await refreshApplicationLedger(requestTargetId);
          await refreshQuietly();
        }
        toast({ title: '回滚失败', description: response.msg, variant: 'destructive' });
        return;
      }
      await recover(response.msg);
    } catch (caught) {
      await recover(caught instanceof Error ? caught.message : '网络响应未确认');
    } finally {
      setPendingAction(null);
      setRollbackConfirmApplicationId(null);
    }
  }

  async function refreshApplicationHistory() {
    if (applicationLoading) return;
    setApplicationLoading(true);
    try {
      const ledger = await refreshApplicationLedger(target.id);
      if (!ledger && targetIdRef.current === target.id) {
        toast({ title: '应用记录刷新失败', variant: 'destructive' });
      }
    } finally {
      if (targetIdRef.current === target.id) setApplicationLoading(false);
    }
  }

  async function refreshStaleApplicationTarget() {
    const staleVersion = applicationTargetStaleVersion;
    const requestTargetId = target.id;
    if (!staleVersion || applicationTargetRefreshing) return;
    setApplicationTargetRefreshing(true);
    try {
      const targetSynchronized = await synchronizeConfirmedApplicationTarget(requestTargetId, staleVersion);
      if (targetIdRef.current !== requestTargetId) return;
      toast(targetSynchronized
        ? { title: '商品图片已同步' }
        : {
          title: '商品图片刷新失败',
          description: '当前页面仍是旧图片状态，图片应用与回滚继续暂停',
          variant: 'destructive',
        });
    } finally {
      if (targetIdRef.current === requestTargetId) setApplicationTargetRefreshing(false);
    }
  }

  const comparisonCandidates = comparisonWorkflowIds.flatMap((workflowId) => {
    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    const job = workflow?.jobs[workflow.jobs.length - 1];
    const output = workflow ? aiMediaWorkflowReviewOutput(workflow, job) : undefined;
    return workflow && output ? [{ workflow, output }] : [];
  });
  const applicationHistoryItems = applicationLedger
    ? [...new Map([
      ...applicationLedger.items.map((application) => [application.id, application] as const),
      ...(applicationLedger.frontier
        ? [[applicationLedger.frontier.id, applicationLedger.frontier] as const]
        : []),
    ]).values()].sort((left, right) => right.targetSequence - left.targetSequence)
    : [];
  const replaceConfirmWorkflow = replaceConfirmWorkflowId
    ? workflows.find((workflow) => workflow.id === replaceConfirmWorkflowId) || null
    : null;
  const rollbackConfirmApplication = rollbackConfirmApplicationId
    ? (applicationLedger?.items.find((application) => application.id === rollbackConfirmApplicationId)
      || (applicationLedger?.frontier?.id === rollbackConfirmApplicationId
        ? applicationLedger.frontier
        : null))
    : null;

  if (loading) return <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载 AI 图片工作流</div>;

  return (
    <section className="space-y-4 border-t pt-4" aria-label="AI 图片工作流">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-medium">AI 图片工作流</h3><p className="mt-1 text-xs text-muted-foreground">从当前商品源图创建候选结果，审核前不会修改商品图片。</p></div>
        <Button type="button" size="icon" variant="ghost" onClick={() => void load(true, true, true)} title="刷新任务与能力状态" aria-label="刷新任务与能力状态"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {disabled ? <p className="text-sm text-muted-foreground">新建 AI 图片任务当前关闭，已有任务仍可查看和处理。</p> : null}
      {capabilities && !capabilities.webMediaEnabled ? <p className="text-sm text-muted-foreground">Web 媒体工具当前关闭，已有任务仍可查看和处理。</p> : null}
      {!disabled && !context?.inputs.length ? <p className="text-sm text-muted-foreground">当前采集快照没有可用于 AI 图片处理的商品级图片。</p> : null}

      <SourceAiMediaPlanningPanel
        targetId={target.id}
        targetUpdatedAt={target.updatedAt}
        enabled
        planningEnabled={Boolean(capabilities?.webMediaEnabled && capabilities?.workflowEnabled)}
        selectedSkuKeys={selectedSkuKeys}
        mediaDraftDirty={mediaDraftDirty || Boolean(applicationTargetStaleVersion)}
        mediaMutationBusy={mediaMutationBusy}
        runMediaMutation={runMediaMutation}
        onApplied={onApplied}
        onConflictRefresh={synchronizeApplicationTarget}
      />

      {!disabled && context?.inputs.length ? <>
      <div className="flex flex-wrap gap-1 rounded-md border p-1" role="group" aria-label="AI 图片操作">
        <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm ${operation === 'IMAGE_TO_IMAGE' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-pressed={operation === 'IMAGE_TO_IMAGE'} onClick={() => selectOperation('IMAGE_TO_IMAGE')}>
          <ImageIcon className="h-4 w-4" />参考改图
        </button>
        <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm ${operation === 'IMAGE_TRANSLATE' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-pressed={operation === 'IMAGE_TRANSLATE'} onClick={() => selectOperation('IMAGE_TRANSLATE')}>
          <Languages className="h-4 w-4" />图片翻译
        </button>
        <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm ${operation === 'FULL_EDIT' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-pressed={operation === 'FULL_EDIT'} onClick={() => selectOperation('FULL_EDIT')}>
          <WandSparkles className="h-4 w-4" />全图编辑
        </button>
        <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm ${operation === 'INPAINT' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-pressed={operation === 'INPAINT'} onClick={() => selectOperation('INPAINT')}>
          <ScanLine className="h-4 w-4" />局部重绘
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {candidateSource ? <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 border-primary bg-muted" title="当前使用历史候选作为编辑源">
          <img src={imageUrl(candidateSource.assetUrl || candidateSource.sourceUrl)} alt="历史编辑候选源图" className="h-full w-full object-cover" />
          <span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">候选源</span>
          <button type="button" className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground" title="恢复采集源图" aria-label="恢复采集源图" onClick={() => selectSource(selectedKey)}><X className="h-3.5 w-3.5" /></button>
        </div> : null}
        {context.inputs.map((input) => (
          <button key={input.sourceMediaKey} type="button" onClick={() => selectSource(input.sourceMediaKey)}
            className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-muted ${!candidateSource && selectedKey === input.sourceMediaKey ? 'border-primary' : 'border-transparent'}`}
            title={operation === 'IMAGE_TRANSLATE' ? '选择为翻译源图' : operation === 'INPAINT' ? '选择为局部重绘源图' : '选择为编辑源图'} aria-pressed={!candidateSource && selectedKey === input.sourceMediaKey} aria-label={`选择商品源图 ${input.sourceMediaKey}`}>
            <img src={imageUrl(input.assetUrl || input.sourceUrl)} alt="商品源图" className="h-full w-full object-cover" />
            {!candidateSource && selectedKey === input.sourceMediaKey ? <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span> : null}
          </button>
        ))}
      </div>

      {operation === 'IMAGE_TO_IMAGE' ? <div>
        <Label htmlFor={`ai-media-prompt-${target.id}`}>改图要求</Label>
        <textarea id={`ai-media-prompt-${target.id}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={8000}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div> : operation === 'IMAGE_TRANSLATE' ? <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`ai-translation-source-${target.id}`}>源语言</Label>
            <select id={`ai-translation-source-${target.id}`} value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="zh">中文</option><option value="en">英语</option><option value="ru">俄语</option>
            </select>
          </div>
          <div>
            <Label htmlFor={`ai-translation-target-${target.id}`}>目标语言</Label>
            <select id={`ai-translation-target-${target.id}`} value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="ru">俄语</option><option value="en">英语</option><option value="zh">中文</option>
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor={`ai-translation-hint-${target.id}`}>翻译要求</Label>
          <textarea id={`ai-translation-hint-${target.id}`} value={translationHint} onChange={(event) => setTranslationHint(event.target.value)} rows={3} maxLength={2000}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>术语表</Label>
            <Button type="button" size="icon" variant="ghost" title="添加术语" aria-label="添加术语" onClick={() => setTerminologies((current) => [...current, { src: '', tgt: '' }])} disabled={terminologies.length >= 50}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {terminologies.map((term, index) => <div className="grid grid-cols-1 items-center gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:border-0 sm:p-0" key={index}>
            <input value={term.src} aria-label={`术语 ${index + 1} 原文`} placeholder="原文" maxLength={120} onChange={(event) => setTerminologies((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, src: event.target.value } : item))} className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-2 text-sm" />
            <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">→</span>
            <input value={term.tgt} aria-label={`术语 ${index + 1} 译文`} placeholder="译文" maxLength={120} onChange={(event) => setTerminologies((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, tgt: event.target.value } : item))} className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-2 text-sm" />
            <Button type="button" size="icon" variant="ghost" className="justify-self-end" title="删除术语" aria-label={`删除术语 ${index + 1}`} onClick={() => setTerminologies((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>)}
          {!terminologies.length ? <p className="text-xs text-muted-foreground">可选。为品牌、型号或固定商品术语指定译法。</p> : null}
        </div>
      </div> : <div className="space-y-3">
        <div>
          <Label htmlFor={`ai-edit-prompt-${target.id}`}>编辑要求</Label>
          <textarea id={`ai-edit-prompt-${target.id}`} value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} rows={3} maxLength={8000}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        <div>
          <Label htmlFor={`ai-edit-negative-${target.id}`}>排除要求</Label>
          <textarea id={`ai-edit-negative-${target.id}`} value={editNegativePrompt} onChange={(event) => setEditNegativePrompt(event.target.value)} rows={2} maxLength={4000}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        {operation === 'INPAINT' && selected ? selected.assetId && selected.editReady && selected.width && selected.height ? (
          <SourceAiImageMaskEditor
            ref={maskEditorRef}
            sourceUrl={imageUrl(selected.assetUrl || selected.sourceUrl)}
            sourceWidth={selected.width}
            sourceHeight={selected.height}
            resetKey={`${selected.sourceMediaKey}:${selected.assetId}:${selected.width}x${selected.height}:${maskResetNonce}`}
            disabled={submitting}
            onReadyChange={setMaskReady}
            onDirtyChange={updateMaskDirty}
          />
        ) : selected.assetId && selected.editReady ? (
          <p className="text-xs text-destructive">源图缺少可验证的像素尺寸，无法创建局部重绘遮罩。</p>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => void prepareInpaintSource()} disabled={preparingSource || submitting}>
            {preparingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {preparingSource ? '正在准备源图' : '准备遮罩源图'}
          </Button>
        ) : null}
      </div>}
      {!capabilities ? <p className="break-words text-xs text-muted-foreground">无法确认 AI 媒体能力，请刷新后重试。</p>
        : !capabilities.webMediaEnabled ? <p className="break-words text-xs text-muted-foreground">Web 媒体工具当前关闭。</p>
          : !currentReadiness ? <p className="break-words text-xs text-muted-foreground">当前服务未返回该操作的能力状态。</p>
            : !currentReadiness.ready || currentReadiness.testOnly ? <p className="break-words text-xs text-muted-foreground">{describeAiMediaReadiness(operation, currentReadiness)}</p>
              : null}
      <Button type="button" size="sm" onClick={() => void submit()} disabled={submitting || preparingSource || !selected || !canCreateCurrentOperation || (operation === 'IMAGE_TO_IMAGE' && !prompt.trim()) || ((operation === 'FULL_EDIT' || operation === 'INPAINT') && !editPrompt.trim()) || (operation === 'INPAINT' && (!selected.assetId || !maskReady))}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : operation === 'IMAGE_TRANSLATE' ? <Languages className="h-4 w-4" /> : operation === 'FULL_EDIT' ? <WandSparkles className="h-4 w-4" /> : operation === 'INPAINT' ? <ScanLine className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
        {submitting ? '正在提交' : operation === 'IMAGE_TRANSLATE' ? '创建翻译候选' : operation === 'FULL_EDIT' ? '创建全图编辑候选' : operation === 'INPAINT' ? '创建局部重绘候选' : '创建参考改图候选'}
      </Button>
      </> : null}

      <div className="space-y-2" aria-label="图片应用记录">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">应用记录</h4>
            {applicationLedger?.frontier?.rollbackEligible ? <Badge variant="outline">可回滚 1 项</Badge> : null}
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => void refreshApplicationHistory()} disabled={applicationLoading} title="刷新应用记录" aria-label="刷新应用记录">
            {applicationLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {mediaDraftDirty ? <p className="text-xs text-amber-700">当前图片筛选尚未保存，应用、替换和回滚暂不可用。</p> : null}
        {applicationLedgerError ? <p className="text-xs text-destructive">{applicationLedgerError}</p> : null}
        {applicationTargetStaleVersion ? <div className="flex min-w-0 flex-col gap-2 border-l-2 border-amber-500 pl-3 text-xs text-amber-700 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 break-words">服务端已完成图片操作，但当前商品图片尚未同步。应用、替换和回滚已暂停。</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={applicationTargetRefreshing} onClick={() => void refreshStaleApplicationTarget()}>
            {applicationTargetRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {applicationTargetRefreshing ? '正在刷新' : '刷新商品图片'}
          </Button>
        </div> : null}
        {applicationHistoryItems.length ? <div className="divide-y border">
          {applicationHistoryItems.map((application) => {
            const rolledBack = application.kind === 'APPLY' && Boolean(application.rolledBackById);
            const status = application.kind === 'ROLLBACK'
              ? '回滚记录'
              : rolledBack
                ? '已回滚'
                : application.mode === 'replace'
                  ? '已替换'
                  : '已追加';
            const canRollback = applicationLedger?.frontier?.id === application.id
              && application.rollbackEligible;
            return <div key={application.id} className="flex min-w-0 flex-col gap-2 px-3 py-2 text-xs sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">{status}</Badge>
                  {application.contextSkuKey ? <span className="break-all">{application.contextSkuKey}</span> : null}
                  {application.contextSlotKey ? <span className="break-all text-muted-foreground">{application.contextSlotKey}</span> : null}
                </div>
                <p className="mt-1 break-words text-muted-foreground">
                  {new Date(application.createdAt).toLocaleString()} · 发布图 {application.beforeCounts.images} → {application.afterCounts.images}
                  {!canRollback ? ` · ${applicationRollbackReason(application.rollbackReason)}` : ''}
                </p>
              </div>
              {canRollback ? <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={Boolean(pendingAction) || mediaMutationBusy || mediaDraftDirty || Boolean(applicationTargetStaleVersion)} title={applicationTargetStaleVersion ? '请先刷新商品图片' : mediaDraftDirty ? '请先保存或放弃当前图片筛选' : '撤销此次图片应用'} onClick={() => setRollbackConfirmApplicationId(application.id)}><RotateCcw className="h-3.5 w-3.5" />撤销此次应用</Button> : null}
            </div>;
          })}
        </div> : applicationLedger ? <p className="text-sm text-muted-foreground">暂无可逆图片应用记录</p> : null}
        {applicationLedger?.legacyApplications.length ? <div className="divide-y border border-dashed">
          {applicationLedger.legacyApplications.map((application) => <div key={application.jobId} className="px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">历史不可回滚</Badge><span>{new Date(application.appliedAt).toLocaleString()}</span></div>
            <p className="mt-1 text-muted-foreground">该记录创建于可逆应用账本启用前。</p>
          </div>)}
        </div> : null}
        {applicationLedger?.nextBeforeSequence ? <div className="flex justify-center"><Button type="button" size="sm" variant="outline" disabled={applicationLoadingMore} onClick={() => void loadMoreApplicationHistory()}>{applicationLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}{applicationLoadingMore ? '正在加载' : '加载更多应用记录'}</Button></div> : null}
      </div>

      <div className="space-y-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">任务历史</h4>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {comparisonCandidates.length ? <Badge variant="outline">对比 {comparisonCandidates.length}/2</Badge> : null}
            {historyPriorityLoading ? <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" />正在加载任务</Badge> : null}
            {historyPriorityTruncated && !historyPriorityLoading ? <>
              <Badge variant="outline">还有待处理任务</Badge>
              {priorityNextCursorRef.current ? <Button type="button" size="sm" variant="outline" title="加载更多待处理任务" onClick={() => void loadNextPriorityHistoryPage(target.id, priorityNextCursorRef.current!)}><ChevronDown className="h-3.5 w-3.5" />加载待处理任务</Button> : null}
            </> : null}
          </div>
        </div>
        {comparisonCandidates.length ? <div className="grid min-w-0 gap-2 sm:grid-cols-2" aria-label="候选图对比">
          {comparisonCandidates.map(({ workflow, output }) => <div key={workflow.id} className="min-w-0 rounded-md border p-2">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-medium">{workflowOperationLabel(workflow.operation)} · {workflowScopeLabel(workflow)} · {new Date(workflow.createdAt).toLocaleString()}</span>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="移出对比" aria-label="移出对比" onClick={() => toggleCandidateComparison(workflow.id)}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <a href={imageUrl(output.url)} target="_blank" rel="noreferrer" className="block aspect-[4/3] w-full overflow-hidden rounded border bg-muted" title="打开候选图">
              <img src={imageUrl(output.url)} alt={`${workflowOperationLabel(workflow.operation)}对比候选`} loading="lazy" className="h-full w-full object-contain" />
            </a>
          </div>)}
        </div> : null}
        {!workflows.length ? <p className="text-sm text-muted-foreground">暂无 AI 图片任务</p> : workflows.map((workflow) => {
          const job = workflow.jobs[workflow.jobs.length - 1];
          const output = aiMediaWorkflowReviewOutput(workflow, job);
          const source = workflow.inputs.find((input) => input.role === 'REFERENCE')
            || workflow.inputs.find((input) => input.role !== 'MASK');
          const mask = workflow.inputs.find((input) => input.role === 'MASK');
          const sourceIsCurrent = Boolean(context) && isAiMediaWorkflowInputCurrent(
            workflow,
            context!.inputs,
            context!.snapshot.id,
          );
          const costReconciled = job?.costStatus === 'SETTLED' || job?.costStatus === 'RELEASED';
          const requiresReconciliation = workflow.status === 'FAILED' && (
            job?.costStatus
              ? !costReconciled
              : job?.errorCode === 'PROVIDER_SUBMISSION_UNCERTAIN' || Boolean(job?.providerJobId)
          );
          const isTranslation = workflow.operation === 'IMAGE_TRANSLATE';
          const isFullEdit = workflow.operation === 'FULL_EDIT';
          const isInpaint = workflow.operation === 'INPAINT';
          const operationLabel = workflowOperationLabel(workflow.operation);
          const retryReadiness = operationReadiness(workflow.operation);
          const retryReady = Boolean(capabilities?.webMediaEnabled && retryReadiness?.ready);
          const candidateCanChain = Boolean(
            output?.editReady
            && sourceIsCurrent
            && output.sourceCaptureSnapshotId === context?.snapshot.id
            && workflow.status === 'SUCCEEDED'
            && (isFullEdit || isInpaint),
          );
          const fullEditReadiness = operationReadiness('FULL_EDIT');
          const inpaintReadiness = operationReadiness('INPAINT');
          const fullEditChainReady = Boolean(capabilities?.webMediaEnabled && fullEditReadiness?.ready);
          const inpaintChainReady = Boolean(capabilities?.webMediaEnabled && inpaintReadiness?.ready);
          return <div key={workflow.id} className="grid min-w-0 gap-3 rounded-md border p-3 lg:grid-cols-[minmax(148px,224px)_minmax(0,1fr)] lg:items-center">
            <div className="flex flex-wrap gap-1">
              {source ? <a href={imageUrl(source.url)} target="_blank" rel="noreferrer" className="relative h-[72px] w-[72px] overflow-hidden rounded border bg-muted" title="打开源图"><img src={imageUrl(source.url)} alt={`${operationLabel}源图`} loading="lazy" className="h-full w-full object-cover" /><span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">源图</span></a> : <div className="h-[72px] w-[72px] rounded border bg-muted" />}
              {mask ? <a href={imageUrl(mask.url)} target="_blank" rel="noreferrer" className="relative h-[72px] w-[72px] overflow-hidden rounded border bg-muted" title="打开遮罩"><img src={imageUrl(mask.url)} alt="局部重绘遮罩" loading="lazy" className="h-full w-full object-contain" /><span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">遮罩</span></a> : null}
              {output ? <a href={imageUrl(output.url)} target="_blank" rel="noreferrer" className="relative h-[72px] w-[72px] overflow-hidden rounded border bg-muted" title="打开候选图"><img src={imageUrl(output.url)} alt={`${operationLabel}候选`} loading="lazy" className="h-full w-full object-cover" /><span className="absolute bottom-0 left-0 bg-black/65 px-1 text-[10px] text-white">候选</span></a> : <div className="flex h-[72px] w-[72px] items-center justify-center rounded border bg-muted"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={workflow.status === 'FAILED' ? 'destructive' : 'secondary'}>{operationLabel} · {workflow.status === 'SUCCEEDED' && workflow.reviewStatus !== 'PENDING' ? '已完成' : STATUS_LABEL[workflow.status]}</Badge>
                {workflow.reviewStatus === 'APPROVED' ? <Badge>已通过</Badge> : workflow.reviewStatus === 'REJECTED' ? <Badge variant="outline">已拒绝</Badge> : null}
                <Badge variant="outline" className="max-w-full truncate">{workflowScopeLabel(workflow)}</Badge>
                {workflow.application ? <Badge variant="outline">{workflow.application.state === 'ROLLED_BACK' ? '已回滚' : workflow.application.mode === 'replace' ? '已替换' : '已追加'}</Badge>
                  : job?.appliedMode ? <Badge variant="outline">历史{job.appliedMode === 'replace' ? '已替换' : '已追加'}</Badge> : null}
                {requiresReconciliation ? <Badge variant="outline">待人工核对</Badge> : null}
                {!sourceIsCurrent ? <Badge variant="outline">源图已过期</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">第 {workflow.currentAttempt} 次尝试 · {new Date(workflow.createdAt).toLocaleString()}</p>
              {isTranslation && job?.translation ? <p className="mt-1 break-words text-xs text-muted-foreground">{job.translation.sourceLanguage} → {job.translation.targetLanguage} · 术语 {job.translation.terminologies?.length || 0} 条</p> : null}
              {job?.prompt ? <p className="mt-1 line-clamp-2 text-xs">{job.prompt}</p> : null}
              {job?.errorMessage ? <p className="mt-1 break-words text-xs text-destructive">{job.errorMessage}</p> : null}
              {!sourceIsCurrent ? <p className="mt-1 text-xs text-amber-700">采集快照已变化，候选仅供查看，不能继续审核或应用。</p> : null}
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5 lg:col-start-2">
              {output ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => toggleCandidateComparison(workflow.id)}><Columns2 className="h-3.5 w-3.5" />{comparisonWorkflowIds.includes(workflow.id) ? '移出对比' : '加入对比'}</Button> : null}
              {ACTIVE.has(workflow.status) ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void action(`cancel:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/cancel`, { expectedRevision: workflow.revision }, '已请求取消')}><Square className="h-3.5 w-3.5" />取消</Button> : null}
              {workflow.status === 'FAILED' && !requiresReconciliation && sourceIsCurrent ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || !retryReady} title={retryReady ? '重试任务' : retryReadiness ? describeAiMediaReadiness(workflow.operation, retryReadiness) : '当前操作状态未知'} onClick={() => void retryWorkflow(workflow)}><RotateCcw className="h-3.5 w-3.5" />重试</Button> : null}
              {workflow.status === 'SUCCEEDED' && workflow.reviewStatus === 'PENDING' && output && sourceIsCurrent ? <><Button size="sm" disabled={Boolean(pendingAction)} onClick={() => void action(`approve:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/review`, { expectedRevision: workflow.revision, outputAssetId: output.id, decision: 'APPROVE' }, '候选图已通过审核')}><Check className="h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void action(`reject:${workflow.id}`, `/api/ai-images/workflows/${workflow.id}/review`, { expectedRevision: workflow.revision, outputAssetId: output.id, decision: 'REJECT' }, '候选图已拒绝')}><X className="h-3.5 w-3.5" />拒绝</Button></> : null}
              {workflow.reviewStatus === 'APPROVED' && job && !workflow.application && !job.appliedMode && sourceIsCurrent ? <>
                <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || mediaMutationBusy || mediaDraftDirty || Boolean(applicationTargetStaleVersion) || !target.updatedAt || !capabilities?.applications?.applyEnabled} title={applicationTargetStaleVersion ? '请先刷新商品图片' : mediaDraftDirty ? '请先保存或放弃当前图片筛选' : '追加候选图'} onClick={() => void applyWorkflow(workflow, job)}><ImageIcon className="h-3.5 w-3.5" />{isTranslation ? '追加翻译图' : isFullEdit ? '追加全图编辑' : isInpaint ? '追加局部重绘' : '追加候选'}</Button>
                {workflow.operation === 'IMAGE_TO_IMAGE' && capabilities?.applications?.replaceOperations.includes('IMAGE_TO_IMAGE') ? <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || mediaMutationBusy || mediaDraftDirty || Boolean(applicationTargetStaleVersion) || !target.updatedAt || !capabilities.applications.applyEnabled} title={applicationTargetStaleVersion ? '请先刷新商品图片' : mediaDraftDirty ? '请先保存或放弃当前图片筛选' : '替换全部发布图'} onClick={() => setReplaceConfirmWorkflowId(workflow.id)}><RotateCcw className="h-3.5 w-3.5" />替换全部发布图</Button> : null}
              </> : null}
              {candidateCanChain && output ? <>
                <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || submitting || !fullEditChainReady} title={fullEditChainReady ? '使用该候选继续全图编辑' : fullEditReadiness ? describeAiMediaReadiness('FULL_EDIT', fullEditReadiness) : '全图编辑状态未知'} onClick={() => selectCandidateSource(workflow, output, 'FULL_EDIT')}><WandSparkles className="h-3.5 w-3.5" />继续全图编辑</Button>
                <Button size="sm" variant="outline" disabled={Boolean(pendingAction) || submitting || !inpaintChainReady} title={inpaintChainReady ? '使用该候选继续局部重绘' : inpaintReadiness ? describeAiMediaReadiness('INPAINT', inpaintReadiness) : '局部重绘状态未知'} onClick={() => selectCandidateSource(workflow, output, 'INPAINT')}><ScanLine className="h-3.5 w-3.5" />继续局部重绘</Button>
              </> : null}
            </div>
          </div>;
        })}
        {historyNextCursor ? <div className="flex justify-center pt-1"><Button type="button" size="sm" variant="outline" disabled={historyLoadingMore} onClick={() => void loadMoreHistory()}>{historyLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}{historyLoadingMore ? '正在加载' : '加载更多'}</Button></div> : null}
      </div>

      <Dialog open={Boolean(replaceConfirmWorkflow)} onOpenChange={(open) => {
        if (!open && !pendingAction) setReplaceConfirmWorkflowId(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>替换全部发布图</DialogTitle>
            <DialogDescription>当前商品的发布图片将只保留这张已审核候选图。系统会保存可逆快照，可在没有后续图片变更时回滚。</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">追加是默认方式。仅确认需要整体替换时继续。</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReplaceConfirmWorkflowId(null)} disabled={Boolean(pendingAction)}>取消</Button>
            <Button type="button" variant="destructive" disabled={Boolean(pendingAction) || mediaDraftDirty || Boolean(applicationTargetStaleVersion)} onClick={() => {
              const workflow = replaceConfirmWorkflow;
              const job = workflow?.jobs[workflow.jobs.length - 1];
              if (workflow && job) void applyWorkflow(workflow, job, 'replace');
            }}>{pendingAction?.endsWith(':replace') ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}确认替换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rollbackConfirmApplication)} onOpenChange={(open) => {
        if (!open && !pendingAction) setRollbackConfirmApplicationId(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>撤销此次图片应用</DialogTitle>
            <DialogDescription>将恢复该次应用前的发布图片、加水印图片和改图结果。任务、候选资产和审计记录都会保留。</DialogDescription>
          </DialogHeader>
          {rollbackConfirmApplication ? <div className="text-sm text-muted-foreground">{rollbackConfirmApplication.mode === 'replace' ? '替换' : '追加'}于 {new Date(rollbackConfirmApplication.createdAt).toLocaleString()}</div> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRollbackConfirmApplicationId(null)} disabled={Boolean(pendingAction)}>取消</Button>
            <Button type="button" variant="destructive" disabled={Boolean(pendingAction) || mediaDraftDirty || Boolean(applicationTargetStaleVersion)} onClick={() => rollbackConfirmApplication && void rollbackApplication(rollbackConfirmApplication)}>{pendingAction?.startsWith('rollback:') ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}确认回滚</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
