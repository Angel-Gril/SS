import { createHash } from 'node:crypto';
import { aiImageCreativeBriefSchema, type AiImageCreativeBrief } from './ai-image-creative-brief.js';
import type { SourceListingWorkflowStage } from 'shared';
import {
  AI_MEDIA_GALLERY_GOALS,
  AiMediaPlanningError,
  type AiMediaGalleryGoal,
  type AiMediaPlanRecord,
  type AiMediaPlanVersionRecord,
  type CreateRuleBasedAiMediaPlanningInput,
  type ReviewAiMediaPlanInput,
} from './ai-media-planning.js';

export const EXTENSION_HOSTED_AI_IMAGE_PLAN_VERSION =
  'extension-hosted-ai-image-plan/v1' as const;

const EXTENSION_HOSTED_AI_IMAGE_ACTIVE_DRAFT_STAGES = new Set<SourceListingWorkflowStage>([
  'CATEGORY_REVIEW',
  'ATTRIBUTE_REVIEW',
  'CONTENT_REVIEW',
  'MEDIA_REVIEW',
  'PRICING_REVIEW',
  'VALIDATION',
]);

export function isExtensionHostedAiImageActiveDraftStage(
  value: unknown,
): value is SourceListingWorkflowStage {
  return EXTENSION_HOSTED_AI_IMAGE_ACTIVE_DRAFT_STAGES.has(value as SourceListingWorkflowStage);
}

export type ExtensionHostedAiImagePlanErrorCode =
  | 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST'
  | 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'
  | 'HOSTED_AI_IMAGE_PLAN_POLICY_DISABLED'
  | 'HOSTED_AI_IMAGE_PLAN_POLICY_UNAVAILABLE'
  | 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'
  | 'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT'
  | 'HOSTED_AI_IMAGE_PLAN_SKU_AMBIGUOUS'
  | 'HOSTED_AI_IMAGE_PLAN_NOT_FOUND';

export class ExtensionHostedAiImagePlanError extends Error {
  constructor(
    public readonly code: ExtensionHostedAiImagePlanErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionHostedAiImagePlanError';
  }
}

export interface ExtensionHostedAiImagePlanIdentity {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
}

export interface ExtensionHostedAiImagePlanBinding {
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}

export interface ExtensionHostedAiImagePlanAuthority
  extends ExtensionHostedAiImagePlanBinding {
  ownerUserId: string;
  sourceSubjectId: string;
  sourceCaptureCurrent: boolean;
  workflowStatus: string;
  draftStage: SourceListingWorkflowStage;
  selectedSkuKeys: string[];
  capturedSkuKeys: string[];
  candidateMediaKeys: string[];
}

export interface ExtensionHostedAiImagePlanPolicyDecision {
  enabled: boolean;
  revision: number;
  ownerUserId: string;
  shopId: string;
  deviceSessionId: string;
}

export interface ExtensionHostedAiImagePlanBindingRecord
  extends ExtensionHostedAiImagePlanBinding {
  planId: string;
  ownerUserId: string;
  deviceSessionId: string;
  selectedSkuHash: string;
  candidateMediaHash: string;
  authorityHash: string;
  bindingHash: string;
}

export interface ExtensionHostedAiImagePlanBindingStore {
  bind(record: ExtensionHostedAiImagePlanBindingRecord): Promise<
    | { kind: 'bound' | 'replayed'; record: ExtensionHostedAiImagePlanBindingRecord }
    | { kind: 'conflict' }
  >;
  get(input: {
    ownerUserId: string;
    planId: string;
  }): Promise<ExtensionHostedAiImagePlanBindingRecord | null>;
  find(input: Omit<
    ExtensionHostedAiImagePlanBindingRecord,
    'planId' | 'authorityHash' | 'bindingHash'
  >): Promise<
    ExtensionHostedAiImagePlanBindingRecord | null
  >;
  /**
   * Re-attaches an existing binding to an approved same-device successor
   * session. The implementation must verify the session lineage and preserve
   * the existing plan identity; it must never create or retarget a plan.
   */
  adoptSessionSuccessor?(input: Omit<
    ExtensionHostedAiImagePlanBindingRecord,
    'planId' | 'authorityHash' | 'bindingHash'
  >): Promise<ExtensionHostedAiImagePlanBindingRecord | null>;
  /**
   * Re-attaches a suite binding after the tenant owner explicitly launches
   * the exact ERP draft on a newly paired instance of the same device.
   */
  rebindAfterExplicitLaunchGrant?(input: Omit<
    ExtensionHostedAiImagePlanBindingRecord,
    'planId' | 'authorityHash' | 'bindingHash'
  > & {
    authorization: 'ERP_SOURCE_LAUNCH_GRANT';
  }): Promise<ExtensionHostedAiImagePlanBindingRecord | null>;
}

export interface ExtensionHostedAiImagePlanningPort {
  createRuleBased(input: CreateRuleBasedAiMediaPlanningInput): Promise<{
    plan: AiMediaPlanRecord;
    replayed: boolean;
  }>;
  getWithSourceStatus(planId: string, ownerUserId: string): Promise<{
    plan: AiMediaPlanRecord;
    sourceCurrent: boolean;
  }>;
  getCurrentByContext(
    ownerUserId: string,
    context: { type: 'collect'; id: string },
  ): Promise<{ plan: AiMediaPlanRecord | null; sourceCurrent: boolean | null }>;
  review(input: ReviewAiMediaPlanInput): Promise<{
    plan: AiMediaPlanRecord;
    replayed: boolean;
    sourceCurrent: boolean;
  }>;
}

export interface ExtensionHostedAiImagePlanServiceOptions {
  planning: ExtensionHostedAiImagePlanningPort;
  bindings: ExtensionHostedAiImagePlanBindingStore;
  loadAuthority(input: {
    ownerUserId: string;
    listingWorkflowId: string;
  }): Promise<ExtensionHostedAiImagePlanAuthority | null>;
  evaluatePolicy(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
  }): Promise<ExtensionHostedAiImagePlanPolicyDecision>;
}

interface BoundRequest {
  identity: ExtensionHostedAiImagePlanIdentity;
  binding: ExtensionHostedAiImagePlanBinding;
}

interface CreateRequest extends BoundRequest {
  idempotencyKey: string;
  galleryGoals?: AiMediaGalleryGoal[];
  creativeBrief?: AiImageCreativeBrief;
  candidateMediaKeys?: string[];
}

interface GetRequest extends BoundRequest {
  planId: string;
}

interface ReviewRequest extends GetRequest {
  expectedRevision: number;
  operationKey: string;
  decision: 'APPROVE' | 'REJECT';
  note: string | null;
}

function error(
  code: ExtensionHostedAiImagePlanErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ExtensionHostedAiImagePlanError(code, statusCode, message);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value !== value.trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, `${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, `${name} is invalid`);
  }
  return Number(value);
}

function normalizeGalleryGoals(value: unknown): AiMediaGalleryGoal[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_MEDIA_GALLERY_GOALS.length
    || value.some((goal) => !AI_MEDIA_GALLERY_GOALS.includes(goal))
    || new Set(value).size !== value.length) {
    return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, 'galleryGoals is invalid');
  }
  return [...value] as AiMediaGalleryGoal[];
}

function selectedReferenceKeys(value: unknown, eligible: string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25
    || value.some((key) => typeof key !== 'string' || key.length < 1 || key.length > 500
      || key !== key.normalize('NFKC').trim()
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(key)
      || /(?:https?|ftp|file|blob|data|javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\.|[?#]/iu.test(key))
    || new Set(value).size !== value.length || value.some((key) => !eligible.includes(key))) {
    return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, '所选参考素材不在当前快照的可用范围');
  }
  return [...value].sort();
}

function normalizeIdentity(value: ExtensionHostedAiImagePlanIdentity) {
  const identity = {
    ownerUserId: identifier(value?.ownerUserId, 'ownerUserId'),
    actorUserId: identifier(value?.actorUserId, 'actorUserId'),
    deviceSessionId: identifier(value?.deviceSessionId, 'deviceSessionId'),
  };
  if (identity.ownerUserId !== identity.actorUserId) {
    return error(
      'HOSTED_AI_IMAGE_PLAN_FORBIDDEN',
      403,
      'Hosted planning requires an owner device session',
    );
  }
  return identity;
}

function normalizeBinding(value: ExtensionHostedAiImagePlanBinding) {
  return {
    snapshotId: identifier(value?.snapshotId, 'snapshotId'),
    supplyGoodsId: identifier(value?.supplyGoodsId, 'supplyGoodsId'),
    shopId: identifier(value?.shopId, 'shopId'),
    listingWorkflowId: identifier(value?.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: positiveInteger(value?.draftRevision, 'draftRevision'),
    draftVersion: positiveInteger(value?.draftVersion, 'draftVersion'),
  };
}

function sortedUniqueIdentifiers(
  value: unknown,
  name: string,
  options: { allowEmpty: boolean; maximum: number },
): string[] {
  const invalidCode = name === 'selectedSkuKeys'
    ? 'HOSTED_AI_IMAGE_PLAN_SKU_AMBIGUOUS'
    : 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE';
  if (!Array.isArray(value) || value.length > options.maximum
    || (!options.allowEmpty && value.length === 0)) {
    return error(invalidCode, 409, `${name} is invalid`);
  }
  const normalized = value.map((item) => identifier(item, name, 500)).sort();
  if (new Set(normalized).size !== normalized.length) {
    return error(
      invalidCode,
      409,
      `${name} is not unique`,
    );
  }
  return normalized;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBinding(
  left: ExtensionHostedAiImagePlanBinding,
  right: ExtensionHostedAiImagePlanBinding,
) {
  return left.snapshotId === right.snapshotId
    && left.supplyGoodsId === right.supplyGoodsId
    && left.shopId === right.shopId
    && left.listingWorkflowId === right.listingWorkflowId
    && left.draftRevision === right.draftRevision
    && left.draftVersion === right.draftVersion;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
}

function operationHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function valuesHash(values: readonly string[]) {
  return operationHash([...values]);
}

function planAuthorityHash(input: {
  identity: ExtensionHostedAiImagePlanIdentity;
  binding: ExtensionHostedAiImagePlanBinding;
  selectedSkuKeys: string[];
  candidateMediaKeys: string[];
}) {
  return operationHash({
    ownerUserId: input.identity.ownerUserId,
    ...input.binding,
    selectedSkuHash: valuesHash(input.selectedSkuKeys),
    candidateMediaHash: valuesHash(input.candidateMediaKeys),
  });
}

export function createExtensionHostedAiImagePlanBindingRecord(input: {
  planId: string;
  identity: ExtensionHostedAiImagePlanIdentity;
  binding: ExtensionHostedAiImagePlanBinding;
  selectedSkuKeys: string[];
  candidateMediaKeys: string[];
}): ExtensionHostedAiImagePlanBindingRecord {
  const authority = {
    ownerUserId: input.identity.ownerUserId,
    ...input.binding,
    selectedSkuHash: valuesHash(input.selectedSkuKeys),
    candidateMediaHash: valuesHash(input.candidateMediaKeys),
  };
  const value = {
    planId: input.planId,
    deviceSessionId: input.identity.deviceSessionId,
    ...authority,
    authorityHash: planAuthorityHash(input),
  };
  return { ...value, bindingHash: operationHash(value) };
}

function sameBindingRecord(
  left: ExtensionHostedAiImagePlanBindingRecord,
  right: ExtensionHostedAiImagePlanBindingRecord,
) {
  return left.planId === right.planId
    && left.ownerUserId === right.ownerUserId
    && left.deviceSessionId === right.deviceSessionId
    && sameBinding(left, right)
    && left.selectedSkuHash === right.selectedSkuHash
    && left.candidateMediaHash === right.candidateMediaHash
    && left.authorityHash === right.authorityHash
    && left.bindingHash === right.bindingHash;
}

function inputSnapshotIdentity(version: AiMediaPlanVersionRecord) {
  const snapshot = record(version.inputSnapshot);
  const source = record(snapshot?.source);
  const context = record(snapshot?.context);
  const skus = Array.isArray(snapshot?.skus) ? snapshot.skus : null;
  const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : null;
  if (!snapshot || !source || !context || !skus || !candidates) return null;
  const skuKeys = skus.flatMap((value) => {
    const item = record(value);
    return typeof item?.skuKey === 'string' ? [item.skuKey] : [];
  }).sort();
  const candidateMediaKeys = candidates.flatMap((value) => {
    const item = record(value);
    return typeof item?.id === 'string' ? [item.id] : [];
  }).sort();
  if (skuKeys.length !== skus.length || candidateMediaKeys.length !== candidates.length
    || new Set(skuKeys).size !== skuKeys.length
    || new Set(candidateMediaKeys).size !== candidateMediaKeys.length) return null;
  return {
    sourceSubjectId: source.subjectId,
    snapshotId: source.snapshotId,
    contextType: context.type,
    contextId: context.id,
    skuKeys,
    candidateMediaKeys,
    referenceSelection: record(snapshot.referenceSelection),
    hasReferenceSelection: Object.prototype.hasOwnProperty.call(snapshot, 'referenceSelection'),
  };
}

function assertPlanCurrent(
  plan: AiMediaPlanRecord,
  authority: ExtensionHostedAiImagePlanAuthority,
  selectedSkuKeys: string[],
  candidateMediaKeys: string[],
  sourceCurrent: boolean | null,
) {
  const version = plan.currentVersion;
  const frozen = version ? inputSnapshotIdentity(version) : null;
  const sealedSelection = frozen?.referenceSelection
    && Object.keys(frozen.referenceSelection).length === 1
    && frozen.referenceSelection.authorityCandidateMediaHash === valuesHash(candidateMediaKeys)
    && frozen.candidateMediaKeys.length > 0
    && frozen.candidateMediaKeys.every((key) => candidateMediaKeys.includes(key));
  if (plan.ownerUserId !== authority.ownerUserId
    || plan.sourceSubjectId !== authority.sourceSubjectId
    || plan.contextType !== 'collect'
    || plan.contextId !== authority.supplyGoodsId
    || plan.staleAt !== null
    || sourceCurrent !== true
    || !version
    || plan.currentVersionId !== version.id
    || version.planId !== plan.id
    || version.ownerUserId !== authority.ownerUserId
    || version.sourceCaptureSnapshotId !== authority.snapshotId
    || !frozen
    || frozen.sourceSubjectId !== authority.sourceSubjectId
    || frozen.snapshotId !== authority.snapshotId
    || frozen.contextType !== 'collect'
    || frozen.contextId !== authority.supplyGoodsId
    || !sameStrings(frozen.skuKeys, selectedSkuKeys)
    || !(frozen.hasReferenceSelection ? sealedSelection : sameStrings(frozen.candidateMediaKeys, candidateMediaKeys))) {
    return error(
      'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
      409,
      'Hosted plan no longer matches the current listing draft',
    );
  }
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)
    || /(?:https?|blob|data|file|ftp):/iu.test(value)) return null;
  return value;
}

function safeOwnership(value: unknown) {
  const item = record(value);
  const level = item?.level === 'sku' || item?.level === 'compatibility_group'
    ? item.level
    : null;
  const key = safeText(item?.key, 500);
  return level && key ? { level, key } : null;
}

function safeVersion(version: AiMediaPlanVersionRecord | null | undefined) {
  if (!version) return null;
  const payload = record(version.planPayload);
  const creativeBrief = payload?.creativeBrief === undefined
    ? undefined : aiImageCreativeBriefSchema.parse(payload.creativeBrief);
  const slots = Array.isArray(payload?.slots) ? payload.slots.flatMap((value) => {
    const item = record(value);
    const slotKey = safeText(item?.slotKey, 500);
    const goal = safeText(item?.goal, 200);
    const status = safeText(item?.status, 100);
    const aspectRatio = safeText(item?.aspectRatio, 50);
    const owner = safeOwnership(item?.ownership);
    if (!slotKey || !goal || !status || !aspectRatio || !owner) return [];
    const references = Array.isArray(item?.references)
      ? item.references.flatMap((reference) => {
        const candidateId = safeText(record(reference)?.candidateId, 500);
        return candidateId ? [{ candidateId }] : [];
      }).slice(0, 4)
      : [];
    return [{ slotKey, goal, status, aspectRatio, ownership: owner, references }];
  }).slice(0, 500) : [];
  return {
    id: version.id,
    version: version.version,
    sourceCaptureSnapshotId: version.sourceCaptureSnapshotId,
    sourceSchemaVersion: version.sourceSchemaVersion,
    planSchemaVersion: version.planSchemaVersion,
    plannerVersion: version.plannerVersion,
    mode: version.mode,
    slots,
    ...(creativeBrief === undefined ? {} : { creativeBrief }),
    createdAt: version.createdAt.toISOString(),
  };
}

function projectPlan(plan: AiMediaPlanRecord, sourceCurrent: boolean) {
  return {
    id: plan.id,
    revision: plan.revision,
    latestVersion: plan.latestVersion,
    currentVersionId: plan.currentVersionId,
    approvedVersionId: plan.approvedVersionId,
    reviewStatus: plan.reviewStatus,
    sourceCurrent,
    stale: plan.staleAt !== null,
    currentVersion: safeVersion(plan.currentVersion),
    approvedVersion: safeVersion(plan.approvedVersion),
    reviewedAt: plan.reviewedAt?.toISOString() ?? null,
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function response(
  policyRevision: number,
  binding: ExtensionHostedAiImagePlanBinding,
  plan: AiMediaPlanRecord | null,
  sourceCurrent: boolean | null,
  replayed: boolean,
) {
  return {
    replayed,
    data: {
      contractVersion: EXTENSION_HOSTED_AI_IMAGE_PLAN_VERSION,
      policyRevision,
      context: { ...binding },
      plan: plan ? projectPlan(plan, sourceCurrent === true) : null,
    },
  };
}

export function createExtensionHostedAiImagePlanService(
  options: ExtensionHostedAiImagePlanServiceOptions,
) {
  async function authorize(request: BoundRequest) {
    const identity = normalizeIdentity(request.identity);
    const binding = normalizeBinding(request.binding);
    const policy = await options.evaluatePolicy({
      ownerUserId: identity.ownerUserId,
      shopId: binding.shopId,
      deviceSessionId: identity.deviceSessionId,
    });
    if (!policy || !Number.isSafeInteger(policy.revision) || policy.revision < 1
      || policy.ownerUserId !== identity.ownerUserId
      || policy.shopId !== binding.shopId
      || policy.deviceSessionId !== identity.deviceSessionId) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_POLICY_UNAVAILABLE',
        503,
        'Hosted planning policy authority is unavailable',
      );
    }
    if (policy.enabled !== true) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_POLICY_DISABLED',
        503,
        'Hosted planning policy is disabled',
      );
    }
    const authority = await options.loadAuthority({
      ownerUserId: identity.ownerUserId,
      listingWorkflowId: binding.listingWorkflowId,
    });
    if (!authority) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_NOT_FOUND',
        404,
        'Hosted planning authority was not found',
      );
    }
    if (authority.ownerUserId !== identity.ownerUserId
      || authority.shopId !== binding.shopId) {
      return error('HOSTED_AI_IMAGE_PLAN_FORBIDDEN', 403, 'Hosted planning authority is forbidden');
    }
    if (!sameBinding(authority, binding)
      || authority.sourceCaptureCurrent !== true
      || authority.workflowStatus !== 'ACTIVE'
      || !isExtensionHostedAiImageActiveDraftStage(authority.draftStage)) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
        409,
        'Hosted planning context is stale',
      );
    }
    const selectedSkuKeys = sortedUniqueIdentifiers(
      authority.selectedSkuKeys,
      'selectedSkuKeys',
      { allowEmpty: false, maximum: 50 },
    );
    const capturedSkuKeys = sortedUniqueIdentifiers(
      authority.capturedSkuKeys,
      'capturedSkuKeys',
      { allowEmpty: true, maximum: 500 },
    );
    if (selectedSkuKeys.some((skuKey) => !capturedSkuKeys.includes(skuKey))) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_SKU_AMBIGUOUS',
        409,
        'Hosted planning SKU authority is ambiguous',
      );
    }
    const candidateMediaKeys = sortedUniqueIdentifiers(
      authority.candidateMediaKeys,
      'candidateMediaKeys',
      { allowEmpty: true, maximum: 25 },
    );
    identifier(authority.sourceSubjectId, 'sourceSubjectId');
    return {
      identity,
      binding,
      authority,
      selectedSkuKeys,
      candidateMediaKeys,
      policyRevision: policy.revision,
    };
  }

  function expectedBindingRecord(
    authorized: Awaited<ReturnType<typeof authorize>>,
    planId: string,
  ) {
    return createExtensionHostedAiImagePlanBindingRecord({
      planId,
      identity: authorized.identity,
      binding: authorized.binding,
      selectedSkuKeys: authorized.selectedSkuKeys,
      candidateMediaKeys: authorized.candidateMediaKeys,
    });
  }

  async function requireBoundPlan(
    authorized: Awaited<ReturnType<typeof authorize>>,
    planId: string,
  ) {
    const expected = expectedBindingRecord(authorized, planId);
    const stored = await options.bindings.get({
      ownerUserId: authorized.identity.ownerUserId,
      planId,
    });
    if (!stored || !sameBindingRecord(stored, expected)) {
      return error(
        'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
        409,
        'Hosted plan is not bound to this device and listing draft',
      );
    }
    return stored;
  }

  return {
    async create(request: CreateRequest) {
      const galleryGoals = normalizeGalleryGoals(request.galleryGoals);
      const parsedBrief = aiImageCreativeBriefSchema.optional().safeParse(request.creativeBrief);
      if (!parsedBrief.success) return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, 'creativeBrief is invalid');
      const creativeBrief = parsedBrief.data;
      const authorized = await authorize(request);
      const candidateMediaKeys = request.candidateMediaKeys === undefined ? authorized.candidateMediaKeys
        : selectedReferenceKeys(request.candidateMediaKeys, authorized.candidateMediaKeys);
      const clientKey = identifier(request.idempotencyKey, 'idempotencyKey', 128);
      if (clientKey.length < 8) {
        return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, 'idempotencyKey is invalid');
      }
      const created = await options.planning.createRuleBased({
        ownerUserId: authorized.identity.ownerUserId,
        actorUserId: authorized.identity.actorUserId,
        sourceSubjectId: authorized.authority.sourceSubjectId,
        sourceCaptureSnapshotId: authorized.binding.snapshotId,
        context: { type: 'collect', id: authorized.binding.supplyGoodsId },
        idempotencyKey: operationHash({
          action: 'CREATE_INITIAL_HOSTED_PLAN',
          contractVersion: EXTENSION_HOSTED_AI_IMAGE_PLAN_VERSION,
          authorityHash: planAuthorityHash({
            identity: authorized.identity,
            binding: authorized.binding,
            selectedSkuKeys: authorized.selectedSkuKeys,
            candidateMediaKeys: authorized.candidateMediaKeys,
          }),
        }),
        selectedSkuKeys: authorized.selectedSkuKeys,
        candidateMediaKeys,
        ...(request.candidateMediaKeys === undefined ? {} : {
          referenceSelectionScopeHash: valuesHash(authorized.candidateMediaKeys),
        }),
        ...(galleryGoals === undefined ? {} : { galleryGoals }),
        ...(creativeBrief === undefined ? {} : { creativeBrief }),
      }).catch((cause: unknown) => {
        // Keep the authority-derived initial-plan key stable: changed goals must
        // conflict with its frozen request fingerprint, never create a new plan.
        if (cause instanceof AiMediaPlanningError
          && cause.code === 'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT') {
          return error(
            'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT', 409,
            'This listing draft already has a plan with a different frozen request',
          );
        }
        throw cause;
      });
      const expectedBinding = expectedBindingRecord(authorized, created.plan.id);
      const bound = await options.bindings.bind(expectedBinding);
      if (bound.kind === 'conflict' || !sameBindingRecord(bound.record, expectedBinding)) {
        return error(
          'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
          409,
          'Hosted plan binding conflicts with another listing draft',
        );
      }
      assertPlanCurrent(
        created.plan,
        authorized.authority,
        authorized.selectedSkuKeys,
        authorized.candidateMediaKeys,
        true,
      );
      return response(
        authorized.policyRevision,
        authorized.binding,
        created.plan,
        true,
        created.replayed,
      );
    },

    async get(request: GetRequest) {
      const authorized = await authorize(request);
      const planId = identifier(request.planId, 'planId');
      await requireBoundPlan(authorized, planId);
      const loaded = await options.planning.getWithSourceStatus(
        planId,
        authorized.identity.ownerUserId,
      );
      if (loaded.plan.id !== planId) {
        return error('HOSTED_AI_IMAGE_PLAN_NOT_FOUND', 404, 'Hosted plan was not found');
      }
      assertPlanCurrent(
        loaded.plan,
        authorized.authority,
        authorized.selectedSkuKeys,
        authorized.candidateMediaKeys,
        loaded.sourceCurrent,
      );
      return response(
        authorized.policyRevision,
        authorized.binding,
        loaded.plan,
        loaded.sourceCurrent,
        false,
      );
    },

    async getCurrent(request: BoundRequest) {
      const authorized = await authorize(request);
      const lookup = {
        ownerUserId: authorized.identity.ownerUserId,
        deviceSessionId: authorized.identity.deviceSessionId,
        ...authorized.binding,
        selectedSkuHash: valuesHash(authorized.selectedSkuKeys),
        candidateMediaHash: valuesHash(authorized.candidateMediaKeys),
      };
      let match = await options.bindings.find(lookup);
      if (!match && options.bindings.adoptSessionSuccessor) {
        match = await options.bindings.adoptSessionSuccessor(lookup);
      }
      if (!match) {
        return response(
          authorized.policyRevision,
          authorized.binding,
          null,
          null,
          false,
        );
      }
      await requireBoundPlan(authorized, match.planId);
      const loaded = await options.planning.getWithSourceStatus(
        match.planId,
        authorized.identity.ownerUserId,
      );
      if (loaded.plan) {
        assertPlanCurrent(
          loaded.plan,
          authorized.authority,
          authorized.selectedSkuKeys,
          authorized.candidateMediaKeys,
          loaded.sourceCurrent,
        );
      }
      return response(
        authorized.policyRevision,
        authorized.binding,
        loaded.plan,
        loaded.sourceCurrent,
        false,
      );
    },

    async review(request: ReviewRequest) {
      const authorized = await authorize(request);
      const planId = identifier(request.planId, 'planId');
      await requireBoundPlan(authorized, planId);
      const expectedRevision = positiveInteger(request.expectedRevision, 'expectedRevision');
      const clientKey = identifier(request.operationKey, 'operationKey', 128);
      if (clientKey.length < 8
        || !['APPROVE', 'REJECT'].includes(request.decision)
        || (request.note !== null
          && (typeof request.note !== 'string' || request.note.length > 2_000))) {
        return error('HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST', 400, 'Plan review is invalid');
      }
      const before = await options.planning.getWithSourceStatus(
        planId,
        authorized.identity.ownerUserId,
      );
      assertPlanCurrent(
        before.plan,
        authorized.authority,
        authorized.selectedSkuKeys,
        authorized.candidateMediaKeys,
        before.sourceCurrent,
      );
      if (before.plan.revision !== expectedRevision) {
        return error('HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE', 409, 'Plan revision is stale');
      }
      const reviewed = await options.planning.review({
        planId,
        ownerUserId: authorized.identity.ownerUserId,
        actorUserId: authorized.identity.actorUserId,
        expectedRevision,
        operationKey: operationHash({
          action: 'REVIEW',
          clientKey,
          identity: authorized.identity,
          binding: authorized.binding,
          planId,
          expectedRevision,
          decision: request.decision,
          note: request.note,
        }),
        decision: request.decision,
        note: request.note,
      });
      assertPlanCurrent(
        reviewed.plan,
        authorized.authority,
        authorized.selectedSkuKeys,
        authorized.candidateMediaKeys,
        reviewed.sourceCurrent,
      );
      return response(
        authorized.policyRevision,
        authorized.binding,
        reviewed.plan,
        reviewed.sourceCurrent,
        reviewed.replayed,
      );
    },
  };
}

export type ExtensionHostedAiImagePlanService = ReturnType<
  typeof createExtensionHostedAiImagePlanService
>;
