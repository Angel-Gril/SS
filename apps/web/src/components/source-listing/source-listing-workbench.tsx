'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Upload,
} from 'lucide-react';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  type OzonListingDraftView as OzonListingDraft,
} from 'shared';
import { OzonAttributeEditor } from '@/components/source-listing/ozon-attribute-editor';
import { SourceAiMediaPanel } from '@/components/ai-media/source-ai-media-panel';
import {
  createMediaMutationLock,
  executeLockedMediaMutation,
  type RunMediaMutation,
} from '@/components/ai-media/source-ai-media-state';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import {
  buildOzonListingPricingV1,
  buildSourceListingHandoffSearchParams,
  buildSourceListingPublishIdempotencyKey,
  sourceListingWorkflowClient,
  type SourceCaptureView,
  type SourceListingAiCopyCapability,
  type SourceListingHandoff,
  type SourceListingMediaSelection,
  type SourceListingPublishAttempt,
  type SourceListingPublishOfferTraceEntry,
  type SourceListingPublisherCapability,
  type SourceListingWorkflowApiError,
  type SourceListingWorkflowClientError,
} from '@/lib/source-listing-workflow';

const SKU_PAGE_SIZE = 25;
const MEDIA_PAGE_SIZE = 12;
const SHOP_STORAGE_KEY = 'ss-erp:source-publish:last-ozon-shop-id';
const COPY_GENERATION_STORAGE_KEY = 'ss-erp:source-listing:pending-copy-generations:v1';
const COPY_GENERATION_STORAGE_MAX_ITEMS = 12;
const COPY_GENERATION_STORAGE_MAX_CHARS = 32_000;
const COPY_GENERATION_STORAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface OzonShopOption {
  id: string;
  name: string;
  platform: string;
}

interface CategoryCandidate {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  categoryNameZh?: string;
  typeNameZh?: string;
  displayPathZh?: string;
  displayPathRu?: string;
  score: number;
  label: 'recommended' | 'optional' | 'risky';
  selected: boolean;
  transitionVersion: number;
  reasons: string[];
  attributePlan?: {
    candidates: unknown[];
    missingRequired: unknown[];
  };
}

interface CategoryCandidateResponse {
  catalogRevision: string;
  candidates: CategoryCandidate[];
}

interface CategoryConfirmationResponse {
  transitionVersion: number;
  metadataPatch: Record<string, unknown>;
}

interface PriceFormRow {
  price: string;
  oldPrice: string;
  vat: string;
  offerId: string;
}

interface PendingCopyGeneration {
  operationKey: string;
  signature: string;
  draftId: string;
  updatedAt: number;
}

interface PendingCopyApply {
  candidateId: string;
  draftId: string;
  operationKey: string;
  startingRevision: number;
  requestedCandidateId: string | null;
  requestedTitle: string;
  requestedDescription: string;
}

interface ActiveHandoffRequest {
  epoch: number;
  identity: string;
  handoff: SourceListingHandoff;
}

type MediaSelectionDraft = SourceListingMediaSelection;
type AttemptDiscoveryState = 'idle' | 'loading' | 'ready' | 'failed';

export interface SourceListingWorkbenchProps {
  handoff: SourceListingHandoff;
}

function errorText(error: unknown, fallback: string): string {
  const apiError = error as SourceListingWorkflowApiError | undefined;
  const clientError = error as SourceListingWorkflowClientError | undefined;
  return apiError?.errorCode
    ? `${apiError.errorCode}: ${apiError.message}`
    : clientError?.message || (error instanceof Error ? error.message : fallback);
}

function skuLabel(value: SourceCaptureView['skus']['items'][number]): string {
  return String(value.specText || value.sourceSkuId || value.key);
}

function mediaUrl(value: SourceCaptureView['media']['items'][number]): string {
  return typeof value.url === 'string' ? value.url : '';
}

function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

function clientOperationKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
}

function productHandoffIdentity(handoff: SourceListingHandoff): string {
  return [
    handoff.supplyGoodsId,
    handoff.snapshotId,
    handoff.snapshotVersion ?? '',
    handoff.sourceProductId || '',
  ].join('\u0000');
}

function activeHandoffIdentity(handoff: SourceListingHandoff): string {
  return `${productHandoffIdentity(handoff)}\u0000${handoff.workflowId || ''}`;
}

function generationSignature(draftId: string, instructions: string): string {
  return `${draftId}\u0000title,description\u0000${instructions}`;
}

function readPendingCopyGenerations(): PendingCopyGeneration[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COPY_GENERATION_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const oldest = Date.now() - COPY_GENERATION_STORAGE_MAX_AGE_MS;
    return parsed.filter((entry): entry is PendingCopyGeneration => {
      if (!entry || typeof entry !== 'object') return false;
      const value = entry as Record<string, unknown>;
      return typeof value.operationKey === 'string'
        && value.operationKey.length > 0
        && value.operationKey.length <= 200
        && typeof value.signature === 'string'
        && value.signature.length > 0
        && value.signature.length <= 2400
        && typeof value.draftId === 'string'
        && value.draftId.length > 0
        && value.draftId.length <= 200
        && typeof value.updatedAt === 'number'
        && Number.isSafeInteger(value.updatedAt)
        && value.updatedAt >= oldest;
    }).sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, COPY_GENERATION_STORAGE_MAX_ITEMS);
  } catch {
    return [];
  }
}

function writePendingCopyGenerations(entries: PendingCopyGeneration[]): PendingCopyGeneration[] {
  const bounded: PendingCopyGeneration[] = [];
  for (const entry of entries.sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (bounded.length >= COPY_GENERATION_STORAGE_MAX_ITEMS) break;
    const candidate = [...bounded, entry];
    if (JSON.stringify(candidate).length > COPY_GENERATION_STORAGE_MAX_CHARS) break;
    bounded.push(entry);
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(COPY_GENERATION_STORAGE_KEY, JSON.stringify(bounded)); } catch { /* unavailable */ }
  }
  return bounded;
}

function aiCopyCapabilityLabel(capability: SourceListingAiCopyCapability): string {
  if (capability.enabled) return 'AI 已启用';
  return ({
    master_off: 'AI 全局关闭',
    tenant_not_allowed: 'AI 未向当前租户开放',
    invalid_policy: 'AI 策略异常',
    listing_copy_off: 'AI 文案关闭',
    provider_not_ready: 'AI Provider 未就绪',
    tenant_allowed: 'AI 未启用',
  } as const)[capability.reason];
}

function canonicalSkuIdentity(values: string[]): string {
  return [...new Set(values)].sort().join('\u0000');
}

function matchesExactHandoff(
  draft: OzonListingDraft,
  handoff: SourceListingHandoff,
  expectedDraftId: string,
): boolean {
  return draft.id === expectedDraftId
    && draft.supplyGoodsId === handoff.supplyGoodsId
    && draft.sourceCaptureSnapshotId === handoff.snapshotId;
}

function matchesConfirmedDraft(current: OzonListingDraft, confirmed: OzonListingDraft): boolean {
  return current.id === confirmed.id
    && current.revision === confirmed.revision
    && current.draftVersion === confirmed.draftVersion
    && current.supplyGoodsId === confirmed.supplyGoodsId
    && current.sourceCaptureSnapshotId === confirmed.sourceCaptureSnapshotId
    && current.shopId === confirmed.shopId
    && canonicalSkuIdentity(current.selectedSkuKeys) === canonicalSkuIdentity(confirmed.selectedSkuKeys);
}

function attemptStateLabel(value: SourceListingPublishAttempt['state']): string {
  return ({
    PREPARED: '已准备',
    SUBMITTING: '提交中',
    SUBMITTED: '已提交',
    UNKNOWN: '提交结果未知',
    REJECTED: '提交被拒绝',
  } as const)[value];
}

function attemptReconciliationLabel(value: SourceListingPublishAttempt['reconciliationState']): string {
  return ({
    NOT_REQUIRED: '无需核对',
    PENDING: '等待核对',
    RUNNING: '核对中',
    RETRY_WAIT: '等待再次核对',
    SUCCEEDED: 'Ozon 已成功处理',
    PARTIAL_FAILURE: '部分商品失败',
    FAILED: 'Ozon 处理失败',
    MANUAL_REVIEW: '需要人工处理',
  } as const)[value];
}

function diagnosticRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function traceForItemError(
  attempt: SourceListingPublishAttempt,
  itemError: unknown,
): SourceListingPublishOfferTraceEntry | undefined {
  const error = diagnosticRecord(itemError);
  const offerId = String(error.offerId || error.offer_id || '').trim();
  const ordinal = Number(error.ordinal);
  const trace = attempt.offerTrace || [];
  if (offerId) {
    const byOffer = trace.find((entry) => entry.offerId === offerId);
    if (byOffer) return byOffer;
  }
  return Number.isSafeInteger(ordinal) && ordinal >= 0
    ? trace.find((entry) => entry.ordinal === ordinal)
    : undefined;
}

function attemptItemErrorCount(attempt: SourceListingPublishAttempt): number {
  return Math.max(attempt.itemErrorCount || 0, attempt.itemErrors.length);
}

function attemptItemResultCount(attempt: SourceListingPublishAttempt): number {
  return Math.max(attempt.itemResultCount || 0, attempt.itemResults?.length || 0);
}

export function isDraftReadyForImmutablePublish(draft: OzonListingDraft | null): boolean {
  if (!draft
    || draft.runState !== 'ACTIVE'
    || draft.stage !== 'READY_TO_PUBLISH'
    || draft.validation.status !== 'VALID'
    || draft.blockers.length > 0) return false;
  return Object.values(draft.freshness).every((freshness) => freshness.state === 'CURRENT');
}

function draftValidationText(draft: OzonListingDraft): string {
  if (draft.validation.status === 'VALID') return '服务端校验通过';
  if (draft.validation.status === 'STALE') return '校验已过期';
  if (draft.validation.status === 'INVALID') return '服务端校验未通过';
  return '尚未执行服务端校验';
}

function stableMediaSlot(media: SourceCaptureView['media']['items'][number]): string {
  const prefix = media.role === 'product_main' ? 'main' : media.role === 'sku' ? 'sku' : 'detail';
  return `${prefix}-${media.ordinal + 1}`;
}

type ListingAiMediaScope = {
  key: string;
  skuKey: string | null;
  slotKey: string;
  assetId: string | null;
  occupied: boolean;
};

const LISTING_AI_MEDIA_PRODUCT_SLOTS = [
  'product-main',
  ...Array.from({ length: 7 }, (_, index) => `product-gallery-${index + 1}`),
] as const;

function listingAiMediaScopes(draft: OzonListingDraft): ListingAiMediaScope[] {
  const seen = new Set<string>();
  const scopes: ListingAiMediaScope[] = draft.media.assignments.flatMap((assignment) => {
    const skuKey = assignment.scope === 'SKU' ? assignment.skuKey : null;
    const key = `${skuKey || ''}\u0000${assignment.slotKey}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, skuKey, slotKey: assignment.slotKey, assetId: assignment.assetId, occupied: true }];
  });
  const emptySlots: Array<{ skuKey: string | null; slotKey: string }> = [
    ...LISTING_AI_MEDIA_PRODUCT_SLOTS.map((slotKey) => ({ skuKey: null, slotKey })),
    ...draft.selectedSkuKeys
      .filter((skuKey) => skuKey !== SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)
      .map((skuKey) => ({ skuKey, slotKey: `sku:${skuKey}:hero` })),
  ];
  for (const slot of emptySlots) {
    const key = `${slot.skuKey || ''}\u0000${slot.slotKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ key, ...slot, assetId: null, occupied: false });
  }
  return scopes;
}

function sourceCategoryLabel(candidate: CategoryCandidate): string {
  return candidate.displayPathZh
    || `${candidate.categoryNameZh || candidate.categoryName} / ${candidate.typeNameZh || candidate.typeName}`;
}

export function SourceListingWorkbench({ handoff }: SourceListingWorkbenchProps) {
  const systemDialog = useSystemDialog();
  const [activeHandoff, setActiveHandoff] = useState<SourceListingHandoff>({ ...handoff, section: 'listing' });
  const [capture, setCapture] = useState<SourceCaptureView | null>(null);
  const [captureLoading, setCaptureLoading] = useState(true);
  const [captureError, setCaptureError] = useState('');
  const [skuOffset, setSkuOffset] = useState(0);
  const [mediaOffset, setMediaOffset] = useState(0);
  const [selectedSkuKeys, setSelectedSkuKeys] = useState<string[]>([]);
  const [mediaSelections, setMediaSelections] = useState<Record<string, MediaSelectionDraft>>({});
  const [aiMediaScopeKey, setAiMediaScopeKey] = useState('');
  const [aiMediaMaskDraftDirty, setAiMediaMaskDraftDirty] = useState(false);
  const [aiMediaMutationBusy, setAiMediaMutationBusy] = useState(false);
  const [shops, setShops] = useState<OzonShopOption[]>([]);
  const [shopId, setShopId] = useState('');
  const [draft, setDraft] = useState<OzonListingDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(handoff.workflowId));
  const [draftError, setDraftError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [capability, setCapability] = useState<SourceListingPublisherCapability | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [categoryData, setCategoryData] = useState<CategoryCandidateResponse | null>(null);
  const [categoryKey, setCategoryKey] = useState('');
  const [copyTitle, setCopyTitle] = useState('');
  const [copyDescription, setCopyDescription] = useState('');
  const [copyInstructions, setCopyInstructions] = useState('');
  const [selectedCopyCandidateId, setSelectedCopyCandidateId] = useState<string | null>(null);
  const [aiCopyCapability, setAiCopyCapability] = useState<SourceListingAiCopyCapability | null>(null);
  const [aiCopyCapabilityError, setAiCopyCapabilityError] = useState('');
  const [aiCopyCapabilityLoading, setAiCopyCapabilityLoading] = useState(Boolean(handoff.workflowId));
  const [aiCopyCapabilityReload, setAiCopyCapabilityReload] = useState(0);
  const [priceRows, setPriceRows] = useState<Record<string, PriceFormRow>>({});
  const [attempt, setAttempt] = useState<SourceListingPublishAttempt | null>(null);
  const [attemptError, setAttemptError] = useState('');
  const [attemptDiscoveryState, setAttemptDiscoveryState] = useState<AttemptDiscoveryState>(
    handoff.workflowId ? 'loading' : 'idle',
  );
  const [resolutionTaskId, setResolutionTaskId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const v2AttemptStartedRef = useRef(Boolean(handoff.attemptId));
  const pollControllerRef = useRef<AbortController | null>(null);
  const exactAttemptRequestedRef = useRef(Boolean(handoff.attemptId));
  const activeHandoffRef = useRef(activeHandoff);
  const handoffEpochRef = useRef(0);
  const captureRequestIdRef = useRef(0);
  const copyEditorVersionRef = useRef(0);
  const pendingCopyGenerationRef = useRef(new Map(
    readPendingCopyGenerations().map((entry) => [entry.signature, entry]),
  ));
  const pendingCopyApplyRef = useRef<PendingCopyApply | null>(null);
  const handledHandoffIdentityRef = useRef(activeHandoffIdentity(handoff));
  const aiMediaMutationLockRef = useRef(createMediaMutationLock());
  const aiMediaMaskDraftDirtyRef = useRef(aiMediaMaskDraftDirty);
  const runAiMediaMutation = useCallback<RunMediaMutation>(
    (action) => executeLockedMediaMutation(aiMediaMutationLockRef.current, setAiMediaMutationBusy, action),
    [],
  );
  const handleAiMediaMaskDraftDirtyChange = useCallback((dirty: boolean) => {
    aiMediaMaskDraftDirtyRef.current = dirty;
    setAiMediaMaskDraftDirty(dirty);
  }, []);
  const handleAttributeDraftChange = useCallback((nextDraft: OzonListingDraft) => {
    if (aiMediaMaskDraftDirtyRef.current) {
      setDraftError('草稿已在服务端变化；当前遮罩仍保留，请先提交或放弃后刷新草稿');
      return;
    }
    setDraft(nextDraft);
  }, []);

  useLayoutEffect(() => {
    const incomingHandoff = { ...handoff, section: 'listing' as const };
    if (activeHandoffIdentity(activeHandoffRef.current) !== activeHandoffIdentity(incomingHandoff)) {
      handoffEpochRef.current += 1;
    }
    activeHandoffRef.current = incomingHandoff;
  }, [
    handoff.attemptId,
    handoff.snapshotId,
    handoff.snapshotVersion,
    handoff.sourceProductId,
    handoff.supplyGoodsId,
    handoff.workflowId,
  ]);

  function captureHandoffRequest(): ActiveHandoffRequest {
    const current = activeHandoffRef.current;
    return {
      epoch: handoffEpochRef.current,
      identity: activeHandoffIdentity(current),
      handoff: { ...current },
    };
  }

  function isHandoffRequestActive(request: ActiveHandoffRequest, expectedDraftId?: string): boolean {
    const current = activeHandoffRef.current;
    return request.epoch === handoffEpochRef.current
      && request.identity === activeHandoffIdentity(current)
      && (!expectedDraftId || current.workflowId === expectedDraftId);
  }

  function blockDraftRevisionChangeForMask(): boolean {
    if (!aiMediaMaskDraftDirtyRef.current) return false;
    setDraftError('当前局部重绘遮罩尚未提交，请先提交或放弃遮罩草稿，再修改或刷新草稿');
    return true;
  }

  function rememberPendingGeneration(entry: PendingCopyGeneration) {
    pendingCopyGenerationRef.current.set(entry.signature, entry);
    const stored = writePendingCopyGenerations([...pendingCopyGenerationRef.current.values()]);
    pendingCopyGenerationRef.current = new Map(stored.map((value) => [value.signature, value]));
  }

  function forgetPendingGeneration(signature: string, operationKey: string) {
    const pending = pendingCopyGenerationRef.current.get(signature);
    if (!pending || pending.operationKey !== operationKey) return;
    pendingCopyGenerationRef.current.delete(signature);
    const stored = writePendingCopyGenerations([...pendingCopyGenerationRef.current.values()]);
    pendingCopyGenerationRef.current = new Map(stored.map((value) => [value.signature, value]));
  }

  const replaceHandoffUrl = useCallback((patch: {
    workflowId?: string | null;
    attemptId?: string | null;
  }) => {
    const current = activeHandoffRef.current;
    const next: SourceListingHandoff = {
      ...current,
      section: 'listing',
      ...(patch.workflowId === null ? { workflowId: undefined } : patch.workflowId ? { workflowId: patch.workflowId } : {}),
      ...(patch.attemptId === null ? { attemptId: undefined } : patch.attemptId ? { attemptId: patch.attemptId } : {}),
    };
    if (patch.workflowId === null) delete next.workflowId;
    if (patch.attemptId === null) delete next.attemptId;
    if (activeHandoffIdentity(current) !== activeHandoffIdentity(next)) handoffEpochRef.current += 1;
    activeHandoffRef.current = next;
    handledHandoffIdentityRef.current = activeHandoffIdentity(next);
    if (patch.workflowId && patch.workflowId !== current.workflowId) {
      setDraft(null);
      setDraftLoading(true);
      setAiCopyCapability(null);
      setAiCopyCapabilityLoading(true);
    }
    setActiveHandoff(next);
    if (typeof window !== 'undefined') {
      const query = buildSourceListingHandoffSearchParams(next);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}`);
    }
  }, []);

  useEffect(() => {
    const nextHandoff = { ...handoff, section: 'listing' as const };
    const nextIdentity = activeHandoffIdentity(nextHandoff);
    const handoffChanged = handledHandoffIdentityRef.current !== nextIdentity;
    handledHandoffIdentityRef.current = nextIdentity;
    activeHandoffRef.current = nextHandoff;
    setActiveHandoff(nextHandoff);
    if (handoffChanged) {
      pollControllerRef.current?.abort();
      pollControllerRef.current = null;
      v2AttemptStartedRef.current = Boolean(handoff.attemptId);
      setDraft(null);
      setDraftLoading(Boolean(handoff.workflowId));
      setDraftError('');
      setBusyAction('');
      setMessage('');
      setCategoryData(null);
      setCategoryKey('');
      setCopyTitle('');
      setCopyDescription('');
      setSelectedCopyCandidateId(null);
      setAiCopyCapability(null);
      setAiCopyCapabilityError('');
      setAiCopyCapabilityLoading(Boolean(handoff.workflowId));
      setPriceRows({});
      setAttempt(null);
      setAttemptError('');
      setAttemptDiscoveryState(handoff.workflowId ? 'loading' : 'idle');
      setResolutionTaskId('');
      setResolutionNote('');
      pendingCopyApplyRef.current = null;
      copyEditorVersionRef.current += 1;
      captureRequestIdRef.current += 1;
      setCapture(null);
      setCaptureLoading(true);
      setCaptureError('');
      setSelectedSkuKeys([]);
      setMediaSelections({});
      setCopyInstructions('');
      setSkuOffset(0);
      setMediaOffset(0);
    }
    exactAttemptRequestedRef.current = Boolean(handoff.attemptId);
    if (handoff.attemptId) v2AttemptStartedRef.current = true;
  }, [
    handoff.attemptId,
    handoff.snapshotId,
    handoff.snapshotVersion,
    handoff.sourceProductId,
    handoff.supplyGoodsId,
    handoff.workflowId,
  ]);

  const loadCapture = useCallback(async () => {
    const request = captureHandoffRequest();
    const requestId = ++captureRequestIdRef.current;
    setCaptureLoading(true);
    setCaptureError('');
    try {
      const view = await sourceListingWorkflowClient.getCaptureView(request.handoff, {
        skuOffset,
        skuLimit: SKU_PAGE_SIZE,
        mediaOffset,
        mediaLimit: MEDIA_PAGE_SIZE,
      });
      if (!isHandoffRequestActive(request) || captureRequestIdRef.current !== requestId) return;
      if (request.handoff.snapshotVersion !== undefined && view.version !== request.handoff.snapshotVersion) {
        throw new Error('handoff snapshotVersion 与服务端快照不一致');
      }
      if (request.handoff.sourceProductId && view.sourceIdentity.productId !== request.handoff.sourceProductId) {
        throw new Error('handoff sourceProductId 与服务端快照不一致');
      }
      setCapture(view);
      if (!request.handoff.workflowId && view.skus.total === 0) {
        setSelectedSkuKeys([SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]);
      }
    } catch (error) {
      if (isHandoffRequestActive(request) && captureRequestIdRef.current === requestId) {
        setCaptureError(errorText(error, '读取完整采集快照失败'));
      }
    } finally {
      if (isHandoffRequestActive(request) && captureRequestIdRef.current === requestId) {
        setCaptureLoading(false);
      }
    }
  }, [activeHandoff, mediaOffset, skuOffset]);

  useEffect(() => {
    void loadCapture();
  }, [loadCapture]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api.get<OzonShopOption[]>('/api/shops');
        if (!active) return;
        if (response.code !== 1 || !response.data) throw new Error(response.msg || '读取店铺失败');
        const ozonShops = response.data.filter((shop) => shop.platform === 'OZON');
        setShops(ozonShops);
        let remembered = '';
        try { remembered = localStorage.getItem(SHOP_STORAGE_KEY) || ''; } catch { remembered = ''; }
        setShopId((current) => current || ozonShops.find((shop) => shop.id === remembered)?.id || ozonShops[0]?.id || '');
      } catch (error) {
        if (active) setDraftError(errorText(error, '读取 Ozon 店铺失败'));
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const workflowId = activeHandoff.workflowId;
    if (!workflowId) {
      setDraftLoading(false);
      return;
    }
    let active = true;
    setDraftLoading(true);
    setDraftError('');
    setDraft(null);
    setAiCopyCapability(null);
    void (async () => {
      try {
        const exact = await sourceListingWorkflowClient.getDraft(workflowId);
        if (exact.supplyGoodsId !== activeHandoff.supplyGoodsId
          || exact.sourceCaptureSnapshotId !== activeHandoff.snapshotId) {
          throw new Error('URL 指定的工作流不属于当前精确采集快照');
        }
        if (!active) return;
        setDraft(exact);
        setShopId(exact.shopId);
        setSelectedSkuKeys(exact.selectedSkuKeys);
        try { localStorage.setItem(SHOP_STORAGE_KEY, exact.shopId); } catch { /* unavailable */ }
      } catch (error) {
        if (active) {
          setDraft(null);
          setDraftError(`精确工作流恢复失败：${errorText(error, '工作流不存在')}`);
        }
      } finally {
        if (active) setDraftLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activeHandoff.snapshotId, activeHandoff.supplyGoodsId, activeHandoff.workflowId]);

  useEffect(() => {
    if (!shopId) {
      setCapability(null);
      return;
    }
    let active = true;
    setCapabilityError('');
    void sourceListingWorkflowClient.getPublisherCapability(shopId).then((value) => {
      if (active) setCapability(value);
    }).catch((error) => {
      if (active) {
        setCapability(null);
        setCapabilityError(errorText(error, '读取 V2 发布能力失败'));
      }
    });
    return () => { active = false; };
  }, [shopId]);

  useEffect(() => {
    if (!draft) {
      setAttempt(null);
      setAttemptDiscoveryState(activeHandoff.workflowId ? 'loading' : 'idle');
      return;
    }
    let active = true;
    setAttemptError('');
    setAttemptDiscoveryState('loading');
    void (async () => {
      try {
        if (activeHandoff.attemptId) {
          const exact = await sourceListingWorkflowClient.getPublishAttempt(draft.id, activeHandoff.attemptId);
          if (exact.workflowId !== draft.id) throw new Error('URL 指定的发布任务不属于当前工作流');
          if (!active) return;
          v2AttemptStartedRef.current = true;
          setAttempt(exact);
          setAttemptDiscoveryState('ready');
          return;
        }
        if (exactAttemptRequestedRef.current) {
          throw new Error('精确发布任务参数已丢失，禁止回退旧发布入口');
        }
        const history = await sourceListingWorkflowClient.listPublishAttempts(draft.id, { limit: 20 });
        if (!active) return;
        const latest = history.items[0] || null;
        setAttempt(latest);
        if (latest) {
          v2AttemptStartedRef.current = true;
          replaceHandoffUrl({ workflowId: draft.id, attemptId: latest.id });
        }
        setAttemptDiscoveryState('ready');
      } catch (error) {
        if (active) {
          setAttempt(null);
          setAttemptDiscoveryState('failed');
          setAttemptError(activeHandoff.attemptId
            ? `精确发布任务恢复失败：${errorText(error, '发布任务不存在')}`
            : errorText(error, '读取发布历史失败'));
        }
      }
    })();
    return () => { active = false; };
  }, [activeHandoff.attemptId, draft?.id, replaceHandoffUrl]);

  useEffect(() => () => pollControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!draft || !shopId) {
      setCategoryData(null);
      return;
    }
    let active = true;
    void (async () => {
      const response = await api.get<CategoryCandidateResponse>(
        `/api/collect/${encodeURIComponent(activeHandoff.supplyGoodsId)}/ozon-category-candidates?shopId=${encodeURIComponent(shopId)}`,
      );
      if (!active) return;
      if (response.code !== 1 || !response.data) {
        setDraftError(response.msg || '读取 Ozon 类目候选失败');
        return;
      }
      setCategoryData(response.data);
      const selected = response.data.candidates.find((candidate) => (
        draft.category?.categoryId === candidate.categoryId && draft.category.typeId === candidate.typeId
      )) || response.data.candidates.find((candidate) => candidate.selected) || response.data.candidates[0];
      setCategoryKey(selected ? `${selected.categoryId}:${selected.typeId}` : '');
    })().catch((error) => {
      if (active) setDraftError(errorText(error, '读取 Ozon 类目候选失败'));
    });
    return () => { active = false; };
  }, [activeHandoff.supplyGoodsId, draft?.id, draft?.category?.categoryId, draft?.category?.typeId, shopId]);

  useEffect(() => {
    if (!draft) return;
    const appliedAudit = draft.copy.applyAudit.at(-1);
    const appliedCandidate = appliedAudit
      ? draft.copy.candidates.find((candidate) => candidate.id === appliedAudit.candidateId)
      : null;
    const initialCandidate = appliedCandidate || draft.copy.candidates.at(-1);
    setCopyTitle(initialCandidate?.titleRu || draft.copy.publishTitleRu || '');
    setCopyDescription(initialCandidate?.descriptionRu || draft.copy.publishDescriptionRu || '');
    setSelectedCopyCandidateId(initialCandidate?.id || null);
  }, [draft?.id]);

  useEffect(() => {
    if (!draft) {
      setAiCopyCapability(null);
      setAiCopyCapabilityError('');
      setAiCopyCapabilityLoading(false);
      return;
    }
    let active = true;
    setAiCopyCapability(null);
    setAiCopyCapabilityError('');
    setAiCopyCapabilityLoading(true);
    void sourceListingWorkflowClient.getAiCopyCapability(draft.id).then((value) => {
      if (active) setAiCopyCapability(value);
    }).catch((error) => {
      if (active) {
        setAiCopyCapability(null);
        setAiCopyCapabilityError(errorText(error, 'AI 状态读取失败'));
      }
    }).finally(() => {
      if (active) setAiCopyCapabilityLoading(false);
    });
    return () => { active = false; };
  }, [aiCopyCapabilityReload, draft?.id]);

  useEffect(() => {
    if (!draft) return;
    const value = draft.pricing.value;
    const items = value?.contractVersion === 'ozon-listing-pricing/v1' && Array.isArray(value.items)
      ? value.items as Array<Record<string, unknown>>
      : [];
    const existing = new Map(items.map((item) => [String(item.skuKey || ''), item]));
    setPriceRows(Object.fromEntries(draft.selectedSkuKeys.map((skuKey) => {
      const row = existing.get(skuKey);
      return [skuKey, {
        price: String(row?.price || ''),
        oldPrice: String(row?.oldPrice || ''),
        vat: String(row?.vat ?? '0'),
        offerId: String(row?.offerId || ''),
      }];
    })));
  }, [draft?.id, draft?.pricing.value, draft?.selectedSkuKeys]);

  const selectedSkuSet = useMemo(() => new Set(selectedSkuKeys), [selectedSkuKeys]);
  const aiMediaScopes = useMemo(() => (draft ? listingAiMediaScopes(draft) : []), [draft]);
  const selectedAiMediaScope = aiMediaScopes.find((scope) => scope.key === aiMediaScopeKey) || aiMediaScopes[0] || null;
  useEffect(() => {
    if (!draft) handleAiMediaMaskDraftDirtyChange(false);
  }, [draft?.id, handleAiMediaMaskDraftDirtyChange]);
  useEffect(() => {
    if (!aiMediaScopes.length) {
      setAiMediaScopeKey('');
      return;
    }
    if (!aiMediaScopes.some((scope) => scope.key === aiMediaScopeKey)) {
      setAiMediaScopeKey(aiMediaScopes[0]!.key);
    }
  }, [aiMediaScopeKey, aiMediaScopes]);
  const acceptedMedia = useMemo(() => (
    capture?.media.items.filter((item) => item.kind === 'image' && item.disposition === 'accepted' && mediaUrl(item)) || []
  ), [capture]);
  const selectedCandidate = categoryData?.candidates.find((candidate) => `${candidate.categoryId}:${candidate.typeId}` === categoryKey) || null;
  const publishReady = isDraftReadyForImmutablePublish(draft);
  const aiCopyFactsReady = Boolean(draft?.category)
    && draft?.freshness.category.state === 'CURRENT'
    && draft?.freshness.attributes.state === 'CURRENT';

  function toggleSku(key: string) {
    if (draft) return;
    setSelectedSkuKeys((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : current.length < 100 ? [...current, key] : current);
  }

  function selectCurrentSkuPage() {
    if (!capture || draft) return;
    setSelectedSkuKeys((current) => {
      const merged = [...new Set([...current, ...capture.skus.items.map((sku) => sku.key)])];
      return merged.slice(0, 100);
    });
  }

  function toggleMedia(media: SourceCaptureView['media']['items'][number]) {
    setMediaSelections((current) => {
      if (current[media.key]) {
        const next = { ...current };
        delete next[media.key];
        return next;
      }
      return {
        ...current,
        [media.key]: { sourceMediaKey: media.key, slotKey: stableMediaSlot(media), scope: 'PRODUCT' },
      };
    });
  }

  function updateMediaSelection(mediaKey: string, patch: Partial<MediaSelectionDraft>) {
    setMediaSelections((current) => {
      const previous = current[mediaKey];
      if (!previous) return current;
      const scope = patch.scope || previous.scope;
      if (scope === 'PRODUCT') {
        return { ...current, [mediaKey]: { sourceMediaKey: previous.sourceMediaKey, slotKey: patch.slotKey || previous.slotKey, scope: 'PRODUCT' } };
      }
      const skuKey = patch.skuKey || ('skuKey' in previous ? previous.skuKey : draft?.selectedSkuKeys[0]);
      if (!skuKey) return current;
      return { ...current, [mediaKey]: { sourceMediaKey: previous.sourceMediaKey, slotKey: patch.slotKey || previous.slotKey, scope: 'SKU', skuKey } };
    });
  }

  async function createWorkflow() {
    if (activeHandoff.workflowId) {
      setDraftError('URL 已指定精确 workflowId；恢复失败时不会静默创建或切换到最新草稿');
      return;
    }
    if (!shopId || !selectedSkuKeys.length) {
      setDraftError('请选择 Ozon 店铺和至少一个 canonical SKU');
      return;
    }
    const request = captureHandoffRequest();
    let handoffAdvanced = false;
    setBusyAction('create');
    setDraftError('');
    try {
      if (!isHandoffRequestActive(request)) return;
      const created = await sourceListingWorkflowClient.createWorkflowFromSnapshot({
        handoff: request.handoff,
        shopId,
        selectedSkuKeys,
      });
      if (!isHandoffRequestActive(request)) return;
      if (created.sourceCaptureSnapshotId !== request.handoff.snapshotId
        || created.supplyGoodsId !== request.handoff.supplyGoodsId) throw new Error('服务端返回了不同的快照工作流');
      setDraft(created);
      setSelectedSkuKeys(created.selectedSkuKeys);
      try { localStorage.setItem(SHOP_STORAGE_KEY, created.shopId); } catch { /* unavailable */ }
      setMessage('已创建并绑定精确采集快照的 Ozon 草稿');
      setBusyAction('');
      handoffAdvanced = true;
      replaceHandoffUrl({ workflowId: created.id, attemptId: null });
    } catch (error) {
      if (isHandoffRequestActive(request)) {
        setDraftError(errorText(error, '创建来源商品草稿失败'));
      }
    } finally {
      if (!handoffAdvanced && isHandoffRequestActive(request)) setBusyAction('');
    }
  }

  async function refreshDraft() {
    if (!draft) return null;
    if (blockDraftRevisionChangeForMask()) return null;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    setBusyAction('refresh');
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return null;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) throw new Error('草稿快照已变化');
      setDraft(current);
      setSelectedSkuKeys(current.selectedSkuKeys);
      return current;
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '刷新草稿失败'));
      }
      return null;
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function confirmCategory() {
    if (!draft || !selectedCandidate || !categoryData) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    setBusyAction('category');
    setDraftError('');
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) {
        throw new Error('当前工作流已切换，请等待最新草稿恢复');
      }
      const confirmation = await api.post<CategoryConfirmationResponse>(
        `/api/collect/${encodeURIComponent(request.handoff.supplyGoodsId)}/ozon-category-confirm`,
        {
          shopId: current.shopId,
          categoryId: selectedCandidate.categoryId,
          typeId: selectedCandidate.typeId,
          expectedCatalogRevision: categoryData.catalogRevision,
          expectedTransitionVersion: selectedCandidate.transitionVersion,
        },
      );
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (confirmation.code !== 1 || !confirmation.data?.metadataPatch) {
        throw new Error(confirmation.msg || '权威类目确认失败');
      }
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      const updated = await sourceListingWorkflowClient.updateCategory(current.id, {
        expectedRevision: current.revision,
        category: {
          categoryId: selectedCandidate.categoryId,
          typeId: selectedCandidate.typeId,
          catalogRevision: categoryData.catalogRevision,
          categoryName: selectedCandidate.categoryName,
          typeName: selectedCandidate.typeName,
        },
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setDraft(updated);
      setMessage('Ozon 官方类目已确认并写入当前草稿');
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '确认 Ozon 类目失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function applyCopyReview() {
    if (!draft || (!copyTitle.trim() && !copyDescription.trim())) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestEditorVersion = copyEditorVersionRef.current;
    const requestedTitle = copyTitle.trim();
    const requestedDescription = copyDescription.trim();
    const requestedCandidateId = selectedCopyCandidateId;
    setBusyAction('copy');
    setDraftError('');
    try {
      if (!isHandoffRequestActive(request, draft.id)
        || request.handoff.snapshotId !== draft.sourceCaptureSnapshotId) {
        throw new Error('当前工作流已切换，请等待最新草稿恢复');
      }
      let current = await sourceListingWorkflowClient.getDraft(draft.id);
      if (!isHandoffRequestActive(request, draft.id)) return;
      if (!matchesExactHandoff(current, request.handoff, draft.id)) {
        throw new Error('当前工作流已切换，请等待最新草稿恢复');
      }
      const unresolvedApply = pendingCopyApplyRef.current;
      const unresolvedCandidate = unresolvedApply?.draftId === current.id
        && unresolvedApply.requestedCandidateId === requestedCandidateId
        && unresolvedApply.requestedTitle === requestedTitle
        && unresolvedApply.requestedDescription === requestedDescription
        ? current.copy.candidates.find((candidate) => candidate.id === unresolvedApply.candidateId)
        : null;
      const unresolvedAudit = unresolvedApply && unresolvedCandidate
        ? current.copy.applyAudit.find((audit) => audit.operationKey === unresolvedApply.operationKey)
        : null;
      if (unresolvedAudit && unresolvedCandidate) {
        pendingCopyApplyRef.current = null;
        setDraft(current);
        if (copyEditorVersionRef.current === requestEditorVersion) {
          setCopyTitle(current.copy.publishTitleRu || '');
          setCopyDescription(current.copy.publishDescriptionRu || '');
          setSelectedCopyCandidateId(unresolvedCandidate.id);
        }
        setMessage('俄文文案采用结果已恢复');
        return;
      }
      const selected = unresolvedCandidate || (requestedCandidateId
        ? current.copy.candidates.find((candidate) => candidate.id === requestedCandidateId)
        : null);
      const selectedMatchesEditor = Boolean(selected
        && (selected.titleRu || '') === requestedTitle
        && (selected.descriptionRu || '') === requestedDescription);
      const fullReview = current.freshness.content.state !== 'CURRENT';
      const reviewsTitle = fullReview
        || requestedTitle !== (current.copy.publishTitleRu || '');
      const reviewsDescription = fullReview
        || requestedDescription !== (current.copy.publishDescriptionRu || '');
      const manualFields = [
        ...(reviewsTitle ? ['title' as const] : []),
        ...(reviewsDescription ? ['description' as const] : []),
      ];
      if (!unresolvedCandidate && !selectedMatchesEditor && !manualFields.length) {
        throw new Error('当前俄文文案已是采用版本，无需重复保存');
      }
      const reusableManualCandidate = !unresolvedCandidate && !selectedMatchesEditor
        ? [...current.copy.candidates].reverse().find((value) => {
          if (value.kind === 'AI_GENERATED'
            || value.sourcePromptVersion !== 'manual:web-reviewed-copy/v1'
            || value.sourceCaptureSnapshotId !== current.sourceCaptureSnapshotId
            || value.sourceCaptureHash !== current.sourceCaptureHash) return false;
          const fields = value.fields || value.generation?.fields || ['title', 'description'];
          return fields.length === manualFields.length
            && manualFields.every((field) => fields.includes(field))
            && (!reviewsTitle || value.titleRu === (requestedTitle || null))
            && (!reviewsDescription || value.descriptionRu === (requestedDescription || null));
        })
        : null;
      const candidate = unresolvedCandidate || (selected
        && selectedMatchesEditor
        ? selected
        : reusableManualCandidate || await (async () => {
          if (!isHandoffRequestActive(request, current.id)) {
            throw new Error('当前工作流已切换，请等待最新草稿恢复');
          }
          return sourceListingWorkflowClient.createCopyCandidate(current.id, {
            expectedRevision: current.revision,
            ...(reviewsTitle ? { titleRu: requestedTitle || null } : {}),
            ...(reviewsDescription ? { descriptionRu: requestedDescription || null } : {}),
            sourcePromptVersion: 'manual:web-reviewed-copy/v1',
          });
        })());
      if (!isHandoffRequestActive(request, current.id)) return;
      if (!selected || candidate.id !== selected.id) {
        current = await sourceListingWorkflowClient.getDraft(current.id);
        if (!isHandoffRequestActive(request, current.id)) return;
        if (!matchesExactHandoff(current, request.handoff, current.id)) return;
      }
      const existingPending = pendingCopyApplyRef.current;
      const pending = existingPending?.draftId === current.id
        && existingPending.candidateId === candidate.id
        && existingPending.startingRevision === current.revision
        ? existingPending
        : {
          draftId: current.id,
          candidateId: candidate.id,
          startingRevision: current.revision,
          requestedCandidateId,
          requestedTitle,
          requestedDescription,
          operationKey: clientOperationKey(
            `source-listing-copy-review:${candidate.id.slice(0, 80)}:r${current.revision}`,
          ),
        };
      pendingCopyApplyRef.current = pending;
      const replayAudit = current.copy.applyAudit.find((audit) => audit.operationKey === pending.operationKey);
      if (replayAudit) {
        pendingCopyApplyRef.current = null;
        const replayCandidate = current.copy.candidates.find((value) => value.id === replayAudit.candidateId);
        setDraft(current);
        if (replayCandidate && copyEditorVersionRef.current === requestEditorVersion) {
          setCopyTitle(current.copy.publishTitleRu || '');
          setCopyDescription(current.copy.publishDescriptionRu || '');
          setSelectedCopyCandidateId(replayCandidate.id);
        }
        setMessage('俄文文案采用结果已恢复');
        return;
      }
      if (!isHandoffRequestActive(request, current.id)) return;
      const applied = await sourceListingWorkflowClient.applyCopyCandidate(current.id, {
        expectedRevision: pending.startingRevision,
        candidateId: candidate.id,
        operationKey: pending.operationKey,
      });
      if (pendingCopyApplyRef.current?.operationKey === pending.operationKey) {
        pendingCopyApplyRef.current = null;
      }
      if (!isHandoffRequestActive(request, current.id)) return;
      const appliedAudit = applied.copy.applyAudit.find((audit) => audit.operationKey === pending.operationKey);
      const appliedCandidate = appliedAudit
        ? applied.copy.candidates.find((value) => value.id === appliedAudit.candidateId)
        : null;
      setDraft(applied);
      if (appliedCandidate && copyEditorVersionRef.current === requestEditorVersion) {
        setCopyTitle(applied.copy.publishTitleRu || '');
        setCopyDescription(applied.copy.publishDescriptionRu || '');
        setSelectedCopyCandidateId(appliedCandidate.id);
      }
      setMessage('俄文文案候选已由当前用户明确采用');
    } catch (error) {
      if (isHandoffRequestActive(request, draft.id)) {
        setDraftError(errorText(error, '保存并采用文案候选失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, draft.id)) setBusyAction('');
    }
  }

  async function generateCopyReview() {
    if (!draft?.category
      || draft.freshness.category.state !== 'CURRENT'
      || draft.freshness.attributes.state !== 'CURRENT') {
      setDraftError('请先确认当前 Ozon 类目和属性事实');
      return;
    }
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestEditorVersion = copyEditorVersionRef.current;
    const requestDraftId = draft.id;
    setBusyAction('copy-generate');
    setDraftError('');
    const instructions = copyInstructions.trim();
    let operationKey = '';
    let signature = '';
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) {
        throw new Error('当前工作流已切换，请等待最新草稿恢复');
      }
      signature = generationSignature(current.id, instructions);
      const pending = pendingCopyGenerationRef.current.get(signature);
      operationKey = pending
        ? pending.operationKey
        : clientOperationKey('source-listing-copy-generate');
      rememberPendingGeneration({
        operationKey,
        signature,
        draftId: current.id,
        updatedAt: Date.now(),
      });

      const persisted = current.copy.candidates.find((candidate) => (
        candidate.generation?.operationKey === operationKey
      ));
      if (persisted) {
        forgetPendingGeneration(signature, operationKey);
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        setDraft(current);
        if (copyEditorVersionRef.current === requestEditorVersion) {
          setCopyTitle(persisted.titleRu || '');
          setCopyDescription(persisted.descriptionRu || '');
          setSelectedCopyCandidateId(persisted.id);
        }
        setMessage('AI 文案候选已恢复，请审核后明确采用');
        return;
      }
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      const generated = await sourceListingWorkflowClient.generateCopyCandidate(current.id, {
        expectedRevision: current.revision,
        operationKey,
        fields: ['title', 'description'],
        userInstructions: instructions,
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      const refreshed = await sourceListingWorkflowClient.getDraft(current.id);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      forgetPendingGeneration(signature, operationKey);
      setDraft(refreshed);
      const editorUnchanged = copyEditorVersionRef.current === requestEditorVersion;
      if (editorUnchanged) {
        setCopyTitle(generated.candidate.titleRu || '');
        setCopyDescription(generated.candidate.descriptionRu || '');
        setSelectedCopyCandidateId(generated.candidate.id);
      }
      setMessage(editorUnchanged
        ? generated.limit
          ? `AI 文案候选已生成，今日剩余 ${generated.limit.remaining}/${generated.limit.limit}`
          : 'AI 文案候选已生成，请审核后明确采用'
        : 'AI 文案候选已生成并进入历史；已保留你生成期间的编辑');
    } catch (error) {
      if (operationKey && signature && isHandoffRequestActive(request, requestDraftId)) {
        try {
          const refreshed = await sourceListingWorkflowClient.getDraft(requestDraftId);
          const recovered = refreshed.copy.candidates.find((candidate) => (
            candidate.generation?.operationKey === operationKey
          ));
          if (recovered) forgetPendingGeneration(signature, operationKey);
          if (recovered && isHandoffRequestActive(request, requestDraftId)) {
            setDraft(refreshed);
            if (copyEditorVersionRef.current === requestEditorVersion) {
              setCopyTitle(recovered.titleRu || '');
              setCopyDescription(recovered.descriptionRu || '');
              setSelectedCopyCandidateId(recovered.id);
            }
            setMessage('AI 文案候选已恢复，请审核后明确采用');
            return;
          }
        } catch {
          // Preserve the original generation failure and operation key for an exact retry.
        }
      }
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, 'AI 文案候选生成失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function internalizeAndAssignMedia() {
    if (!draft) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    const selections = Object.values(mediaSelections);
    if (!selections.length) {
      setDraftError('请选择至少一张来源图片');
      return;
    }
    setBusyAction('media');
    setDraftError('');
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) return;
      const internalized = await sourceListingWorkflowClient.internalizeMedia(current.id, {
        expectedRevision: current.revision,
        selections,
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      const updated = await sourceListingWorkflowClient.assignMedia(current.id, {
        expectedRevision: current.revision,
        assignments: internalized.assignments,
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setDraft(updated);
      setMediaSelections({});
      setMessage(`已转存并分配 ${internalized.assets.length} 张来源图片`);
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '来源图片转存或分配失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  function updatePriceRow(skuKey: string, patch: Partial<PriceFormRow>) {
    setPriceRows((current) => ({
      ...current,
      [skuKey]: { price: '', oldPrice: '', vat: '0', offerId: '', ...current[skuKey], ...patch },
    }));
  }

  async function saveStrictPricing() {
    if (!draft) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    setBusyAction('pricing');
    setDraftError('');
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) return;
      const value = buildOzonListingPricingV1({
        selectedSkuKeys: current.selectedSkuKeys,
        items: current.selectedSkuKeys.map((skuKey) => {
          const row = priceRows[skuKey] || { price: '', oldPrice: '', vat: '', offerId: '' };
          return {
            skuKey,
            price: row.price,
            oldPrice: row.oldPrice,
            currencyCode: 'RUB' as const,
            vat: row.vat,
            ...(row.offerId ? { offerId: row.offerId } : {}),
          };
        }),
      });
      const updated = await sourceListingWorkflowClient.savePricing(current.id, {
        expectedRevision: current.revision,
        value,
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setDraft(updated);
      setMessage('逐 canonical SKU 的 RUB 定价已保存');
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '保存严格定价失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function validateFinalDraft() {
    if (!draft) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    setBusyAction('validate');
    setDraftError('');
    try {
      const current = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(current, request.handoff, requestDraftId)) return;
      const validated = await sourceListingWorkflowClient.validateFinalDraft(current.id, current.revision);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setDraft(validated);
      setMessage(validated.validation.status === 'VALID' ? '服务端校验通过，可以明确提交' : '服务端校验未通过，请按阻断项修复');
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '服务端最终校验失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function pollPublishAttempt(target: SourceListingPublishAttempt) {
    const request = captureHandoffRequest();
    if (!isHandoffRequestActive(request, target.workflowId)) return;
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;
    setBusyAction('poll');
    try {
      const completed = await sourceListingWorkflowClient.pollPublishAttempt(target.workflowId, target.id, {
        signal: controller.signal,
        maxAttempts: 30,
        intervalMs: 2000,
      });
      if (!isHandoffRequestActive(request, target.workflowId)) return;
      setAttempt(completed);
    } catch (error) {
      const value = error as SourceListingWorkflowClientError & { lastAttempt?: SourceListingPublishAttempt };
      if (value.code === 'POLL_CANCELLED') return;
      if (isHandoffRequestActive(request, target.workflowId)) {
        if (value.lastAttempt) setAttempt(value.lastAttempt);
        setAttemptError(errorText(error, '同步 Ozon 发布任务失败'));
      }
    } finally {
      if (pollControllerRef.current === controller) pollControllerRef.current = null;
      if (isHandoffRequestActive(request, target.workflowId)) setBusyAction('');
    }
  }

  async function publish() {
    if (!draft || !capability || busyAction) return;
    if (blockDraftRevisionChangeForMask()) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    setDraftError('');
    if (attemptDiscoveryState !== 'ready') {
      setDraftError(attemptDiscoveryState === 'failed'
        ? '发布历史读取失败，已禁止发布和旧入口回退'
        : '发布历史仍在读取，请稍后重试');
      return;
    }
    if (!capability.enabled && !capability.legacyAllowed) {
      setDraftError(`当前店铺未开放发布：${capability.reason}`);
      return;
    }
    setBusyAction('publish-confirm');
    let pollingStarted = false;
    try {
      const confirmationDraft = await sourceListingWorkflowClient.getDraft(requestDraftId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!matchesExactHandoff(confirmationDraft, request.handoff, requestDraftId)) {
        setDraftError('当前草稿已不再绑定 URL 指定的精确采集快照，已禁止发布');
        return;
      }
      setDraft(confirmationDraft);
      if (!isDraftReadyForImmutablePublish(confirmationDraft)) {
        setDraftError('发布按钮仅在服务端 VALID、全部 freshness=CURRENT 且 blockers=0 时启用');
        return;
      }
      const confirmationCapability = await sourceListingWorkflowClient
        .getPublisherCapability(confirmationDraft.shopId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setCapability(confirmationCapability);
      if (!confirmationCapability.enabled && !confirmationCapability.legacyAllowed) {
        setDraftError(`当前店铺未开放发布：${confirmationCapability.reason}`);
        return;
      }
      const shopLabel = shops.find((shop) => shop.id === confirmationDraft.shopId)?.name
        || confirmationDraft.shopId;
      const confirmed = await systemDialog.confirm({
        title: confirmationCapability.enabled ? '确认提交不可变 V2 任务' : '确认使用兼容旧版发布',
        message: [
          `店铺：${shopLabel}`,
          `SKU 数：${confirmationDraft.selectedSkuKeys.length}`,
          `草稿：v${confirmationDraft.draftVersion} / r${confirmationDraft.revision}`,
          `路径：${confirmationCapability.enabled ? 'V2 不可变发布' : 'Unit 6C 前 legacy 兼容入口'}`,
        ].join('\n'),
        confirmText: confirmationCapability.enabled ? '确认提交 V2' : '确认兼容发布',
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      if (!confirmed) return;

      setBusyAction('publish');
      const freshCapability = await sourceListingWorkflowClient
        .getPublisherCapability(confirmationDraft.shopId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setCapability(freshCapability);
      if (freshCapability.revision !== confirmationCapability.revision
        || freshCapability.enabled !== confirmationCapability.enabled
        || freshCapability.legacyAllowed !== confirmationCapability.legacyAllowed) {
        setDraftError('发布策略已变化，请核对路径后重新确认');
        return;
      }
      if (freshCapability.enabled) {
        v2AttemptStartedRef.current = true;
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        const created = await sourceListingWorkflowClient.createPublishAttempt(confirmationDraft.id, {
          expectedRevision: confirmationDraft.revision,
          idempotencyKey: buildSourceListingPublishIdempotencyKey({
            draftId: confirmationDraft.id,
            draftVersion: confirmationDraft.draftVersion,
            revision: confirmationDraft.revision,
          }),
        });
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        setAttempt(created);
        replaceHandoffUrl({ workflowId: confirmationDraft.id, attemptId: created.id });
        toast({ title: '已创建不可变 Ozon 发布任务' });
        pollingStarted = true;
        void pollPublishAttempt(created);
        return;
      }
      if (v2AttemptStartedRef.current) {
        setDraftError('V2 发布已经开始，失败后不会回退旧发布入口');
        return;
      }
      if (freshCapability.legacyAllowed) {
        const history = await sourceListingWorkflowClient.listPublishAttempts(confirmationDraft.id, { limit: 1 });
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        const latest = history.items[0];
        if (latest) {
          v2AttemptStartedRef.current = true;
          setAttempt(latest);
          replaceHandoffUrl({ workflowId: confirmationDraft.id, attemptId: latest.id });
          setDraftError('已发现 V2 发布任务，禁止回退旧发布入口');
          return;
        }
        const current = await sourceListingWorkflowClient.getDraft(confirmationDraft.id);
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        if (!matchesConfirmedDraft(current, confirmationDraft)) {
          setDraft(current);
          setDraftError('草稿在确认期间已变化，请核对最新店铺、SKU 和版本后重新确认');
          return;
        }
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        const legacy = await api.post('/api/collect/publish-ozon', {
          ids: [confirmationDraft.supplyGoodsId],
          shopId: confirmationDraft.shopId,
          categoryId: confirmationDraft.category?.categoryId,
          typeId: confirmationDraft.category?.typeId,
          mode: 'clone',
          useItemCategory: true,
          source: 'source-listing-unit6b-legacy-compatible',
        });
        if (!isHandoffRequestActive(request, requestDraftId)) return;
        if (legacy.code !== 1) throw new Error(legacy.msg || '兼容旧版发布失败');
        setMessage('当前店铺尚未进入 V2 pilot，已明确使用 Unit 6C 前的兼容旧入口');
        return;
      }
      setDraftError('当前店铺未开放 V2 发布，旧入口也已禁用');
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setDraftError(errorText(error, '提交 Ozon 发布任务失败'));
      }
    } finally {
      if (!pollingStarted && isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function refreshAttempt() {
    if (!attempt || !draft) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    const requestAttemptId = attempt.id;
    setBusyAction('attempt');
    setAttemptError('');
    try {
      const current = await sourceListingWorkflowClient.getPublishAttempt(requestDraftId, requestAttemptId);
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      setAttempt(current);
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setAttemptError(errorText(error, '刷新发布任务失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  async function resolvePublishAttempt(decision: 'SUBMITTED' | 'NOT_SUBMITTED') {
    if (!attempt || !draft) return;
    const request = captureHandoffRequest();
    const requestDraftId = draft.id;
    const requestAttemptId = attempt.id;
    const requestStateVersion = attempt.stateVersion;
    setBusyAction('resolve');
    setAttemptError('');
    try {
      const resolved = await sourceListingWorkflowClient.resolvePublishAttempt(requestDraftId, requestAttemptId, {
        expectedStateVersion: requestStateVersion,
        decision,
        ...(decision === 'SUBMITTED' ? { taskId: resolutionTaskId } : {}),
        note: resolutionNote,
        evidence: {
          source: 'owner_web_resolution',
          checkedAt: new Date().toISOString(),
          note: resolutionNote,
        },
      });
      if (!isHandoffRequestActive(request, requestDraftId)) return;
      v2AttemptStartedRef.current = true;
      setAttempt(resolved);
      setResolutionNote('');
      setMessage('人工处理结论已记录；继续在同一快照草稿中修复，不会重建 capture');
    } catch (error) {
      if (isHandoffRequestActive(request, requestDraftId)) {
        setAttemptError(errorText(error, '记录人工处理结论失败'));
      }
    } finally {
      if (isHandoffRequestActive(request, requestDraftId)) setBusyAction('');
    }
  }

  return (
    <section className="space-y-4 border-y bg-background py-4" aria-label="1688 到 Ozon 上架工作台">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">1688 到 Ozon</h2>
            <Badge variant="outline">精确快照 #{activeHandoff.snapshotVersion || capture?.version || '-'}</Badge>
            {draft ? <Badge variant="outline">草稿 v{draft.draftVersion} / r{draft.revision}</Badge> : null}
          </div>
          <div className="mt-1 break-all text-xs text-muted-foreground">
            {activeHandoff.supplyGoodsId} · {activeHandoff.snapshotId}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={loadCapture} disabled={captureLoading}>
            {captureLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新快照
          </Button>
          {draft ? (
            <Button type="button" size="sm" variant="outline" onClick={refreshDraft} disabled={Boolean(busyAction) || aiMediaMaskDraftDirty} title={aiMediaMaskDraftDirty ? '请先提交或放弃当前遮罩草稿' : undefined}>
              <RefreshCw className="h-4 w-4" />刷新草稿
            </Button>
          ) : null}
        </div>
      </div>

      {captureError ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{captureError}</div> : null}
      {draftError ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{draftError}</div> : null}
      {message ? <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      {capture ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3 border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Canonical SKU 选择</div>
                <div className="text-xs text-muted-foreground">完整快照共 {capture.skus.total} 个，当前选择 {selectedSkuKeys.length}/100</div>
              </div>
              {!draft && capture.skus.total > 0 ? <Button type="button" size="sm" variant="outline" onClick={selectCurrentSkuPage}>选择本页</Button> : null}
            </div>
            <div className="max-h-72 overflow-y-auto border">
              {capture.skus.total === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2">
                  <input type="checkbox" className="h-4 w-4" checked readOnly />
                  <span className="text-sm">无变体商品</span>
                  <Badge variant="outline">产品级</Badge>
                </div>
              ) : capture.skus.items.map((sku) => (
                <label key={sku.key} className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={selectedSkuSet.has(sku.key)}
                    onChange={() => toggleSku(sku.key)}
                    disabled={Boolean(draft)}
                  />
                  <span className="min-w-0">
                    <span className="block break-words text-sm">{skuLabel(sku)}</span>
                    <span className="block break-all font-mono text-xs text-muted-foreground">{sku.key}</span>
                  </span>
                </label>
              ))}
            </div>
            {capture.skus.total > 0 ? <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>第 {Math.floor(skuOffset / SKU_PAGE_SIZE) + 1} / {pageCount(capture.skus.total, SKU_PAGE_SIZE)} 页</span>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" aria-label="SKU 上一页" onClick={() => setSkuOffset(Math.max(0, skuOffset - SKU_PAGE_SIZE))} disabled={skuOffset === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" aria-label="SKU 下一页" onClick={() => setSkuOffset(skuOffset + SKU_PAGE_SIZE)} disabled={skuOffset + SKU_PAGE_SIZE >= capture.skus.total}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div> : null}
          </div>

          <div className="space-y-3 border p-3">
            <div className="font-medium">目标店铺与草稿</div>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Ozon 店铺</span>
              <select
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
                disabled={Boolean(draft) || draftLoading}
                className="h-9 w-full border bg-background px-2 text-sm"
              >
                {shops.length === 0 ? <option value="">暂无 Ozon 店铺</option> : null}
                {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
              </select>
            </label>
            {capability ? (
              <div className={`border px-2 py-2 text-xs ${capability.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : capability.legacyAllowed ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {capability.enabled
                  ? `V2 不可变发布已开放 · ${capability.reason}`
                  : capability.legacyAllowed
                    ? `非 pilot：Unit 6C 前保留兼容旧入口 · ${capability.reason}`
                    : `发布未开放 · ${capability.reason}`}
              </div>
            ) : null}
            {capabilityError ? <div className="text-xs text-destructive">{capabilityError}</div> : null}
            {draft && attemptDiscoveryState === 'loading' ? (
              <div className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                正在读取此草稿的 V2 发布历史
              </div>
            ) : null}
            {draft && attemptDiscoveryState === 'failed' ? (
              <div className="border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700">
                {attemptError || '发布历史读取失败'}；发布与旧入口回退均已禁用。
              </div>
            ) : null}
            {!draft && !activeHandoff.workflowId ? (
              <Button type="button" className="w-full" onClick={createWorkflow} disabled={busyAction === 'create' || !shopId || !selectedSkuKeys.length}>
                {busyAction === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                创建精确快照草稿
              </Button>
            ) : null}
            {draftLoading ? <div className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />恢复精确工作流</div> : null}
            {draft ? (
              <div className="space-y-1 text-xs">
                <div>阶段：{draft.stage}</div>
                <div>状态：{draft.runState}</div>
                <div>阻断：{draft.blockers.length} · 警告：{draft.warnings.length}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {draft ? (
        <>
          <div className="space-y-3 border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Ozon 官方类目</div>
                <div className="text-xs text-muted-foreground">候选只供人工确认，服务端会再次校验目录版本。</div>
              </div>
              <Button type="button" size="sm" onClick={confirmCategory} disabled={!selectedCandidate || busyAction === 'category' || aiMediaMaskDraftDirty}>
                {busyAction === 'category' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                确认类目
              </Button>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {categoryData?.candidates.map((candidate) => {
                const key = `${candidate.categoryId}:${candidate.typeId}`;
                return (
                  <button key={key} type="button" onClick={() => setCategoryKey(key)} className={`border p-3 text-left ${key === categoryKey ? 'border-primary bg-primary/5' : ''}`}>
                    <div className="text-sm font-medium">{sourceCategoryLabel(candidate)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{candidate.displayPathRu || `${candidate.categoryName} / ${candidate.typeName}`}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="outline">分数 {candidate.score}</Badge>
                      <Badge variant="outline">{candidate.label}</Badge>
                      {(candidate.reasons || []).slice(0, 3).map((reason) => <Badge key={reason} variant="outline">{reason}</Badge>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {draft.category ? (
            <OzonAttributeEditor
              itemId={draft.supplyGoodsId}
              selectedSkuKeys={draft.selectedSkuKeys}
              shopStorageKey={SHOP_STORAGE_KEY}
              exactWorkflowId={draft.id}
              exactSnapshotId={activeHandoff.snapshotId}
              lockedShopId={draft.shopId}
              exactRevision={draft.revision}
              disabled={aiMediaMaskDraftDirty}
              onDraftChange={handleAttributeDraftChange}
            />
          ) : null}

          <div className="space-y-3 border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">俄文文案审核</div>
                  {aiCopyCapabilityLoading ? (
                    <Badge variant="outline" role="status" aria-live="polite">读取 AI 状态</Badge>
                  ) : null}
                  {aiCopyCapability ? (
                    <Badge variant="outline">{aiCopyCapabilityLabel(aiCopyCapability)}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={generateCopyReview} disabled={draftLoading || !aiCopyFactsReady || !aiCopyCapability?.enabled || Boolean(busyAction) || aiMediaMaskDraftDirty}>
                  {busyAction === 'copy-generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  生成候选
                </Button>
                <Button type="button" size="sm" onClick={applyCopyReview} disabled={draftLoading || (!copyTitle.trim() && !copyDescription.trim()) || Boolean(busyAction) || aiMediaMaskDraftDirty}>
                  {busyAction === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存并采用
                </Button>
              </div>
            </div>
            {aiCopyCapabilityError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert" aria-live="assertive">
                <span>AI 状态读取失败：{aiCopyCapabilityError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    setAiCopyCapability(null);
                    setAiCopyCapabilityError('');
                    setAiCopyCapabilityLoading(true);
                    setAiCopyCapabilityReload((value) => value + 1);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                  重试 AI 状态
                </Button>
              </div>
            ) : null}
            {!aiCopyFactsReady ? (
              <div className="text-xs text-amber-700" role="status" aria-live="polite">
                请先确认当前类目和属性事实，再生成文案候选。
              </div>
            ) : null}
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">本次生成要求（可选）</span>
              <Input
                value={copyInstructions}
                onChange={(event) => setCopyInstructions(event.target.value)}
                maxLength={2000}
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">俄文标题</span>
              <Input value={copyTitle} onChange={(event) => {
                copyEditorVersionRef.current += 1;
                setCopyTitle(event.target.value);
                setSelectedCopyCandidateId(null);
              }} />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">俄文描述</span>
              <textarea value={copyDescription} onChange={(event) => {
                copyEditorVersionRef.current += 1;
                setCopyDescription(event.target.value);
                setSelectedCopyCandidateId(null);
              }} rows={5} className="w-full resize-y border bg-background px-3 py-2 text-sm" />
            </label>
            <div className="text-xs text-muted-foreground">已审核标题：{draft.copy.publishTitleRu || '-'}</div>
            {draft.copy.candidates.length ? (
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-medium">历史候选</div>
                {draft.copy.candidates.slice(-5).reverse().map((candidate) => (
                  <div key={candidate.id} className="flex flex-wrap items-start justify-between gap-2 border p-2 text-xs">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{candidate.kind === 'AI_GENERATED' ? 'AI 生成' : '人工'}</Badge>
                        {candidate.generation?.title ? (
                          <Badge variant="outline">模板 #{candidate.generation.title.sequence}</Badge>
                        ) : null}
                      </div>
                      <div className="break-words font-medium">{candidate.titleRu || '仅描述候选'}</div>
                      {candidate.descriptionRu ? (
                        <div className="line-clamp-2 break-words text-muted-foreground">{candidate.descriptionRu}</div>
                      ) : null}
                    </div>
                    <Button type="button" size="sm" variant="outline" aria-label={`载入候选 ${candidate.titleRu || candidate.id}`} onClick={() => {
                      copyEditorVersionRef.current += 1;
                      setCopyTitle(candidate.titleRu || '');
                      setCopyDescription(candidate.descriptionRu || '');
                      setSelectedCopyCandidateId(candidate.id);
                    }}>
                      载入
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {capture ? (
            <div className="space-y-3 border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">来源图片选择与持久化</div>
                  <div className="text-xs text-muted-foreground">完整快照共 {capture.media.total} 个素材，已选 {Object.keys(mediaSelections).length}</div>
                </div>
                <Button type="button" size="sm" onClick={internalizeAndAssignMedia} disabled={!Object.keys(mediaSelections).length || busyAction === 'media' || aiMediaMaskDraftDirty}>
                  {busyAction === 'media' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  转存并分配
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {acceptedMedia.map((media) => {
                  const selection = mediaSelections[media.key];
                  return (
                    <div key={media.key} className="space-y-2 border p-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={Boolean(selection)} onChange={() => toggleMedia(media)} />
                        <span className="break-all">{media.key}</span>
                      </label>
                      <a href={mediaUrl(media)} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden border bg-muted">
                        <img src={mediaUrl(media)} alt="" className="h-full w-full object-contain" />
                      </a>
                      {selection ? (
                        <div className="grid gap-2">
                          <Input value={selection.slotKey} onChange={(event) => updateMediaSelection(media.key, { slotKey: event.target.value })} aria-label={`${media.key} 槽位`} />
                          <select value={selection.scope} onChange={(event) => updateMediaSelection(media.key, { scope: event.target.value as 'PRODUCT' | 'SKU' })} className="h-9 border bg-background px-2 text-xs">
                            <option value="PRODUCT">商品级</option>
                            <option value="SKU">SKU 级</option>
                          </select>
                          {selection.scope === 'SKU' ? (
                            <select value={selection.skuKey} onChange={(event) => updateMediaSelection(media.key, { skuKey: event.target.value })} className="h-9 border bg-background px-2 text-xs">
                              {draft.selectedSkuKeys.map((skuKey) => <option key={skuKey} value={skuKey}>{skuKey}</option>)}
                            </select>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>第 {Math.floor(mediaOffset / MEDIA_PAGE_SIZE) + 1} / {pageCount(capture.media.total, MEDIA_PAGE_SIZE)} 页</span>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" aria-label="图片上一页" onClick={() => setMediaOffset(Math.max(0, mediaOffset - MEDIA_PAGE_SIZE))} disabled={mediaOffset === 0}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" aria-label="图片下一页" onClick={() => setMediaOffset(mediaOffset + MEDIA_PAGE_SIZE)} disabled={mediaOffset + MEDIA_PAGE_SIZE >= capture.media.total}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ) : null}

          {selectedAiMediaScope ? (
            <div className="space-y-3 border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="font-medium">AI 图片候选与草稿槽位</div>
                  <div className="text-xs text-muted-foreground">目标只能从当前草稿 assignment 或受限标准空槽中选择，应用阶段不会再次接收目标槽位。</div>
                </div>
                <label className="block min-w-0 space-y-1 text-xs sm:w-[min(100%,420px)]">
                  <span className="text-muted-foreground">精确目标槽位</span>
                  <select
                    value={selectedAiMediaScope.key}
                    onChange={(event) => setAiMediaScopeKey(event.target.value)}
                    disabled={aiMediaMutationBusy || Boolean(busyAction) || aiMediaMaskDraftDirty}
                    title={aiMediaMaskDraftDirty ? '请先提交或放弃当前遮罩草稿，再切换图片槽位' : undefined}
                    className="h-9 w-full border bg-background px-2 text-sm"
                    aria-label="AI 图片精确目标槽位"
                  >
                    {aiMediaScopes.map((scope) => (
                      <option key={scope.key} value={scope.key}>
                        {scope.skuKey ? `SKU ${scope.skuKey}` : '商品级'} · {scope.slotKey} · {scope.occupied ? '已有图片' : '空槽'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <SourceAiMediaPanel
                target={{
                  type: 'listing-draft',
                  id: draft.id,
                  label: draft.copy.publishTitleRu || activeHandoff.sourceProductId || draft.id,
                  revision: draft.revision,
                  draftVersion: draft.draftVersion,
                  skuKey: selectedAiMediaScope.skuKey,
                  slotKey: selectedAiMediaScope.slotKey,
                  assignedAssetId: selectedAiMediaScope.assetId,
                }}
                selectedSkuKeys={draft.selectedSkuKeys}
                mediaDraftDirty={Object.keys(mediaSelections).length > 0}
                mediaMutationBusy={aiMediaMutationBusy || Boolean(busyAction)}
                runMediaMutation={runAiMediaMutation}
                onConflictRefresh={refreshDraft}
                onMaskDraftDirtyChange={handleAiMediaMaskDraftDirtyChange}
              />
            </div>
          ) : null}

          <div className="space-y-3 border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">逐 SKU 定价</div>
                <div className="text-xs text-muted-foreground">必须精确覆盖 {draft.selectedSkuKeys.length} 个 canonical SKU，币种固定 RUB，VAT 显式填写。</div>
              </div>
              <Button type="button" size="sm" onClick={saveStrictPricing} disabled={busyAction === 'pricing' || aiMediaMaskDraftDirty}>
                {busyAction === 'pricing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存严格定价
              </Button>
            </div>
            <div className="max-h-96 overflow-auto border">
              <div className="grid min-w-[800px] grid-cols-[minmax(220px,1fr)_130px_130px_100px_180px] bg-muted/50 px-3 py-2 text-xs font-medium">
                <div>Canonical SKU</div><div>售价 RUB</div><div>划线价 RUB</div><div>VAT</div><div>Offer ID（可选）</div>
              </div>
              {draft.selectedSkuKeys.map((skuKey) => {
                const row = priceRows[skuKey] || { price: '', oldPrice: '', vat: '0', offerId: '' };
                return (
                  <div key={skuKey} className="grid min-w-[800px] grid-cols-[minmax(220px,1fr)_130px_130px_100px_180px] gap-2 border-t px-3 py-2">
                    <div className="break-all font-mono text-xs">
                      {skuKey === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY ? '无变体商品' : skuKey}
                    </div>
                    <Input value={row.price} onChange={(event) => updatePriceRow(skuKey, { price: event.target.value })} inputMode="decimal" />
                    <Input value={row.oldPrice} onChange={(event) => updatePriceRow(skuKey, { oldPrice: event.target.value })} inputMode="decimal" />
                    <Input value={row.vat} onChange={(event) => updatePriceRow(skuKey, { vat: event.target.value })} />
                    <Input value={row.offerId} onChange={(event) => updatePriceRow(skuKey, { offerId: event.target.value })} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 border p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">最终校验与发布</div>
                  <Badge variant="outline" className={publishReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                    {draftValidationText(draft)}
                  </Badge>
                  <Badge variant="outline">阻断 {draft.blockers.length}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">发布按钮仅在服务端 VALID/current/blockers=0 时启用。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={validateFinalDraft} disabled={busyAction === 'validate' || aiMediaMaskDraftDirty}>
                  {busyAction === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  最终服务端校验
                </Button>
                <Button
                  type="button"
                  onClick={publish}
                  disabled={!publishReady
                    || !capability
                    || (!capability.enabled && !capability.legacyAllowed)
                    || attemptDiscoveryState !== 'ready'
                    || Boolean(busyAction)
                    || aiMediaMaskDraftDirty}
                >
                  {busyAction === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {attemptDiscoveryState === 'loading'
                    ? '读取发布历史'
                    : attemptDiscoveryState === 'failed'
                      ? '发布历史不可用'
                      : capability?.enabled
                        ? '提交不可变 V2 任务'
                        : capability?.legacyAllowed
                          ? '兼容旧版发布'
                          : '发布未开放'}
                </Button>
              </div>
            </div>
            {draft.blockers.length ? (
              <div className="space-y-1 border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {draft.blockers.map((blocker) => <div key={`${blocker.code}:${blocker.fieldPath || ''}`}>{blocker.fieldPath ? `${blocker.fieldPath} · ` : ''}{blocker.message}</div>)}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {attempt ? (
        <div className="space-y-3 border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">Ozon 发布任务</div>
                <Badge variant="outline">{attemptStateLabel(attempt.state)}</Badge>
                <Badge variant="outline">{attemptReconciliationLabel(attempt.reconciliationState)}</Badge>
              </div>
              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{attempt.id}</div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={refreshAttempt} disabled={busyAction === 'attempt'}><RefreshCw className="h-4 w-4" />刷新</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => pollPublishAttempt(attempt)} disabled={busyAction === 'poll'}>{busyAction === 'poll' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}持续同步</Button>
            </div>
          </div>
          {attemptError ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{attemptError}</div> : null}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="border bg-muted/20 px-3 py-2">Ozon Task ID：<span className="font-mono">{attempt.ozonTaskId || '-'}</span></div>
            <div className="break-all border bg-muted/20 px-3 py-2">提交载荷哈希：<span className="font-mono">{attempt.requestPayloadHash}</span></div>
            <div className="border bg-muted/20 px-3 py-2">商品数：{attempt.itemCount}</div>
            <div className="border bg-muted/20 px-3 py-2">状态版本：{attempt.stateVersion}</div>
            <div className="border bg-muted/20 px-3 py-2">
              处理结果：{attemptItemResultCount(attempt)}{attempt.itemResultsTruncated ? '（响应已截断）' : ''}
            </div>
            <div className="border bg-muted/20 px-3 py-2">
              错误：{attemptItemErrorCount(attempt)}{attempt.itemErrorsTruncated ? '（响应已截断）' : ''}
            </div>
          </div>
          {attemptItemErrorCount(attempt) > 0 ? (
            <div className="space-y-2">
              <div className="font-medium text-red-700">
                错误明细 {attempt.itemErrors.length}/{attemptItemErrorCount(attempt)}
              </div>
              {attempt.itemErrors.map((itemError, index) => {
                const trace = traceForItemError(attempt, itemError);
                const error = diagnosticRecord(itemError);
                const offerId = trace?.offerId || String(error.offerId || error.offer_id || '').trim();
                const skuKey = trace?.skuKey || String(error.skuKey || '').trim();
                return (
                  <div key={`${trace?.ordinal ?? index}:${offerId}`} className="border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 font-medium">
                      <span>Canonical SKU：{skuKey || '-'}</span>
                      <span>Offer：{offerId || '-'}</span>
                      <span>序号：{trace?.ordinal ?? String(error.ordinal ?? index)}</span>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(itemError, null, 2)}</pre>
                  </div>
                );
              })}
              {attempt.itemErrorsTruncated ? (
                <div className="border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-800">
                  精确任务响应仍有诊断被大小上限截断，请按任务 ID 在服务端审计记录中继续核对。
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">修复字段或 SKU 后重新校验同一草稿，不会重建 capture。</div>
            </div>
          ) : null}
          {attempt.state === 'UNKNOWN' ? (
            <div className="space-y-3 border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center gap-2 font-medium text-amber-800"><AlertTriangle className="h-4 w-4" />提交结果未知，需要店铺所有者提供核对证据</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs"><span>Ozon Task ID（确认已提交时必填）</span><Input value={resolutionTaskId} onChange={(event) => setResolutionTaskId(event.target.value)} /></label>
                <label className="space-y-1 text-xs"><span>核对说明</span><Input value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => resolvePublishAttempt('SUBMITTED')} disabled={!resolutionTaskId || !resolutionNote || busyAction === 'resolve'}>人工确认已提交</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => resolvePublishAttempt('NOT_SUBMITTED')} disabled={!resolutionNote || busyAction === 'resolve'}>人工确认未提交</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
