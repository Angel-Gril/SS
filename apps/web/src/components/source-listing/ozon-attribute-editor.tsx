'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  OzonListingDraftView as OzonListingDraft,
  OzonListingDraftAttributeValue,
  OzonListingWorkflowIssue,
  OzonNormalizedAttributeField,
  OzonNormalizedAttributeSchema,
} from 'shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface OzonShopOption {
  id: string;
  name: string;
  platform: string;
}

interface AttributeSuggestion extends OzonListingDraftAttributeValue {
  attributeId: number;
  attributeName: string;
  valueType: OzonNormalizedAttributeField['valueType'];
  cardinality: OzonNormalizedAttributeField['cardinality'];
  candidateId: string;
  candidateHash: string;
  schemaRevision: string;
  draftRevision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  evidenceDetails?: Array<{
    id: string;
    source: string;
    path: string;
    confidence: number;
  }>;
}

interface BlockedAttributeSuggestion {
  attributeId: number;
  attributeName: string;
  skuKey?: string;
  fieldPath?: string;
  reasonCode: string;
  message: string;
  unsupportedValues: Array<string | number | boolean>;
  evidence: string[];
}

interface OperationReadiness {
  status: 'READY' | 'BLOCKED';
  issues: OzonListingWorkflowIssue[];
}

interface AttributeValidationResult {
  status: 'VALID' | 'INVALID';
  report: {
    operationReadiness: {
      ozonImport: OperationReadiness;
      inventoryActivation: OperationReadiness;
      costingAutoPricing: OperationReadiness;
    };
  };
  blockers: OzonListingWorkflowIssue[];
  warnings: OzonListingWorkflowIssue[];
}

function authoritativeValidationFromDraft(draft: OzonListingDraft): AttributeValidationResult | null {
  if (!['VALID', 'INVALID'].includes(draft.validation.status)) return null;
  const report = draft.validation.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const operationReadiness = (report as Record<string, unknown>).operationReadiness;
  if (!operationReadiness || typeof operationReadiness !== 'object' || Array.isArray(operationReadiness)) return null;
  return {
    status: draft.validation.status as 'VALID' | 'INVALID',
    report: report as unknown as AttributeValidationResult['report'],
    blockers: draft.blockers,
    warnings: draft.warnings,
  };
}

interface AttributeWorkspace {
  schema: OzonNormalizedAttributeSchema;
  schemaRevision: string;
  values: Record<string, OzonListingDraftAttributeValue>;
  suggestions: Record<string, AttributeSuggestion>;
  blockedSuggestions: BlockedAttributeSuggestion[];
  validationPreview: AttributeValidationResult;
}

interface DictionaryValue {
  id: number;
  value: string;
}

interface DictionarySearchState {
  loading: boolean;
  complete: boolean;
  values: DictionaryValue[];
  error: string;
}

interface AttributeEditState {
  valueText: string;
  evidenceText: string;
  dictionaryValues: DictionaryValue[];
}

interface ListingWorkflowIdentityTarget {
  identityKey: string;
  itemId: string;
  shopId: string;
  selectedSkuKeys: string[];
  skuIdentity: string;
  canonicalSkuKeys: string[];
  canonicalSkuIdentity: string;
}

interface AttributeRequestContext {
  identityKey: string;
  draftId: string;
  revision: number;
}

const SKU_MATRIX_PAGE_SIZE = 10;

export interface OzonAttributeEditorProps {
  itemId: string;
  selectedSkuKeys: string[];
  shopStorageKey: string;
  exactWorkflowId?: string;
  exactSnapshotId?: string;
  lockedShopId?: string;
  exactRevision?: number;
  disabled?: boolean;
  onDraftChange?: (draft: OzonListingDraft) => void;
}

function listingWorkflowIdentityKey(itemId: string, shopId: string, skuIdentity: string): string {
  return JSON.stringify([itemId, shopId, skuIdentity]);
}

function attributeScopeKey(attributeId: number, skuKey?: string): string {
  return skuKey ? JSON.stringify([attributeId, skuKey]) : String(attributeId);
}

function isSkuMatrixField(field: OzonNormalizedAttributeField): boolean {
  return field.ownership === 'SKU' || field.editorMode === 'SKU_MATRIX';
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map(displayValue).join(' / ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function editableValueText(value: unknown, field: OzonNormalizedAttributeField): string {
  if (field.valueType === 'JSON' && value !== null && value !== undefined) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  if (Array.isArray(value)) return value.map(displayValue).join('\n');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  return field.cardinality === 'MULTI' ? String(value) : displayValue(value);
}

function evidenceLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))].slice(0, 20);
}

function currentDictionaryValues(value: OzonListingDraftAttributeValue | undefined): DictionaryValue[] {
  const matches = Array.isArray(value?.dictionaryMatches) ? value.dictionaryMatches : [];
  if (matches.length) {
    return matches.flatMap((match) => {
      const id = Number(match.dictionaryValueId);
      const canonical = String(match.canonicalValue || '').trim();
      return Number.isSafeInteger(id) && id > 0 && canonical ? [{ id, value: canonical }] : [];
    });
  }
  const id = Number(value?.dictionaryMatch?.dictionaryValueId);
  const canonical = String(value?.dictionaryMatch?.canonicalValue || '').trim();
  return Number.isSafeInteger(id) && id > 0 && canonical ? [{ id, value: canonical }] : [];
}

function buildEditStates(
  workspace: AttributeWorkspace,
  selectedSkuKeys: string[],
): Record<string, AttributeEditState> {
  return Object.fromEntries(workspace.schema.fields.flatMap((field) => {
    const root = workspace.values[String(field.attributeId)];
    const scopes = isSkuMatrixField(field)
      ? selectedSkuKeys.map((skuKey) => ({ skuKey, current: root?.skuValues?.[skuKey] }))
      : [{ skuKey: undefined, current: root }];
    return scopes.map(({ skuKey, current }) => [attributeScopeKey(field.attributeId, skuKey), {
      valueText: editableValueText(current?.value, field),
      evidenceText: Array.isArray(current?.evidence) ? current.evidence.join('\n') : '',
      dictionaryValues: currentDictionaryValues(current),
    }]);
  }));
}

function valuePolicyLabel(value: OzonNormalizedAttributeField['valuePolicy']): string {
  return ({
    STRICT_DICTIONARY: '严格字典',
    OPEN_DICTIONARY: '开放字典',
    FREE_TEXT: '自由文本',
  })[value];
}

function ownershipLabel(value: OzonNormalizedAttributeField['ownership']): string {
  return ({
    SYSTEM: '系统',
    SKU: 'SKU',
    MEDIA: '媒体',
    COMPLIANCE: '合规',
    EDITOR: '编辑器',
  })[value];
}

function sourceLabel(value: OzonListingDraftAttributeValue['source'] | undefined): string {
  return ({ SOURCE: '来源事实', SYSTEM: '系统', AI: 'AI 候选', MANUAL: '人工' } as Record<string, string>)[value || ''] || '未填写';
}

function reviewLabel(value: OzonListingDraftAttributeValue['manualReview'] | undefined, reviewed: boolean | undefined): string {
  if (value === 'CONFIRMED') return '已确认';
  if (value === 'REJECTED') return '已拒绝';
  if (value === 'REQUIRED') return '待人工复核';
  return reviewed ? '已复核' : '未复核';
}

function confidenceLabel(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : '-';
}

function operationLabel(key: keyof AttributeValidationResult['report']['operationReadiness']): string {
  return ({
    ozonImport: 'Ozon 导入',
    inventoryActivation: '库存激活',
    costingAutoPricing: '成本定价',
  })[key];
}

function fieldInputType(field: OzonNormalizedAttributeField): string {
  if (field.valueType === 'INTEGER' || field.valueType === 'DECIMAL') return 'number';
  if (field.valueType === 'DATE') return 'date';
  if (field.valueType === 'DATETIME') return 'datetime-local';
  return 'text';
}

function parsedFreeValue(field: OzonNormalizedAttributeField, rawText: string): unknown {
  if (field.valueType === 'JSON') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`${field.name}不是有效 JSON`);
    }
    if (field.cardinality === 'MULTI' && !Array.isArray(parsed)) {
      throw new Error(`${field.name}必须为 JSON 数组`);
    }
    return parsed;
  }
  const texts = field.cardinality === 'MULTI'
    ? rawText.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
    : [rawText.trim()];
  if (!texts.length || (texts.length === 1 && !texts[0])) throw new Error(`${field.name}不能为空`);
  const parsed = texts.map((value) => {
    if (field.valueType === 'INTEGER') {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error(`${field.name}必须为整数`);
      return number;
    }
    if (field.valueType === 'DECIMAL') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`${field.name}必须为数字`);
      return number;
    }
    if (field.valueType === 'BOOLEAN') {
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`${field.name}必须选择是或否`);
    }
    if (field.valueType === 'UNKNOWN') throw new Error(`${field.name}的字段类型暂不支持编辑`);
    return value;
  });
  return field.cardinality === 'MULTI' ? parsed : parsed[0];
}

export function OzonAttributeEditor({
  itemId,
  selectedSkuKeys,
  shopStorageKey,
  exactWorkflowId,
  exactSnapshotId,
  lockedShopId,
  exactRevision,
  disabled = false,
  onDraftChange,
}: OzonAttributeEditorProps) {
  const exactMode = Boolean(exactWorkflowId || exactSnapshotId || lockedShopId);
  const exactContractComplete = Boolean(exactWorkflowId && exactSnapshotId && lockedShopId);
  const normalizedSkuIdentity = useMemo(() => (
    [...new Set(selectedSkuKeys.map((value) => String(value || '').trim()).filter(Boolean))]
      .sort()
      .join('\u0000')
  ), [selectedSkuKeys]);
  const normalizedSkuKeys = useMemo(
    () => normalizedSkuIdentity ? normalizedSkuIdentity.split('\u0000') : [],
    [normalizedSkuIdentity],
  );
  const [shops, setShops] = useState<OzonShopOption[]>([]);
  const [shopId, setShopId] = useState(lockedShopId || '');
  const [shopsLoading, setShopsLoading] = useState(false);
  const [listingWorkflow, setListingWorkflow] = useState<OzonListingDraft | null>(null);
  const [listingWorkflowLoading, setListingWorkflowLoading] = useState(false);
  const [workspace, setWorkspace] = useState<AttributeWorkspace | null>(null);
  const [authoritativeValidation, setAuthoritativeValidation] = useState<AttributeValidationResult | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [editStates, setEditStates] = useState<Record<string, AttributeEditState>>({});
  const [dictionaryQueries, setDictionaryQueries] = useState<Record<string, string>>({});
  const [dictionarySearches, setDictionarySearches] = useState<Record<string, DictionarySearchState>>({});
  const [skuPageByAttribute, setSkuPageByAttribute] = useState<Record<string, number>>({});
  const [activeSkuKeys, setActiveSkuKeys] = useState<string[]>(normalizedSkuKeys);
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const listingWorkflowRequestIdRef = useRef(0);
  const attributeWorkspaceRequestIdRef = useRef(0);
  const dictionaryRequestIdsRef = useRef<Record<string, number>>({});
  const listingWorkflowServerRef = useRef<OzonListingDraft | null>(null);
  const workspaceRef = useRef<AttributeWorkspace | null>(null);
  const listingWorkflowIdentityQueueRef = useRef<Promise<void>>(Promise.resolve());
  const desiredListingWorkflowIdentityRef = useRef<ListingWorkflowIdentityTarget | null>(null);

  const invalidateDictionarySearches = useCallback(() => {
    for (const key of Object.keys(dictionaryRequestIdsRef.current)) {
      dictionaryRequestIdsRef.current[key] = (dictionaryRequestIdsRef.current[key] || 0) + 1;
    }
    setDictionarySearches({});
  }, []);

  const applyListingWorkflowDraft = useCallback((draft: OzonListingDraft) => {
    listingWorkflowServerRef.current = draft;
    setListingWorkflow(draft);
    setAuthoritativeValidation(authoritativeValidationFromDraft(draft));
    onDraftChange?.(draft);
  }, [onDraftChange]);

  function captureAttributeContext(): AttributeRequestContext | null {
    const desired = desiredListingWorkflowIdentityRef.current;
    const draft = listingWorkflowServerRef.current;
    if (!desired || !draft
      || desired.itemId !== itemId
      || desired.shopId !== shopId
      || desired.skuIdentity !== normalizedSkuIdentity
      || draft.supplyGoodsId !== itemId
      || draft.shopId !== shopId
      || (exactMode && (
        draft.id !== exactWorkflowId
        || draft.sourceCaptureSnapshotId !== exactSnapshotId
        || draft.shopId !== lockedShopId
      ))
      || [...draft.selectedSkuKeys].sort().join('\u0000') !== desired.canonicalSkuIdentity) return null;
    return { identityKey: desired.identityKey, draftId: draft.id, revision: draft.revision };
  }

  function attributeContextIsCurrent(context: AttributeRequestContext): boolean {
    const desired = desiredListingWorkflowIdentityRef.current;
    const draft = listingWorkflowServerRef.current;
    return desired?.identityKey === context.identityKey
      && draft?.id === context.draftId
      && draft.revision === context.revision;
  }

  const refreshAttributeWorkspace = useCallback(async (
    draft: OzonListingDraft,
    expectedIdentityKey?: string,
  ): Promise<boolean> => {
    const desired = desiredListingWorkflowIdentityRef.current;
    if (!desired
      || (expectedIdentityKey && desired.identityKey !== expectedIdentityKey)
      || draft.supplyGoodsId !== desired.itemId
      || draft.shopId !== desired.shopId
      || (exactMode && (
        draft.id !== exactWorkflowId
        || draft.sourceCaptureSnapshotId !== exactSnapshotId
        || draft.shopId !== lockedShopId
      ))
      || [...draft.selectedSkuKeys].sort().join('\u0000') !== desired.canonicalSkuIdentity) return false;
    invalidateDictionarySearches();
    const requestId = ++attributeWorkspaceRequestIdRef.current;
    const contextKey = `${desired.identityKey}:${draft.id}:${draft.revision}`;
    setWorkspaceLoading(true);
    setError('');
    try {
      const res = await api.get<AttributeWorkspace>(
        `/api/source-listing-workflows/${encodeURIComponent(draft.id)}/attributes`,
      );
      const current = listingWorkflowServerRef.current;
      if (attributeWorkspaceRequestIdRef.current !== requestId
        || desiredListingWorkflowIdentityRef.current?.identityKey !== desired.identityKey
        || !current
        || `${desired.identityKey}:${current.id}:${current.revision}` !== contextKey) return false;
      if (res.code === 1 && res.data) {
        workspaceRef.current = res.data;
        setWorkspace(res.data);
        setEditStates(buildEditStates(res.data, desired.canonicalSkuKeys));
        return true;
      }
      setError(res.msg || '读取 Ozon 属性工作区失败');
      return false;
    } catch (caught) {
      if (attributeWorkspaceRequestIdRef.current === requestId
        && desiredListingWorkflowIdentityRef.current?.identityKey === desired.identityKey) {
        setError(caught instanceof Error ? caught.message : '读取 Ozon 属性工作区失败');
      }
      return false;
    } finally {
      if (attributeWorkspaceRequestIdRef.current === requestId) setWorkspaceLoading(false);
    }
  }, [exactMode, exactSnapshotId, exactWorkflowId, invalidateDictionarySearches, lockedShopId]);

  useEffect(() => {
    if (exactMode) {
      setShops([]);
      setShopsLoading(false);
      setShopId(lockedShopId || '');
      return;
    }
    let active = true;
    setShopsLoading(true);
    void (async () => {
      try {
        const res = await api.get<OzonShopOption[]>('/api/shops');
        if (!active) return;
        if (res.code !== 1 || !res.data) throw new Error(res.msg || '读取 Ozon 店铺失败');
        const ozonShops = res.data.filter((shop) => shop.platform === 'OZON');
        setShops(ozonShops);
        let remembered = '';
        try {
          remembered = localStorage.getItem(shopStorageKey) || '';
        } catch {
          remembered = '';
        }
        setShopId((current) => (
          ozonShops.some((shop) => shop.id === current)
            ? current
            : ozonShops.find((shop) => shop.id === remembered)?.id || ozonShops[0]?.id || ''
        ));
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : '读取 Ozon 店铺失败');
      } finally {
        if (active) setShopsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [exactMode, lockedShopId, shopStorageKey]);

  useEffect(() => {
    const requestId = ++listingWorkflowRequestIdRef.current;
    attributeWorkspaceRequestIdRef.current += 1;
    setMessage('');
    setError('');
    setBusyAction('');
    setWorkspaceLoading(false);
    setWorkspace(null);
    workspaceRef.current = null;
    setAuthoritativeValidation(null);
    setSkuPageByAttribute({});
    setActiveSkuKeys(normalizedSkuKeys);
    invalidateDictionarySearches();
    if (exactMode && !exactContractComplete) {
      desiredListingWorkflowIdentityRef.current = null;
      listingWorkflowServerRef.current = null;
      setListingWorkflow(null);
      setListingWorkflowLoading(false);
      setError('精确属性编辑必须同时提供 workflow、snapshot 和锁定店铺');
      return;
    }
    if (exactMode && exactRevision !== undefined
      && (!Number.isSafeInteger(exactRevision) || exactRevision < 1)) {
      setListingWorkflowLoading(false);
      setError('精确属性编辑 revision 无效');
      return;
    }
    if (!shopId || !normalizedSkuKeys.length) {
      desiredListingWorkflowIdentityRef.current = null;
      listingWorkflowServerRef.current = null;
      setListingWorkflow(null);
      setListingWorkflowLoading(false);
      return;
    }
    const previousTarget = desiredListingWorkflowIdentityRef.current;
    const target: ListingWorkflowIdentityTarget = {
      identityKey: exactMode
        ? JSON.stringify([itemId, shopId, normalizedSkuIdentity, exactWorkflowId, exactSnapshotId, exactRevision])
        : listingWorkflowIdentityKey(itemId, shopId, normalizedSkuIdentity),
      itemId,
      shopId,
      selectedSkuKeys: normalizedSkuKeys,
      skuIdentity: normalizedSkuIdentity,
      canonicalSkuKeys: normalizedSkuKeys,
      canonicalSkuIdentity: normalizedSkuIdentity,
    };
    desiredListingWorkflowIdentityRef.current = target;
    if (listingWorkflowServerRef.current?.supplyGoodsId !== itemId) {
      listingWorkflowServerRef.current = null;
      setListingWorkflow(null);
    }
    setListingWorkflowLoading(true);

    const syncIdentity = async () => {
      try {
        if (desiredListingWorkflowIdentityRef.current?.identityKey !== target.identityKey) return;
        const sameRequestedSkuKeys = (draft: OzonListingDraft) => (
          [...draft.selectedSkuKeys].sort().join('\u0000') === target.skuIdentity
        );
        const rememberServerDraft = (draft: OzonListingDraft) => {
          listingWorkflowServerRef.current = draft;
          return draft;
        };
        const patchIdentity = async (
          draft: OzonListingDraft,
          body: { shopId: string } | { selectedSkuKeys: string[] },
          applied: (candidate: OzonListingDraft) => boolean,
        ): Promise<OzonListingDraft> => {
          let candidate = draft;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const res = await api.patch<OzonListingDraft>(
              `/api/source-listing-workflows/${encodeURIComponent(candidate.id)}`,
              { expectedRevision: candidate.revision, ...body },
            );
            if (res.code === 1 && res.data) return rememberServerDraft(res.data);
            const conflict = (res as typeof res & { current?: OzonListingDraft }).current;
            if (conflict) {
              candidate = rememberServerDraft(conflict);
              if (applied(candidate)) return candidate;
              if (attempt === 0) continue;
            }
            throw new Error(res.msg || '更新来源商品草稿身份失败');
          }
          return candidate;
        };

        const adoptCanonicalSkuIdentity = (draft: OzonListingDraft) => {
          const desired = desiredListingWorkflowIdentityRef.current;
          if (desired?.identityKey !== target.identityKey) return false;
          const canonicalSkuKeys = [...new Set(draft.selectedSkuKeys)].sort();
          if (!canonicalSkuKeys.length) return false;
          desiredListingWorkflowIdentityRef.current = {
            ...desired,
            canonicalSkuKeys,
            canonicalSkuIdentity: canonicalSkuKeys.join('\u0000'),
          };
          setActiveSkuKeys(canonicalSkuKeys);
          return true;
        };

        if (exactMode) {
          const res = await api.get<OzonListingDraft>(
            `/api/source-listing-workflows/${encodeURIComponent(exactWorkflowId!)}`,
          );
          if (res.code !== 1 || !res.data) throw new Error(res.msg || '读取精确来源商品草稿失败');
          const exact = rememberServerDraft(res.data);
          const exactSkuIdentity = [...new Set(exact.selectedSkuKeys)].sort().join('\u0000');
          if (exact.id !== exactWorkflowId
            || exact.supplyGoodsId !== itemId
            || exact.shopId !== lockedShopId
            || exact.sourceCaptureSnapshotId !== exactSnapshotId
            || (exactRevision !== undefined && exact.revision < exactRevision)
            || exactSkuIdentity !== normalizedSkuIdentity) {
            throw new Error('精确属性编辑上下文与指定 workflow/snapshot/shop/SKU 不一致');
          }
          if (desiredListingWorkflowIdentityRef.current?.identityKey !== target.identityKey
            || !adoptCanonicalSkuIdentity(exact)) return;
          applyListingWorkflowDraft(exact);
          await refreshAttributeWorkspace(exact, target.identityKey);
          return;
        }

        let current = listingWorkflowServerRef.current;
        const resumedFromServer = !current || current.supplyGoodsId !== target.itemId;
        if (!current || current.supplyGoodsId !== target.itemId) {
          const res = await api.post<OzonListingDraft>('/api/source-listing-workflows', {
            supplyGoodsId: target.itemId,
            shopId: target.shopId,
            selectedSkuKeys: target.selectedSkuKeys,
          });
          if (res.code !== 1 || !res.data) throw new Error(res.msg || '恢复来源商品草稿失败');
          current = rememberServerDraft(res.data);
        }
        if (desiredListingWorkflowIdentityRef.current?.identityKey !== target.identityKey) return;
        if (current.shopId !== target.shopId) {
          current = await patchIdentity(current, { shopId: target.shopId }, (draft) => draft.shopId === target.shopId);
        }
        if (desiredListingWorkflowIdentityRef.current?.identityKey !== target.identityKey) return;
        const requestedSkuSelectionChanged = !previousTarget
          || previousTarget.itemId !== target.itemId
          || previousTarget.skuIdentity !== target.skuIdentity;
        if (!resumedFromServer && requestedSkuSelectionChanged && !sameRequestedSkuKeys(current)) {
          current = await patchIdentity(
            current,
            { selectedSkuKeys: target.selectedSkuKeys },
            sameRequestedSkuKeys,
          );
        }
        if (desiredListingWorkflowIdentityRef.current?.identityKey !== target.identityKey
          || current.shopId !== target.shopId
          || !adoptCanonicalSkuIdentity(current)) return;
        applyListingWorkflowDraft(current);
        await refreshAttributeWorkspace(current, target.identityKey);
      } catch (caught) {
        if (listingWorkflowRequestIdRef.current === requestId
          && desiredListingWorkflowIdentityRef.current?.identityKey === target.identityKey) {
          setError(caught instanceof Error ? caught.message : '恢复来源商品草稿失败');
        }
      } finally {
        if (listingWorkflowRequestIdRef.current === requestId
          && desiredListingWorkflowIdentityRef.current?.identityKey === target.identityKey) {
          setListingWorkflowLoading(false);
        }
      }
    };
    const queued = listingWorkflowIdentityQueueRef.current.catch(() => undefined).then(syncIdentity);
    listingWorkflowIdentityQueueRef.current = queued;
    return () => {
      listingWorkflowRequestIdRef.current += 1;
      attributeWorkspaceRequestIdRef.current += 1;
    };
  }, [
    applyListingWorkflowDraft,
    exactContractComplete,
    exactMode,
    exactRevision,
    exactSnapshotId,
    exactWorkflowId,
    invalidateDictionarySearches,
    itemId,
    lockedShopId,
    normalizedSkuIdentity,
    normalizedSkuKeys,
    refreshAttributeWorkspace,
    shopId,
  ]);

  function handleShopChange(nextShopId: string) {
    if (exactMode || listingWorkflowLoading || busyAction) return;
    setShopId(nextShopId);
    try {
      if (nextShopId) localStorage.setItem(shopStorageKey, nextShopId);
    } catch {
      // The selection remains valid for the current session when storage is unavailable.
    }
  }

  function updateEditState(attributeId: number, patch: Partial<AttributeEditState>, skuKey?: string) {
    const key = attributeScopeKey(attributeId, skuKey);
    setEditStates((current) => ({
      ...current,
      [key]: {
        valueText: '',
        evidenceText: '',
        dictionaryValues: [],
        ...current[key],
        ...patch,
      },
    }));
  }

  function handleDictionaryQueryChange(attributeId: number, value: string, skuKey?: string) {
    const key = attributeScopeKey(attributeId, skuKey);
    dictionaryRequestIdsRef.current[key] = (dictionaryRequestIdsRef.current[key] || 0) + 1;
    setDictionaryQueries((current) => ({ ...current, [key]: value }));
    setDictionarySearches((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function toggleDictionaryValue(field: OzonNormalizedAttributeField, option: DictionaryValue, skuKey?: string) {
    const scopeKey = attributeScopeKey(field.attributeId, skuKey);
    const state = editStates[scopeKey] || { valueText: '', evidenceText: '', dictionaryValues: [] };
    const selected = state.dictionaryValues.some((entry) => entry.id === option.id);
    const dictionaryValues = field.cardinality === 'SINGLE'
      ? [option]
      : selected
        ? state.dictionaryValues.filter((entry) => entry.id !== option.id)
        : [...state.dictionaryValues, option];
    updateEditState(field.attributeId, {
      dictionaryValues,
      valueText: dictionaryValues.map((entry) => entry.value).join('\n'),
    }, skuKey);
  }

  async function searchAttributeDictionary(field: OzonNormalizedAttributeField, skuKey?: string) {
    const context = captureAttributeContext();
    const currentWorkspace = workspaceRef.current;
    if (!context || !currentWorkspace || field.valuePolicy === 'FREE_TEXT') return;
    const key = attributeScopeKey(field.attributeId, skuKey);
    const requestId = (dictionaryRequestIdsRef.current[key] || 0) + 1;
    dictionaryRequestIdsRef.current[key] = requestId;
    setDictionarySearches((current) => ({
      ...current,
      [key]: { loading: true, complete: false, values: current[key]?.values || [], error: '' },
    }));
    const query = encodeURIComponent(dictionaryQueries[key] || '');
    try {
      const res = await api.get<{ attributeId: number; complete: boolean; values: DictionaryValue[] }>(
        `/api/source-listing-workflows/${encodeURIComponent(context.draftId)}/attributes/${field.attributeId}/dictionary?query=${query}&limit=50`,
      );
      if (dictionaryRequestIdsRef.current[key] !== requestId
        || !attributeContextIsCurrent(context)
        || workspaceRef.current?.schemaRevision !== currentWorkspace.schemaRevision) return;
      if (res.code === 1 && res.data) {
        setDictionarySearches((current) => ({
          ...current,
          [key]: { loading: false, complete: res.data!.complete, values: res.data!.values, error: '' },
        }));
      } else {
        setDictionarySearches((current) => ({
          ...current,
          [key]: { loading: false, complete: false, values: [], error: res.msg || '字典搜索失败' },
        }));
      }
    } catch (caught) {
      if (dictionaryRequestIdsRef.current[key] === requestId && attributeContextIsCurrent(context)) {
        setDictionarySearches((current) => ({
          ...current,
          [key]: { loading: false, complete: false, values: [], error: caught instanceof Error ? caught.message : '字典搜索失败' },
        }));
      }
    }
  }

  async function saveAttribute(field: OzonNormalizedAttributeField, skuKey?: string) {
    const context = captureAttributeContext();
    if (!context || busyAction) return;
    if (isSkuMatrixField(field) && (!skuKey || !activeSkuKeys.includes(skuKey))) {
      setError(`${field.name}缺少有效的 SKU 标识`);
      return;
    }
    const scopeKey = attributeScopeKey(field.attributeId, skuKey);
    const edit = editStates[scopeKey] || { valueText: '', evidenceText: '', dictionaryValues: [] };
    setMessage('');
    setError('');
    let change: {
      attributeId: number;
      skuKey?: string;
      value: unknown;
      dictionaryValueId?: number;
      dictionaryValueIds?: number[];
      evidence: string[];
    };
    try {
      const evidence = evidenceLines(edit.evidenceText);
      if (field.ownership === 'COMPLIANCE' && !evidence.length) throw new Error(`${field.name}必须填写人工证据`);
      if (field.valuePolicy === 'STRICT_DICTIONARY' && !edit.dictionaryValues.length) {
        throw new Error(`${field.name}必须从官方字典选择`);
      }
      const selectedDictionary = edit.dictionaryValues;
      const value = selectedDictionary.length
        ? field.cardinality === 'MULTI'
          ? selectedDictionary.map((entry) => entry.value)
          : selectedDictionary[0]!.value
        : parsedFreeValue(field, edit.valueText);
      change = {
        attributeId: field.attributeId,
        ...(skuKey ? { skuKey } : {}),
        value,
        ...(selectedDictionary.length === 1 && field.cardinality === 'SINGLE'
          ? { dictionaryValueId: selectedDictionary[0]!.id }
          : {}),
        ...(selectedDictionary.length && field.cardinality === 'MULTI'
          ? { dictionaryValueIds: selectedDictionary.map((entry) => entry.id) }
          : {}),
        evidence: evidence.length ? evidence : ['manual:web-source-attribute-editor'],
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '属性值无效');
      return;
    }
    setBusyAction(`save:${scopeKey}`);
    try {
      const res = await api.put<OzonListingDraft>(
        `/api/source-listing-workflows/${encodeURIComponent(context.draftId)}/attributes`,
        { expectedRevision: context.revision, changes: [change] },
      );
      if (!attributeContextIsCurrent(context)) return;
      if (res.code === 1 && res.data) {
        applyListingWorkflowDraft(res.data);
        setMessage(skuKey ? `已保存 ${field.name} · ${skuKey}` : `已保存 ${field.name}`);
        await refreshAttributeWorkspace(res.data, context.identityKey);
        return;
      }
      const conflict = (res as typeof res & { current?: OzonListingDraft }).current;
      if (conflict) {
        applyListingWorkflowDraft(conflict);
        await refreshAttributeWorkspace(conflict, context.identityKey);
      }
      setError(res.msg || `保存 ${field.name} 失败`);
    } catch (caught) {
      if (attributeContextIsCurrent(context)) setError(caught instanceof Error ? caught.message : `保存 ${field.name} 失败`);
    } finally {
      if (desiredListingWorkflowIdentityRef.current?.identityKey === context.identityKey) setBusyAction('');
    }
  }

  async function clearAttribute(field: OzonNormalizedAttributeField, skuKey?: string) {
    const context = captureAttributeContext();
    if (!context || busyAction) return;
    if (isSkuMatrixField(field) && (!skuKey || !activeSkuKeys.includes(skuKey))) {
      setError(`${field.name}缺少有效的 SKU 标识`);
      return;
    }
    const scopeKey = attributeScopeKey(field.attributeId, skuKey);
    const edit = editStates[scopeKey] || { valueText: '', evidenceText: '', dictionaryValues: [] };
    const evidence = evidenceLines(edit.evidenceText);
    const change = {
      attributeId: field.attributeId,
      ...(skuKey ? { skuKey } : {}),
      action: 'CLEAR' as const,
      evidence: evidence.length ? evidence : ['manual:web-source-attribute-editor:clear'],
    };
    setBusyAction(`clear:${scopeKey}`);
    setMessage('');
    setError('');
    try {
      const res = await api.put<OzonListingDraft>(
        `/api/source-listing-workflows/${encodeURIComponent(context.draftId)}/attributes`,
        { expectedRevision: context.revision, changes: [change] },
      );
      if (!attributeContextIsCurrent(context)) return;
      if (res.code === 1 && res.data) {
        applyListingWorkflowDraft(res.data);
        setMessage(skuKey ? `已清除 ${field.name} · ${skuKey}` : `已清除 ${field.name}`);
        await refreshAttributeWorkspace(res.data, context.identityKey);
        return;
      }
      const conflict = (res as typeof res & { current?: OzonListingDraft }).current;
      if (conflict) {
        applyListingWorkflowDraft(conflict);
        await refreshAttributeWorkspace(conflict, context.identityKey);
      }
      setError(res.msg || `清除 ${field.name} 失败`);
    } catch (caught) {
      if (attributeContextIsCurrent(context)) setError(caught instanceof Error ? caught.message : `清除 ${field.name} 失败`);
    } finally {
      if (desiredListingWorkflowIdentityRef.current?.identityKey === context.identityKey) setBusyAction('');
    }
  }

  async function applyAttributeSuggestion(attributeId: number) {
    const context = captureAttributeContext();
    if (!context || busyAction) return;
    const suggestion = workspaceRef.current?.suggestions[String(attributeId)];
    if (!suggestion
      || suggestion.draftRevision !== context.revision
      || suggestion.schemaRevision !== workspaceRef.current?.schemaRevision) {
      setError('属性建议已刷新，请重新查看后再采用');
      return;
    }
    const candidate = {
      attributeId,
      candidateId: suggestion.candidateId,
      candidateHash: suggestion.candidateHash,
      schemaRevision: suggestion.schemaRevision,
    };
    setBusyAction(`suggestion:${attributeId}`);
    setMessage('');
    setError('');
    try {
      const res = await api.post<OzonListingDraft>(
        `/api/source-listing-workflows/${encodeURIComponent(context.draftId)}/attributes/suggestions/apply`,
        { expectedRevision: context.revision, candidates: [candidate] },
      );
      if (!attributeContextIsCurrent(context)) return;
      if (res.code === 1 && res.data) {
        applyListingWorkflowDraft(res.data);
        setMessage('建议已采用');
        await refreshAttributeWorkspace(res.data, context.identityKey);
        return;
      }
      const conflict = (res as typeof res & { current?: OzonListingDraft }).current;
      if (conflict) {
        applyListingWorkflowDraft(conflict);
        await refreshAttributeWorkspace(conflict, context.identityKey);
      }
      setError(res.msg || '采用建议失败');
    } catch (caught) {
      if (attributeContextIsCurrent(context)) setError(caught instanceof Error ? caught.message : '采用建议失败');
    } finally {
      if (desiredListingWorkflowIdentityRef.current?.identityKey === context.identityKey) setBusyAction('');
    }
  }

  async function validateOnServer() {
    const context = captureAttributeContext();
    if (!context || busyAction) return;
    setBusyAction('validate');
    setMessage('');
    setError('');
    try {
      const res = await api.post<OzonListingDraft>(
        `/api/source-listing-workflows/${encodeURIComponent(context.draftId)}/validate`,
        { expectedRevision: context.revision },
      );
      if (!attributeContextIsCurrent(context)) return;
      if (res.code === 1 && res.data) {
        applyListingWorkflowDraft(res.data);
        setMessage(res.data.validation.status === 'VALID' ? '服务器校验通过' : '服务器校验完成');
        await refreshAttributeWorkspace(res.data, context.identityKey);
        return;
      }
      const conflict = (res as typeof res & { current?: OzonListingDraft }).current;
      if (conflict) {
        applyListingWorkflowDraft(conflict);
        await refreshAttributeWorkspace(conflict, context.identityKey);
      }
      setError(res.msg || '服务器校验失败');
    } catch (caught) {
      if (attributeContextIsCurrent(context)) setError(caught instanceof Error ? caught.message : '服务器校验失败');
    } finally {
      if (desiredListingWorkflowIdentityRef.current?.identityKey === context.identityKey) setBusyAction('');
    }
  }

  const editorLocked = disabled || listingWorkflowLoading || workspaceLoading || !!busyAction;
  const displayedValidation = authoritativeValidation || workspace?.validationPreview || null;
  const displayedIssues = displayedValidation
    ? [
      ...displayedValidation.blockers.map((issue) => ({ issue, severity: 'BLOCKER' as const })),
      ...displayedValidation.warnings.map((issue) => ({ issue, severity: 'WARNING' as const })),
    ].filter((entry, index, all) => all.findIndex((candidate) => (
      candidate.issue.code === entry.issue.code
      && candidate.issue.fieldPath === entry.issue.fieldPath
    )) === index).slice(0, 20)
    : [];

  function renderAttributeScope(input: {
    field: OzonNormalizedAttributeField;
    current: OzonListingDraftAttributeValue | undefined;
    suggestion: OzonListingDraftAttributeValue | undefined;
    hasRootSuggestion: boolean;
    blocked: BlockedAttributeSuggestion[];
    readOnly: boolean;
    skuKey?: string;
  }) {
    const { field, current, suggestion, hasRootSuggestion, blocked, readOnly, skuKey } = input;
    const scopeKey = attributeScopeKey(field.attributeId, skuKey);
    const edit = editStates[scopeKey] || { valueText: '', evidenceText: '', dictionaryValues: [] };
    const dictionary = dictionarySearches[scopeKey];
    const evidenceId = skuKey
      ? `attribute-evidence-${field.attributeId}-${encodeURIComponent(skuKey)}`
      : `attribute-evidence-${field.attributeId}`;
    return (
      <div
        key={scopeKey}
        className={skuKey ? 'rounded-md border border-dashed bg-muted/10 p-3' : ''}
        data-attribute-scope={scopeKey}
      >
        {skuKey ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">SKU</Badge>
            <span className="min-w-0 break-all font-mono text-xs">{skuKey}</span>
            {!current ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">当前 SKU 值缺失</Badge>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/30 px-3 py-2">
              <span className="text-muted-foreground">当前值</span><span className="break-words text-right">{displayValue(current?.value)}</span>
              <span className="text-muted-foreground">来源</span><span className="text-right">{sourceLabel(current?.source)}</span>
              <span className="text-muted-foreground">置信度</span><span className="text-right">{confidenceLabel(current?.confidence)}</span>
              <span className="text-muted-foreground">复核状态</span><span className="text-right">{reviewLabel(current?.manualReview, current?.reviewed)}</span>
            </div>
            <div className="break-words text-muted-foreground">
              <span className="font-medium text-foreground">证据：</span>
              {current?.evidence?.length ? current.evidence.join('；') : '无'}
            </div>
            {suggestion ? (
              <div className="border-l-2 border-sky-300 pl-2">
                <div><span className="font-medium">建议：</span>{displayValue(suggestion.value)}</div>
                <div className="mt-1 text-muted-foreground">
                  {sourceLabel(suggestion.source)} · 置信度 {confidenceLabel(suggestion.confidence)}
                </div>
                {suggestion.evidence?.length ? <div className="mt-1 break-words text-muted-foreground">{suggestion.evidence.join('；')}</div> : null}
              </div>
            ) : skuKey && hasRootSuggestion && field.aiSuggestionAllowed ? (
              <div className="border-l-2 border-muted-foreground/30 pl-2 text-muted-foreground">该 SKU 暂无建议</div>
            ) : null}
            {blocked.map((entry) => (
              <div
                key={`${entry.fieldPath || scopeKey}:${entry.reasonCode}:${entry.unsupportedValues.join('|')}`}
                className="border-l-2 border-red-300 pl-2 text-red-700"
              >
                <div className="font-medium">阻断原因 · {entry.reasonCode}</div>
                <div className="break-words">{entry.message}</div>
                {entry.unsupportedValues.length ? <div className="break-words">{entry.unsupportedValues.join(' / ')}</div> : null}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {field.valuePolicy !== 'FREE_TEXT' ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={dictionaryQueries[scopeKey] || ''}
                    onChange={(event) => handleDictionaryQueryChange(field.attributeId, event.target.value, skuKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void searchAttributeDictionary(field, skuKey);
                      }
                    }}
                    placeholder="搜索官方字典"
                    aria-label={skuKey ? `${skuKey} ${field.name}字典搜索` : undefined}
                    className="h-8"
                    disabled={readOnly || editorLocked}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    title="搜索字典"
                    aria-label={skuKey ? `搜索 ${skuKey} ${field.name}字典` : '搜索字典'}
                    onClick={() => searchAttributeDictionary(field, skuKey)}
                    disabled={readOnly || editorLocked || dictionary?.loading}
                  >
                    {dictionary?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {edit.dictionaryValues.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {edit.dictionaryValues.map((entry) => (
                      <Badge key={entry.id} variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                        {entry.value} · {entry.id}
                        {!readOnly ? (
                          <button
                            type="button"
                            title="移除字典值"
                            aria-label={`移除 ${entry.value}`}
                            onClick={() => toggleDictionaryValue(field, entry, skuKey)}
                            disabled={editorLocked}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {dictionary?.values.length ? (
                  <div className="max-h-36 overflow-y-auto rounded-md border p-1">
                    {dictionary.values.map((entry) => {
                      const selected = edit.dictionaryValues.some((value) => value.id === entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleDictionaryValue(field, entry, skuKey)}
                          disabled={editorLocked}
                          className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="break-words">{entry.value}</span>
                          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                            {entry.id}{selected ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {dictionary?.error ? <div className="text-xs text-destructive">{dictionary.error}</div> : null}
              </div>
            ) : null}

            {(field.valuePolicy === 'FREE_TEXT' || field.valuePolicy === 'OPEN_DICTIONARY')
              && field.valueType === 'BOOLEAN'
              && field.cardinality === 'SINGLE' ? (
              <select
                value={edit.valueText}
                onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] }, skuKey)}
                disabled={readOnly || editorLocked}
                aria-label={skuKey ? `${skuKey} ${field.name}值` : undefined}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">请选择</option>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : null}
            {(field.valuePolicy === 'FREE_TEXT' || field.valuePolicy === 'OPEN_DICTIONARY')
              && (field.valueType !== 'BOOLEAN' || field.cardinality === 'MULTI') ? (
              field.cardinality === 'MULTI' || field.valueType === 'JSON' ? (
                <textarea
                  value={edit.valueText}
                  onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] }, skuKey)}
                  disabled={readOnly || editorLocked}
                  rows={field.valueType === 'JSON' ? 4 : 3}
                  aria-label={`${skuKey ? `${skuKey} ` : ''}${field.name}值`}
                  className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              ) : (
                <Input
                  type={fieldInputType(field)}
                  value={edit.valueText}
                  onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] }, skuKey)}
                  disabled={readOnly || editorLocked}
                  className="h-8"
                  aria-label={`${skuKey ? `${skuKey} ` : ''}${field.name}值`}
                />
              )
            ) : null}
            {!readOnly ? (
              <div className="space-y-1">
                <label htmlFor={evidenceId} className="text-xs text-muted-foreground">
                  {field.ownership === 'COMPLIANCE' ? '合规证据（必填）' : '人工证据'}
                </label>
                <textarea
                  id={evidenceId}
                  value={edit.evidenceText}
                  onChange={(event) => updateEditState(field.attributeId, { evidenceText: event.target.value }, skuKey)}
                  disabled={editorLocked}
                  rows={2}
                  aria-label={skuKey ? `${skuKey} 人工证据` : undefined}
                  className="w-full resize-y rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ) : null}
            {!readOnly ? (
              <div className="flex justify-end gap-2">
                {current ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    title={skuKey ? `清除 ${skuKey} 的 ${field.name}` : `清除 ${field.name}`}
                    aria-label={skuKey ? `清除 ${skuKey} 的 ${field.name}` : `清除 ${field.name}`}
                    onClick={() => clearAttribute(field, skuKey)}
                    disabled={editorLocked}
                  >
                    {busyAction === `clear:${scopeKey}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => saveAttribute(field, skuKey)} disabled={editorLocked}>
                  {busyAction === `save:${scopeKey}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {skuKey ? '保存该 SKU' : '保存字段'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="Ozon 全字段属性编辑">
      <div className="flex flex-col gap-2 border-y bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Ozon 全字段</span>
          <select
            value={shopId}
            onChange={(event) => handleShopChange(event.target.value)}
            disabled={exactMode || shopsLoading || editorLocked}
            aria-label="Ozon 店铺"
            className="h-8 min-w-0 max-w-64 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {exactMode ? <option value={lockedShopId || ''}>锁定店铺 · {lockedShopId || '无效'}</option> : null}
            {!exactMode && !shops.length ? <option value="">请先添加 Ozon 店铺</option> : null}
            {!exactMode ? shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>) : null}
          </select>
          {exactMode && exactWorkflowId ? <Badge variant="outline">精确草稿 {exactWorkflowId.slice(0, 8)}</Badge> : null}
          {listingWorkflow ? <Badge variant="outline">草稿 v{listingWorkflow.draftVersion} / r{listingWorkflow.revision}</Badge> : null}
          {workspace ? <Badge variant="outline">Schema {workspace.schemaRevision.slice(0, 8)}</Badge> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="重新加载属性"
            onClick={() => {
              const draft = listingWorkflowServerRef.current;
              if (draft) void refreshAttributeWorkspace(draft);
            }}
            disabled={!listingWorkflow || workspaceLoading || !!busyAction}
          >
            {workspaceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            重新加载
          </Button>
          <Button type="button" size="sm" onClick={validateOnServer} disabled={!workspace || editorLocked}>
            {busyAction === 'validate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            服务器校验
          </Button>
        </div>
      </div>

      {displayedValidation ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
          {(Object.keys(displayedValidation.report.operationReadiness) as Array<keyof AttributeValidationResult['report']['operationReadiness']>)
            .map((key) => {
              const operation = displayedValidation.report.operationReadiness[key];
              return (
                <Badge
                  key={key}
                  variant="outline"
                  title={operation.issues.map((issue) => issue.message).join('\n')}
                  className={operation.status === 'READY'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700'}
                >
                  {operation.status === 'READY' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                  {operationLabel(key)} {operation.status === 'READY' ? '就绪' : `阻断 ${operation.issues.length}`}
                </Badge>
              );
            })}
          <Badge variant="outline">
            {authoritativeValidation ? '服务器终检' : '缓存预检'} {displayedValidation.status === 'VALID' ? '通过' : '未通过'}
          </Badge>
          </div>
          {displayedIssues.length ? (
            <div className="divide-y border-y text-xs">
              {displayedIssues.map(({ issue, severity }) => (
                <div key={`${issue.code}:${issue.fieldPath || ''}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3">
                  <span className={severity === 'BLOCKER' ? 'font-medium text-red-700' : 'font-medium text-amber-700'}>
                    {severity === 'BLOCKER' ? '阻断' : '提醒'} · {issue.code}
                  </span>
                  <span className="min-w-0 break-words">
                    {issue.message}{issue.fieldPath ? ` · ${issue.fieldPath}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div> : null}
      {error ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
      {listingWorkflowLoading || (workspaceLoading && !workspace) ? (
        <div className="border px-3 py-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />加载属性工作区
        </div>
      ) : null}

      {workspace ? (
        <div className="space-y-2">
          {workspace.schema.fields.map((field) => {
            const key = String(field.attributeId);
            const current = workspace.values[key];
            const suggestion = workspace.suggestions[key];
            const blocked = workspace.blockedSuggestions.filter((entry) => entry.attributeId === field.attributeId);
            const edit = editStates[key] || { valueText: '', evidenceText: '', dictionaryValues: [] };
            const dictionary = dictionarySearches[key];
            const readOnly = field.editorMode === 'READ_ONLY' || field.editorMode === 'MEDIA_WORKBENCH';
            if (isSkuMatrixField(field)) {
              const suggestedSkuCount = activeSkuKeys
                .filter((skuKey) => suggestion?.skuValues?.[skuKey] != null)
                .length;
              const skuPageCount = Math.max(1, Math.ceil(activeSkuKeys.length / SKU_MATRIX_PAGE_SIZE));
              const skuPage = Math.min(skuPageByAttribute[key] || 0, skuPageCount - 1);
              const skuPageStart = skuPage * SKU_MATRIX_PAGE_SIZE;
              const skuPageEnd = Math.min(skuPageStart + SKU_MATRIX_PAGE_SIZE, activeSkuKeys.length);
              const visibleSkuKeys = activeSkuKeys.slice(skuPageStart, skuPageEnd);
              return (
                <article key={field.attributeId} className="rounded-md border bg-background px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words text-sm font-medium">{field.name}</span>
                        <span className="text-xs text-muted-foreground">#{field.attributeId}</span>
                        {field.required ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">必填</Badge> : null}
                        <Badge variant="outline">{valuePolicyLabel(field.valuePolicy)}</Badge>
                        <Badge variant="outline">{field.cardinality === 'MULTI' ? '多值' : '单值'} · {field.valueType}</Badge>
                        <Badge variant="outline">字段归属 {ownershipLabel(field.ownership)}</Badge>
                        <Badge variant="outline">SKU 矩阵 {activeSkuKeys.length}</Badge>
                      </div>
                      {field.description ? <div className="mt-1 break-words text-xs text-muted-foreground">{field.description}</div> : null}
                    </div>
                    {suggestion ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => applyAttributeSuggestion(field.attributeId)}
                        disabled={editorLocked}
                      >
                        {busyAction === `suggestion:${field.attributeId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        采用 SKU 建议 {suggestedSkuCount}/{activeSkuKeys.length}
                      </Button>
                    ) : null}
                  </div>

                  {activeSkuKeys.length ? (
                    <div className="mt-3 space-y-3">
                      {skuPageCount > 1 ? (
                        <div className="flex flex-col gap-2 border-y bg-muted/20 px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-xs text-muted-foreground">
                            显示 SKU {skuPageStart + 1}-{skuPageEnd}，共 {activeSkuKeys.length}
                          </span>
                          <div
                            className="flex items-center gap-1 self-end sm:self-auto"
                            role="group"
                            aria-label={`${field.name} SKU 分页`}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              title="上一页"
                              aria-label={`${field.name} SKU 上一页`}
                              onClick={() => setSkuPageByAttribute((currentPages) => ({
                                ...currentPages,
                                [key]: Math.max(0, skuPage - 1),
                              }))}
                              disabled={editorLocked || skuPage === 0}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <span className="min-w-[88px] text-center text-xs" aria-live="polite">
                              第 {skuPage + 1} / {skuPageCount} 页
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              title="下一页"
                              aria-label={`${field.name} SKU 下一页`}
                              onClick={() => setSkuPageByAttribute((currentPages) => ({
                                ...currentPages,
                                [key]: Math.min(skuPageCount - 1, skuPage + 1),
                              }))}
                              disabled={editorLocked || skuPage >= skuPageCount - 1}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {visibleSkuKeys.map((skuKey) => renderAttributeScope({
                        field,
                        current: current?.skuValues?.[skuKey],
                        suggestion: suggestion?.skuValues?.[skuKey],
                        hasRootSuggestion: suggestion != null,
                        blocked: blocked.filter((entry) => !entry.skuKey || entry.skuKey === skuKey),
                        readOnly,
                        skuKey,
                      }))}
                    </div>
                  ) : (
                    <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      没有已选 SKU，无法编辑 SKU 字段
                    </div>
                  )}
                </article>
              );
            }
            return (
              <article key={field.attributeId} className="rounded-md border bg-background px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words text-sm font-medium">{field.name}</span>
                      <span className="text-xs text-muted-foreground">#{field.attributeId}</span>
                      {field.required ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">必填</Badge> : null}
                      <Badge variant="outline">{valuePolicyLabel(field.valuePolicy)}</Badge>
                      <Badge variant="outline">{field.cardinality === 'MULTI' ? '多值' : '单值'} · {field.valueType}</Badge>
                      <Badge variant="outline">字段归属 {ownershipLabel(field.ownership)}</Badge>
                    </div>
                    {field.description ? <div className="mt-1 break-words text-xs text-muted-foreground">{field.description}</div> : null}
                  </div>
                  {suggestion ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applyAttributeSuggestion(field.attributeId)}
                      disabled={editorLocked}
                    >
                      {busyAction === `suggestion:${field.attributeId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      采用建议
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">当前值</span><span className="break-words text-right">{displayValue(current?.value)}</span>
                      <span className="text-muted-foreground">来源</span><span className="text-right">{sourceLabel(current?.source)}</span>
                      <span className="text-muted-foreground">置信度</span><span className="text-right">{confidenceLabel(current?.confidence)}</span>
                      <span className="text-muted-foreground">复核状态</span><span className="text-right">{reviewLabel(current?.manualReview, current?.reviewed)}</span>
                    </div>
                    <div className="break-words text-muted-foreground">
                      <span className="font-medium text-foreground">证据：</span>
                      {current?.evidence?.length ? current.evidence.join('；') : '无'}
                    </div>
                    {suggestion ? (
                      <div className="border-l-2 border-sky-300 pl-2">
                        <div><span className="font-medium">建议：</span>{displayValue(suggestion.value)}</div>
                        <div className="mt-1 text-muted-foreground">
                          {sourceLabel(suggestion.source)} · 置信度 {confidenceLabel(suggestion.confidence)}
                        </div>
                        {suggestion.evidence?.length ? <div className="mt-1 break-words text-muted-foreground">{suggestion.evidence.join('；')}</div> : null}
                      </div>
                    ) : null}
                    {blocked.map((entry) => (
                      <div key={`${entry.attributeId}:${entry.reasonCode}`} className="border-l-2 border-red-300 pl-2 text-red-700">
                        <div className="font-medium">阻断原因 · {entry.reasonCode}</div>
                        <div className="break-words">{entry.message}</div>
                        {entry.unsupportedValues.length ? <div className="break-words">{entry.unsupportedValues.join(' / ')}</div> : null}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {field.valuePolicy !== 'FREE_TEXT' ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            value={dictionaryQueries[key] || ''}
                            onChange={(event) => handleDictionaryQueryChange(field.attributeId, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void searchAttributeDictionary(field);
                              }
                            }}
                            placeholder="搜索官方字典"
                            aria-label={`${field.name} 官方字典搜索`}
                            className="h-8"
                            disabled={readOnly || editorLocked}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="搜索字典"
                            aria-label={`搜索 ${field.name} 官方字典`}
                            onClick={() => searchAttributeDictionary(field)}
                            disabled={readOnly || editorLocked || dictionary?.loading}
                          >
                            {dictionary?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        {edit.dictionaryValues.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {edit.dictionaryValues.map((entry) => (
                              <Badge key={entry.id} variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                                {entry.value} · {entry.id}
                                {!readOnly ? (
                                  <button
                                    type="button"
                                    title="移除字典值"
                                    aria-label={`移除 ${entry.value}`}
                                    onClick={() => toggleDictionaryValue(field, entry)}
                                    disabled={editorLocked}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                ) : null}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {dictionary?.values.length ? (
                          <div className="max-h-36 overflow-y-auto rounded-md border p-1">
                            {dictionary.values.map((entry) => {
                              const selected = edit.dictionaryValues.some((value) => value.id === entry.id);
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => toggleDictionaryValue(field, entry)}
                                  disabled={editorLocked}
                                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <span className="break-words">{entry.value}</span>
                                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                                    {entry.id}{selected ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        {dictionary?.error ? <div className="text-xs text-destructive">{dictionary.error}</div> : null}
                      </div>
                    ) : null}

                    {(field.valuePolicy === 'FREE_TEXT' || field.valuePolicy === 'OPEN_DICTIONARY')
                      && field.valueType === 'BOOLEAN'
                      && field.cardinality === 'SINGLE' ? (
                      <select
                        value={edit.valueText}
                        onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] })}
                        disabled={readOnly || editorLocked}
                        aria-label={`${field.name} 值`}
                        className="h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">请选择</option>
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : null}
                    {(field.valuePolicy === 'FREE_TEXT' || field.valuePolicy === 'OPEN_DICTIONARY')
                      && (field.valueType !== 'BOOLEAN' || field.cardinality === 'MULTI') ? (
                      field.cardinality === 'MULTI' || field.valueType === 'JSON' ? (
                        <textarea
                          value={edit.valueText}
                          onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] })}
                          disabled={readOnly || editorLocked}
                          rows={field.valueType === 'JSON' ? 4 : 3}
                          aria-label={`${field.name}值`}
                          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      ) : (
                        <Input
                          type={fieldInputType(field)}
                          value={edit.valueText}
                          onChange={(event) => updateEditState(field.attributeId, { valueText: event.target.value, dictionaryValues: [] })}
                          disabled={readOnly || editorLocked}
                          className="h-8"
                          aria-label={`${field.name}值`}
                        />
                      )
                    ) : null}
                    {!readOnly ? (
                      <div className="space-y-1">
                        <label htmlFor={`attribute-evidence-${field.attributeId}`} className="text-xs text-muted-foreground">
                          {field.ownership === 'COMPLIANCE' ? '合规证据（必填）' : '人工证据'}
                        </label>
                        <textarea
                          id={`attribute-evidence-${field.attributeId}`}
                          value={edit.evidenceText}
                          onChange={(event) => updateEditState(field.attributeId, { evidenceText: event.target.value })}
                          disabled={editorLocked}
                          rows={2}
                          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    ) : null}
                    {!readOnly ? (
                      <div className="flex justify-end gap-2">
                        {current ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            title={`清除 ${field.name}`}
                            aria-label={`清除 ${field.name}`}
                            onClick={() => clearAttribute(field)}
                            disabled={editorLocked}
                          >
                            {busyAction === `clear:${field.attributeId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="outline" onClick={() => saveAttribute(field)} disabled={editorLocked}>
                          {busyAction === `save:${field.attributeId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          保存字段
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
