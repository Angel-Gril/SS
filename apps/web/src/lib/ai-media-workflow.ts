import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared/ozon-listing-draft';
import type {
  AiMediaApplicationCapability,
  AiMediaWorkflowApplicationSummary,
} from './ai-media-application';

export type AiMediaOperation = 'IMAGE_TO_IMAGE' | 'IMAGE_TRANSLATE' | 'FULL_EDIT' | 'INPAINT';
export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type AiMediaProviderReconciliationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW'
  | 'RECOVERED'
  | 'NO_OUTPUT'
  | 'NOT_SUBMITTED'
  | 'CANCELLED_OUTPUT_RETAINED';

export interface AiMediaProviderReconciliation {
  status: AiMediaProviderReconciliationStatus;
  revision: number;
  attemptCount: number;
  nextAt: string | null;
  deadlineAt: string | null;
  lastProviderStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  reconciledAt: string | null;
  actionRequired: boolean;
}

export const AI_MEDIA_EXECUTION_POLL_INTERVAL_MS = 2_000;
export const AI_MEDIA_REVIEW_POLL_INTERVAL_MS = 30_000;

export interface AiMediaContextInput {
  sourceMediaKey: string;
  role: string;
  sourceUrl: string;
  assetId: string | null;
  assetUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  editReady?: boolean;
  compatibleAssetIds?: string[];
  sourceCaptureSnapshotId?: string | null;
  contextSkuKey?: string | null;
  contextSlotKey?: string | null;
  scope?: 'PRODUCT' | 'SKU';
  skuKeys?: string[];
}

export type AiMediaContextTarget =
  | {
    type: 'collect';
    id: string;
    label: string;
  }
  | {
    type: 'listing-draft';
    id: string;
    label: string;
    revision: number;
    draftVersion: number;
    skuKey: string | null;
    slotKey: string | null;
    assignedAssetId: string | null;
  };

export type AiMediaWorkflowContextRequest =
  | {
    type: 'collect';
    id: string;
    skuKey?: string | null;
    slotKey?: string | null;
  }
  | {
    type: 'listing-draft';
    id: string;
    revision: number;
    draftVersion: number;
    skuKey?: string | null;
    slotKey?: string | null;
  };

export interface AiMediaContextResponse {
  target: AiMediaContextTarget;
  snapshot: { id: string; version: number; captureHash: string };
  selectedSkuKeys?: string[];
  inputs: AiMediaContextInput[];
}

export interface AiMediaInternalizedAsset {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  editReady?: boolean;
}

export interface AiImageEditMaskAsset {
  id: string;
  url: string;
  mimeType: 'image/png' | string;
  width: number;
  height: number;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
  editPixelCount: number;
  preservedPixelCount: number;
  featheredPixelCount: number;
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
  retryAllowed?: boolean;
  providerReconciliation?: AiMediaProviderReconciliation;
  appliedMode?: 'append' | 'replace' | null;
  translation?: {
    sourceLanguage: string;
    targetLanguage: string;
    policyVersion: string;
    terminologies?: AiImageTranslationTerminology[];
  };
  assets?: Array<{
    id: string;
    kind?: string;
    url: string;
    mimeType?: string;
    width?: number | null;
    height?: number | null;
    sourceCaptureSnapshotId?: string | null;
    editReady?: boolean;
  }>;
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
  contextType: string | null;
  contextId: string | null;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  contextDraftRevision: number | null;
  contextDraftVersion: number | null;
  selectedOutputAssetId?: string | null;
  reviewedAt?: string | null;
  application?: AiMediaWorkflowApplicationSummary | null;
  inputs: Array<{
    assetId: string;
    role?: 'REFERENCE' | 'MASK' | string;
    ordinal?: number;
    url: string;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    kind?: string;
    sourceCaptureSnapshotId?: string | null;
  }>;
  jobs: AiMediaWorkflowJob[];
}

export interface AiMediaWorkflowPage {
  items: AiMediaWorkflow[];
  priorityItems: AiMediaWorkflow[];
  priorityItemsTruncated: boolean;
  priorityNextCursor?: string | null;
  nextCursor: string | null;
}

export function aiMediaWorkflowReviewOutput(
  workflow: AiMediaWorkflow,
  job?: AiMediaWorkflowJob,
) {
  const assets = job?.assets || [];
  if (workflow.selectedOutputAssetId) {
    return assets.find((asset) => asset.id === workflow.selectedOutputAssetId);
  }
  return assets.length === 1 ? assets[0] : undefined;
}

export function shouldRefreshAiMediaWorkflow(workflow: AiMediaWorkflow) {
  if (workflow.status === 'QUEUED' || workflow.status === 'RUNNING' || workflow.status === 'CANCEL_REQUESTED') {
    return true;
  }
  const latestJob = workflow.jobs[workflow.jobs.length - 1];
  if (latestJob && aiMediaProviderReconciliationPending(latestJob)) return true;
  return workflow.status === 'SUCCEEDED' && (
    workflow.reviewStatus === 'PENDING'
    || (workflow.reviewStatus === 'APPROVED' && !workflow.application && !latestJob?.appliedMode)
  );
}

const AI_MEDIA_PROVIDER_RECONCILIATION_PENDING = new Set<AiMediaProviderReconciliationStatus>([
  'PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW',
]);

export function aiMediaProviderReconciliationPending(
  job: Pick<AiMediaWorkflowJob, 'providerReconciliation'>,
): boolean {
  return Boolean(
    job.providerReconciliation
    && AI_MEDIA_PROVIDER_RECONCILIATION_PENDING.has(job.providerReconciliation.status),
  );
}

export function aiMediaWorkflowPollInterval(workflows: AiMediaWorkflow[]) {
  if (workflows.some((workflow) => (
    workflow.status === 'QUEUED'
    || workflow.status === 'RUNNING'
    || workflow.status === 'CANCEL_REQUESTED'
  ))) return AI_MEDIA_EXECUTION_POLL_INTERVAL_MS;
  return workflows.some(shouldRefreshAiMediaWorkflow)
    ? AI_MEDIA_REVIEW_POLL_INTERVAL_MS
    : null;
}

export interface AiMediaWorkflowPriorityPage {
  items: AiMediaWorkflow[];
  nextCursor: string | null;
}

function validAiMediaWorkflowCursor(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string'
    && Boolean(value)
    && value.length <= 1_000
    && /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

export function normalizeAiMediaWorkflowPage(value: unknown): AiMediaWorkflowPage | null {
  if (Array.isArray(value)) {
    return {
      items: value as AiMediaWorkflow[],
      priorityItems: [],
      priorityItemsTruncated: false,
      nextCursor: null,
    };
  }
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items)) return null;
  if (page.priorityItems !== undefined && !Array.isArray(page.priorityItems)) return null;
  if (page.priorityItemsTruncated !== undefined && typeof page.priorityItemsTruncated !== 'boolean') return null;
  if (!validAiMediaWorkflowCursor(page.nextCursor)) return null;
  const hasPriorityCursor = Object.prototype.hasOwnProperty.call(page, 'priorityNextCursor');
  if (hasPriorityCursor && !validAiMediaWorkflowCursor(page.priorityNextCursor)) return null;
  return {
    items: page.items as AiMediaWorkflow[],
    priorityItems: (page.priorityItems || []) as AiMediaWorkflow[],
    priorityItemsTruncated: page.priorityItemsTruncated === true,
    ...(hasPriorityCursor ? { priorityNextCursor: page.priorityNextCursor as string | null } : {}),
    nextCursor: page.nextCursor as string | null,
  };
}

export function normalizeAiMediaWorkflowPriorityPage(value: unknown): AiMediaWorkflowPriorityPage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || !validAiMediaWorkflowCursor(page.nextCursor)) return null;
  return { items: page.items as AiMediaWorkflow[], nextCursor: page.nextCursor as string | null };
}

function sortAiMediaWorkflowHistory(items: AiMediaWorkflow[]) {
  return items.sort((left, right) => {
    const dateOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (dateOrder) return dateOrder;
    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
  });
}

const AI_MEDIA_COST_STATUS_RANK: Record<NonNullable<AiMediaWorkflowJob['costStatus']>, number> = {
  RESERVED: 0,
  SUBMISSION_UNCERTAIN: 1,
  RECONCILIATION_REQUIRED: 2,
  SETTLED: 3,
  RELEASED: 3,
};

function mergeMonotonicAiMediaApplication(
  current: AiMediaWorkflowApplicationSummary | null | undefined,
  incoming: AiMediaWorkflowApplicationSummary | null | undefined,
) {
  if (!current) return incoming || null;
  if (!incoming) return current;
  if (current.id && incoming.id && current.id === incoming.id) {
    if (current.state === 'ROLLED_BACK' && incoming.state === 'APPLIED') return current;
    if (incoming.revision < current.revision) return current;
  }
  return incoming;
}

function mergeMonotonicAiMediaJobState(
  current: AiMediaWorkflow,
  incoming: AiMediaWorkflow,
) {
  const currentJobs = new Map((current.jobs || []).map((job) => [job.id, job]));
  return {
    ...incoming,
    application: mergeMonotonicAiMediaApplication(
      current.application,
      incoming.application,
    ),
    jobs: (incoming.jobs || []).map((job) => {
      const existing = currentJobs.get(job.id);
      if (!existing) return job;
      const currentCostRank = existing.costStatus ? AI_MEDIA_COST_STATUS_RANK[existing.costStatus] : -1;
      const incomingCostRank = job.costStatus ? AI_MEDIA_COST_STATUS_RANK[job.costStatus] : -1;
      const currentReconciliationRevision = existing.providerReconciliation?.revision ?? -1;
      const incomingReconciliationRevision = job.providerReconciliation?.revision ?? -1;
      const preserveCurrentReconciliation = currentReconciliationRevision > incomingReconciliationRevision;
      const preserveCurrentRetryAllowed = preserveCurrentReconciliation || (
        currentReconciliationRevision === incomingReconciliationRevision
        && currentCostRank > incomingCostRank
      );
      return {
        ...job,
        appliedMode: job.appliedMode || existing.appliedMode,
        costStatus: currentCostRank > incomingCostRank ? existing.costStatus : job.costStatus,
        ...(preserveCurrentReconciliation ? {
          providerReconciliation: existing.providerReconciliation,
        } : {}),
        ...(preserveCurrentRetryAllowed ? { retryAllowed: existing.retryAllowed } : {}),
      };
    }),
  };
}

function newerAiMediaWorkflow(
  current: AiMediaWorkflow,
  incoming: AiMediaWorkflow,
) {
  if (Number.isFinite(current.revision) && Number.isFinite(incoming.revision)) {
    if (incoming.revision < current.revision) return current;
    if (incoming.revision > current.revision) return mergeMonotonicAiMediaJobState(current, incoming);
  }
  const currentUpdatedAt = current.updatedAt ? Date.parse(current.updatedAt) : Number.NaN;
  const incomingUpdatedAt = incoming.updatedAt ? Date.parse(incoming.updatedAt) : Number.NaN;
  if (Number.isFinite(currentUpdatedAt) && Number.isFinite(incomingUpdatedAt)) {
    if (incomingUpdatedAt < currentUpdatedAt) return current;
    if (incomingUpdatedAt > currentUpdatedAt) return mergeMonotonicAiMediaJobState(current, incoming);
  }
  return mergeMonotonicAiMediaJobState(current, incoming);
}

export function mergeAiMediaWorkflowHistoryHead(
  current: AiMediaWorkflow[],
  head: AiMediaWorkflow[],
) {
  const headById = new Map(head.map((workflow) => [workflow.id, workflow]));
  const currentIds = new Set(current.map((workflow) => workflow.id));
  return sortAiMediaWorkflowHistory([
    ...current.map((workflow) => {
      const incoming = headById.get(workflow.id);
      return incoming ? newerAiMediaWorkflow(workflow, incoming) : workflow;
    }),
    ...head.filter((workflow) => !currentIds.has(workflow.id)),
  ]);
}

export function appendAiMediaWorkflowHistoryPage(
  current: AiMediaWorkflow[],
  page: AiMediaWorkflow[],
) {
  const updates = new Map(page.map((workflow) => [workflow.id, workflow]));
  const seen = new Set(current.map((workflow) => workflow.id));
  return sortAiMediaWorkflowHistory([
    ...current.map((workflow) => {
      const incoming = updates.get(workflow.id);
      return incoming ? newerAiMediaWorkflow(workflow, incoming) : workflow;
    }),
    ...page.filter((workflow) => !seen.has(workflow.id)),
  ]);
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
  webMediaReason?: string;
  webMediaRevision?: string | number;
  workflowEnabled: boolean;
  workflowReason?: string;
  workflowRevision?: string | number;
  applications?: AiMediaApplicationCapability;
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
  manualSelectionAllowed: boolean;
  recoverable: boolean;
  diagnostics: Array<{ code: string; slotKey: string; candidateId: string | null }>;
  fallbackReason: string | null;
}

export type AiMediaPlanSlotCandidateReason = 'NOT_CURATED' | 'SLOT_INCOMPATIBLE' | 'SOURCE_UNAVAILABLE';

export interface AiMediaPlanSlotCandidateOption {
  candidateId: string;
  input: AiMediaContextInput | null;
  selectable: boolean;
  reasonCode: AiMediaPlanSlotCandidateReason | null;
}

export interface AiMediaPlanSlotDraftEnvelope {
  planId: string;
  baseVersionId: string;
  baseRevision: number;
  slotKey: string;
  referenceCandidateIds: string[];
  savedAt: number;
}

export type AiMediaPlanSlotDraftAuthority = 'CURRENT' | 'VERSION_CONFLICT' | 'STALE_SOURCE';
export type AiMediaPlanSlotCandidateEditMode = 'current' | 'version-conflict' | 'read-only';

export function resolveAiMediaPlanSlotDraftAuthority(input: {
  draft: Pick<AiMediaPlanSlotDraftEnvelope, 'planId' | 'baseVersionId' | 'baseRevision'>;
  plan: Pick<AiMediaPlanRecord, 'id' | 'revision' | 'staleAt' | 'sourceCurrent'>;
  currentVersionId: string | null;
}): AiMediaPlanSlotDraftAuthority {
  if (input.plan.staleAt || input.plan.sourceCurrent === false) return 'STALE_SOURCE';
  if (input.draft.planId !== input.plan.id
    || input.draft.baseRevision !== input.plan.revision
    || input.draft.baseVersionId !== input.currentVersionId) return 'VERSION_CONFLICT';
  return 'CURRENT';
}

export function resolveAiMediaPlanSlotCandidateEditMode(input: {
  editingAllowed: boolean;
  staleConflict: boolean;
  rebaseRequested: boolean;
  authority: AiMediaPlanSlotDraftAuthority | null;
}): AiMediaPlanSlotCandidateEditMode {
  if (!input.editingAllowed || input.staleConflict) return 'read-only';
  if (!input.rebaseRequested) return 'current';
  return input.authority === 'VERSION_CONFLICT' ? 'version-conflict' : 'read-only';
}

export function canToggleAiMediaPlanSlotCandidate(input: {
  mode: AiMediaPlanSlotCandidateEditMode;
  selected: boolean;
  selectable: boolean;
}): boolean {
  if (input.mode === 'read-only') return false;
  if (input.mode === 'version-conflict') return input.selected;
  return input.selected || input.selectable;
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
    manualSelectionAllowed: object.manualSelectionAllowed === true,
    recoverable: object.recoverable === true,
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

const AI_MEDIA_PLANNING_GOAL_LABELS: Record<string, string> = {
  sku_hero: 'SKU 主图',
  scene: '场景图',
  detail: '细节图',
  function: '功能图',
  fitment: '适配图',
  spec: '规格图',
  package: '包装图',
  poster: '海报图',
};

export function formatAiMediaPlanningGoal(value: string): string {
  const normalized = value.trim();
  return AI_MEDIA_PLANNING_GOAL_LABELS[normalized.toLowerCase()] || normalized || '未命名槽位';
}

function aiMediaPlanSlotReferenceIds(value: unknown, options: { allowEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length < 1) || value.length > 5) {
    throw new Error(options.allowEmpty ? '每个槽位最多选择 5 张参考图' : '每个槽位需要选择 1 到 5 张参考图');
  }
  const normalized = value.map((entry) => {
    const candidateId = planningText(entry, 500);
    if (!candidateId) throw new Error('参考图标识无效');
    return candidateId;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error('同一槽位不能重复选择参考图');
  return normalized;
}

export function buildAiMediaPlanSlotReferenceUpdateRequest(input: {
  expectedRevision: number;
  baseVersionId: string;
  operationKey: string;
  slotKey: string;
  referenceCandidateIds: string[];
}) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error('计划版本已失效，请刷新后重试');
  }
  const baseVersionId = planningText(input.baseVersionId, 200);
  if (!baseVersionId) throw new Error('计划基础版本无效');
  const operationKey = planningText(input.operationKey, 128);
  if (!operationKey || operationKey.length < 8) throw new Error('槽位保存操作标识无效');
  const slotKey = planningText(input.slotKey, 1_024);
  if (!slotKey) throw new Error('图片槽位标识无效');
  const referenceCandidateIds = aiMediaPlanSlotReferenceIds(input.referenceCandidateIds, { allowEmpty: true });
  return {
    expectedRevision: input.expectedRevision,
    baseVersionId,
    operationKey,
    changes: [{ slotKey, referenceCandidateIds }],
  };
}

function aiMediaPlanSlotSkuKeys(
  slot: AiMediaPlanSlot,
  compatibilityGroups: AiMediaPlanCompatibilityGroup[],
): Set<string> {
  if (slot.ownership.level === 'sku') return new Set([slot.ownership.key]);
  const group = compatibilityGroups.find((candidate) => candidate.groupKey === slot.ownership.key);
  return new Set(group?.skuKeys || []);
}

export function resolveAiMediaPlanSlotCandidateOptions(input: {
  slot: AiMediaPlanSlot;
  compatibilityGroups: AiMediaPlanCompatibilityGroup[];
  consideredCandidateIds: string[];
  selectedCandidateIds: string[];
  draftCandidateIds?: string[];
  inputs: AiMediaContextInput[];
}): AiMediaPlanSlotCandidateOption[] {
  const selected = new Set(input.selectedCandidateIds);
  const sourceByKey = new Map(input.inputs.map((candidate) => [candidate.sourceMediaKey, candidate]));
  const slotSkuKeys = aiMediaPlanSlotSkuKeys(input.slot, input.compatibilityGroups);
  const candidateIds = [...new Set([
    ...input.consideredCandidateIds,
    ...input.slot.references.map((reference) => reference.candidateId),
    ...(input.draftCandidateIds || []),
  ])];
  return candidateIds.map((candidateId) => {
    const source = sourceByKey.get(candidateId) || null;
    if (!source) return { candidateId, input: null, selectable: false, reasonCode: 'SOURCE_UNAVAILABLE' };
    if (!selected.has(candidateId)) {
      return { candidateId, input: source, selectable: false, reasonCode: 'NOT_CURATED' };
    }
    const sourceSkuKeys = source.skuKeys || [];
    const compatible = sourceSkuKeys.length === 0 || (input.slot.ownership.level === 'sku'
      ? sourceSkuKeys.includes(input.slot.ownership.key)
      : sourceSkuKeys.every((skuKey) => slotSkuKeys.has(skuKey)));
    return compatible
      ? { candidateId, input: source, selectable: true, reasonCode: null }
      : { candidateId, input: source, selectable: false, reasonCode: 'SLOT_INCOMPATIBLE' };
  });
}

export function aiMediaPlanSlotDraftStorageKey(planId: string, slotKey: string): string {
  return `ss-erp:ai-media-plan-slot-draft:${encodeURIComponent(planId)}:${encodeURIComponent(slotKey)}`;
}

function validAiMediaPlanSlotDraft(value: unknown): value is AiMediaPlanSlotDraftEnvelope {
  const object = planningObject(value);
  if (!object) return false;
  const planId = planningText(object.planId, 200);
  const baseVersionId = planningText(object.baseVersionId, 200);
  const slotKey = planningText(object.slotKey, 1_024);
  if (!planId || !baseVersionId || !slotKey
    || !Number.isSafeInteger(object.baseRevision) || Number(object.baseRevision) < 1
    || !Number.isSafeInteger(object.savedAt) || Number(object.savedAt) < 0) return false;
  try {
    aiMediaPlanSlotReferenceIds(object.referenceCandidateIds, { allowEmpty: true });
    return true;
  } catch {
    return false;
  }
}

export function loadAiMediaPlanSlotDraft(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  options: { now?: number; ttlMs?: number } = {},
): AiMediaPlanSlotDraftEnvelope | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validAiMediaPlanSlotDraft(parsed)) {
      storage.removeItem(key);
      return null;
    }
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? AI_MEDIA_INTENT_TTL_MS;
    if (parsed.savedAt > now || now - parsed.savedAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return {
      planId: parsed.planId.trim(),
      baseVersionId: parsed.baseVersionId.trim(),
      baseRevision: parsed.baseRevision,
      slotKey: parsed.slotKey.trim(),
      referenceCandidateIds: aiMediaPlanSlotReferenceIds(parsed.referenceCandidateIds, { allowEmpty: true }),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveAiMediaPlanSlotDraft(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
  draft: AiMediaPlanSlotDraftEnvelope,
): void {
  if (!storage || !key || !validAiMediaPlanSlotDraft(draft)) return;
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // Session storage can be unavailable; the in-memory draft remains authoritative.
  }
}

export function clearAiMediaPlanSlotDraft(
  storage: WorkflowIntentStorage | null | undefined,
  key: string,
): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can become unavailable after the browser context changes.
  }
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

export type AiMediaSuiteStatus =
  | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'PARTIAL_FAILURE' | 'FAILED'
  | 'SUCCEEDED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaSuiteSlotStatus =
  | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  | 'CANCEL_REQUESTED' | 'CANCELLED';

export interface AiMediaSuiteReadiness {
  suiteEnabled: boolean;
  workflowEnabled: boolean;
  webMediaEnabled: boolean;
  provider: {
    provider: string | null;
    model: string | null;
    evidenceLevel: 'local-test' | 'adapter-characterized' | 'sandbox-verified' | null;
    ready: boolean;
  };
  services: {
    references: boolean;
    prompts: boolean;
    materialization: boolean;
    execution: boolean;
    runtime: boolean;
    queue: boolean;
  };
  storage: {
    ready: boolean;
    backend: string | null;
    publicHttps: boolean;
  };
  ready: boolean;
  testOnly: boolean;
  reasonCode: string;
  reason: string;
}

export interface AiMediaSuitePreview {
  version: string;
  planId: string;
  planVersionId: string;
  planRevision: number;
  provider: string;
  model: string;
  pricingVersion: string;
  concurrencyLimit: number;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
  previewHash: string;
  slots: Array<{
    ordinal: number;
    slotKey: string;
    goal: string;
    ownership: { level: 'sku' | 'compatibility_group'; key: string };
    compatibilityGroupKey: string | null;
    references: Array<{
      candidateId: string;
      source: {
        width: number | null;
        height: number | null;
        mimeType: string | null;
        role: string;
        skuKeys: string[];
      };
    }>;
    estimatedCostCents: number;
    maximumCostCents: number;
  }>;
}

export interface AiMediaSuiteOutputAsset {
  id: string;
  url: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

export interface AiMediaSuiteReferenceAsset extends AiMediaSuiteOutputAsset {
  candidateId: string;
}

export interface AiMediaSuiteApplication {
  id: string | null;
  revision: number;
  state: 'APPLIED' | 'ROLLED_BACK';
  legacy: boolean;
  jobId: string;
  outputAssetId: string;
  mode: 'append' | 'replace';
  appliedAt: string;
  rolledBackAt: string | null;
  targetUpdatedAt: string;
}

export interface AiMediaSuiteSlot {
  id: string;
  ordinal: number;
  slotKey: string;
  goal: string;
  ownership: { level: 'sku' | 'compatibility_group'; key: string };
  compatibilityGroupKey: string | null;
  status: AiMediaSuiteSlotStatus;
  attempt: number;
  revision: number;
  childWorkflowId: string | null;
  workflowRevision: number | null;
  referenceCandidateIds: string[];
  referenceAssets: AiMediaSuiteReferenceAsset[];
  diagnostics: string[];
  estimatedCostCents: number;
  maximumCostCents: number;
  errorCode: string | null;
  reviewStatus: AiMediaReviewStatus;
  selectedOutputAssetId: string | null;
  reviewedAt: string | null;
  application: AiMediaSuiteApplication | null;
  outputAssets: AiMediaSuiteOutputAsset[];
}

export interface AiMediaSuite {
  id: string;
  planId: string;
  planVersionId: string;
  status: AiMediaSuiteStatus;
  revision: number;
  previewHash: string | null;
  provider: string;
  model: string;
  pricingVersion: string;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
  concurrencyLimit: number;
  cancelRequestedAt: string | null;
  completedAt: string | null;
  counts: {
    planned: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelRequested: number;
    cancelled: number;
  };
  createdAt: string;
  updatedAt: string;
  slots: AiMediaSuiteSlot[];
}

const AI_MEDIA_SUITE_MAX_ITEMS = 25;
const AI_MEDIA_SUITE_MAX_REFERENCES = 20;
const AI_MEDIA_SUITE_MAX_OUTPUTS = 1;
const AI_MEDIA_SUITE_HASH = /^[a-f0-9]{64}$/u;
const AI_MEDIA_SUITE_PUBLIC_CODE = /^[A-Z][A-Z0-9_]{0,99}$/u;
const AI_MEDIA_SUITE_STATUSES: readonly AiMediaSuiteStatus[] = [
  'PLANNED', 'QUEUED', 'RUNNING', 'PARTIAL_FAILURE', 'FAILED',
  'SUCCEEDED', 'CANCEL_REQUESTED', 'CANCELLED',
];
const AI_MEDIA_SUITE_SLOT_STATUSES: readonly AiMediaSuiteSlotStatus[] = [
  'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
  'CANCEL_REQUESTED', 'CANCELLED',
];

function suiteSafeInteger(value: unknown, minimum = 0): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function suiteNullableDimension(value: unknown): number | null | undefined {
  if (value === null) return null;
  const normalized = suiteSafeInteger(value, 1);
  return normalized === null ? undefined : normalized;
}

function suiteNullableText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  const normalized = planningText(value, max);
  return normalized === null ? undefined : normalized;
}

function suiteDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  const normalized = planningText(value, 128);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function suitePublicCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  const normalized = planningText(value, 100);
  return normalized && AI_MEDIA_SUITE_PUBLIC_CODE.test(normalized) ? normalized : undefined;
}

export function normalizeAiMediaSuiteReadiness(value: unknown): AiMediaSuiteReadiness | null {
  const root = planningObject(value);
  const provider = planningObject(root?.provider);
  const services = planningObject(root?.services);
  const storage = planningObject(root?.storage);
  if (!root || !provider || !services || !storage) return null;
  const providerName = suiteNullableText(provider.provider, 100);
  const model = suiteNullableText(provider.model, 200);
  const reasonCode = planningText(root.reasonCode, 100);
  const reason = planningText(root.reason, 1_000);
  const evidenceLevel = provider.evidenceLevel;
  const storageBackend = suiteNullableText(storage.backend, 100);
  if (providerName === undefined || model === undefined || !reasonCode || !reason
    || storageBackend === undefined
    || !AI_MEDIA_SUITE_PUBLIC_CODE.test(reasonCode)
    || (evidenceLevel !== null
      && evidenceLevel !== 'local-test'
      && evidenceLevel !== 'adapter-characterized'
      && evidenceLevel !== 'sandbox-verified')) return null;
  const booleans = [
    root.suiteEnabled, root.workflowEnabled, root.webMediaEnabled, root.ready, root.testOnly,
    provider.ready, services.references, services.prompts, services.materialization,
    services.execution, services.runtime, services.queue, storage.ready, storage.publicHttps,
  ];
  if (booleans.some((entry) => typeof entry !== 'boolean')) return null;
  if ((provider.ready === true || root.ready === true)
    && (!providerName || !model || !evidenceLevel)) return null;
  if (root.ready === true && (
    root.suiteEnabled !== true || root.workflowEnabled !== true || root.webMediaEnabled !== true
    || provider.ready !== true || services.references !== true || services.prompts !== true
    || services.materialization !== true || services.execution !== true
    || services.runtime !== true || services.queue !== true || storage.ready !== true
  )) return null;
  return {
    suiteEnabled: root.suiteEnabled as boolean,
    workflowEnabled: root.workflowEnabled as boolean,
    webMediaEnabled: root.webMediaEnabled as boolean,
    provider: {
      provider: providerName,
      model,
      evidenceLevel,
      ready: provider.ready as boolean,
    },
    services: {
      references: services.references as boolean,
      prompts: services.prompts as boolean,
      materialization: services.materialization as boolean,
      execution: services.execution as boolean,
      runtime: services.runtime as boolean,
      queue: services.queue as boolean,
    },
    storage: {
      ready: storage.ready as boolean,
      backend: storageBackend,
      publicHttps: storage.publicHttps as boolean,
    },
    ready: root.ready as boolean,
    testOnly: root.testOnly as boolean,
    reasonCode,
    reason,
  };
}

export function normalizeAiMediaSuitePreview(value: unknown): AiMediaSuitePreview | null {
  const root = planningObject(value);
  if (!root || !Array.isArray(root.slots) || root.slots.length < 1
    || root.slots.length > AI_MEDIA_SUITE_MAX_ITEMS) return null;
  const version = planningText(root.version, 100);
  const planId = planningText(root.planId, 200);
  const planVersionId = planningText(root.planVersionId, 200);
  const provider = planningText(root.provider, 100);
  const model = planningText(root.model, 200);
  const pricingVersion = planningText(root.pricingVersion, 200);
  const planRevision = suiteSafeInteger(root.planRevision, 1);
  const concurrencyLimit = suiteSafeInteger(root.concurrencyLimit, 1);
  const itemCount = suiteSafeInteger(root.itemCount, 1);
  const estimatedCostCents = suiteSafeInteger(root.estimatedCostCents);
  const maximumCostCents = suiteSafeInteger(root.maximumCostCents);
  const previewHash = planningText(root.previewHash, 64);
  if (!version || !planId || !planVersionId || !provider || !model || !pricingVersion
    || planRevision === null || concurrencyLimit === null || itemCount === null
    || estimatedCostCents === null || maximumCostCents === null
    || maximumCostCents < estimatedCostCents || !previewHash
    || !AI_MEDIA_SUITE_HASH.test(previewHash) || itemCount !== root.slots.length) return null;
  const slots: AiMediaSuitePreview['slots'] = [];
  const ordinals = new Set<number>();
  const slotKeys = new Set<string>();
  for (const entry of root.slots) {
    const slot = planningObject(entry);
    const ownership = planningObject(slot?.ownership);
    const ordinal = suiteSafeInteger(slot?.ordinal);
    const slotKey = planningText(slot?.slotKey, 1_024);
    const goal = planningText(slot?.goal, 200);
    const ownershipKey = planningText(ownership?.key, 500);
    const compatibilityGroupKey = suiteNullableText(slot?.compatibilityGroupKey, 500);
    const slotEstimated = suiteSafeInteger(slot?.estimatedCostCents);
    const slotMaximum = suiteSafeInteger(slot?.maximumCostCents);
    if (!slot || !ownership || ordinal === null || !slotKey || !goal || !ownershipKey
      || (ownership.level !== 'sku' && ownership.level !== 'compatibility_group')
      || compatibilityGroupKey === undefined || slotEstimated === null || slotMaximum === null
      || slotMaximum < slotEstimated || ordinals.has(ordinal) || slotKeys.has(slotKey)
      || !Array.isArray(slot.references) || slot.references.length < 1
      || slot.references.length > AI_MEDIA_SUITE_MAX_REFERENCES) return null;
    const references: AiMediaSuitePreview['slots'][number]['references'] = [];
    const candidateIds = new Set<string>();
    for (const rawReference of slot.references) {
      const reference = planningObject(rawReference);
      const source = planningObject(reference?.source);
      const candidateId = planningText(reference?.candidateId, 500);
      const width = suiteNullableDimension(source?.width);
      const height = suiteNullableDimension(source?.height);
      const mimeType = suiteNullableText(source?.mimeType, 100);
      const role = planningText(source?.role, 100);
      if (!reference || !source || !candidateId || candidateIds.has(candidateId)
        || width === undefined || height === undefined || mimeType === undefined || !role
        || !Array.isArray(source.skuKeys) || source.skuKeys.length > AI_MEDIA_PLAN_MAX_ITEMS) return null;
      const skuKeys = planningTextArray(source.skuKeys, AI_MEDIA_PLAN_MAX_ITEMS);
      if (skuKeys.length !== source.skuKeys.length) return null;
      candidateIds.add(candidateId);
      references.push({ candidateId, source: { width, height, mimeType, role, skuKeys } });
    }
    ordinals.add(ordinal);
    slotKeys.add(slotKey);
    slots.push({
      ordinal,
      slotKey,
      goal,
      ownership: { level: ownership.level, key: ownershipKey },
      compatibilityGroupKey,
      references,
      estimatedCostCents: slotEstimated,
      maximumCostCents: slotMaximum,
    });
  }
  slots.sort((left, right) => left.ordinal - right.ordinal);
  if (slots.some((slot, index) => slot.ordinal !== index)) return null;
  return {
    version, planId, planVersionId, planRevision, provider, model, pricingVersion,
    concurrencyLimit, itemCount, estimatedCostCents, maximumCostCents, previewHash, slots,
  };
}

export function normalizeAiMediaSuite(value: unknown): AiMediaSuite | null {
  const root = planningObject(value);
  const counts = planningObject(root?.counts);
  if (!root || !counts || !Array.isArray(root.slots)
    || root.slots.length < 1 || root.slots.length > AI_MEDIA_SUITE_MAX_ITEMS) return null;
  const id = planningText(root.id, 200);
  const planId = planningText(root.planId, 200);
  const planVersionId = planningText(root.planVersionId, 200);
  const status = root.status;
  const revision = suiteSafeInteger(root.revision, 1);
  const previewHashValue = suiteNullableText(root.previewHash ?? null, 64);
  const provider = planningText(root.provider, 100);
  const model = planningText(root.model, 200);
  const pricingVersion = planningText(root.pricingVersion, 100);
  const itemCount = suiteSafeInteger(root.itemCount, 1);
  const estimatedCostCents = suiteSafeInteger(root.estimatedCostCents);
  const maximumCostCents = suiteSafeInteger(root.maximumCostCents);
  const concurrencyLimit = root.concurrencyLimit === null
    ? null
    : suiteSafeInteger(root.concurrencyLimit, 1);
  const cancelRequestedAt = suiteDate(root.cancelRequestedAt ?? null);
  const completedAt = suiteDate(root.completedAt ?? null);
  const createdAt = suiteDate(root.createdAt);
  const updatedAt = suiteDate(root.updatedAt);
  if (!id || !planId || !planVersionId || !provider || !model || !pricingVersion
    || !AI_MEDIA_SUITE_STATUSES.includes(status as AiMediaSuiteStatus)
    || revision === null || previewHashValue === undefined
    || (previewHashValue !== null && !AI_MEDIA_SUITE_HASH.test(previewHashValue))
    || itemCount === null || itemCount !== root.slots.length
    || estimatedCostCents === null || maximumCostCents === null
    || maximumCostCents < estimatedCostCents || concurrencyLimit === null
    || cancelRequestedAt === undefined || completedAt === undefined
    || !createdAt || !updatedAt) return null;
  const normalizedCounts = {
    planned: suiteSafeInteger(counts.planned),
    queued: suiteSafeInteger(counts.queued),
    running: suiteSafeInteger(counts.running),
    succeeded: suiteSafeInteger(counts.succeeded),
    failed: suiteSafeInteger(counts.failed),
    cancelRequested: suiteSafeInteger(counts.cancelRequested),
    cancelled: suiteSafeInteger(counts.cancelled),
  };
  if (Object.values(normalizedCounts).some((entry) => entry === null)
    || Object.values(normalizedCounts).reduce<number>((total, entry) => total + (entry ?? 0), 0) !== itemCount) return null;
  const slots: AiMediaSuiteSlot[] = [];
  const slotIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const entry of root.slots) {
    const slot = planningObject(entry);
    const ownership = planningObject(slot?.ownership);
    const slotId = planningText(slot?.id, 200);
    const ordinal = suiteSafeInteger(slot?.ordinal);
    const slotKey = planningText(slot?.slotKey, 1_024);
    const goal = planningText(slot?.goal, 200);
    const ownershipKey = planningText(ownership?.key, 500);
    const compatibilityGroupKey = suiteNullableText(slot?.compatibilityGroupKey, 500);
    const slotStatus = slot?.status;
    const attempt = suiteSafeInteger(slot?.attempt);
    const slotRevision = suiteSafeInteger(slot?.revision, 1);
    const childWorkflowId = suiteNullableText(slot?.childWorkflowId, 200);
    const workflowRevision = slot?.workflowRevision === null
      ? null
      : suiteSafeInteger(slot?.workflowRevision, 1);
    const slotEstimated = suiteSafeInteger(slot?.estimatedCostCents);
    const slotMaximum = suiteSafeInteger(slot?.maximumCostCents);
    const errorCode = suitePublicCode(slot?.errorCode ?? null);
    const reviewStatus = slot?.reviewStatus === null && childWorkflowId === null
      ? 'NOT_READY'
      : slot?.reviewStatus;
    const selectedOutputAssetId = suiteNullableText(slot?.selectedOutputAssetId, 200);
    const reviewedAt = suiteDate(slot?.reviewedAt);
    if (!slot || !ownership || !slotId || ordinal === null || !slotKey || !goal || !ownershipKey
      || slotIds.has(slotId) || ordinals.has(ordinal)
      || (ownership.level !== 'sku' && ownership.level !== 'compatibility_group')
      || compatibilityGroupKey === undefined
      || !AI_MEDIA_SUITE_SLOT_STATUSES.includes(slotStatus as AiMediaSuiteSlotStatus)
      || attempt === null || slotRevision === null || childWorkflowId === undefined
      || workflowRevision === undefined
      || slotEstimated === null || slotMaximum === null || slotMaximum < slotEstimated
      || errorCode === undefined || !Array.isArray(slot.referenceCandidateIds)
      || slot.referenceCandidateIds.length > AI_MEDIA_SUITE_MAX_REFERENCES
      || !Array.isArray(slot.referenceAssets)
      || slot.referenceAssets.length > AI_MEDIA_SUITE_MAX_REFERENCES
      || !Array.isArray(slot.diagnostics) || slot.diagnostics.length > 20
      || !Array.isArray(slot.outputAssets) || slot.outputAssets.length > AI_MEDIA_SUITE_MAX_OUTPUTS
      || !['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'].includes(String(reviewStatus))
      || selectedOutputAssetId === undefined || reviewedAt === undefined) return null;
    const referenceCandidateIds = planningTextArray(slot.referenceCandidateIds, AI_MEDIA_SUITE_MAX_REFERENCES);
    const diagnostics = planningTextArray(slot.diagnostics, 20);
    if (referenceCandidateIds.length !== slot.referenceCandidateIds.length
      || diagnostics.length !== slot.diagnostics.length
      || diagnostics.some((code) => !AI_MEDIA_SUITE_PUBLIC_CODE.test(code))) return null;
    const referenceAssets: AiMediaSuiteReferenceAsset[] = [];
    const referenceAssetIds = new Set<string>();
    const referenceAssetCandidateIds = new Set<string>();
    for (const entryAsset of slot.referenceAssets) {
      const asset = planningObject(entryAsset);
      const candidateId = planningText(asset?.candidateId, 500);
      const assetId = planningText(asset?.id, 200);
      const url = planningText(asset?.url, 8_000);
      const mimeType = suiteNullableText(asset?.mimeType, 200);
      const width = suiteNullableDimension(asset?.width);
      const height = suiteNullableDimension(asset?.height);
      if (!asset || !candidateId || !referenceCandidateIds.includes(candidateId)
        || referenceAssetCandidateIds.has(candidateId) || !assetId || referenceAssetIds.has(assetId)
        || !url || mimeType === undefined || width === undefined || height === undefined) return null;
      referenceAssetCandidateIds.add(candidateId);
      referenceAssetIds.add(assetId);
      referenceAssets.push({ candidateId, id: assetId, url, mimeType, width, height });
    }
    const outputAssets: AiMediaSuiteOutputAsset[] = [];
    for (const entryAsset of slot.outputAssets) {
      const asset = planningObject(entryAsset);
      const assetId = planningText(asset?.id, 200);
      const url = planningText(asset?.url, 8_000);
      const mimeType = suiteNullableText(asset?.mimeType, 200);
      const width = suiteNullableDimension(asset?.width);
      const height = suiteNullableDimension(asset?.height);
      if (!asset || !assetId || !url || mimeType === undefined
        || width === undefined || height === undefined) return null;
      outputAssets.push({ id: assetId, url, mimeType, width, height });
    }
    const applicationValue = slot.application === null ? null : planningObject(slot.application);
    let application: AiMediaSuiteApplication | null = null;
    if (slot.application !== null) {
      const applicationId = applicationValue?.id === null
        ? null
        : planningText(applicationValue?.id, 200);
      const applicationRevision = planningNumber(applicationValue?.revision, Number.NaN);
      const applicationState = applicationValue?.state;
      const applicationLegacy = applicationValue?.legacy;
      const applicationJobId = planningText(applicationValue?.jobId, 200);
      const applicationOutputAssetId = planningText(applicationValue?.outputAssetId, 200);
      const applicationMode = applicationValue?.mode;
      const appliedAt = suiteDate(applicationValue?.appliedAt);
      const rolledBackAt = applicationValue?.rolledBackAt === null
        ? null
        : suiteDate(applicationValue?.rolledBackAt);
      const targetUpdatedAt = suiteDate(applicationValue?.targetUpdatedAt);
      if (!applicationValue
        || (applicationValue.id !== null && !applicationId)
        || !Number.isSafeInteger(applicationRevision) || applicationRevision < 1
        || (applicationState !== 'APPLIED' && applicationState !== 'ROLLED_BACK')
        || typeof applicationLegacy !== 'boolean'
        || applicationLegacy !== (applicationId === null)
        || !applicationJobId || !applicationOutputAssetId
        || (applicationMode !== 'append' && applicationMode !== 'replace')
        || !appliedAt || !targetUpdatedAt
        || (applicationValue.rolledBackAt !== null && !rolledBackAt)
        || (applicationState === 'ROLLED_BACK') !== Boolean(rolledBackAt)) return null;
      application = {
        id: applicationId ?? null,
        revision: applicationRevision,
        state: applicationState,
        legacy: applicationLegacy,
        jobId: applicationJobId,
        outputAssetId: applicationOutputAssetId,
        mode: applicationMode,
        appliedAt,
        rolledBackAt: rolledBackAt ?? null,
        targetUpdatedAt,
      };
    }
    const outputAssetIds = new Set(outputAssets.map((asset) => asset.id));
    const hasTerminalReview = reviewStatus === 'APPROVED' || reviewStatus === 'REJECTED';
    if ((childWorkflowId === null) !== (workflowRevision === null)
      || (childWorkflowId === null && reviewStatus !== 'NOT_READY')
      || (childWorkflowId !== null && referenceAssets.length !== referenceCandidateIds.length)
      || (slotStatus === 'SUCCEEDED' && (outputAssets.length !== 1 || reviewStatus === 'NOT_READY'))
      || (slotStatus !== 'SUCCEEDED' && (outputAssets.length > 0 || reviewStatus !== 'NOT_READY'))
      || (hasTerminalReview
        ? (!selectedOutputAssetId || !outputAssetIds.has(selectedOutputAssetId) || !reviewedAt)
        : (selectedOutputAssetId !== null || reviewedAt !== null))
      || (application && (reviewStatus !== 'APPROVED'
        || application.outputAssetId !== selectedOutputAssetId
        || !outputAssetIds.has(application.outputAssetId)))) return null;
    slotIds.add(slotId);
    ordinals.add(ordinal);
    slots.push({
      id: slotId,
      ordinal,
      slotKey,
      goal,
      ownership: { level: ownership.level, key: ownershipKey },
      compatibilityGroupKey,
      status: slotStatus as AiMediaSuiteSlotStatus,
      attempt,
      revision: slotRevision,
      childWorkflowId,
      workflowRevision,
      referenceCandidateIds,
      referenceAssets,
      diagnostics,
      estimatedCostCents: slotEstimated,
      maximumCostCents: slotMaximum,
      errorCode,
      reviewStatus: reviewStatus as AiMediaReviewStatus,
      selectedOutputAssetId,
      reviewedAt,
      application,
      outputAssets,
    });
  }
  slots.sort((left, right) => left.ordinal - right.ordinal);
  if (slots.some((slot, index) => slot.ordinal !== index)) return null;
  const derivedCounts = {
    planned: slots.filter((slot) => slot.status === 'PLANNED').length,
    queued: slots.filter((slot) => slot.status === 'QUEUED').length,
    running: slots.filter((slot) => slot.status === 'RUNNING').length,
    succeeded: slots.filter((slot) => slot.status === 'SUCCEEDED').length,
    failed: slots.filter((slot) => slot.status === 'FAILED').length,
    cancelRequested: slots.filter((slot) => slot.status === 'CANCEL_REQUESTED').length,
    cancelled: slots.filter((slot) => slot.status === 'CANCELLED').length,
  };
  if (Object.entries(derivedCounts).some(([key, count]) => (
    count !== normalizedCounts[key as keyof typeof normalizedCounts]
  ))) return null;
  return {
    id,
    planId,
    planVersionId,
    status: status as AiMediaSuiteStatus,
    revision,
    previewHash: previewHashValue,
    provider,
    model,
    pricingVersion,
    itemCount,
    estimatedCostCents,
    maximumCostCents,
    concurrencyLimit,
    cancelRequestedAt,
    completedAt,
    counts: normalizedCounts as AiMediaSuite['counts'],
    createdAt,
    updatedAt,
    slots,
  };
}

export interface AiMediaSuiteActionState {
  planCurrent: boolean;
  suiteBelongsToPlan: boolean;
  suiteCurrent: boolean;
  blockedByActiveSuite: boolean;
  canPreview: boolean;
  canClaim: boolean;
  canPrepare: boolean;
  canDispatch: boolean;
  canCancel: boolean;
  shouldPoll: boolean;
  terminal: boolean;
  retryableSlotIds: string[];
}

export type AiMediaSuiteSlotViewOnlyReason =
  | 'HISTORICAL_VERSION'
  | 'SOURCE_CHANGED'
  | 'PLAN_NOT_CURRENT'
  | null;

export interface AiMediaSuiteSlotActionState {
  candidateCurrent: boolean;
  canReview: boolean;
  canApply: boolean;
  applied: boolean;
  viewOnlyReason: AiMediaSuiteSlotViewOnlyReason;
}

export function isAiMediaSuitePlanCurrent(plan: AiMediaPlanRecord): boolean {
  return plan.reviewStatus === 'APPROVED'
    && !plan.staleAt
    && plan.sourceCurrent === true
    && Boolean(plan.currentVersionId)
    && plan.currentVersionId === plan.approvedVersionId;
}

export function resolveAiMediaSuiteActions(input: {
  plan: AiMediaPlanRecord;
  readiness: AiMediaSuiteReadiness | null;
  preview: AiMediaSuitePreview | null;
  suite: AiMediaSuite | null;
  activeSuite?: AiMediaSuite | null;
}): AiMediaSuiteActionState {
  const { plan, readiness, preview, suite, activeSuite = null } = input;
  const planCurrent = isAiMediaSuitePlanCurrent(plan);
  const writesReady = planCurrent && readiness?.ready === true;
  const suiteBelongsToPlan = Boolean(suite && suite.planId === plan.id);
  const suiteCurrent = Boolean(
    suiteBelongsToPlan && plan.currentVersionId && suite?.planVersionId === plan.currentVersionId,
  );
  const status = suiteBelongsToPlan ? suite!.status : null;
  const blockedByActiveSuite = Boolean(
    activeSuite
    && activeSuite.planId === plan.id
    && activeSuite.id !== suite?.id
    && ((activeSuite.status === 'PLANNED' && activeSuite.revision >= 4) || activeSuite.status === 'QUEUED'
      || activeSuite.status === 'RUNNING' || activeSuite.status === 'CANCEL_REQUESTED'),
  );
  const retryableSlotIds = writesReady && suiteCurrent
    && (status === 'PARTIAL_FAILURE' || status === 'FAILED')
    ? suite!.slots.filter((slot) => slot.status === 'FAILED').map((slot) => slot.id)
    : [];
  return {
    planCurrent,
    suiteBelongsToPlan,
    suiteCurrent,
    blockedByActiveSuite,
    canPreview: writesReady && !suiteCurrent && !blockedByActiveSuite,
    canClaim: writesReady && !suiteCurrent && !blockedByActiveSuite && Boolean(preview
      && preview.planId === plan.id
      && preview.planVersionId === plan.currentVersionId
      && preview.planRevision === plan.revision),
    canPrepare: writesReady && suiteCurrent && status === 'PLANNED'
      && suite!.revision >= 1 && suite!.revision < 4,
    canDispatch: writesReady && suiteCurrent && status === 'PLANNED' && suite!.revision === 4,
    canCancel: suiteBelongsToPlan && suite!.revision >= 4
      && (status === 'PLANNED' || status === 'QUEUED' || status === 'RUNNING'),
    shouldPoll: suiteBelongsToPlan
      && (status === 'QUEUED' || status === 'RUNNING' || status === 'CANCEL_REQUESTED'),
    terminal: suiteBelongsToPlan
      && (status === 'PARTIAL_FAILURE' || status === 'FAILED'
        || status === 'SUCCEEDED' || status === 'CANCELLED'),
    retryableSlotIds,
  };
}

export function resolveAiMediaSuiteSlotActions(input: {
  plan: AiMediaPlanRecord;
  readiness: Pick<AiMediaSuiteReadiness, 'ready'> | null | undefined;
  suite: AiMediaSuite;
  slot: AiMediaSuiteSlot;
  targetUpdatedAt: string | null | undefined;
}): AiMediaSuiteSlotActionState {
  const { plan, readiness, suite, slot } = input;
  const writesReady = readiness?.ready === true;
  const suiteCurrent = suite.planId === plan.id
    && Boolean(plan.currentVersionId)
    && suite.planVersionId === plan.currentVersionId;
  const sourceCurrent = !plan.staleAt && plan.sourceCurrent === true;
  const planCurrent = isAiMediaSuitePlanCurrent(plan);
  const slotBelongsToSuite = suite.slots.some((candidate) => candidate.id === slot.id);
  const candidateCurrent = suiteCurrent && sourceCurrent && planCurrent && slotBelongsToSuite;
  const output = slot.outputAssets[0] || null;
  const selectedOutputCurrent = Boolean(output && slot.selectedOutputAssetId === output.id);
  const applied = Boolean(slot.application
    && output
    && slot.application.outputAssetId === output.id);
  let viewOnlyReason: AiMediaSuiteSlotViewOnlyReason = null;
  if (!suiteCurrent) viewOnlyReason = 'HISTORICAL_VERSION';
  else if (!sourceCurrent) viewOnlyReason = 'SOURCE_CHANGED';
  else if (!planCurrent) viewOnlyReason = 'PLAN_NOT_CURRENT';
  return {
    candidateCurrent,
    canReview: writesReady && candidateCurrent
      && slot.status === 'SUCCEEDED'
      && slot.reviewStatus === 'PENDING'
      && slot.workflowRevision !== null
      && Boolean(output),
    canApply: writesReady && candidateCurrent
      && slot.status === 'SUCCEEDED'
      && slot.reviewStatus === 'APPROVED'
      && slot.workflowRevision !== null
      && selectedOutputCurrent
      && !applied
      && Boolean(input.targetUpdatedAt),
    applied,
    viewOnlyReason,
  };
}

export type AiMediaSuitePreparationDecision = 'dispatch' | 'reconcile' | 'incomplete' | 'invalid';

export function resolveAiMediaSuitePreparationDecision(input: {
  plan: AiMediaPlanRecord;
  suite: AiMediaSuite | null | undefined;
}): AiMediaSuitePreparationDecision {
  const { plan, suite } = input;
  if (!suite
    || suite.planId !== plan.id
    || !plan.currentVersionId
    || suite.planVersionId !== plan.currentVersionId) return 'invalid';
  if (suite.status === 'PLANNED' && suite.revision === 4) return 'dispatch';
  if (suite.revision >= 4) return 'reconcile';
  return 'incomplete';
}

export type AiMediaSuiteClaimOutcome = 'accepted' | 'rejected' | 'unknown';

export type AiMediaSuiteClaimDecision =
  | { kind: 'proceed'; suite: AiMediaSuite }
  | { kind: 'manual-continue'; suite: AiMediaSuite }
  | { kind: 'rejected' | 'uncertain'; suite: null };

export function resolveAiMediaSuiteClaimDecision(input: {
  outcome: AiMediaSuiteClaimOutcome;
  plan: AiMediaPlanRecord;
  preview: AiMediaSuitePreview;
  claimedSuite?: AiMediaSuite | null;
  recoveredSuite?: AiMediaSuite | null;
}): AiMediaSuiteClaimDecision {
  const { outcome, plan, preview, claimedSuite = null, recoveredSuite = null } = input;
  const acceptedClaimMatches = outcome === 'accepted'
    && preview.planId === plan.id
    && preview.planVersionId === plan.currentVersionId
    && preview.planRevision === plan.revision
    && claimedSuite?.planId === preview.planId
    && claimedSuite.planVersionId === preview.planVersionId
    && claimedSuite.previewHash === preview.previewHash;
  if (acceptedClaimMatches) return { kind: 'proceed', suite: claimedSuite };
  if (outcome === 'accepted') return { kind: 'uncertain', suite: null };

  const recoveredCurrentSuite = recoveredSuite?.planId === plan.id
    && Boolean(plan.currentVersionId)
    && recoveredSuite.planVersionId === plan.currentVersionId;
  if (recoveredCurrentSuite) return { kind: 'manual-continue', suite: recoveredSuite };
  return { kind: outcome === 'rejected' ? 'rejected' : 'uncertain', suite: null };
}

export function startAiMediaSuitePolling<TimerHandle>(input: {
  delayMs: number;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
  canPoll: () => boolean;
  poll: () => unknown | Promise<unknown>;
  onError?: (error: unknown) => void;
}): () => void {
  if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 0) {
    throw new Error('套图轮询间隔无效');
  }
  let stopped = false;
  let scheduled = false;
  let timer: TimerHandle | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    scheduled = true;
    timer = input.schedule(() => {
      scheduled = false;
      timer = null;
      if (stopped) return;
      void (async () => {
        try {
          if (input.canPoll()) await input.poll();
        } catch (error) {
          input.onError?.(error);
        } finally {
          scheduleNext();
        }
      })();
    }, input.delayMs);
  };

  scheduleNext();
  return () => {
    if (stopped) return;
    stopped = true;
    if (scheduled && timer !== null) input.cancel(timer);
    scheduled = false;
    timer = null;
  };
}

function suiteOperationKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) throw new Error('套图操作标识无效');
  return normalized;
}

export function buildAiMediaSuitePreviewRequest(planId: string) {
  const normalized = planId.trim();
  if (!normalized || normalized.length > 200) throw new Error('图片策展计划无效');
  return { planId: normalized };
}

export function buildAiMediaSuiteClaimRequest(input: {
  plan: AiMediaPlanRecord;
  preview: AiMediaSuitePreview;
  idempotencyKey: string;
}) {
  if (!isAiMediaSuitePlanCurrent(input.plan)
    || input.preview.planId !== input.plan.id
    || input.preview.planVersionId !== input.plan.currentVersionId
    || input.preview.planRevision !== input.plan.revision) {
    throw new Error('套图预览已失效，请刷新后重试');
  }
  return {
    planId: input.plan.id,
    expectedPlanRevision: input.preview.planRevision,
    expectedPreviewHash: input.preview.previewHash,
    idempotencyKey: suiteOperationKey(input.idempotencyKey),
  };
}

export function buildAiMediaSuitePrepareRequest(operationKey: string) {
  return { operationKey: suiteOperationKey(operationKey) };
}

export function buildAiMediaSuiteDispatchRequest(suite: AiMediaSuite, operationKey: string) {
  if (suite.status !== 'PLANNED' || suite.revision !== 4) {
    throw new Error('套图任务尚未完成准备或已开始执行');
  }
  return { expectedRevision: suite.revision, operationKey: suiteOperationKey(operationKey) };
}

export function buildAiMediaSuiteCancelRequest(suite: AiMediaSuite, operationKey: string) {
  if (suite.revision < 4
    || (suite.status !== 'PLANNED' && suite.status !== 'QUEUED' && suite.status !== 'RUNNING')) {
    throw new Error('当前套图任务不能取消');
  }
  return { expectedRevision: suite.revision, operationKey: suiteOperationKey(operationKey) };
}

export function buildAiMediaSuiteRetryRequest(slot: AiMediaSuiteSlot, operationKey: string) {
  if (slot.status !== 'FAILED') throw new Error('仅失败的套图槽位可以重试');
  return { expectedSlotRevision: slot.revision, operationKey: suiteOperationKey(operationKey) };
}

export function buildAiMediaSuiteSlotReviewRequest(input: {
  slot: AiMediaSuiteSlot;
  operationKey: string;
  outputAssetId: string;
  decision: 'APPROVE' | 'REJECT';
  note: string;
}) {
  const outputAssetId = input.outputAssetId.trim();
  const note = input.note.trim();
  if (input.slot.status !== 'SUCCEEDED'
    || input.slot.reviewStatus !== 'PENDING'
    || input.slot.workflowRevision === null
    || !input.slot.outputAssets.some((asset) => asset.id === outputAssetId)) {
    throw new Error('当前套图候选不能审核');
  }
  if (note.length > 2_000) throw new Error('审核备注不能超过 2000 个字符');
  return {
    expectedWorkflowRevision: input.slot.workflowRevision,
    operationKey: suiteOperationKey(input.operationKey),
    outputAssetId,
    decision: input.decision,
    note: note || null,
  };
}

export function buildAiMediaSuiteSlotApplyRequest(input: {
  slot: AiMediaSuiteSlot;
  operationKey: string;
  expectedTargetUpdatedAt: string;
}) {
  const expectedTargetUpdatedAt = input.expectedTargetUpdatedAt.trim();
  const output = input.slot.outputAssets[0] || null;
  if (input.slot.application) throw new Error('当前套图候选已经应用过，不能重复追加');
  if (input.slot.status !== 'SUCCEEDED'
    || input.slot.reviewStatus !== 'APPROVED'
    || input.slot.workflowRevision === null
    || !output
    || input.slot.selectedOutputAssetId !== output.id) {
    throw new Error('当前套图候选尚未通过审核');
  }
  if (!expectedTargetUpdatedAt || !Number.isFinite(Date.parse(expectedTargetUpdatedAt))) {
    throw new Error('商品图片版本无效，请刷新后重试');
  }
  return {
    expectedWorkflowRevision: input.slot.workflowRevision,
    operationKey: suiteOperationKey(input.operationKey),
    expectedTargetUpdatedAt,
  };
}

export type AiMediaSuiteSlotRecoveryDecision = 'confirmed' | 'retry' | 'conflict';

const AI_MEDIA_SUITE_TARGET_REFRESH_ERROR_CODES = new Set([
  'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT',
  'AI_MEDIA_SUITE_CANDIDATE_STALE',
  'TARGET_CONFLICT',
  'STALE_MEDIA_WORKFLOW',
]);

export function shouldRefreshAiMediaSuiteTargetAfterError(code: unknown): boolean {
  return AI_MEDIA_SUITE_TARGET_REFRESH_ERROR_CODES.has(String(code || '').toUpperCase());
}

export function resolveAiMediaSuiteSlotReviewRecovery(input: {
  slot: AiMediaSuiteSlot;
  outputAssetId: string;
  decision: 'APPROVE' | 'REJECT';
}): AiMediaSuiteSlotRecoveryDecision {
  const expectedReviewStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (input.slot.reviewStatus === expectedReviewStatus
    && input.slot.selectedOutputAssetId === input.outputAssetId) return 'confirmed';
  if (input.slot.status === 'SUCCEEDED'
    && input.slot.reviewStatus === 'PENDING'
    && input.slot.outputAssets.some((asset) => asset.id === input.outputAssetId)) return 'retry';
  return 'conflict';
}

export function resolveAiMediaSuiteSlotApplyRecovery(input: {
  slot: AiMediaSuiteSlot;
  outputAssetId: string;
}): AiMediaSuiteSlotRecoveryDecision {
  if (input.slot.application?.state === 'APPLIED'
    && input.slot.application.outputAssetId === input.outputAssetId) return 'confirmed';
  if (input.slot.status === 'SUCCEEDED'
    && input.slot.reviewStatus === 'APPROVED'
    && input.slot.selectedOutputAssetId === input.outputAssetId
    && !input.slot.application) return 'retry';
  return 'conflict';
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
    if (operation === 'IMAGE_TRANSLATE') return '图片翻译当前关闭。';
    if (operation === 'FULL_EDIT') return 'AI 全图编辑当前关闭。';
    if (operation === 'INPAINT') return 'AI 局部重绘当前关闭。';
    return 'AI 改图当前关闭。';
  }
  if (readiness.reasonCode === 'PROVIDER_NOT_READY') {
    if (operation === 'IMAGE_TRANSLATE') return '图片翻译 Provider 尚未完成生产验证。';
    if (operation === 'FULL_EDIT') return 'AI 全图编辑 Provider 尚未完成生产验证。';
    if (operation === 'INPAINT') return 'AI 局部重绘 Provider 尚未完成生产验证。';
    return 'AI 改图 Provider 尚未完成生产验证。';
  }
  if (readiness.reasonCode === 'STORAGE_NOT_READY') {
    return operation === 'IMAGE_TRANSLATE'
      ? '图片翻译需要可用的对象存储；付费 Provider 必须使用公网 HTTPS 的自有 OSS，当前配置不兼容。'
      : 'AI 图片编辑需要可用的 OSS 或本地存储，当前存储配置不兼容。';
  }
  return readiness.reason;
}

export interface AiMediaReadinessNotice {
  id: string;
  label: string;
  message: string;
  revision?: string | number;
}

const AI_MEDIA_OPERATION_LABELS: Record<AiMediaOperation, string> = {
  IMAGE_TO_IMAGE: '参考改图',
  IMAGE_TRANSLATE: '图片翻译',
  FULL_EDIT: '全图编辑',
  INPAINT: '局部重绘',
};

function describeAiMediaWorkflowRollout(reason?: string): string {
  if (reason === 'master_off') {
    return '全局主开关未开启。';
  }
  if (reason === 'tenant_not_allowed') {
    return '当前账号不在媒体工作流灰度名单中。';
  }
  if (reason === 'invalid_policy') {
    return '媒体工作流租户策略无效，请由管理员修复。';
  }
  return '未开放。请由管理员检查媒体工作流主开关与租户策略。';
}

function describeWebMediaRollout(reason?: string): string {
  if (reason === 'master_off') {
    return '全局入口开关未开启。';
  }
  if (reason === 'policy_off') {
    return '来源工作流发布策略已关闭此入口。';
  }
  if (reason === 'pilot_miss') {
    return '当前账号、店铺或设备不在入口灰度范围内。';
  }
  if (reason === 'policy_invalid') {
    return '来源工作流发布策略无效，请由管理员修复。';
  }
  if (reason === 'context_invalid') {
    return '当前账号上下文无效。';
  }
  if (reason === 'config_unavailable') {
    return '来源工作流发布配置暂时不可读取。';
  }
  return '未开放。请由管理员检查 Web 媒体入口与来源工作流发布策略。';
}

export function listAiMediaReadinessNotices(input: {
  disabled: boolean;
  capabilities: AiMediaCapabilities | null;
}): AiMediaReadinessNotice[] {
  const notices: AiMediaReadinessNotice[] = [];
  const { capabilities } = input;
  if (input.disabled || capabilities?.workflowEnabled === false) {
    notices.push({
      id: 'workflow',
      label: 'AI 媒体工作流',
      message: describeAiMediaWorkflowRollout(capabilities?.workflowReason),
      ...(capabilities?.workflowRevision === undefined
        ? {}
        : { revision: capabilities.workflowRevision }),
    });
  }
  if (capabilities && !capabilities.webMediaEnabled) {
    notices.push({
      id: 'web-media',
      label: 'Web 媒体工作台',
      message: describeWebMediaRollout(capabilities.webMediaReason),
      ...(capabilities.webMediaRevision === undefined
        ? {}
        : { revision: capabilities.webMediaRevision }),
    });
  }
  for (const operation of Object.keys(AI_MEDIA_OPERATION_LABELS) as AiMediaOperation[]) {
    const readiness = capabilities?.operations[operation];
    if (!readiness || readiness.ready
      || readiness.reasonCode === 'AI_MEDIA_WORKFLOW_DISABLED'
      || readiness.reasonCode === 'SOURCE_LISTING_WEB_MEDIA_DISABLED') continue;
    notices.push({
      id: operation,
      label: AI_MEDIA_OPERATION_LABELS[operation],
      message: describeAiMediaReadiness(operation, readiness),
    });
  }
  return notices;
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
    'AI_IMAGE_EDIT_QUOTA_EXCEEDED',
    'MASK_ASSET_NOT_FOUND',
    'MASK_ASSET_INVALID',
    'EDIT_RESOURCE_QUOTA_EXCEEDED',
    'EDIT_RESOURCE_RATE_LIMITED',
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
  contextId?: string;
  context?: AiMediaWorkflowContextRequest;
}) {
  const sourceAssetId = input.sourceAssetId.trim();
  const context = normalizeAiMediaWorkflowContextRequest(input.context, input.contextId);
  if (!sourceAssetId) throw new Error('请选择当前商品的源图');
  const sourceLanguage = languageTag(input.sourceLanguage);
  const targetLanguage = languageTag(input.targetLanguage);
  if (sourceLanguage === targetLanguage) throw new Error('源语言和目标语言不能相同');
  const domainHint = input.domainHint.trim();
  if (new TextEncoder().encode(domainHint).byteLength > 2_000) {
    throw new Error('翻译要求不能超过 2000 字节');
  }
  const legacyCollectContext = { context: { type: 'collect' as const, id: context.id } };
  return {
    operation: 'IMAGE_TRANSLATE' as const,
    sourceAssetId,
    sourceLanguage,
    targetLanguage,
    domainHint,
    terminologies: normalizeImageTranslationTerminologies(input.terminologies),
    idempotencyKey: input.idempotencyKey,
    ...(input.context ? { context } : legacyCollectContext),
  };
}

export const AI_IMAGE_EDIT_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1' as const;

function normalizeAiMediaContextKey(value: string | null | undefined, maximum: number, label: string) {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label}无效`);
  return normalized;
}

export function buildAiImageEditWorkflowRequest(input: {
  operation: 'FULL_EDIT' | 'INPAINT';
  sourceAssetId: string;
  maskAssetId?: string | null;
  userPrompt: string;
  userNegativePrompt: string;
  idempotencyKey: string;
  contextId?: string;
  context?: AiMediaWorkflowContextRequest;
  contextSkuKey?: string | null;
  contextSlotKey?: string | null;
}) {
  const sourceAssetId = input.sourceAssetId.trim();
  const context = normalizeAiMediaWorkflowContextRequest(input.context, input.contextId, {
    skuKey: input.contextSkuKey,
    slotKey: input.contextSlotKey,
  });
  const userPrompt = input.userPrompt.trim();
  const userNegativePrompt = input.userNegativePrompt.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!sourceAssetId) throw new Error('请选择当前商品的源图');
  if (!userPrompt) throw new Error('请填写编辑要求');
  if (userPrompt.length > 8_000) throw new Error('编辑要求不能超过 8000 个字符');
  if (userNegativePrompt.length > 4_000) throw new Error('排除要求不能超过 4000 个字符');
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error('编辑请求幂等键无效');
  }
  if (input.operation === 'FULL_EDIT') {
    if (String(input.maskAssetId || '').trim()) throw new Error('全图编辑不能包含遮罩');
    const legacyCollectContext = { context: { type: 'collect' as const, id: context.id, skuKey: context.skuKey, slotKey: context.slotKey } };
    return {
      operation: 'FULL_EDIT' as const,
      sourceAssetId,
      userPrompt,
      userNegativePrompt,
      idempotencyKey,
      ...(input.context ? { context } : legacyCollectContext),
    };
  }
  const maskAssetId = String(input.maskAssetId || '').trim();
  if (!maskAssetId) throw new Error('局部重绘需要有效遮罩');
  const legacyCollectContext = { context: { type: 'collect' as const, id: context.id, skuKey: context.skuKey, slotKey: context.slotKey } };
  return {
    operation: 'INPAINT' as const,
    sourceAssetId,
    maskAssetId,
    maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    userPrompt,
    userNegativePrompt,
    idempotencyKey,
    ...(input.context ? { context } : legacyCollectContext),
  };
}

export function normalizeAiMediaWorkflowContextRequest(
  input: AiMediaWorkflowContextRequest | null | undefined,
  legacyCollectId?: string,
  legacyScope: { skuKey?: string | null; slotKey?: string | null } = {},
): AiMediaWorkflowContextRequest {
  if (!input) {
    const id = String(legacyCollectId || '').trim();
    if (!id || id.length > 200) throw new Error('当前商品上下文无效');
    return {
      type: 'collect',
      id,
      skuKey: normalizeAiMediaContextKey(legacyScope.skuKey, 500, 'SKU 上下文'),
      slotKey: normalizeAiMediaContextKey(legacyScope.slotKey, 200, '图片槽位上下文'),
    };
  }
  const id = String(input.id || '').trim();
  if (!id || id.length > 200) throw new Error('当前商品上下文无效');
  const skuKey = normalizeAiMediaContextKey(input.skuKey, 500, 'SKU 上下文');
  const slotKey = normalizeAiMediaContextKey(
    input.slotKey,
    input.type === 'listing-draft' ? 1_024 : 200,
    '图片槽位上下文',
  );
  if (input.type === 'collect') return { type: 'collect', id, skuKey, slotKey };
  if (!Number.isSafeInteger(input.revision) || input.revision < 1
    || !Number.isSafeInteger(input.draftVersion) || input.draftVersion < 1) {
    throw new Error('草稿图片上下文已失效，请刷新后重试');
  }
  return {
    type: 'listing-draft',
    id,
    revision: input.revision,
    draftVersion: input.draftVersion,
    skuKey,
    slotKey,
  };
}

export function aiMediaWorkflowContextFromTarget(
  target: AiMediaContextTarget,
): AiMediaWorkflowContextRequest {
  return target.type === 'listing-draft'
    ? normalizeAiMediaWorkflowContextRequest({
      type: 'listing-draft',
      id: target.id,
      revision: target.revision,
      draftVersion: target.draftVersion,
      skuKey: target.skuKey,
      slotKey: target.slotKey,
    })
    : normalizeAiMediaWorkflowContextRequest({ type: 'collect', id: target.id });
}

export function isAiMediaWorkflowInputCurrent(
  workflow: Pick<AiMediaWorkflow, 'inputs'> & Partial<Pick<
    AiMediaWorkflow,
    | 'contextType'
    | 'contextId'
    | 'contextSkuKey'
    | 'contextSlotKey'
    | 'contextDraftRevision'
    | 'contextDraftVersion'
  >>,
  currentInputs: AiMediaContextInput[],
  currentSnapshotId?: string | null,
  currentContext?: Pick<AiMediaContextResponse, 'target'> | null,
) {
  if (workflow.contextType === 'listing-draft') {
    const target = currentContext?.target;
    if (
      !target
      || target.type !== 'listing-draft'
      || workflow.contextId !== target.id
      || workflow.contextDraftRevision !== target.revision
      || workflow.contextDraftVersion !== target.draftVersion
      || (workflow.contextSkuKey ?? null) !== target.skuKey
      || (workflow.contextSlotKey ?? null) !== target.slotKey
    ) return false;
  } else if (workflow.contextType === 'collect' && currentContext) {
    if (
      currentContext.target.type !== 'collect'
      || (workflow.contextId != null && workflow.contextId !== currentContext.target.id)
    ) return false;
  }
  const sourceInputs = workflow.inputs.filter((input) => input.role !== 'MASK');
  if (!sourceInputs.length) return false;
  const currentAssetIds = new Set(currentInputs.flatMap((input) => [
    input.assetId,
    ...(Array.isArray(input.compatibleAssetIds) ? input.compatibleAssetIds : []),
  ]).filter(Boolean));
  return sourceInputs.every((input) => currentAssetIds.has(input.assetId) || Boolean(
    input.kind === 'AI_GENERATED'
    && currentSnapshotId
    && input.sourceCaptureSnapshotId === currentSnapshotId,
  ));
}
