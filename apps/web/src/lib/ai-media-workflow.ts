import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared/ozon-listing-draft';

export type AiMediaOperation = 'IMAGE_TO_IMAGE' | 'IMAGE_TRANSLATE';
export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaContextInput {
  sourceMediaKey: string;
  role: string;
  sourceUrl: string;
  assetId: string | null;
  assetUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

export interface AiMediaContextResponse {
  target: { type: 'collect'; id: string; label: string };
  snapshot: { id: string; version: number; captureHash: string };
  inputs: AiMediaContextInput[];
}

export interface AiImageTranslationTerminology {
  src: string;
  tgt: string;
}

export interface AiMediaWorkflowJob {
  id: string;
  operation?: AiMediaOperation;
  status: string;
  prompt?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerJobId?: string | null;
  costStatus?: 'RESERVED' | 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED' | 'SETTLED' | 'RELEASED' | null;
  appliedMode?: 'append' | 'replace' | null;
  translation?: {
    sourceLanguage: string;
    targetLanguage: string;
    policyVersion: string;
    terminologies?: AiImageTranslationTerminology[];
  };
  assets?: Array<{ id: string; url: string; mimeType?: string; width?: number | null; height?: number | null }>;
}

export interface AiMediaWorkflow {
  id: string;
  operation: AiMediaOperation;
  status: AiMediaWorkflowStatus;
  reviewStatus: AiMediaReviewStatus;
  revision: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt?: string;
  completedAt: string | null;
  inputs: Array<{ assetId: string; url: string }>;
  jobs: AiMediaWorkflowJob[];
}

export interface AiMediaOperationReadiness {
  enabled: boolean;
  ready: boolean;
  testOnly?: boolean;
  reasonCode: 'READY' | 'AI_MEDIA_WORKFLOW_DISABLED' | 'AI_MEDIA_OPERATION_DISABLED'
    | 'SOURCE_LISTING_WEB_MEDIA_DISABLED' | 'PROVIDER_NOT_READY' | 'STORAGE_NOT_READY';
  reason: string;
}

export interface AiMediaCapabilities {
  webMediaEnabled: boolean;
  workflowEnabled: boolean;
  operations: Partial<Record<AiMediaOperation, AiMediaOperationReadiness>>;
}

/**
 * Public, provider-neutral planning data. The server owns the source of truth;
 * these DTOs deliberately contain only reviewable evidence and plan metadata.
 */
export type AiMediaPlanningReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaPlanRecord {
  id: string;
  revision: number;
  latestVersion: number;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  reviewStatus: AiMediaPlanningReviewStatus;
  sourceCaptureSnapshotId: string | null;
  staleAt: string | null;
  staleReasons: string[];
  sourceCurrent: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AiMediaPlanCurationDecision {
  candidateId: string;
  disposition: 'keep' | 'reject' | 'manual';
  reasonCodes: string[];
  translation: 'translate' | 'skip' | 'unknown';
  contentRole: 'identity' | 'context' | 'detail' | 'unknown';
  score: number | null;
  duplicateOfCandidateId: string | null;
  continuity: { groupKey: string; index: number; total: number } | null;
}

export interface AiMediaPlanCuration {
  version: string;
  mode: 'deterministic' | 'model' | 'fallback';
  consideredCandidateIds: string[];
  selectedCandidateIds: string[];
  decisions: AiMediaPlanCurationDecision[];
  selectionTarget: {
    minimum: number;
    maximum: number;
    eligibleCount: number;
    selectedCount: number;
    met: boolean;
  } | null;
  diagnostics: Array<{ code: string; candidateId: string }>;
  fallbackReason: string | null;
}

export interface AiMediaPlanCompatibilityGroup {
  groupKey: string;
  identitySignature: string;
  skuKeys: string[];
}

export interface AiMediaPlanSlotReference {
  candidateId: string;
  evidenceIds: string[];
}

export interface AiMediaPlanSlot {
  slotKey: string;
  goal: string;
  status: 'READY' | 'MANUAL_REQUIRED';
  aspectRatio: string;
  ownership: { level: 'sku' | 'compatibility_group'; key: string };
  references: AiMediaPlanSlotReference[];
  factEvidenceIds: string[];
  safetyConstraints: string[];
  acceptanceChecks: string[];
}

export interface AiMediaPlanPayload {
  version: string;
  mode: 'rule_based' | 'model' | 'fallback';
  compatibilityGroups: AiMediaPlanCompatibilityGroup[];
  slots: AiMediaPlanSlot[];
  verifiedFacts: Array<{ path: string; value: unknown; evidenceIds: string[]; skuKeys: string[] }>;
  diagnostics: Array<{ code: string; slotKey: string; candidateId: string | null }>;
  fallbackReason: string | null;
}

export interface AiMediaPlanVersion {
  id: string;
  planId: string;
  version: number;
  sourceCaptureSnapshotId: string;
  planPayload: AiMediaPlanPayload | null;
  curation: AiMediaPlanCuration | null;
  visionEvidence: unknown;
  provenance: unknown;
  createdAt: string | null;
}

export interface AiMediaPlanBundle {
  plan: AiMediaPlanRecord;
  currentVersion: AiMediaPlanVersion | null;
}

const AI_MEDIA_PLAN_MAX_ITEMS = 500;
const AI_MEDIA_PLAN_MAX_TEXT = 2_000;

function planningObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function planningText(value: unknown, max = AI_MEDIA_PLAN_MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function planningTextArray(value: unknown, max = AI_MEDIA_PLAN_MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .map((item) => planningText(item))
    .filter((item): item is string => Boolean(item));
}

function planningNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function planningDate(value: unknown): string | null {
  const text = planningText(value, 128);
  return text;
}

function planningReviewStatus(value: unknown): AiMediaPlanningReviewStatus {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED' ? value : 'NOT_READY';
}

function normalizePlanningCuration(value: unknown): AiMediaPlanCuration | null {
  const object = planningObject(value);
  if (!object) return null;
  const decisions: AiMediaPlanCurationDecision[] = Array.isArray(object.decisions) ? object.decisions.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
    const item = planningObject(entry);
    const candidateId = planningText(item?.candidateId, 500);
    if (!item || !candidateId) return [];
    const disposition: AiMediaPlanCurationDecision['disposition'] = item.disposition === 'keep' || item.disposition === 'reject' || item.disposition === 'manual'
      ? item.disposition
      : 'manual';
    const translation: AiMediaPlanCurationDecision['translation'] = item.translation === 'translate' || item.translation === 'skip' ? item.translation : 'unknown';
    const contentRole: AiMediaPlanCurationDecision['contentRole'] = item.contentRole === 'identity' || item.contentRole === 'context' || item.contentRole === 'detail'
      ? item.contentRole
      : 'unknown';
    const continuityValue = planningObject(item.continuity);
    const continuity = continuityValue && planningText(continuityValue.groupKey, 500)
      ? {
        groupKey: planningText(continuityValue.groupKey, 500)!,
        index: Math.max(0, Math.floor(planningNumber(continuityValue.index))),
        total: Math.max(0, Math.floor(planningNumber(continuityValue.total))),
      }
      : null;
    const score = item.score === null ? null : planningNumber(item.score, Number.NaN);
    return [{
      candidateId,
      disposition,
      reasonCodes: planningTextArray(item.reasonCodes, 32),
      translation,
      contentRole,
      score: Number.isFinite(score) ? score : null,
      duplicateOfCandidateId: planningText(item.duplicateOfCandidateId, 500),
      continuity,
    }];
  }) : [];
  const selectionTargetValue = planningObject(object.selectionTarget);
  const selectionTarget = selectionTargetValue ? {
    minimum: Math.max(0, Math.floor(planningNumber(selectionTargetValue.minimum))),
    maximum: Math.max(0, Math.floor(planningNumber(selectionTargetValue.maximum))),
    eligibleCount: Math.max(0, Math.floor(planningNumber(selectionTargetValue.eligibleCount))),
    selectedCount: Math.max(0, Math.floor(planningNumber(selectionTargetValue.selectedCount))),
    met: selectionTargetValue.met === true,
  } : null;
  return {
    version: planningText(object.version, 100) || 'unknown',
    mode: object.mode === 'model' || object.mode === 'fallback' ? object.mode : 'deterministic',
    consideredCandidateIds: planningTextArray(object.consideredCandidateIds, AI_MEDIA_PLAN_MAX_ITEMS),
    selectedCandidateIds: planningTextArray(object.selectedCandidateIds, AI_MEDIA_PLAN_MAX_ITEMS),
    decisions,
    selectionTarget,
    diagnostics: Array.isArray(object.diagnostics) ? object.diagnostics.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
      const item = planningObject(entry);
      const code = planningText(item?.code, 200);
      const candidateId = planningText(item?.candidateId, 500);
      return code && candidateId ? [{ code, candidateId }] : [];
    }) : [],
    fallbackReason: planningText(object.fallbackReason, 200),
  };
}

function normalizePlanningPayload(value: unknown): AiMediaPlanPayload | null {
  const object = planningObject(value);
  if (!object) return null;
  const groups = Array.isArray(object.compatibilityGroups) ? object.compatibilityGroups.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
    const item = planningObject(entry);
    const groupKey = planningText(item?.groupKey, 500);
    if (!item || !groupKey) return [];
    return [{
      groupKey,
      identitySignature: planningText(item.identitySignature, 500) || 'unknown',
      skuKeys: planningTextArray(item.skuKeys, AI_MEDIA_PLAN_MAX_ITEMS),
    }];
  }) : [];
  const slots: AiMediaPlanSlot[] = Array.isArray(object.slots) ? object.slots.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
    const item = planningObject(entry);
    const slotKey = planningText(item?.slotKey, 1_024);
    const ownershipValue = planningObject(item?.ownership);
    const ownershipKey = planningText(ownershipValue?.key, 500);
    if (!item || !slotKey || !ownershipKey) return [];
    const ownershipLevel: AiMediaPlanSlot['ownership']['level'] = ownershipValue?.level === 'sku' ? 'sku' : 'compatibility_group';
    const references = Array.isArray(item.references) ? item.references.slice(0, 20).flatMap((entry) => {
      const reference = planningObject(entry);
      const candidateId = planningText(reference?.candidateId, 500);
      return candidateId ? [{ candidateId, evidenceIds: planningTextArray(reference?.evidenceIds, 32) }] : [];
    }) : [];
    return [{
      slotKey,
      goal: planningText(item.goal, 200) || 'unknown',
      status: item.status === 'READY' ? 'READY' as const : 'MANUAL_REQUIRED' as const,
      aspectRatio: planningText(item.aspectRatio, 50) || '3:4',
      ownership: { level: ownershipLevel, key: ownershipKey },
      references,
      factEvidenceIds: planningTextArray(item.factEvidenceIds, 64),
      safetyConstraints: planningTextArray(item.safetyConstraints, 32),
      acceptanceChecks: planningTextArray(item.acceptanceChecks, 32),
    }];
  }) : [];
  const verifiedFacts = Array.isArray(object.verifiedFacts) ? object.verifiedFacts.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
    const item = planningObject(entry);
    const path = planningText(item?.path, 1_024);
    if (!item || !path) return [];
    return [{ path, value: item.value, evidenceIds: planningTextArray(item.evidenceIds, 64), skuKeys: planningTextArray(item.skuKeys, AI_MEDIA_PLAN_MAX_ITEMS) }];
  }) : [];
  const diagnostics = Array.isArray(object.diagnostics) ? object.diagnostics.slice(0, AI_MEDIA_PLAN_MAX_ITEMS).flatMap((entry) => {
    const item = planningObject(entry);
    const code = planningText(item?.code, 200);
    const slotKey = planningText(item?.slotKey, 1_024);
    return code && slotKey ? [{ code, slotKey, candidateId: planningText(item?.candidateId, 500) }] : [];
  }) : [];
  return {
    version: planningText(object.version, 100) || 'unknown',
    mode: object.mode === 'model' || object.mode === 'fallback' ? object.mode : 'rule_based',
    compatibilityGroups: groups,
    slots,
    verifiedFacts,
    diagnostics,
    fallbackReason: planningText(object.fallbackReason, 200),
  };
}

function normalizePlanningVersion(value: unknown, fallbackPlanId: string): AiMediaPlanVersion | null {
  const object = planningObject(value);
  if (!object) return null;
  const id = planningText(object.id, 200);
  if (!id) return null;
  const planId = planningText(object.planId, 200) || fallbackPlanId;
  const payloadObject = planningObject(object.planPayload);
  const payloadCandidate = payloadObject && planningObject(payloadObject.plan)
    ? payloadObject.plan
    : object.planPayload;
  const planPayload = normalizePlanningPayload(payloadCandidate);
  const curation = normalizePlanningCuration(object.curation)
    || (payloadObject ? normalizePlanningCuration(payloadObject.curation) : null);
  return {
    id,
    planId,
    version: Math.max(0, Math.floor(planningNumber(object.version))),
    sourceCaptureSnapshotId: planningText(object.sourceCaptureSnapshotId, 200) || '',
    planPayload,
    curation,
    visionEvidence: object.visionEvidence ?? null,
    provenance: object.provenance ?? null,
    createdAt: planningDate(object.createdAt),
  };
}

/** Normalize an API plan response and reject malformed/oversized payloads. */
export function normalizeAiMediaPlanBundle(value: unknown): AiMediaPlanBundle | null {
  if (value === null || value === undefined) return null;
  const root = planningObject(value);
  if (!root) return null;
  const planValue = planningObject(root.plan) || root;
  const id = planningText(planValue.id, 200);
  if (!id) return null;
  const plan: AiMediaPlanRecord = {
    id,
    revision: Math.max(1, Math.floor(planningNumber(planValue.revision, 1))),
    latestVersion: Math.max(0, Math.floor(planningNumber(planValue.latestVersion))),
    currentVersionId: planningText(planValue.currentVersionId, 200),
    approvedVersionId: planningText(planValue.approvedVersionId, 200),
    reviewStatus: planningReviewStatus(planValue.reviewStatus),
    sourceCaptureSnapshotId: planningText(planValue.sourceCaptureSnapshotId, 200),
    staleAt: planningDate(planValue.staleAt),
    staleReasons: planningTextArray(planValue.staleReasons, 32),
    sourceCurrent: typeof planValue.sourceCurrent === 'boolean' ? planValue.sourceCurrent : null,
    createdAt: planningDate(planValue.createdAt),
    updatedAt: planningDate(planValue.updatedAt),
  };
  const versionValue = root.currentVersion ?? root.version ?? planValue.currentVersion;
  const currentVersion = normalizePlanningVersion(versionValue, id);
  if (currentVersion && !plan.sourceCaptureSnapshotId) plan.sourceCaptureSnapshotId = currentVersion.sourceCaptureSnapshotId || null;
  return { plan, currentVersion };
}

export function canRegenerateAiMediaPlan(
  plan: Pick<AiMediaPlanRecord, 'reviewStatus' | 'staleAt' | 'sourceCurrent'>,
): boolean {
  return plan.reviewStatus === 'REJECTED' || Boolean(plan.staleAt) || plan.sourceCurrent === false;
}

export function canApproveAiMediaPlan(bundle: AiMediaPlanBundle): boolean {
  const version = bundle.currentVersion;
  const target = version?.curation?.selectionTarget;
  const slots = version?.planPayload?.slots;
  if (!version || !target?.met || !slots?.length) return false;
  return slots.every((slot) => (
    slot.status === 'READY'
    && slot.goal !== 'unknown'
    && Boolean(slot.ownership.key)
    && slot.references.length > 0
    && slot.references.every((reference) => (
      Boolean(reference.candidateId) && reference.evidenceIds.length > 0
    ))
    && slot.safetyConstraints.length > 0
    && slot.acceptanceChecks.length > 0
  ));
}

export function formatAiMediaPlanningIdentity(value: string): string {
  return value === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY ? '商品级' : value;
}

export function formatAiMediaPlanningSlotKey(value: string): string {
  return value.replaceAll(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY, '商品级');
}

export function buildAiMediaPlanReviewRequest(input: {
  expectedRevision: number;
  operationKey: string;
  decision: 'APPROVE' | 'REJECT';
  note?: string | null;
}) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error('计划版本已失效，请刷新后重试');
  }
  const operationKey = input.operationKey.trim();
  if (operationKey.length < 8 || operationKey.length > 128) throw new Error('审核操作标识无效');
  const note = input.note?.trim() || null;
  if (note && note.length > 2_000) throw new Error('审核备注不能超过 2000 个字符');
  return { expectedRevision: input.expectedRevision, operationKey, decision: input.decision, note };
}

export function describeAiMediaReadiness(
  operation: AiMediaOperation,
  readiness: AiMediaOperationReadiness,
): string {
  if (readiness.ready && readiness.testOnly) {
    return '当前使用本地测试 Provider，结果不代表真实 AI 效果。';
  }
  if (readiness.reasonCode === 'SOURCE_LISTING_WEB_MEDIA_DISABLED') {
    return 'Web 媒体工具当前关闭。';
  }
  if (readiness.reasonCode === 'AI_MEDIA_WORKFLOW_DISABLED') {
    return 'AI 媒体工作流当前未对该账号开放。';
  }
  if (readiness.reasonCode === 'AI_MEDIA_OPERATION_DISABLED') {
    return operation === 'IMAGE_TRANSLATE' ? '图片翻译当前关闭。' : 'AI 改图当前关闭。';
  }
  if (readiness.reasonCode === 'PROVIDER_NOT_READY') {
    return operation === 'IMAGE_TRANSLATE'
      ? '图片翻译 Provider 尚未完成生产验证。'
      : 'AI 改图 Provider 尚未完成生产验证。';
  }
  if (readiness.reasonCode === 'STORAGE_NOT_READY') {
    return '图片翻译需要可用的 OSS 或本地存储，当前存储配置不兼容。';
  }
  return readiness.reason;
}

export interface WorkflowSubmissionIntent {
  fingerprint: string;
  idempotencyKey: string;
  createdAt: number;
}

export const AI_MEDIA_INTENT_TTL_MS = 15 * 60 * 1_000;

export interface WorkflowIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resolveWorkflowSubmissionIntent(
  current: WorkflowSubmissionIntent | null,
  fingerprint: string,
  createKey: () => string,
  options: { now?: number; ttlMs?: number } = {},
): WorkflowSubmissionIntent {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? AI_MEDIA_INTENT_TTL_MS;
  if (
    current?.fingerprint === fingerprint
    && Number.isSafeInteger(current.createdAt)
    && current.createdAt <= now
    && now - current.createdAt <= ttlMs
  ) return current;
  return { fingerprint, idempotencyKey: createKey(), createdAt: now };
}

function validWorkflowSubmissionIntent(value: unknown): value is WorkflowSubmissionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fingerprint === 'string'
    && candidate.fingerprint.length > 0
    && candidate.fingerprint.length <= 100_000
    && typeof candidate.idempotencyKey === 'string'
    && candidate.idempotencyKey.length >= 8
    && candidate.idempotencyKey.length <= 128
    && Number.isSafeInteger(candidate.createdAt);
}

export function loadWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  options: { now?: number; ttlMs?: number } = {},
): WorkflowSubmissionIntent | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validWorkflowSubmissionIntent(parsed)) {
      storage.removeItem(key);
      return null;
    }
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? AI_MEDIA_INTENT_TTL_MS;
    if (parsed.createdAt > now || now - parsed.createdAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  intent: WorkflowSubmissionIntent,
): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(intent));
  } catch {
    // Private browsing and quota failures must not block a submission.
  }
}

export function clearWorkflowSubmissionIntent(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable after a browser context is closed.
  }
}

export function isDefinitiveWorkflowSubmissionFailure(code: unknown): boolean {
  return new Set([
    'INVALID_REQUEST',
    'AI_MEDIA_WORKFLOW_DISABLED',
    'AI_MEDIA_OPERATION_DISABLED',
    'PROVIDER_NOT_READY',
    'SOURCE_ASSET_NOT_FOUND',
    'SOURCE_ASSET_INVALID',
    'SOURCE_ASSET_DUPLICATE',
    'AI_MEDIA_CONTEXT_MISMATCH',
    'IDEMPOTENCY_KEY_CONFLICT',
    'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
    'QUEUE_UNAVAILABLE',
  ]).has(String(code || '').toUpperCase());
}

function languageTag(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(normalized)) {
    throw new Error('翻译语言代码无效');
  }
  return normalized;
}

export function normalizeImageTranslationTerminologies(
  entries: AiImageTranslationTerminology[],
): AiImageTranslationTerminology[] {
  if (entries.length > 50) throw new Error('术语表最多支持 50 条');
  const bySource = new Map<string, AiImageTranslationTerminology>();
  for (const entry of entries) {
    const src = String(entry.src || '').trim();
    const tgt = String(entry.tgt || '').trim();
    if (!src && !tgt) continue;
    if (!src || !tgt) throw new Error('每条术语都需要填写原文和译文');
    if (src.length > 120 || tgt.length > 120) throw new Error('单条术语不能超过 120 个字符');
    const key = src.toLocaleLowerCase();
    const existing = bySource.get(key);
    if (existing && existing.tgt.toLocaleLowerCase() !== tgt.toLocaleLowerCase()) {
      throw new Error(`术语“${src}”存在冲突译文`);
    }
    if (!existing) bySource.set(key, { src, tgt });
  }
  return [...bySource.values()];
}

export function buildImageTranslationWorkflowRequest(input: {
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  terminologies: AiImageTranslationTerminology[];
  idempotencyKey: string;
  contextId: string;
}) {
  const sourceAssetId = input.sourceAssetId.trim();
  const contextId = input.contextId.trim();
  if (!sourceAssetId || !contextId) throw new Error('请选择当前商品的源图');
  const sourceLanguage = languageTag(input.sourceLanguage);
  const targetLanguage = languageTag(input.targetLanguage);
  if (sourceLanguage === targetLanguage) throw new Error('源语言和目标语言不能相同');
  const domainHint = input.domainHint.trim();
  if (new TextEncoder().encode(domainHint).byteLength > 2_000) {
    throw new Error('翻译要求不能超过 2000 字节');
  }
  return {
    operation: 'IMAGE_TRANSLATE' as const,
    sourceAssetId,
    sourceLanguage,
    targetLanguage,
    domainHint,
    terminologies: normalizeImageTranslationTerminologies(input.terminologies),
    idempotencyKey: input.idempotencyKey,
    context: { type: 'collect' as const, id: contextId },
  };
}

export function isAiMediaWorkflowInputCurrent(
  workflow: Pick<AiMediaWorkflow, 'inputs'>,
  currentInputs: AiMediaContextInput[],
) {
  if (!workflow.inputs.length) return false;
  const currentAssetIds = new Set(currentInputs.map((input) => input.assetId).filter(Boolean));
  return workflow.inputs.every((input) => currentAssetIds.has(input.assetId));
}
