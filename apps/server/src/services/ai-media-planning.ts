import { createHash } from 'node:crypto';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  type SourceCaptureEvidence,
  type SourceProductCaptureV2,
} from 'shared';
import {
  createDeterministicImageCuration,
  type ImageCurationCandidate,
  type ImageCurationPlan,
} from './ai-image-curation.js';
import {
  createRuleBasedImagePromptPlan,
  AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES,
  AI_IMAGE_PROMPT_PLAN_VERSION,
  type ImagePromptPlan,
  type ImagePromptPlanSku,
  type ImagePromptPlanVerifiedFact,
} from './ai-image-prompt-plan.js';
import {
  AI_IMAGE_VISION_VERSION,
  normalizeAiImageVisionOutput,
  type NormalizedAiImageVisionOutput,
} from './ai-image-vision.js';
import {
  AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH,
  AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH,
  compareAiMediaPlanningStrings,
} from './ai-media-planning-contract.js';
import {
  AI_MEDIA_PLANNING_SOURCE_MAX_CANDIDATES,
  AiMediaPlanningSourceError,
  prepareAiMediaPlanningSources,
  type AiMediaPlanningSourceDependencies,
  type AiMediaPlanningSourceErrorCode,
  type AiMediaPlanningSourceRepository,
  type PreparedAiMediaPlanningSource,
} from './ai-media-planning-sources.js';

export const AI_MEDIA_RULE_PLANNER_VERSION = 'ai-media-rule-planner/v1';
export const AI_MEDIA_PLANNING_INPUT_VERSION = 'ai-media-planning-input/v1';
export const AI_MEDIA_PLANNING_PROVENANCE_VERSION = 'ai-media-planning-provenance/v1';
export const AI_MEDIA_PLANNING_MAX_JSON_BYTES = 1024 * 1024;
export const AI_MEDIA_PLANNING_MAX_SELECTED_SKUS = 50;
export const AI_MEDIA_PLANNING_MAX_CANDIDATES = AI_MEDIA_PLANNING_SOURCE_MAX_CANDIDATES;
export const AI_MEDIA_PLANNING_MAX_VERIFIED_FACTS = 32;
export const AI_MEDIA_PLAN_VERSION_PAGE_DEFAULT = 10;
export const AI_MEDIA_PLAN_VERSION_PAGE_MAX = 20;
export const AI_MEDIA_MANUAL_SLOT_EDITOR_VERSION = 'ai-media-manual-slot-editor/v1';
export const AI_MEDIA_MANUAL_SLOT_CHANGE_MAX = 50;

export const AI_MEDIA_GALLERY_GOALS = Object.freeze([
  'scene',
  'detail',
  'function',
  'fitment',
  'spec',
  'package',
  'poster',
] as const);
export type AiMediaGalleryGoal = typeof AI_MEDIA_GALLERY_GOALS[number];

type JsonObject = Record<string, unknown>;

export interface CreateRuleBasedAiMediaPlanningInput {
  ownerUserId: string;
  actorUserId: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  context: { type: 'collect'; id: string };
  idempotencyKey: string;
  selectedSkuKeys: string[];
  candidateMediaKeys?: string[];
  galleryGoals?: AiMediaGalleryGoal[];
}

export type CreateCurrentRuleBasedAiMediaPlanningInput = Omit<
  CreateRuleBasedAiMediaPlanningInput,
  'sourceSubjectId' | 'sourceCaptureSnapshotId' | 'selectedSkuKeys'
> & {
  selectedSkuKeys?: string[];
};

export interface AiMediaPlanningCurrentTarget {
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  selectedSkuKeys?: string[];
}

export interface AiMediaPlanningSourceAuthority {
  snapshotId: string;
  captureHash: string;
  profileHash: string;
  schemaVersion: string;
}

export interface AiMediaPlanVersionPageInput {
  limit: number;
  beforeVersion?: number;
}

export interface AiMediaPlanningAuthority {
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  capture: SourceProductCaptureV2;
}

export interface ResolvedRuleBasedAiMediaPlanningInput extends CreateRuleBasedAiMediaPlanningInput {
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  skus: ImagePromptPlanSku[];
  candidates: ImageCurationCandidate[];
  verifiedFacts: ImagePromptPlanVerifiedFact[];
}

export interface RuleBasedAiMediaPlanningArtifacts {
  ownerUserId: string;
  actorUserId: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  contextType: 'collect';
  contextId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  engineVersion: typeof AI_MEDIA_RULE_PLANNER_VERSION;
  inputFingerprint: string;
  selectedSkuHash: string;
  inputAssetSetHash: string;
  inputSnapshot: JsonObject;
  inputHash: string;
  inputBytes: number;
  curation: ImageCurationPlan;
  curationHash: string;
  visionEvidence: NormalizedAiImageVisionOutput;
  visionEvidenceHash: string;
  plan: ImagePromptPlan;
  planSchemaVersion: string;
  planHash: string;
  planBytes: number;
  provenance: JsonObject;
  provenanceHash: string;
}

export type AiMediaPlanningReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaPlanVersionRecord {
  id: string;
  planId: string;
  ownerUserId: string;
  version: number;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  inputFingerprint: string;
  planSchemaVersion: string;
  plannerVersion: string;
  mode: 'RULE_BASED' | 'MODEL_ASSISTED';
  fallbackReason: string | null;
  inputSnapshot: unknown;
  curation: unknown;
  curationHash: string;
  visionEvidence: unknown;
  visionEvidenceHash: string;
  planHash: string;
  planPayload: unknown;
  provenance: unknown;
  provenanceHash: string;
  createdAt: Date;
}

export interface AiMediaPlanRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  sourceSubjectId: string;
  contextType: string;
  contextId: string;
  revision: number;
  latestVersion: number;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  reviewStatus: AiMediaPlanningReviewStatus;
  staleAt: Date | null;
  staleAgainstFingerprint: string | null;
  staleReasons: unknown;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  currentVersion?: AiMediaPlanVersionRecord | null;
  approvedVersion?: AiMediaPlanVersionRecord | null;
}

export interface ReviewAiMediaPlanInput {
  planId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
  decision: 'APPROVE' | 'REJECT';
  note: string | null;
}

export interface AiMediaSlotReferenceChange {
  slotKey: string;
  referenceCandidateIds: string[];
}

export interface UpdateAiMediaPlanSlotReferencesInput {
  planId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  baseVersionId: string;
  operationKey: string;
  changes: AiMediaSlotReferenceChange[];
}

export interface AiMediaManualSlotVersionArtifacts {
  operation: UpdateAiMediaPlanSlotReferencesInput;
  requestFingerprint: string;
  inputSnapshot: JsonObject;
  inputHash: string;
  inputBytes: number;
  inputFingerprint: string;
  planPayload: JsonObject;
  planHash: string;
  planBytes: number;
  provenance: JsonObject;
  provenanceHash: string;
  changed: boolean;
}

export type CreateRulePlanResult = {
  kind: 'created' | 'existing' | 'conflict' | 'context-changed';
  plan: AiMediaPlanRecord | null;
};

export type ReviewRulePlanResult = {
  kind:
    | 'updated'
    | 'replayed'
    | 'not-found'
    | 'operation-conflict'
    | 'revision-conflict'
    | 'state-conflict'
    | 'not-ready'
    | 'stale';
  plan: AiMediaPlanRecord | null;
};

export type ExecutionPlanResult = {
  kind: 'ready' | 'not-found' | 'not-approved' | 'not-ready' | 'stale';
  plan: AiMediaPlanRecord | null;
};

export type UpdateAiMediaPlanSlotReferencesResult = {
  kind:
    | 'updated'
    | 'replayed'
    | 'not-found'
    | 'operation-conflict'
    | 'revision-conflict'
    | 'state-conflict'
    | 'stale'
    | 'no-changes'
    | 'invalid-reference'
    | 'active-suite-conflict';
  plan: AiMediaPlanRecord | null;
  createdVersionId: string | null;
};

export interface AiMediaPlanningRepository extends AiMediaPlanningSourceRepository {
  resolveCurrentRulePlanningTarget(input: {
    ownerUserId: string;
    context: { type: 'collect'; id: string };
  }): Promise<AiMediaPlanningCurrentTarget | null>;
  loadRulePlanningAuthority(
    input: CreateRuleBasedAiMediaPlanningInput,
  ): Promise<AiMediaPlanningAuthority | null>;
  createRulePlan(input: RuleBasedAiMediaPlanningArtifacts): Promise<CreateRulePlanResult>;
  getOwned(planId: string, ownerUserId: string): Promise<AiMediaPlanRecord | null>;
  getLatestOwnedByContext(input: {
    ownerUserId: string;
    contextType: 'collect';
    contextId: string;
  }): Promise<AiMediaPlanRecord | null>;
  loadLatestSourceAuthority(input: {
    ownerUserId: string;
    sourceSubjectId: string;
    contextType: string;
    contextId: string;
  }): Promise<AiMediaPlanningSourceAuthority | null>;
  listVersionsOwned(
    planId: string,
    ownerUserId: string,
    page: AiMediaPlanVersionPageInput,
  ): Promise<AiMediaPlanVersionRecord[]>;
  reviewCurrent(input: ReviewAiMediaPlanInput): Promise<ReviewRulePlanResult>;
  updateSlotReferences(
    input: UpdateAiMediaPlanSlotReferencesInput,
  ): Promise<UpdateAiMediaPlanSlotReferencesResult>;
  requireApprovedForExecution(input: {
    planId: string;
    ownerUserId: string;
    actorUserId: string;
  }): Promise<ExecutionPlanResult>;
}

export type AiMediaPlanningErrorCode =
  | AiMediaPlanningSourceErrorCode
  | 'AI_MEDIA_WORKFLOW_DISABLED'
  | 'SOURCE_LISTING_WEB_MEDIA_DISABLED'
  | 'AI_MEDIA_PLANNING_NOT_FOUND'
  | 'AI_MEDIA_PLANNING_INVALID_INPUT'
  | 'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT'
  | 'AI_MEDIA_PLANNING_OPERATION_CONFLICT'
  | 'AI_MEDIA_PLANNING_REVISION_CONFLICT'
  | 'AI_MEDIA_PLANNING_CONTEXT_CHANGED'
  | 'AI_MEDIA_PLANNING_STALE'
  | 'AI_MEDIA_PLANNING_NOT_READY'
  | 'AI_MEDIA_PLANNING_REVIEW_STATE_CONFLICT'
  | 'AI_MEDIA_PLANNING_NO_CHANGES'
  | 'AI_MEDIA_PLANNING_ACTIVE_SUITE_CONFLICT'
  | 'AI_MEDIA_PLANNING_NOT_APPROVED';

export class AiMediaPlanningError extends Error {
  constructor(
    public readonly code: AiMediaPlanningErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AiMediaPlanningError';
  }
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('AI media planning JSON requires finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('AI media planning JSON cannot be circular');
    ancestors.add(value);
    try {
      return `[${value.map((item) => {
        if (item === undefined) throw new TypeError('AI media planning JSON cannot contain undefined');
        return canonicalJson(item, ancestors);
      }).join(',')}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError('AI media planning input must be JSON serializable');
  }
  if (ancestors.has(value)) throw new TypeError('AI media planning JSON cannot be circular');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('AI media planning JSON requires plain objects');
  }
  ancestors.add(value);
  try {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareAiMediaPlanningStrings(left, right));
    return `{${entries.map(([key, item]) => (
      `${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`
    )).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function hashAiMediaPlanningJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function jsonClone<T>(value: T): T {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > AI_MEDIA_PLANNING_MAX_JSON_BYTES) {
    throw new TypeError('AI media planning JSON exceeds the 1 MiB persistence limit');
  }
  return JSON.parse(serialized) as T;
}

function required(value: string, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is required`);
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function sha256(value: string, label: string): string {
  const normalized = required(value.toLowerCase(), label, 64);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function normalizeSlotReferenceMutation(
  input: UpdateAiMediaPlanSlotReferencesInput,
): UpdateAiMediaPlanSlotReferencesInput {
  const planId = required(input.planId, 'planId', 200);
  const ownerUserId = required(input.ownerUserId, 'ownerUserId', 200);
  const actorUserId = required(input.actorUserId, 'actorUserId', 200);
  const baseVersionId = required(input.baseVersionId, 'baseVersionId', 200);
  const operationKey = required(input.operationKey, 'operationKey', 128);
  if (operationKey.length < 8) throw new TypeError('operationKey is invalid');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new TypeError('expectedRevision is invalid');
  }
  if (!Array.isArray(input.changes)
    || input.changes.length < 1
    || input.changes.length > AI_MEDIA_MANUAL_SLOT_CHANGE_MAX) {
    throw new TypeError(`slot reference changes require 1 to ${AI_MEDIA_MANUAL_SLOT_CHANGE_MAX} slots`);
  }
  const slotKeys = new Set<string>();
  const changes = input.changes.map((change) => {
    if (!change || typeof change !== 'object') throw new TypeError('slot reference change is invalid');
    const slotKey = required(change.slotKey, 'slotKey', AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH);
    if (slotKeys.has(slotKey)) throw new TypeError('slot reference change slotKeys must be unique');
    slotKeys.add(slotKey);
    if (!Array.isArray(change.referenceCandidateIds)
      || change.referenceCandidateIds.length > AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES) {
      throw new TypeError(
        `slot references support at most ${AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES} candidates`,
      );
    }
    const referenceCandidateIds = change.referenceCandidateIds.map((candidateId) => (
      required(candidateId, 'referenceCandidateId', AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)
    ));
    if (new Set(referenceCandidateIds).size !== referenceCandidateIds.length) {
      throw new TypeError('slot reference candidate IDs must be unique');
    }
    return { slotKey, referenceCandidateIds };
  });
  return jsonClone({
    planId,
    ownerUserId,
    actorUserId,
    expectedRevision: input.expectedRevision,
    baseVersionId,
    operationKey,
    changes,
  });
}

function planningRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function planningStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}

function sameSlotReferences(
  references: unknown,
  candidateIds: string[],
  snapshotId: string,
): boolean {
  if (!Array.isArray(references) || references.length !== candidateIds.length) return false;
  return references.every((rawReference, index) => {
    const reference = planningRecord(rawReference);
    const evidenceIds = planningStringArray(reference?.evidenceIds);
    const candidateId = candidateIds[index];
    return reference?.candidateId === candidateId
      && evidenceIds?.length === 1
      && evidenceIds[0] === selectedCandidateEvidenceId(snapshotId, candidateId!);
  });
}

export function buildManualAiMediaSlotVersionArtifacts(
  rawInput: UpdateAiMediaPlanSlotReferencesInput,
  baseVersion: AiMediaPlanVersionRecord,
): AiMediaManualSlotVersionArtifacts {
  const operation = normalizeSlotReferenceMutation(rawInput);
  if (baseVersion.id !== operation.baseVersionId) throw new TypeError('baseVersionId is not current');
  const inputSnapshot = planningRecord(baseVersion.inputSnapshot);
  const rawCandidates = inputSnapshot?.candidates;
  const curation = planningRecord(baseVersion.curation);
  const selectedCandidateIds = planningStringArray(curation?.selectedCandidateIds);
  const visionEvidence = planningRecord(baseVersion.visionEvidence);
  const visionImages = visionEvidence?.images;
  const planPayload = jsonClone(baseVersion.planPayload);
  const payload = planningRecord(planPayload);
  if (!inputSnapshot || !Array.isArray(rawCandidates) || !selectedCandidateIds
    || !Array.isArray(visionImages) || !payload || !Array.isArray(payload.slots)
    || !Array.isArray(payload.compatibilityGroups)) {
    throw new TypeError('current plan version has invalid frozen slot authority');
  }

  const candidates = new Map<string, { skuKeys: string[] }>();
  for (const rawCandidate of rawCandidates) {
    const candidate = planningRecord(rawCandidate);
    const candidateId = typeof candidate?.id === 'string' ? candidate.id : '';
    const skuKeys = planningStringArray(candidate?.skuKeys);
    if (!candidateId || !skuKeys || candidates.has(candidateId)) {
      throw new TypeError('current plan version has invalid frozen candidates');
    }
    candidates.set(candidateId, { skuKeys });
  }
  const selected = new Set(selectedCandidateIds);
  const vision = new Set<string>();
  for (const rawImage of visionImages) {
    const image = planningRecord(rawImage);
    if (typeof image?.candidateId === 'string' && image.candidateId) vision.add(image.candidateId);
  }
  const groups = new Map<string, Set<string>>();
  for (const rawGroup of payload.compatibilityGroups) {
    const group = planningRecord(rawGroup);
    const groupKey = typeof group?.groupKey === 'string' ? group.groupKey : '';
    const skuKeys = planningStringArray(group?.skuKeys);
    if (!groupKey || !skuKeys || groups.has(groupKey)) {
      throw new TypeError('current plan version has invalid compatibility groups');
    }
    groups.set(groupKey, new Set(skuKeys));
  }
  const slots = new Map<string, Record<string, unknown>>();
  for (const rawSlot of payload.slots) {
    const slot = planningRecord(rawSlot);
    const slotKey = typeof slot?.slotKey === 'string' ? slot.slotKey : '';
    if (!slotKey || slots.has(slotKey)) throw new TypeError('current plan version has invalid slots');
    slots.set(slotKey, slot!);
  }

  let changed = false;
  for (const change of operation.changes) {
    const slot = slots.get(change.slotKey);
    if (!slot) throw new TypeError(`unknown AI media slot: ${change.slotKey}`);
    const ownership = planningRecord(slot.ownership);
    const ownershipLevel = ownership?.level;
    const ownershipKey = typeof ownership?.key === 'string' ? ownership.key : '';
    if ((ownershipLevel !== 'sku' && ownershipLevel !== 'compatibility_group') || !ownershipKey) {
      throw new TypeError(`AI media slot ownership is invalid: ${change.slotKey}`);
    }
    for (const candidateId of change.referenceCandidateIds) {
      const candidate = candidates.get(candidateId);
      if (!candidate || !selected.has(candidateId) || !vision.has(candidateId)) {
        throw new TypeError(`AI media slot reference is outside frozen evidence: ${candidateId}`);
      }
      const compatible = ownershipLevel === 'sku'
        ? candidate.skuKeys.length === 0 || candidate.skuKeys.includes(ownershipKey)
        : (() => {
            const members = groups.get(ownershipKey);
            return Boolean(members
              && (candidate.skuKeys.length === 0
                || candidate.skuKeys.every((skuKey) => members.has(skuKey))));
          })();
      if (!compatible) {
        throw new TypeError(`AI media slot reference is incompatible with slot ownership: ${candidateId}`);
      }
    }
    const nextStatus = change.referenceCandidateIds.length > 0 ? 'READY' : 'MANUAL_REQUIRED';
    if (slot.status !== nextStatus
      || !sameSlotReferences(
        slot.references,
        change.referenceCandidateIds,
        baseVersion.sourceCaptureSnapshotId,
      )) {
      changed = true;
    }
    slot.status = nextStatus;
    slot.references = change.referenceCandidateIds.map((candidateId) => ({
      candidateId,
      evidenceIds: [selectedCandidateEvidenceId(baseVersion.sourceCaptureSnapshotId, candidateId)],
    }));
  }
  const planSerialized = canonicalJson(planPayload);
  const planBytes = Buffer.byteLength(planSerialized, 'utf8');
  if (planBytes > AI_MEDIA_PLANNING_MAX_JSON_BYTES) {
    throw new TypeError('AI media planning output exceeds the 1 MiB persistence limit');
  }
  const planHash = createHash('sha256').update(planSerialized).digest('hex');
  const nextInputSnapshot = jsonClone<JsonObject>({
    ...inputSnapshot,
    manualSlotEdit: {
      version: AI_MEDIA_MANUAL_SLOT_EDITOR_VERSION,
      parentVersionId: baseVersion.id,
      parentPlanHash: baseVersion.planHash,
      changes: operation.changes,
    },
  });
  const inputSerialized = canonicalJson(nextInputSnapshot);
  const inputBytes = Buffer.byteLength(inputSerialized, 'utf8');
  if (inputBytes > AI_MEDIA_PLANNING_MAX_JSON_BYTES) {
    throw new TypeError('AI media planning input exceeds the 1 MiB persistence limit');
  }
  const inputHash = createHash('sha256').update(inputSerialized).digest('hex');
  const inputFingerprint = hashAiMediaPlanningJson({
    inputHash,
    sourceCaptureSnapshotId: baseVersion.sourceCaptureSnapshotId,
    sourceCaptureHash: baseVersion.sourceCaptureHash,
    sourceProfileHash: baseVersion.sourceProfileHash,
  });
  const provenance = jsonClone<JsonObject>({
    version: AI_MEDIA_PLANNING_PROVENANCE_VERSION,
    mode: 'MANUAL_SLOT_EDIT',
    engineVersion: AI_MEDIA_MANUAL_SLOT_EDITOR_VERSION,
    parentVersionId: baseVersion.id,
    parentPlanHash: baseVersion.planHash,
    changes: operation.changes,
    provider: null,
  });
  return {
    operation,
    requestFingerprint: hashAiMediaPlanningJson(operation),
    inputSnapshot: nextInputSnapshot,
    inputHash,
    inputBytes,
    inputFingerprint,
    planPayload: planPayload as JsonObject,
    planHash,
    planBytes,
    provenance,
    provenanceHash: hashAiMediaPlanningJson(provenance),
    changed,
  };
}

function normalizeCreateInput(
  input: CreateRuleBasedAiMediaPlanningInput,
): CreateRuleBasedAiMediaPlanningInput {
  const ownerUserId = required(input.ownerUserId, 'ownerUserId', 200);
  const actorUserId = required(input.actorUserId, 'actorUserId', 200);
  const sourceSubjectId = required(input.sourceSubjectId, 'sourceSubjectId', 200);
  const sourceCaptureSnapshotId = required(input.sourceCaptureSnapshotId, 'sourceCaptureSnapshotId', 200);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey', 128);
  if (idempotencyKey.length < 8) throw new TypeError('idempotencyKey is invalid');
  if (!input.context || input.context.type !== 'collect') {
    throw new TypeError('AI media planning context is invalid');
  }
  const contextId = required(input.context.id, 'context.id', 200);
  if (!Array.isArray(input.selectedSkuKeys)
    || input.selectedSkuKeys.length < 1
    || input.selectedSkuKeys.length > AI_MEDIA_PLANNING_MAX_SELECTED_SKUS) {
    throw new TypeError(`AI media planning requires 1 to ${AI_MEDIA_PLANNING_MAX_SELECTED_SKUS} SKUs`);
  }
  const selectedSkuKeys = input.selectedSkuKeys
    .map((key) => required(key, 'selectedSkuKey', 500))
    .sort(compareAiMediaPlanningStrings);
  if (new Set(selectedSkuKeys).size !== selectedSkuKeys.length) {
    throw new TypeError('AI media planning selectedSkuKeys must be unique');
  }
  let candidateMediaKeys: string[] | undefined;
  if (input.candidateMediaKeys !== undefined) {
    if (!Array.isArray(input.candidateMediaKeys)
      || input.candidateMediaKeys.length > AI_MEDIA_PLANNING_MAX_CANDIDATES) {
      throw new TypeError(`AI media planning supports at most ${AI_MEDIA_PLANNING_MAX_CANDIDATES} candidates`);
    }
    candidateMediaKeys = input.candidateMediaKeys.map((key) => required(key, 'candidateMediaKey', 500));
    if (new Set(candidateMediaKeys).size !== candidateMediaKeys.length) {
      throw new TypeError('AI media planning candidateMediaKeys must be unique');
    }
  }
  let galleryGoals: AiMediaGalleryGoal[] | undefined;
  if (input.galleryGoals !== undefined) {
    if (!Array.isArray(input.galleryGoals)
      || input.galleryGoals.length < 1
      || input.galleryGoals.length > AI_MEDIA_GALLERY_GOALS.length
      || input.galleryGoals.some((goal) => !AI_MEDIA_GALLERY_GOALS.includes(goal))) {
      throw new TypeError('AI media planning galleryGoals is invalid');
    }
    galleryGoals = [...input.galleryGoals];
    if (new Set(galleryGoals).size !== galleryGoals.length) {
      throw new TypeError('AI media planning galleryGoals must be unique');
    }
  }
  return jsonClone({
    ownerUserId,
    actorUserId,
    sourceSubjectId,
    sourceCaptureSnapshotId,
    context: { type: 'collect' as const, id: contextId },
    idempotencyKey,
    selectedSkuKeys,
    ...(candidateMediaKeys === undefined ? {} : { candidateMediaKeys }),
    ...(galleryGoals === undefined ? {} : { galleryGoals }),
  });
}

function captureEvidenceId(snapshotId: string, path: string, evidencePath: string): string {
  const evidenceHash = createHash('sha256').update(`${path}\u0000${evidencePath}`).digest('hex');
  return `capture:${snapshotId}:evidence:${evidenceHash}`;
}

function trustedEvidence(evidence: SourceCaptureEvidence, value: unknown): boolean {
  return evidence.missingReason === null
    && !evidence.isEstimated
    && evidence.confidence >= 0.5
    && canonicalJson(evidence.value) === canonicalJson(value);
}

function identityImpact(name: string): ImagePromptPlanSku['attributes'][number]['identityImpact'] {
  const key = name.normalize('NFKC').toLowerCase();
  if (/color|colour|颜色|色彩|цвет/u.test(key)) return 'color';
  if (/capacity|volume|容量|容积|毫升|升|объем/u.test(key)) return 'capacity';
  if (/bundle|count|quantity|套装|件数|数量|комплект|количество/u.test(key)) return 'bundle';
  if (/packaging|package|包装|упаков/u.test(key)) return 'packaging';
  if (/structure|shape|style|结构|形状|款式|форма|стиль/u.test(key)) return 'structure';
  return 'unknown';
}

function isImageLikeCapturedMedia(media: SourceProductCaptureV2['media'][number]): boolean {
  if (typeof media.url !== 'string' || !media.url) return false;
  const declaredMime = typeof media.mimeType === 'string'
    ? media.mimeType.split(';', 1)[0]!.trim().toLowerCase()
    : '';
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff'].includes(declaredMime)) {
    return true;
  }
  try {
    const pathname = new URL(media.url).pathname.toLowerCase();
    return /\.(?:jpe?g|png|webp|gif|avif|tiff?)$/u.test(pathname);
  } catch {
    return false;
  }
}

function verifiedFactsFromCapture(
  snapshotId: string,
  capture: SourceProductCaptureV2,
  selectedSkus: SourceProductCaptureV2['skus'],
): ImagePromptPlanVerifiedFact[] {
  const facts: ImagePromptPlanVerifiedFact[] = [];
  const factKeys = [
    'title',
    'shopName',
    'currency',
    'shippingCny',
    'shippingFree',
    'packageWeightG',
    'packageLengthMm',
    'packageWidthMm',
    'packageHeightMm',
    'minimumOrderQuantity',
  ] as const;
  for (const key of factKeys) {
    const value = capture.facts[key];
    const evidence = capture.fieldEvidence[key];
    if (value == null || !trustedEvidence(evidence, value)) continue;
    const path = `/facts/${key}`;
    facts.push({
      path,
      value,
      evidenceIds: [captureEvidenceId(snapshotId, path, evidence.sourcePath)],
    });
  }
  for (const sku of selectedSkus) {
    for (const [index, attribute] of sku.attributes.entries()) {
      if (facts.length >= AI_MEDIA_PLANNING_MAX_VERIFIED_FACTS) return facts;
      const nameEvidence = attribute.fieldEvidence.name;
      const valueEvidence = attribute.fieldEvidence.value;
      if (!trustedEvidence(nameEvidence, attribute.name)
        || !trustedEvidence(valueEvidence, attribute.value)) continue;
      const path = `/skus/${encodeURIComponent(sku.key)}/attributes/${index}`;
      facts.push({
        path,
        value: { name: attribute.name, value: attribute.value },
        evidenceIds: [
          captureEvidenceId(snapshotId, `${path}/name`, nameEvidence.sourcePath),
          captureEvidenceId(snapshotId, `${path}/value`, valueEvidence.sourcePath),
        ],
        skuKeys: [sku.key],
      });
    }
  }
  return facts;
}

export function resolveRuleBasedAiMediaPlanningInput(
  rawInput: CreateRuleBasedAiMediaPlanningInput,
  authority: AiMediaPlanningAuthority,
  preparedSources?: PreparedAiMediaPlanningSource[],
): ResolvedRuleBasedAiMediaPlanningInput {
  const input = normalizeCreateInput(rawInput);
  if (authority.capture.captureVersion !== 'source-product-capture-v2') {
    throw new TypeError('AI media planning source capture schema is unsupported');
  }
  const skuByKey = new Map(authority.capture.skus.map((sku) => [sku.key, sku]));
  const selectedSkus = input.selectedSkuKeys.map((key) => {
    const sku = skuByKey.get(key);
    if (!sku
      && authority.capture.skus.length === 0
      && key === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY) return null;
    if (!sku) throw new TypeError(`AI media planning SKU is not present in the source capture: ${key}`);
    return sku;
  });
  const skus: ImagePromptPlanSku[] = selectedSkus.map((sku, index) => ({
    skuKey: sku?.key || input.selectedSkuKeys[index]!,
    attributes: (sku?.attributes || []).map((attribute) => ({
      key: attribute.name,
      value: attribute.value,
      identityImpact: trustedEvidence(attribute.fieldEvidence.name, attribute.name)
        ? identityImpact(attribute.name)
        : 'unknown',
    })),
  }));
  const selectedSkuSet = new Set(input.selectedSkuKeys);
  const acceptedMedia = authority.capture.media.filter((media) => (
    media.kind === 'image'
      && media.disposition === 'accepted'
      && Boolean(media.url)
      && isImageLikeCapturedMedia(media)
  ));
  const eligibleMedia = acceptedMedia.filter((media) => (
    media.skuKeys.length === 0 || media.skuKeys.some((skuKey) => selectedSkuSet.has(skuKey))
  ));
  const mediaByKey = new Map(acceptedMedia.map((media) => [media.key, media]));
  const selectedMedia = input.candidateMediaKeys === undefined
    ? eligibleMedia.slice(0, AI_MEDIA_PLANNING_MAX_CANDIDATES)
    : input.candidateMediaKeys.map((key) => {
      const media = mediaByKey.get(key);
      if (!media) throw new TypeError(`AI media planning media is not present in the source capture: ${key}`);
      if (media.skuKeys.length > 0 && !media.skuKeys.some((skuKey) => selectedSkuSet.has(skuKey))) {
        throw new TypeError(`AI media planning media does not belong to a selected SKU: ${key}`);
      }
      return media;
    });
  const preparedByKey = new Map<string, PreparedAiMediaPlanningSource>();
  if (preparedSources !== undefined) {
    if (!Array.isArray(preparedSources) || preparedSources.length !== selectedMedia.length) {
      throw new TypeError('AI media planning source preparation does not cover the selected candidates');
    }
    for (const source of preparedSources) {
      const media = selectedMedia.find((candidate) => candidate.key === source.sourceMediaKey);
      if (!media || preparedByKey.has(source.sourceMediaKey)
        || source.ownerUserId !== input.ownerUserId
        || source.sourceSubjectId !== input.sourceSubjectId
        || source.sourceCaptureSnapshotId !== input.sourceCaptureSnapshotId
        || source.sourceCaptureHash !== authority.sourceCaptureHash
        || source.sourceProfileHash !== authority.sourceProfileHash
        || source.sourceSchemaVersion !== authority.sourceSchemaVersion
        || source.contextType !== input.context.type || source.contextId !== input.context.id
        || source.sourceUrl !== media.url
        || !Number.isSafeInteger(source.width) || source.width < 1
        || !Number.isSafeInteger(source.height) || source.height < 1
        || !/^image\/(jpeg|png|webp|gif|avif|tiff)$/u.test(source.sourceMimeType)
        || (media.width != null && media.width !== source.width)
        || (media.height != null && media.height !== source.height)
        || (media.mimeType != null && media.mimeType.split(';')[0]!.trim().toLowerCase() !== source.sourceMimeType)) {
        throw new TypeError('AI media planning prepared source does not match the capture authority');
      }
      preparedByKey.set(source.sourceMediaKey, {
        ...source, sourceSha256: sha256(source.sourceSha256, 'sourceSha256'),
      });
    }
  }
  const candidates: ImageCurationCandidate[] = selectedMedia.map((media) => ({
    id: media.key,
    url: media.url,
    width: media.width ?? preparedByKey.get(media.key)?.width ?? null,
    height: media.height ?? preparedByKey.get(media.key)?.height ?? null,
    mimeType: media.mimeType ?? preparedByKey.get(media.key)?.sourceMimeType ?? null,
    role: media.role,
    skuKeys: media.skuKeys.filter((skuKey) => selectedSkuSet.has(skuKey)),
    contentHash: preparedByKey.get(media.key)?.sourceSha256 || null,
  }));
  return jsonClone({
    ...input,
    sourceCaptureHash: sha256(authority.sourceCaptureHash, 'sourceCaptureHash'),
    sourceProfileHash: sha256(authority.sourceProfileHash, 'sourceProfileHash'),
    sourceSchemaVersion: required(authority.sourceSchemaVersion, 'sourceSchemaVersion', 100),
    skus,
    candidates,
    verifiedFacts: verifiedFactsFromCapture(
      input.sourceCaptureSnapshotId,
      authority.capture,
      selectedSkus.filter((sku): sku is SourceProductCaptureV2['skus'][number] => Boolean(sku)),
    ),
  });
}

function selectedCandidateEvidenceId(snapshotId: string, candidateId: string): string {
  return captureEvidenceId(snapshotId, `/media/${encodeURIComponent(candidateId)}`, candidateId);
}

export function buildRuleBasedAiMediaPlanningArtifacts(
  rawInput: ResolvedRuleBasedAiMediaPlanningInput,
): RuleBasedAiMediaPlanningArtifacts {
  const input = jsonClone(rawInput);
  const curation = createDeterministicImageCuration(input.candidates);
  const selected = new Set(curation.selectedCandidateIds);
  const globalVerifiedFacts = input.verifiedFacts
    .filter((fact) => !fact.skuKeys?.length)
    .map((fact) => ({ path: fact.path, value: fact.value, evidenceIds: fact.evidenceIds }));
  const visionEvidence = normalizeAiImageVisionOutput({
    candidateIds: curation.selectedCandidateIds,
    verifiedFacts: globalVerifiedFacts,
    modelOutput: null,
  });
  const decisions = new Map(curation.decisions.map((decision) => [decision.candidateId, decision]));
  const plan = createRuleBasedImagePromptPlan({
    skus: input.skus,
    images: input.candidates.filter((candidate) => selected.has(candidate.id)).map((candidate) => ({
      candidateId: candidate.id,
      skuKeys: [...candidate.skuKeys],
      contentRole: decisions.get(candidate.id)?.contentRole || 'unknown',
      evidenceIds: [selectedCandidateEvidenceId(input.sourceCaptureSnapshotId, candidate.id)],
    })),
    verifiedFacts: input.verifiedFacts,
    ...(input.galleryGoals ? { galleryGoals: input.galleryGoals } : {}),
  });
  const selectedSkuKeys = [...new Set(input.skus.map((sku) => sku.skuKey))]
    .sort(compareAiMediaPlanningStrings);
  const selectedSkuHash = hashAiMediaPlanningJson(selectedSkuKeys);
  const inputAssetSetHash = hashAiMediaPlanningJson(input.candidates
    .map((candidate) => candidate.id)
    .sort(compareAiMediaPlanningStrings));
  const inputSnapshot = jsonClone<JsonObject>({
    version: AI_MEDIA_PLANNING_INPUT_VERSION,
    source: {
      subjectId: input.sourceSubjectId,
      snapshotId: input.sourceCaptureSnapshotId,
      captureHash: input.sourceCaptureHash,
      profileHash: input.sourceProfileHash,
      schemaVersion: input.sourceSchemaVersion,
    },
    context: input.context,
    skus: input.skus,
    candidates: input.candidates,
    verifiedFacts: input.verifiedFacts,
    galleryGoals: input.galleryGoals || null,
  });
  const inputSerialized = canonicalJson(inputSnapshot);
  const inputBytes = Buffer.byteLength(inputSerialized, 'utf8');
  if (inputBytes > AI_MEDIA_PLANNING_MAX_JSON_BYTES) {
    throw new TypeError('AI media planning input exceeds the 1 MiB persistence limit');
  }
  const inputHash = createHash('sha256').update(inputSerialized).digest('hex');
  const inputFingerprint = hashAiMediaPlanningJson({
    inputHash,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
  });
  const provenance = jsonClone<JsonObject>({
    version: AI_MEDIA_PLANNING_PROVENANCE_VERSION,
    mode: 'RULE_BASED',
    engineVersion: AI_MEDIA_RULE_PLANNER_VERSION,
    rules: {
      curation: 'deterministic/v1',
      vision: AI_IMAGE_VISION_VERSION,
      slotPlan: AI_IMAGE_PROMPT_PLAN_VERSION,
    },
    promptTemplates: [],
    provider: null,
  });
  const planSerialized = canonicalJson(plan);
  const planBytes = Buffer.byteLength(planSerialized, 'utf8');
  if (planBytes > AI_MEDIA_PLANNING_MAX_JSON_BYTES) {
    throw new TypeError('AI media planning output exceeds the 1 MiB persistence limit');
  }
  const planHash = createHash('sha256').update(planSerialized).digest('hex');
  return {
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    contextType: input.context.type,
    contextId: input.context.id,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: hashAiMediaPlanningJson({
      sourceSubjectId: input.sourceSubjectId,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      context: input.context,
      inputFingerprint,
      engineVersion: AI_MEDIA_RULE_PLANNER_VERSION,
    }),
    engineVersion: AI_MEDIA_RULE_PLANNER_VERSION,
    inputFingerprint,
    selectedSkuHash,
    inputAssetSetHash,
    inputSnapshot,
    inputHash,
    inputBytes,
    curation,
    curationHash: hashAiMediaPlanningJson(curation),
    visionEvidence,
    visionEvidenceHash: hashAiMediaPlanningJson(visionEvidence),
    plan,
    planSchemaVersion: `ai-image-prompt-plan/${AI_IMAGE_PROMPT_PLAN_VERSION}`,
    planHash,
    planBytes,
    provenance,
    provenanceHash: hashAiMediaPlanningJson(provenance),
  };
}

function inputError(error: unknown): never {
  if (error instanceof AiMediaPlanningError) throw error;
  if (error instanceof AiMediaPlanningSourceError) {
    throw new AiMediaPlanningError(error.code, error.message, error.statusCode);
  }
  const message = error instanceof Error ? error.message : 'AI media planning input is invalid';
  throw new AiMediaPlanningError('AI_MEDIA_PLANNING_INVALID_INPUT', message, 400);
}

export interface AiMediaPlanningServiceOptions {
  /** Internal legacy replay only. HTTP and extension callers cannot choose this option. */
  sourcePreparation?: AiMediaPlanningSourceDependencies | false;
}

export function createAiMediaPlanningService(
  repository: AiMediaPlanningRepository,
  options: AiMediaPlanningServiceOptions = {},
) {
  const createRuleBased = async (input: CreateRuleBasedAiMediaPlanningInput) => {
      let normalized: CreateRuleBasedAiMediaPlanningInput;
      let artifacts: RuleBasedAiMediaPlanningArtifacts;
      try {
        normalized = normalizeCreateInput(input);
      } catch (error) {
        return inputError(error);
      }
      const authority = await repository.loadRulePlanningAuthority(normalized);
      if (!authority) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_CONTEXT_CHANGED',
          'Source capture context changed or does not belong to this tenant',
          409,
        );
      }
      try {
        const resolved = resolveRuleBasedAiMediaPlanningInput(normalized, authority);
        const prepared = options.sourcePreparation === false ? undefined : await prepareAiMediaPlanningSources(
          repository,
          {
            ownerUserId: resolved.ownerUserId,
            sourceSubjectId: resolved.sourceSubjectId,
            sourceCaptureSnapshotId: resolved.sourceCaptureSnapshotId,
            sourceCaptureHash: resolved.sourceCaptureHash,
            sourceProfileHash: resolved.sourceProfileHash,
            sourceSchemaVersion: resolved.sourceSchemaVersion,
            contextType: resolved.context.type,
            contextId: resolved.context.id,
          },
          resolved.candidates,
          options.sourcePreparation,
        );
        artifacts = buildRuleBasedAiMediaPlanningArtifacts(
          prepared === undefined ? resolved : resolveRuleBasedAiMediaPlanningInput(normalized, authority, prepared),
        );
      } catch (error) {
        return inputError(error);
      }
      const result = await repository.createRulePlan(artifacts);
      if (result.kind === 'conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT',
          'Idempotency key was used for a different AI media plan',
          409,
        );
      }
      if (result.kind === 'context-changed' || !result.plan) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_CONTEXT_CHANGED',
          'Source capture context changed or does not belong to this tenant',
          409,
        );
      }
      return { plan: result.plan, replayed: result.kind === 'existing' };
  };

  const sourceCurrent = async (plan: AiMediaPlanRecord): Promise<boolean> => {
    if (plan.staleAt || !plan.currentVersion) return false;
    const latest = await repository.loadLatestSourceAuthority({
      ownerUserId: plan.ownerUserId,
      sourceSubjectId: plan.sourceSubjectId,
      contextType: plan.contextType,
      contextId: plan.contextId,
    });
    return Boolean(latest
      && latest.snapshotId === plan.currentVersion.sourceCaptureSnapshotId
      && latest.captureHash === plan.currentVersion.sourceCaptureHash
      && latest.profileHash === plan.currentVersion.sourceProfileHash
      && latest.schemaVersion === plan.currentVersion.sourceSchemaVersion);
  };

  return {
    createRuleBased,

    async createCurrentRuleBased(input: CreateCurrentRuleBasedAiMediaPlanningInput) {
      let ownerUserId: string;
      let actorUserId: string;
      let contextId: string;
      try {
        ownerUserId = required(input.ownerUserId, 'ownerUserId', 200);
        actorUserId = required(input.actorUserId, 'actorUserId', 200);
        if (!input.context || input.context.type !== 'collect') {
          throw new TypeError('AI media planning context is invalid');
        }
        contextId = required(input.context.id, 'context.id', 200);
      } catch (error) {
        return inputError(error);
      }
      const target = await repository.resolveCurrentRulePlanningTarget({
        ownerUserId,
        context: { type: 'collect', id: contextId },
      });
      if (!target) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_CONTEXT_CHANGED',
          'Source capture context changed or does not belong to this tenant',
          409,
        );
      }
      const created = await createRuleBased({
        ...input,
        ownerUserId,
        actorUserId,
        context: { type: 'collect', id: contextId },
        sourceSubjectId: target.sourceSubjectId,
        sourceCaptureSnapshotId: target.sourceCaptureSnapshotId,
        selectedSkuKeys: input.selectedSkuKeys?.length
          ? input.selectedSkuKeys
          : target.selectedSkuKeys?.length
            ? target.selectedSkuKeys
            : [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      });
      return {
        ...created,
        sourceCurrent: await sourceCurrent(created.plan),
      };
    },

    async get(planId: string, ownerUserId: string) {
      const plan = await repository.getOwned(planId, ownerUserId);
      if (!plan) {
        throw new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404);
      }
      return plan;
    },

    async getWithSourceStatus(planId: string, ownerUserId: string) {
      const plan = await repository.getOwned(planId, ownerUserId);
      if (!plan) {
        throw new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404);
      }
      return { plan, sourceCurrent: await sourceCurrent(plan) };
    },

    async getCurrentByContext(
      ownerUserId: string,
      context: { type: 'collect'; id: string },
    ) {
      let normalizedOwner: string;
      let contextId: string;
      try {
        normalizedOwner = required(ownerUserId, 'ownerUserId', 200);
        if (!context || context.type !== 'collect') throw new TypeError('AI media planning context is invalid');
        contextId = required(context.id, 'context.id', 200);
      } catch (error) {
        return inputError(error);
      }
      const plan = await repository.getLatestOwnedByContext({
        ownerUserId: normalizedOwner,
        contextType: 'collect',
        contextId,
      });
      if (!plan) return { plan: null, sourceCurrent: null };
      return { plan, sourceCurrent: await sourceCurrent(plan) };
    },

    async listVersions(
      planId: string,
      ownerUserId: string,
      page: Partial<AiMediaPlanVersionPageInput> = {},
    ) {
      const limit = page.limit ?? AI_MEDIA_PLAN_VERSION_PAGE_DEFAULT;
      const beforeVersion = page.beforeVersion;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_MEDIA_PLAN_VERSION_PAGE_MAX
        || (beforeVersion !== undefined
          && (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1))) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_INVALID_INPUT', 'AI media plan version page is invalid', 400,
        );
      }
      const plan = await repository.getOwned(planId, ownerUserId);
      if (!plan) {
        throw new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404);
      }
      return repository.listVersionsOwned(planId, ownerUserId, {
        limit,
        ...(beforeVersion === undefined ? {} : { beforeVersion }),
      });
    },

    async updateSlotReferences(input: UpdateAiMediaPlanSlotReferencesInput) {
      let normalized: UpdateAiMediaPlanSlotReferencesInput;
      try {
        normalized = normalizeSlotReferenceMutation(input);
      } catch (error) {
        return inputError(error);
      }
      const result = await repository.updateSlotReferences(normalized);
      if (result.kind === 'not-found' || !result.plan) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404,
        );
      }
      if (result.kind === 'operation-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_OPERATION_CONFLICT',
          'Slot-reference operation key was reused with different input',
          409,
        );
      }
      if (result.kind === 'revision-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_REVISION_CONFLICT', 'AI media plan revision changed', 409,
        );
      }
      if (result.kind === 'state-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_REVIEW_STATE_CONFLICT',
          'AI media plan version changed before slot references were saved',
          409,
        );
      }
      if (result.kind === 'stale') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_STALE', 'AI media plan is stale against the current source context', 409,
        );
      }
      if (result.kind === 'no-changes') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_NO_CHANGES', 'Slot references are unchanged', 409,
        );
      }
      if (result.kind === 'invalid-reference') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_INVALID_INPUT',
          'Slot references are not valid for the frozen plan evidence',
          400,
        );
      }
      if (result.kind === 'active-suite-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_ACTIVE_SUITE_CONFLICT',
          'Slot references cannot change while the current plan version has a non-terminal suite',
          409,
        );
      }
      if (!result.createdVersionId) {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_REVIEW_STATE_CONFLICT',
          'AI media plan version was not created',
          409,
        );
      }
      return {
        plan: result.plan,
        replayed: result.kind === 'replayed',
        createdVersionId: result.createdVersionId,
        sourceCurrent: await sourceCurrent(result.plan),
      };
    },

    async review(input: ReviewAiMediaPlanInput) {
      try {
        required(input.planId, 'planId', 200);
        required(input.ownerUserId, 'ownerUserId', 200);
        required(input.actorUserId, 'actorUserId', 200);
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
          throw new TypeError('expectedRevision is invalid');
        }
        required(input.operationKey, 'operationKey', 128);
        if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
          throw new TypeError('review decision is invalid');
        }
        if (input.note !== null && (typeof input.note !== 'string' || input.note.length > 2_000)) {
          throw new TypeError('review note is invalid');
        }
      } catch (error) {
        return inputError(error);
      }
      const result = await repository.reviewCurrent(input);
      if (result.kind === 'not-found' || !result.plan) {
        throw new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404);
      }
      if (result.kind === 'operation-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_OPERATION_CONFLICT', 'Review operation key was reused with different input', 409,
        );
      }
      if (result.kind === 'revision-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_REVISION_CONFLICT', 'AI media plan revision changed', 409,
        );
      }
      if (result.kind === 'state-conflict') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_REVIEW_STATE_CONFLICT', 'AI media plan cannot be reviewed in its current state', 409,
        );
      }
      if (result.kind === 'not-ready') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_NOT_READY',
          'AI media plan still has manual or evidence-incomplete slots',
          409,
        );
      }
      if (result.kind === 'stale') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_STALE', 'AI media plan is stale against the current source context', 409,
        );
      }
      // A review replay remains idempotent, but source authority is mutable.
      // Project the current source state separately so an old approval cannot
      // be presented as executable after a newer capture arrives.
      return {
        plan: result.plan,
        replayed: result.kind === 'replayed',
        sourceCurrent: await sourceCurrent(result.plan),
      };
    },

    async requireApprovedForExecution(input: {
      planId: string;
      ownerUserId: string;
      actorUserId: string;
    }) {
      try {
        required(input.planId, 'planId', 200);
        required(input.ownerUserId, 'ownerUserId', 200);
        required(input.actorUserId, 'actorUserId', 200);
      } catch (error) {
        return inputError(error);
      }
      const result = await repository.requireApprovedForExecution(input);
      if (result.kind === 'not-found' || !result.plan) {
        throw new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'AI media plan was not found', 404);
      }
      if (result.kind === 'stale') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_STALE', 'AI media plan is stale against the current source context', 409,
        );
      }
      if (result.kind === 'not-ready') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_NOT_READY',
          'AI media plan still has manual or evidence-incomplete slots',
          409,
        );
      }
      if (result.kind !== 'ready') {
        throw new AiMediaPlanningError(
          'AI_MEDIA_PLANNING_NOT_APPROVED', 'AI media plan is not approved for execution', 409,
        );
      }
      return result.plan;
    },
  };
}

export type AiMediaPlanningService = ReturnType<typeof createAiMediaPlanningService>;
