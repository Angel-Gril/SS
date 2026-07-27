import {
  EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS,
  hashExtensionAiImageSuiteContext,
} from './extension-ai-image-suite.js';

export const EXTENSION_AI_IMAGE_SUITE_PROJECTION_VERSION =
  'extension-ai-image-suite-projection/v1' as const;

export interface ExtensionAiImageSuiteBinding {
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}

export interface ExtensionAiImageSuiteProjectionState {
  authority: ExtensionAiImageSuiteBinding;
  plan: unknown;
  suite: unknown;
  targetUpdatedAt?: unknown;
  executionReady?: unknown;
}

export class ExtensionAiImageSuiteProjectionError extends Error {
  constructor(
    public readonly code: 'INVALID_REQUEST' | 'STALE_CONTEXT',
    public readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionAiImageSuiteProjectionError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, `${field} is invalid`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, `${field} is invalid`);
  }
  return Number(value);
}

function boundedCost(value: unknown, field: string, positive = false): number {
  if (!Number.isSafeInteger(value)
    || Number(value) < (positive ? 1 : 0)
    || Number(value) > EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, `${field} is invalid`);
  }
  return Number(value);
}

function sha256(value: unknown, field: string): string {
  const normalized = identifier(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, `${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

function normalizeBinding(value: ExtensionAiImageSuiteBinding): ExtensionAiImageSuiteBinding {
  return {
    snapshotId: identifier(value.snapshotId, 'snapshotId'),
    supplyGoodsId: identifier(value.supplyGoodsId, 'supplyGoodsId'),
    shopId: identifier(value.shopId, 'shopId'),
    listingWorkflowId: identifier(value.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    draftVersion: positiveInteger(value.draftVersion, 'draftVersion'),
  };
}

function sameBinding(left: ExtensionAiImageSuiteBinding, right: ExtensionAiImageSuiteBinding): boolean {
  return left.snapshotId === right.snapshotId
    && left.supplyGoodsId === right.supplyGoodsId
    && left.shopId === right.shopId
    && left.listingWorkflowId === right.listingWorkflowId
    && left.draftRevision === right.draftRevision
    && left.draftVersion === right.draftVersion;
}

interface ApprovedPlanSlotMembership {
  slots: Map<string, { level: 'sku' | 'compatibility_group'; key: string }>;
  groups: Map<string, string[]>;
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function approvedPlanSlotMembership(version: Record<string, unknown>): ApprovedPlanSlotMembership | null {
  const payload = record(version.planPayload);
  if (!payload) return null;
  if (!Array.isArray(payload.slots)
    || payload.slots.length > 500
    || !Array.isArray(payload.compatibilityGroups)
    || payload.compatibilityGroups.length > 500) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'Approved plan membership authority is invalid',
    );
  }
  const slots = new Map<string, { level: 'sku' | 'compatibility_group'; key: string }>();
  const selectedSkuKeys = new Set<string>();
  for (const slotValue of payload.slots) {
    const slot = record(slotValue);
    const ownership = record(slot?.ownership);
    const level = ownership?.level === 'sku' || ownership?.level === 'compatibility_group'
      ? ownership.level
      : null;
    if (!slot || !ownership || !level) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Approved plan slot membership is invalid',
      );
    }
    const slotKey = identifier(slot.slotKey, 'approved slotKey', 500);
    const key = identifier(ownership.key, 'approved ownership.key', 500);
    if (slots.has(slotKey)) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Approved plan slot membership is ambiguous',
      );
    }
    slots.set(slotKey, { level, key });
    if (level === 'sku') selectedSkuKeys.add(key);
  }
  const groups = new Map<string, string[]>();
  const memberGroups = new Map<string, string>();
  for (const groupValue of payload.compatibilityGroups) {
    const group = record(groupValue);
    if (!group || !Array.isArray(group.skuKeys)
      || group.skuKeys.length < 1
      || group.skuKeys.length > 500) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Approved compatibility group is invalid',
      );
    }
    const groupKey = identifier(group.groupKey, 'compatibility group key', 500);
    const members = group.skuKeys.map((value) => (
      identifier(value, 'compatibility group member', 500)
    ));
    if (groups.has(groupKey)
      || new Set(members).size !== members.length
      || members.some((skuKey) => !selectedSkuKeys.has(skuKey))) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Approved compatibility group crosses selected SKU authority',
      );
    }
    for (const skuKey of members) {
      const existing = memberGroups.get(skuKey);
      if (existing && existing !== groupKey) {
        throw new ExtensionAiImageSuiteProjectionError(
          'STALE_CONTEXT', 409, 'Approved compatibility group membership is ambiguous',
        );
      }
      memberGroups.set(skuKey, groupKey);
    }
    groups.set(groupKey, [...members].sort(compareIdentifiers));
  }
  for (const ownership of slots.values()) {
    if (ownership.level === 'compatibility_group' && !groups.has(ownership.key)) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Approved plan references an unknown compatibility group',
      );
    }
  }
  return { slots, groups };
}

function applicableSkuKeysForPlanSlot(input: {
  membership: ApprovedPlanSlotMembership | null;
  slotKey: string;
  ownership: { level: 'sku' | 'compatibility_group'; key: string };
}): string[] {
  const approvedOwnership = input.membership?.slots.get(input.slotKey);
  if (input.membership && (!approvedOwnership
    || approvedOwnership.level !== input.ownership.level
    || approvedOwnership.key !== input.ownership.key)) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT', 409, 'Projected slot no longer matches approved plan ownership',
    );
  }
  if (input.ownership.level === 'sku') return [input.ownership.key];
  const members = input.membership?.groups.get(input.ownership.key);
  if (!members || members.length < 1) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT', 409, 'Compatibility group membership is unavailable',
    );
  }
  return [...members];
}

function safePlanSlot(value: unknown, membership: ApprovedPlanSlotMembership | null) {
  const slot = record(value);
  const ownership = record(slot?.ownership);
  if (!slot || !ownership) return null;
  const level = ownership.level === 'sku' || ownership.level === 'compatibility_group'
    ? ownership.level
    : null;
  if (!level) return null;
  let projected: {
    ordinal: number;
    slotKey: string;
    goal: string;
    ownership: { level: 'sku' | 'compatibility_group'; key: string };
    estimatedCostCents: number;
    maximumCostCents: number;
  };
  try {
    projected = {
      ordinal: Number.isSafeInteger(slot.ordinal) && Number(slot.ordinal) >= 0
        ? Number(slot.ordinal)
        : 0,
      slotKey: identifier(slot.slotKey, 'slotKey', 500),
      goal: identifier(slot.goal, 'goal', 200),
      ownership: {
        level,
        key: identifier(ownership.key, 'ownership.key', 500),
      },
      estimatedCostCents: boundedCost(slot.estimatedCostCents, 'slot estimated cost'),
      maximumCostCents: boundedCost(slot.maximumCostCents, 'slot maximum cost'),
    };
  } catch (error) {
    if (error instanceof ExtensionAiImageSuiteProjectionError) return null;
    throw error;
  }
  return {
    ...projected,
    applicableSkuKeys: applicableSkuKeysForPlanSlot({
      membership,
      slotKey: projected.slotKey,
      ownership: projected.ownership,
    }),
  };
}

function approvedPlanProjection(planValue: unknown, binding: ExtensionAiImageSuiteBinding) {
  const plan = record(planValue);
  const version = record(plan?.approvedVersion);
  const preview = record(plan?.preview);
  if (!plan || !version || !preview
    || plan.reviewStatus !== 'APPROVED'
    || plan.staleAt != null
    || plan.currentVersionId !== plan.approvedVersionId
    || plan.currentVersionId !== version.id) return null;
  if (plan.contextType !== 'collect'
    || plan.contextId !== binding.supplyGoodsId
    || version.sourceCaptureSnapshotId !== binding.snapshotId) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'Approved plan authority no longer matches the requested source capture',
    );
  }

  const id = identifier(plan.id, 'planId');
  const versionId = identifier(version.id, 'planVersionId');
  const revision = positiveInteger(plan.revision, 'planRevision');
  if (preview.planId !== id
    || preview.planVersionId !== versionId
    || preview.planRevision !== revision) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'Approved plan preview authority changed',
    );
  }
  const hash = sha256(preview.previewHash, 'previewHash');
  const pricingVersion = identifier(preview.pricingVersion, 'pricingVersion', 100);
  const itemCount = positiveInteger(preview.itemCount, 'itemCount');
  const estimatedCostCents = boundedCost(preview.estimatedCostCents, 'estimatedCostCents');
  const maximumCostCents = boundedCost(preview.maximumCostCents, 'maximumCostCents');
  if (maximumCostCents < estimatedCostCents) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'Approved plan pricing changed',
    );
  }
  const membership = approvedPlanSlotMembership(version);
  const slots = Array.isArray(preview.slots)
    ? preview.slots.slice(0, 500).flatMap((slot) => {
      const projected = safePlanSlot(slot, membership);
      return projected ? [projected] : [];
    })
    : [];
  const skuKey = plan.skuKey == null ? null : identifier(plan.skuKey, 'skuKey', 500);
  return {
    id,
    versionId,
    revision,
    skuKey,
    preview: {
      hash,
      pricingVersion,
      itemCount,
      estimatedCostCents,
      maximumCostCents,
      slots,
    },
  };
}

function supportsProductWideCompatibilityGroups(
  approved: NonNullable<ReturnType<typeof approvedPlanProjection>>,
): boolean {
  const selectedSkuKeys = [...new Set(approved.preview.slots.flatMap((slot) => (
    slot.ownership.level === 'sku' ? [slot.ownership.key] : []
  )))].sort(compareIdentifiers);
  if (selectedSkuKeys.length < 1) return false;
  return approved.preview.slots.every((slot) => (
    slot.ownership.level !== 'compatibility_group'
      || slot.applicableSkuKeys.length === selectedSkuKeys.length
        && slot.applicableSkuKeys.every((skuKey, index) => skuKey === selectedSkuKeys[index])
  ));
}

const suiteStatuses = new Set([
  'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
  'CANCEL_REQUESTED', 'CANCELLED',
]);
const slotStatuses = new Set([
  'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
]);
const reviewStatuses = new Set(['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED']);
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function trustedOrigin(value: unknown, allowInsecureLocal: boolean): string | null {
  if (typeof value !== 'string' || !value || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.hostname.endsWith('.')) return null;
    if (url.protocol === 'https:') return url.origin;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return allowInsecureLocal
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function trustedPreviewUrl(value: unknown, origins: Set<string>, allowInsecureLocal: boolean): string | null {
  if (typeof value !== 'string' || !value || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.hostname.endsWith('.')
      || !origins.has(url.origin)) return null;
    if (url.protocol === 'https:') return url.href;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return allowInsecureLocal
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function safeOutputAsset(input: {
  value: unknown;
  ownerUserId: string;
  jobId: string;
  snapshotId: string;
  origins: Set<string>;
  allowInsecureLocal: boolean;
}) {
  const asset = record(input.value);
  const storageBackend = asset?.storageBackend === 'local' || asset?.storageBackend === 'oss'
    ? asset.storageBackend
    : null;
  if (!asset
    || asset.ownerUserId !== input.ownerUserId
    || asset.aiImageJobId !== input.jobId
    || asset.sourceCaptureSnapshotId !== input.snapshotId
    || asset.kind !== 'AI_GENERATED'
    || !storageBackend) return null;
  const url = trustedPreviewUrl(asset.url, input.origins, input.allowInsecureLocal);
  const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType.toLowerCase() : '';
  if (!url || !imageMimeTypes.has(mimeType)) return null;
  let id: string;
  try {
    id = identifier(asset.id, 'outputAssetId');
  } catch (error) {
    if (error instanceof ExtensionAiImageSuiteProjectionError) return null;
    throw error;
  }
  const width = Number(asset.width);
  const height = Number(asset.height);
  return {
    id,
    url,
    storageBackend,
    mimeType,
    width: Number.isSafeInteger(width) && width > 0 ? width : null,
    height: Number.isSafeInteger(height) && height > 0 ? height : null,
  };
}

function safeSlotApplication(value: unknown, supplyGoodsId: string) {
  const application = record(value);
  if (!application
    || application.targetType !== 'collect'
    || application.targetId !== supplyGoodsId
    || !['APPEND', 'append'].includes(String(application.mode || ''))) return null;
  return {
    state: application.rolledBackAt || application.rolledBackBy ? 'ROLLED_BACK' as const : 'APPLIED' as const,
    target: 'ERP_SOURCE_PRODUCT' as const,
    mode: 'append' as const,
    writesStoreDraft: false as const,
  };
}

function retryAuthoritySafe(
  jobsValue: unknown,
  provider: unknown,
  model: unknown,
  expectedAttempt: number,
): boolean {
  if (!Array.isArray(jobsValue)
    || jobsValue.length !== expectedAttempt
    || jobsValue.length < 1
    || jobsValue.length > 100) return false;
  const current = record(jobsValue[0]);
  const frozenFingerprint = typeof current?.requestFingerprint === 'string'
    && /^[a-f0-9]{64}$/u.test(current.requestFingerprint)
    ? current.requestFingerprint
    : null;
  if (!frozenFingerprint) return false;
  return jobsValue.every((value, index) => {
    const job = record(value);
    const reservation = record(job?.costReservation);
    const counts = record(job?._count);
    const expectedWorkflowAttempt = expectedAttempt - index;
    if (!job
      || job.status !== 'FAILED'
      || job.workflowAttempt !== expectedWorkflowAttempt
      || job.provider !== provider
      || job.model !== model
      || job.requestFingerprint !== frozenFingerprint
      || reservation?.status !== 'RELEASED'
      || reservation.provider !== provider
      || reservation.model !== model
      || reservation.requestFingerprint !== frozenFingerprint
      || job.actualCostCents !== null
      || job.billedUnits !== 0
      || counts?.assets !== 0
      || job.providerReconciliationLeaseOwner != null
      || job.providerReconciliationLeaseTokenHash != null
      || job.providerReconciliationLeaseExpiresAt != null) return false;
    if (provider === 'fake') return true;
    const reconciliationStatus = String(job.providerReconciliationStatus || '');
    if (reconciliationStatus === 'NOT_REQUIRED') {
      return job.providerDispatchedAt == null && job.providerJobId == null;
    }
    const reconciledAt = job.providerReconciledAt;
    return ['NOT_SUBMITTED', 'NO_OUTPUT'].includes(reconciliationStatus)
      && reconciledAt instanceof Date
      && !Number.isNaN(reconciledAt.getTime());
  });
}

function suiteProjection(input: {
  value: unknown;
  approved: NonNullable<ReturnType<typeof approvedPlanProjection>>;
  binding: ExtensionAiImageSuiteBinding;
  ownerUserId: string;
  scopes: readonly string[];
  origins: Set<string>;
  allowInsecureLocal: boolean;
  targetUpdatedAt: string | null;
  executionReady: boolean;
  productScopeSupported: boolean;
}) {
  const suite = record(input.value);
  if (!suite) return null;
  if (suite.planId !== input.approved.id
    || suite.planVersionId !== input.approved.versionId
    || suite.previewHash !== input.approved.preview.hash
    || suite.pricingVersion !== input.approved.preview.pricingVersion) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'Current AI image suite no longer matches the approved plan',
    );
  }
  const id = identifier(suite.id, 'suiteId');
  const status = typeof suite.status === 'string' && suiteStatuses.has(suite.status)
    ? suite.status
    : null;
  if (!status) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, 'Suite status is invalid');
  }
  const revision = positiveInteger(suite.revision, 'suiteRevision');
  const provider = identifier(suite.provider, 'suite provider', 100);
  const model = identifier(suite.model, 'suite model', 200);
  const itemCount = positiveInteger(suite.itemCount, 'suite itemCount');
  const estimatedCostCents = boundedCost(suite.estimatedCostCents, 'suite estimated cost');
  const maximumCostCents = boundedCost(suite.maximumCostCents, 'suite maximum cost');
  if (maximumCostCents < estimatedCostCents) {
    throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, 'Suite pricing is invalid');
  }
  const canExecute = input.scopes.includes('media:execute');
  const canGenerate = canExecute && input.executionReady;
  const suiteCommands: Record<string, unknown> = {};
  if (canGenerate && status === 'PLANNED') {
    suiteCommands.CONTINUE = { suiteId: id, expectedSuiteRevision: revision };
  }
  if (canExecute && revision >= 4 && ['PLANNED', 'QUEUED', 'RUNNING'].includes(status)) {
    suiteCommands.CANCEL = { suiteId: id, expectedSuiteRevision: revision };
  }
  const approvedSlots = new Map(input.approved.preview.slots.map((slot) => [slot.slotKey, slot]));
  if (approvedSlots.size !== input.approved.preview.slots.length) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT', 409, 'Approved plan slot authority is ambiguous',
    );
  }
  const slots = Array.isArray(suite.slots) ? suite.slots.slice(0, 500).map((slotValue) => {
    const slot = record(slotValue);
    if (!slot) {
      throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, 'Suite slot is invalid');
    }
    const slotId = identifier(slot.id, 'slotId');
    const slotStatus = typeof slot.status === 'string' && slotStatuses.has(slot.status)
      ? slot.status
      : null;
    const ownershipLevel = slot.ownershipLevel === 'sku' || slot.ownershipLevel === 'compatibility_group'
      ? slot.ownershipLevel
      : null;
    if (!slotStatus || !ownershipLevel) {
      throw new ExtensionAiImageSuiteProjectionError('STALE_CONTEXT', 409, 'Suite slot state is invalid');
    }
    const slotOrdinal = Number.isSafeInteger(slot.ordinal) && Number(slot.ordinal) >= 0
      ? Number(slot.ordinal)
      : 0;
    const slotKey = identifier(slot.slotKey, 'slotKey', 500);
    const goal = identifier(slot.goal, 'goal', 200);
    const ownershipKey = identifier(slot.ownershipKey, 'ownershipKey', 500);
    const approvedSlot = approvedSlots.get(slotKey);
    if (!approvedSlot
      || approvedSlot.ordinal !== slotOrdinal
      || approvedSlot.goal !== goal
      || approvedSlot.ownership.level !== ownershipLevel
      || approvedSlot.ownership.key !== ownershipKey) {
      throw new ExtensionAiImageSuiteProjectionError(
        'STALE_CONTEXT', 409, 'Suite slot no longer matches approved plan authority',
      );
    }
    const slotRevision = positiveInteger(slot.revision, 'slotRevision');
    const slotAttempt = nonNegativeInteger(slot.attempt, 'slot attempt');
    const maximumSlotCost = boundedCost(slot.maximumCostCents, 'slot maximum cost');
    const workflow = record(slot.childWorkflow);
    const workflowId = workflow && slot.childWorkflowId === workflow.id
      ? identifier(workflow.id, 'workflowId')
      : null;
    const workflowRevision = workflowId ? positiveInteger(workflow?.revision, 'workflowRevision') : null;
    const reviewStatus = workflowId && typeof workflow?.reviewStatus === 'string'
      && reviewStatuses.has(workflow.reviewStatus)
      ? workflow.reviewStatus
      : 'NOT_READY';
    const currentJob = workflow && Array.isArray(workflow.jobs) ? record(workflow.jobs[0]) : null;
    const jobId = currentJob ? identifier(currentJob.id, 'jobId') : null;
    const output = jobId && Array.isArray(currentJob?.assets)
      ? currentJob.assets.flatMap((asset) => {
        const projected = safeOutputAsset({
          value: asset,
          ownerUserId: input.ownerUserId,
          jobId,
          snapshotId: input.binding.snapshotId,
          origins: input.origins,
          allowInsecureLocal: input.allowInsecureLocal,
        });
        return projected ? [projected] : [];
      })[0] || null
      : null;
    const application = safeSlotApplication(workflow?.application, input.binding.supplyGoodsId);
    const commands: Record<string, unknown> = {};
    if (canGenerate
      && ['FAILED', 'PARTIAL_FAILURE'].includes(status)
      && slotStatus === 'FAILED'
      && retryAuthoritySafe(workflow?.jobs, provider, model, slotAttempt)) {
      commands.RETRY_SLOT = {
        suiteId: id,
        slotId,
        expectedSuiteRevision: revision,
        expectedSlotRevision: slotRevision,
        acceptedAdditionalMaximumCostCents: maximumSlotCost,
      };
    }
    if (input.scopes.includes('listing:review')
      && slotStatus === 'SUCCEEDED'
      && workflow?.status === 'SUCCEEDED'
      && reviewStatus === 'PENDING'
      && workflowId
      && workflowRevision
      && output) {
      commands.REVIEW_SLOT = {
        suiteId: id,
        slotId,
        workflowId,
        outputAssetId: output.id,
        expectedSuiteRevision: revision,
        expectedSlotRevision: slotRevision,
        expectedWorkflowRevision: workflowRevision,
        decisions: ['APPROVE', 'REJECT'],
      };
    }
    if (input.scopes.includes('listing:write')
      && input.productScopeSupported
      && slotStatus === 'SUCCEEDED'
      && workflow?.status === 'SUCCEEDED'
      && reviewStatus === 'APPROVED'
      && workflow?.selectedOutputAssetId === output?.id
      && workflowId
      && workflowRevision
      && output
      && input.targetUpdatedAt
      && !application) {
      commands.APPLY_SLOT = {
        suiteId: id,
        slotId,
        workflowId,
        outputAssetId: output.id,
        expectedSuiteRevision: revision,
        expectedSlotRevision: slotRevision,
        expectedWorkflowRevision: workflowRevision,
        mode: 'append',
        target: 'ERP_SOURCE_PRODUCT',
        writesStoreDraft: false,
        expectedTargetUpdatedAt: input.targetUpdatedAt,
      };
    }
    return {
      id: slotId,
      ordinal: slotOrdinal,
      slotKey,
      goal,
      ownership: {
        level: ownershipLevel,
        key: ownershipKey,
      },
      applicableSkuKeys: [...approvedSlot.applicableSkuKeys],
      status: slotStatus,
      attempt: slotAttempt,
      revision: slotRevision,
      estimatedCostCents: boundedCost(slot.estimatedCostCents, 'slot estimated cost'),
      maximumCostCents: maximumSlotCost,
      workflowId,
      workflowRevision,
      reviewStatus,
      output,
      application,
      allowedActions: Object.keys(commands),
      commands,
    };
  }) : [];
  return {
    id,
    status,
    revision,
    previewHash: input.approved.preview.hash,
    pricingVersion: input.approved.preview.pricingVersion,
    itemCount,
    estimatedCostCents,
    maximumCostCents,
    allowedActions: Object.keys(suiteCommands),
    commands: suiteCommands,
    slots,
  };
}

export function projectExtensionAiImageSuite(input: {
  requested: ExtensionAiImageSuiteBinding;
  state: ExtensionAiImageSuiteProjectionState;
  ownerUserId: string;
  scopes: readonly string[];
  trustedPreviewOrigins: readonly string[];
  allowInsecureLocalPreview?: boolean;
}) {
  const requested = normalizeBinding(input.requested);
  const authoritative = normalizeBinding(input.state.authority);
  if (!sameBinding(requested, authoritative)) {
    throw new ExtensionAiImageSuiteProjectionError(
      'STALE_CONTEXT',
      409,
      'AI image suite authority changed; refresh the listing draft',
    );
  }
  const approved = approvedPlanProjection(input.state.plan, requested);
  if (!approved) {
    return {
      contractVersion: EXTENSION_AI_IMAGE_SUITE_PROJECTION_VERSION,
      context: requested,
      commandAuthority: null,
      applyPolicy: {
        target: 'ERP_SOURCE_PRODUCT' as const,
        mode: 'append' as const,
        writesStoreDraft: false as const,
      },
      plan: null,
      suite: null,
    };
  }
  const authority = {
    snapshotId: requested.snapshotId,
    supplyGoodsId: requested.supplyGoodsId,
    draftRevision: requested.draftRevision,
    planId: approved.id,
    planVersionId: approved.versionId,
    planRevision: approved.revision,
    skuKey: approved.skuKey,
  };
  const canExecute = input.scopes.includes('media:execute');
  const productScopeSupported = supportsProductWideCompatibilityGroups(approved);
  const canStart = canExecute
    && input.state.executionReady === true
    && productScopeSupported
    && input.state.suite == null;
  const origins = new Set(input.trustedPreviewOrigins.flatMap((value) => {
    const origin = trustedOrigin(value, input.allowInsecureLocalPreview === true);
    return origin ? [origin] : [];
  }));
  const suite = input.state.suite == null ? null : suiteProjection({
    value: input.state.suite,
    approved,
    binding: requested,
    ownerUserId: identifier(input.ownerUserId, 'ownerUserId'),
    scopes: input.scopes,
    origins,
    allowInsecureLocal: input.allowInsecureLocalPreview === true,
    targetUpdatedAt: canonicalTimestamp(input.state.targetUpdatedAt),
    executionReady: input.state.executionReady === true && productScopeSupported,
    productScopeSupported,
  });
  return {
    contractVersion: EXTENSION_AI_IMAGE_SUITE_PROJECTION_VERSION,
    context: requested,
    commandAuthority: {
      ...authority,
      authorityHash: hashExtensionAiImageSuiteContext(authority),
    },
    applyPolicy: {
      target: 'ERP_SOURCE_PRODUCT' as const,
      mode: 'append' as const,
      writesStoreDraft: false as const,
    },
    plan: {
      id: approved.id,
      versionId: approved.versionId,
      revision: approved.revision,
      status: 'APPROVED' as const,
      skuKey: approved.skuKey,
      preview: approved.preview,
      allowedActions: canStart ? ['START' as const] : [],
      commands: canStart ? {
        START: {
          expectedPreviewHash: approved.preview.hash,
          acceptedPricingVersion: approved.preview.pricingVersion,
          acceptedEstimatedCostCents: approved.preview.estimatedCostCents,
          acceptedMaximumCostCents: approved.preview.maximumCostCents,
        },
      } : {},
    },
    suite,
  };
}
