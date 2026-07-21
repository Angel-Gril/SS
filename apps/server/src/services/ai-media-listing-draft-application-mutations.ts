import { randomUUID } from 'node:crypto';
import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import {
  lockAiMediaApplicationOperation,
  runAiMediaSerializableTransaction,
} from '../lib/ai-media-transaction.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import { AiMediaApplicationMutationError } from './ai-media-application-mutations.js';
import {
  applySourceListingDraftCasInTransaction,
  lockCurrentSourceListingDraft,
} from './source-listing-workflow-prisma.js';

export const AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION =
  'ai-media-listing-draft-application/v1';
export const AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION =
  'ai-media-listing-draft-assignment/v1';

export interface ApplyAiMediaListingDraftApplicationInput {
  workflowId: string;
  ownerUserId: string;
  actorUserId: string;
  mode: 'append' | 'replace';
  operationKey: string;
  expectedWorkflowRevision: number;
  expectedTargetRevision: number;
  expectedTargetDraftVersion: number;
  replaceConfirmed?: boolean;
  production?: boolean;
}

export interface RollbackAiMediaListingDraftApplicationInput {
  applicationId: string;
  ownerUserId: string;
  actorUserId: string;
  operationKey: string;
  expectedApplicationRevision: number;
  expectedWorkflowRevision: number;
  expectedTargetRevision: number;
  expectedTargetDraftVersion: number;
}

export interface ListAiMediaListingDraftApplicationsInput {
  targetId: string;
  ownerUserId: string;
  limit?: number;
  beforeSequence?: number;
  operationKey?: string;
}

export interface ListAiMediaListingDraftWorkflowApplicationsInput {
  workflowId: string;
  ownerUserId: string;
  limit?: number;
  beforeSequence?: number;
  operationKey?: string;
}

export interface AiMediaListingDraftAssignmentProjection {
  version: typeof AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION;
  assignment: OzonListingDraftMediaAssignment | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('not serializable');
    return JSON.parse(encoded) as T;
  } catch {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media state is not valid JSON',
    );
  }
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new AiMediaApplicationMutationError('INVALID_REQUEST', `${label} is invalid`);
  }
  return normalized;
}

function requiredOperationKey(value: unknown): string {
  const key = requiredString(value, 'Application operation key', 128);
  if (key.length < 8) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      'Application operation key is invalid',
    );
  }
  return key;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new AiMediaApplicationMutationError('INVALID_REQUEST', `${label} is invalid`);
  }
  return Number(value);
}

function normalizedAssignment(value: unknown): OzonListingDraftMediaAssignment {
  if (!isRecord(value)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media assignment is invalid',
    );
  }
  const scope = value.scope;
  const slotKey = requiredString(value.slotKey, 'Media slot key', 200);
  const assetId = requiredString(value.assetId, 'Media asset ID', 500);
  const source = String(value.source || '');
  if (!['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(source)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media assignment source is invalid',
    );
  }
  if (scope === 'PRODUCT') {
    if (Object.prototype.hasOwnProperty.call(value, 'skuKey') && value.skuKey != null) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_STATE_INVALID',
        'Product media assignment cannot contain a SKU key',
      );
    }
    return { scope: 'PRODUCT', slotKey, assetId, source: source as any };
  }
  if (scope !== 'SKU') {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media assignment scope is invalid',
    );
  }
  return {
    scope: 'SKU',
    skuKey: requiredString(value.skuKey, 'Media SKU key', 500),
    slotKey,
    assetId,
    source: source as any,
  };
}

export function assertAiMediaListingDraftAssignmentProjection(
  value: unknown,
): AiMediaListingDraftAssignmentProjection {
  if (!isRecord(value)
    || value.version !== AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION
    || !Object.prototype.hasOwnProperty.call(value, 'assignment')
    || Object.keys(value).some((key) => !['version', 'assignment'].includes(key))) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft assignment projection uses an unsupported contract',
    );
  }
  return {
    version: AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
    assignment: value.assignment == null ? null : normalizedAssignment(value.assignment),
  };
}

function assignmentMatches(
  assignment: OzonListingDraftMediaAssignment,
  skuKey: string | null,
  slotKey: string,
): boolean {
  return assignment.slotKey === slotKey
    && (skuKey == null
      ? assignment.scope === 'PRODUCT'
      : assignment.scope === 'SKU' && assignment.skuKey === skuKey);
}

function normalizedAssignments(draft: OzonListingDraft): OzonListingDraftMediaAssignment[] {
  if (!isRecord(draft.media) || !Array.isArray(draft.media.assignments)
    || draft.media.assignments.length > 500) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media assignments are invalid',
    );
  }
  const assignments = draft.media.assignments.map(normalizedAssignment);
  const assetIds = new Set<string>();
  const slots = new Set<string>();
  for (const assignment of assignments) {
    const slot = assignment.slotKey;
    if (assetIds.has(assignment.assetId) || slots.has(slot)) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_STATE_INVALID',
        'Listing draft media assignments contain ambiguous authority',
      );
    }
    assetIds.add(assignment.assetId);
    slots.add(slot);
  }
  return assignments;
}

export function captureAiMediaListingDraftAssignment(
  draft: OzonListingDraft,
  skuKey: string | null,
  slotKey: string,
): AiMediaListingDraftAssignmentProjection {
  const matches = normalizedAssignments(draft).filter((assignment) => (
    assignmentMatches(assignment, skuKey, slotKey)
  ));
  if (matches.length > 1) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft media slot is ambiguous',
    );
  }
  return {
    version: AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
    assignment: matches[0] ? clone(matches[0]) : null,
  };
}

export function hashAiMediaListingDraftAssignment(
  projection: AiMediaListingDraftAssignmentProjection,
): string {
  return hashAiMediaPlanningJson(assertAiMediaListingDraftAssignmentProjection(projection));
}

function assignmentSource(operation: string): OzonListingDraftMediaAssignment['source'] {
  if (operation === 'IMAGE_TO_IMAGE') return 'GENERATED';
  if (operation === 'IMAGE_TRANSLATE') return 'TRANSLATED';
  if (operation === 'FULL_EDIT' || operation === 'INPAINT') return 'EDITED';
  throw new AiMediaApplicationMutationError(
    'UNSUPPORTED_TARGET',
    'This AI media operation cannot be assigned to a listing draft slot',
  );
}

function buildCandidateAssignment(input: {
  skuKey: string | null;
  slotKey: string;
  assetId: string;
  operation: string;
}): OzonListingDraftMediaAssignment {
  const base = {
    slotKey: input.slotKey,
    assetId: input.assetId,
    source: assignmentSource(input.operation),
  };
  return input.skuKey == null
    ? { scope: 'PRODUCT', ...base }
    : { scope: 'SKU', skuKey: input.skuKey, ...base };
}

function replaceSlot(
  draft: OzonListingDraft,
  skuKey: string | null,
  slotKey: string,
  assignment: OzonListingDraftMediaAssignment | null,
): OzonListingDraftMediaAssignment[] {
  const current = normalizedAssignments(draft);
  const existingIndex = current.findIndex((item) => assignmentMatches(item, skuKey, slotKey));
  const remaining = current.filter((_, index) => index !== existingIndex);
  if (!assignment) return remaining;
  if (remaining.some((item) => item.assetId === assignment.assetId)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_CONFLICT',
      'The reviewed output is already assigned to another listing slot',
    );
  }
  if (existingIndex < 0) return [...remaining, assignment];
  const result = [...remaining];
  result.splice(existingIndex, 0, assignment);
  return result;
}

function operationFingerprint(value: Record<string, unknown>): string {
  return hashAiMediaPlanningJson({
    contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    ...value,
  });
}

const rollbackSummarySelect = {
  id: true,
  createdAt: true,
  targetRevisionAfter: true,
  targetDraftVersionAfter: true,
} as const;

function publicMutation(row: any, options: {
  rollbackEligible?: boolean;
  rollbackReason?: string | null;
} = {}) {
  return {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    workflowId: row.workflowId,
    jobId: row.jobId,
    assetId: row.assetId,
    outputAssetId: row.assetId,
    operation: row.operation,
    source: (assertAiMediaListingDraftAssignmentProjection(
      row.kind === 'ROLLBACK' ? row.beforeState : row.afterState,
    ).assignment as any)?.source || null,
    rollbackOfId: row.rollbackOfId || null,
    rolledBackById: row.rolledBackBy?.id || null,
    rolledBackAt: row.rolledBackBy?.createdAt || null,
    targetType: 'listing-draft' as const,
    targetId: row.targetId,
    targetSequence: row.targetSequence,
    mode: String(row.mode || '').toLowerCase(),
    replaceConfirmed: row.replaceConfirmed === true,
    contextSkuKey: row.contextSkuKey || null,
    contextSlotKey: row.contextSlotKey,
    contextDraftRevision: row.contextDraftRevision,
    contextDraftVersion: row.contextDraftVersion,
    sourceCaptureSnapshotId: row.sourceCaptureSnapshotId,
    operationKey: row.operationKey,
    workflowRevisionBefore: row.workflowRevisionBefore,
    workflowRevisionAfter: row.workflowRevisionAfter,
    targetRevisionBefore: row.targetRevisionBefore,
    targetDraftVersionBefore: row.targetDraftVersionBefore,
    targetRevisionAfter: row.targetRevisionAfter,
    targetDraftVersionAfter: row.targetDraftVersionAfter,
    beforeAssignment: assertAiMediaListingDraftAssignmentProjection(row.beforeState).assignment,
    afterAssignment: assertAiMediaListingDraftAssignmentProjection(row.afterState).assignment,
    createdAt: row.createdAt,
    rollbackEligible: options.rollbackEligible ?? false,
    rollbackReason: options.rollbackReason ?? null,
  };
}

function publicTarget(draft: OzonListingDraft) {
  return {
    type: 'listing-draft' as const,
    id: draft.id,
    revision: draft.revision,
    draftVersion: draft.draftVersion,
    sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
    media: { assignments: clone(normalizedAssignments(draft)) },
  };
}

async function lockAiWorkflow(tx: any, workflowId: string, ownerUserId: string) {
  const rows = await tx.$queryRawUnsafe(
    'SELECT "id" FROM "ai_media_workflows" WHERE "id" = $1 AND "owner_user_id" = $2 FOR UPDATE',
    workflowId,
    ownerUserId,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AiMediaApplicationMutationError('NOT_FOUND', 'AI media workflow not found');
  }
}

async function loadWorkflow(tx: any, workflowId: string, ownerUserId: string) {
  const workflow = await tx.aiMediaWorkflow.findFirst({
    where: { id: workflowId, ownerUserId },
    include: {
      selectedOutputAsset: true,
      inputs: { include: { asset: { select: { sourceCaptureSnapshotId: true } } } },
      suiteSlot: { select: { id: true } },
    },
  });
  if (!workflow) {
    throw new AiMediaApplicationMutationError('NOT_FOUND', 'AI media workflow not found');
  }
  if (workflow.contextType !== 'listing-draft' || !workflow.contextId) {
    throw new AiMediaApplicationMutationError(
      'UNSUPPORTED_TARGET',
      'Workflow does not target a listing draft',
    );
  }
  return workflow;
}

async function assertActorAuthority(
  tx: any,
  ownerUserId: string,
  actorUserId: string,
) {
  const actor = await tx.user.findFirst({
    where: {
      id: actorUserId,
      OR: [{ id: ownerUserId }, { parentId: ownerUserId }],
    },
    select: { id: true },
  });
  if (!actor) {
    throw new AiMediaApplicationMutationError(
      'NOT_FOUND',
      'Application actor does not belong to the target owner',
    );
  }
}

function assertCurrentDraft(
  workflow: any,
  draft: OzonListingDraft,
  expectedRevision: number,
  expectedDraftVersion: number,
) {
  if (draft.revision !== expectedRevision || draft.draftVersion !== expectedDraftVersion) {
    throw new AiMediaApplicationMutationError(
      'TARGET_CONFLICT',
      'Listing draft revision changed',
      { revision: draft.revision, draftVersion: draft.draftVersion },
    );
  }
  if (workflow.contextDraftRevision !== draft.revision
    || workflow.contextDraftVersion !== draft.draftVersion
    || workflow.contextId !== draft.id) {
    throw new AiMediaApplicationMutationError(
      'STALE_MEDIA_WORKFLOW',
      'The listing draft changed; review and generate a new candidate',
    );
  }
  if (workflow.contextSkuKey != null
    && !draft.selectedSkuKeys.includes(workflow.contextSkuKey)) {
    throw new AiMediaApplicationMutationError(
      'STALE_MEDIA_WORKFLOW',
      'The selected SKU is no longer part of the listing draft',
    );
  }
}

function assertWorkflowSnapshot(workflow: any, draft: OzonListingDraft) {
  const sourceIds = Array.isArray(workflow.inputs)
    ? workflow.inputs
      .filter((input: any) => input?.role !== 'MASK')
      .map((input: any) => input?.asset?.sourceCaptureSnapshotId || null)
    : [];
  if (!draft.sourceCaptureSnapshotId
    || !sourceIds.length
    || sourceIds.some((snapshotId: string | null) => snapshotId !== draft.sourceCaptureSnapshotId)) {
    throw new AiMediaApplicationMutationError(
      'STALE_MEDIA_WORKFLOW',
      'The listing draft source snapshot changed; review and generate a new candidate',
    );
  }
}

function nextDraft(
  current: OzonListingDraft,
  assignments: OzonListingDraftMediaAssignment[],
  input: { actorUserId: string; applicationId: string; workflowId: string; kind: 'APPLY' | 'ROLLBACK' },
  now: Date,
): OzonListingDraft {
  if (current.stage === 'PUBLISHED'
    || current.runState === 'CANCELLED'
    || current.runState === 'PERMANENT_FAILURE') {
    throw new AiMediaApplicationMutationError(
      'TARGET_CONFLICT',
      'Terminal listing workflow cannot be changed',
    );
  }
  const next = clone(current);
  next.revision += 1;
  next.draftVersion += 1;
  next.media.assignments = clone(assignments);
  next.validation.status = 'STALE';
  next.freshness.media = { state: 'CURRENT', reason: null };
  next.freshness.validation = { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' };
  next.grantRevocation = {
    required: true,
    reason: 'MEDIA_ASSIGNMENT_CHANGED',
    previousShopId: null,
  };
  next.updatedAt = now.toISOString();
  if (!Array.isArray(next.auditEvents)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Listing draft audit history is invalid',
    );
  }
  next.auditEvents.push({
    id: `ai-media-listing-${input.applicationId}`,
    type: input.kind === 'APPLY'
      ? 'AI_MEDIA_ASSIGNMENT_APPLIED'
      : 'AI_MEDIA_ASSIGNMENT_ROLLED_BACK',
    actorUserId: input.actorUserId,
    draftVersion: next.draftVersion,
    occurredAt: now.toISOString(),
    details: {
      applicationId: input.applicationId,
      workflowId: input.workflowId,
      kind: input.kind,
      reason: 'MEDIA_ASSIGNMENT_CHANGED',
    },
  });
  return next;
}

async function nextTargetSequence(tx: any, ownerUserId: string, targetId: string): Promise<number> {
  const latest = await tx.aiMediaListingDraftApplicationMutation.findFirst({
    where: { ownerUserId, targetId },
    orderBy: { targetSequence: 'desc' },
    select: { targetSequence: true },
  });
  return Number(latest?.targetSequence || 0) + 1;
}

async function appendAiAuditEvent(tx: any, mutation: any, eventType: string) {
  const payload = {
    version: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    applicationId: mutation.id,
    kind: mutation.kind,
    rollbackOfId: mutation.rollbackOfId || null,
    operationKey: mutation.operationKey,
    mode: String(mutation.mode).toLowerCase(),
    targetType: 'listing-draft',
    targetId: mutation.targetId,
    targetSequence: mutation.targetSequence,
    targetRevision: mutation.targetRevisionAfter,
    targetDraftVersion: mutation.targetDraftVersionAfter,
    contextSkuKey: mutation.contextSkuKey || null,
    contextSlotKey: mutation.contextSlotKey,
  };
  await tx.aiMediaWorkflowEvent.create({ data: {
    workflowId: mutation.workflowId,
    ownerUserId: mutation.ownerUserId,
    actorUserId: mutation.actorUserId,
    jobId: mutation.jobId,
    assetId: mutation.assetId,
    eventKey: `listing-draft-application:${mutation.id}`,
    eventType,
    payload,
    payloadHash: hashAiMediaPlanningJson(payload),
  } });
}

async function loadReplay(tx: any, ownerUserId: string, operationKey: string, fingerprint: string) {
  const row = await tx.aiMediaListingDraftApplicationMutation.findFirst({
    where: { ownerUserId, operationKey },
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  if (!row) {
    const collectOperation = tx.aiMediaApplicationMutation?.findFirst
      ? await tx.aiMediaApplicationMutation.findFirst({
        where: { ownerUserId, operationKey },
        select: { id: true },
      })
      : null;
    if (collectOperation) {
      throw new AiMediaApplicationMutationError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Application operation key is already used by a collect mutation',
      );
    }
    return null;
  }
  if (row.requestFingerprint !== fingerprint) {
    throw new AiMediaApplicationMutationError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Application operation key was reused with different input',
    );
  }
  return row;
}

async function loadCurrentTarget(database: any, targetId: string, ownerUserId: string) {
  const row = await database.sourceListingWorkflow.findFirst({
    where: { id: targetId, ownerUserId },
    select: { currentDraft: { select: { payload: true } } },
  });
  if (!row?.currentDraft?.payload) {
    throw new AiMediaApplicationMutationError('TARGET_NOT_FOUND', 'Listing draft not found');
  }
  return clone(row.currentDraft.payload) as OzonListingDraft;
}

async function replayResult(database: any, row: any) {
  const target = await loadCurrentTarget(database, row.targetId, row.ownerUserId);
  return {
    contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    application: publicMutation(row),
    target: publicTarget(target),
    replayed: true,
  };
}

function uniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; meta?: { code?: unknown; target?: unknown }; message?: unknown };
  if (![value.code, value.meta?.code].some((code) => (
    ['23505', 'P2002', 'P2010'].includes(String(code || ''))
  ))) return false;
  const metadata = `${value.message || ''} ${JSON.stringify(value.meta || {})}`.toLowerCase();
  return metadata.includes('ai_media_listing_draft_mutation_operation_key')
    || (metadata.includes('owner_user_id') && metadata.includes('operation_key'));
}

async function applicationTransaction<T>(
  database: any,
  input: { ownerUserId: string; operationKey: string; requestFingerprint: string },
  action: (tx: any) => Promise<T>,
): Promise<T> {
  try {
    return await runAiMediaSerializableTransaction(database, async (tx) => {
      await lockAiMediaApplicationOperation(tx, input.ownerUserId, input.operationKey);
      return action(tx);
    });
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const replay = await loadReplay(
      database,
      input.ownerUserId,
      input.operationKey,
      input.requestFingerprint,
    );
    if (!replay) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'Listing draft application changed concurrently',
      );
    }
    return replayResult(database, replay) as Promise<T>;
  }
}

export async function applyAiMediaListingDraftApplication(
  database: any,
  input: ApplyAiMediaListingDraftApplicationInput,
) {
  const workflowId = requiredString(input.workflowId, 'Workflow ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const actorUserId = requiredString(input.actorUserId, 'Actor user ID', 200);
  const operationKey = requiredOperationKey(input.operationKey);
  const expectedWorkflowRevision = positiveInteger(
    input.expectedWorkflowRevision,
    'Workflow revision',
  );
  const expectedTargetRevision = positiveInteger(input.expectedTargetRevision, 'Target revision');
  const expectedTargetDraftVersion = positiveInteger(
    input.expectedTargetDraftVersion,
    'Target draft version',
  );
  if (!['append', 'replace'].includes(input.mode)) {
    throw new AiMediaApplicationMutationError('INVALID_REQUEST', 'Application mode is invalid');
  }
  if (input.mode === 'replace' && input.replaceConfirmed !== true) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      'Replacing a listing draft slot requires explicit confirmation',
    );
  }
  const requestFingerprint = operationFingerprint({
    kind: 'APPLY', workflowId, mode: input.mode, expectedWorkflowRevision,
    expectedTargetRevision, expectedTargetDraftVersion,
    replaceConfirmed: input.replaceConfirmed === true,
  });

  return applicationTransaction(database, {
    ownerUserId, operationKey, requestFingerprint,
  }, async (tx) => {
    const replay = await loadReplay(tx, ownerUserId, operationKey, requestFingerprint);
    if (replay) return replayResult(tx, replay);

    await lockAiWorkflow(tx, workflowId, ownerUserId);
    const workflow = await loadWorkflow(tx, workflowId, ownerUserId);
    const draft = await lockCurrentSourceListingDraft(tx, {
      draftId: workflow.contextId,
      ownerUserId,
    });
    if (!draft) {
      throw new AiMediaApplicationMutationError('TARGET_NOT_FOUND', 'Listing draft not found');
    }
    await assertActorAuthority(tx, ownerUserId, actorUserId);
    if (workflow.revision !== expectedWorkflowRevision) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
        { workflowRevision: workflow.revision },
      );
    }
    const priorApplication = workflow.selectedOutputAsset?.aiImageJobId
      ? await tx.aiMediaListingDraftApplicationMutation.findFirst({
        where: {
          ownerUserId,
          jobId: workflow.selectedOutputAsset.aiImageJobId,
          kind: 'APPLY',
        },
        select: { id: true },
      })
      : null;
    if (priorApplication) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'This candidate already has an application record',
        { applicationId: priorApplication.id },
      );
    }
    assertCurrentDraft(workflow, draft, expectedTargetRevision, expectedTargetDraftVersion);
    assertWorkflowSnapshot(workflow, draft);
    const slotKey = requiredString(workflow.contextSlotKey, 'Frozen media slot key', 200);
    if (workflow.status !== 'SUCCEEDED'
      || workflow.reviewStatus !== 'APPROVED'
      || !workflow.selectedOutputAssetId
      || workflow.selectedOutputAsset?.id !== workflow.selectedOutputAssetId) {
      throw new AiMediaApplicationMutationError(
        'INVALID_STATE',
        'Workflow output must be approved before listing draft application',
      );
    }
    if (workflow.suiteSlot) {
      throw new AiMediaApplicationMutationError(
        'UNSUPPORTED_TARGET',
        'Suite child outputs are not supported by listing draft writeback yet',
      );
    }
    const asset = workflow.selectedOutputAsset;
    if (asset.kind !== 'AI_GENERATED'
      || !asset.aiImageJobId
      || !String(asset.url || '').trim()
      || asset.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId) {
      throw new AiMediaApplicationMutationError(
        'INVALID_STATE',
        'Reviewed output is not bound to the frozen listing draft snapshot',
      );
    }
    const job = await tx.aiImageJob.findFirst({
      where: { id: asset.aiImageJobId, ownerUserId, workflowId },
      select: {
        id: true, status: true, operation: true, provider: true, appliedAt: true,
        workflowAttempt: true,
      },
    });
    if (!job
      || job.status !== 'SUCCEEDED'
      || job.workflowAttempt !== workflow.currentAttempt
      || job.operation !== workflow.operation) {
      throw new AiMediaApplicationMutationError(
        'INVALID_STATE',
        'Reviewed workflow job is not the current succeeded attempt',
      );
    }
    if (input.production || job.provider !== 'fake') {
      throw new AiMediaApplicationMutationError(
        'PROVIDER_NOT_READY',
        'Listing draft writeback remains available for fake-provider acceptance only',
      );
    }
    assignmentSource(job.operation);
    if (job.appliedAt) {
      throw new AiMediaApplicationMutationError(
        'LEGACY_APPLICATION',
        'This candidate already has an application record',
        { applicationId: null },
      );
    }

    const skuKey = workflow.contextSkuKey || null;
    const beforeState = captureAiMediaListingDraftAssignment(draft, skuKey, slotKey);
    if (input.mode === 'append' && beforeState.assignment) {
      throw new AiMediaApplicationMutationError(
        'TARGET_CONFLICT',
        'Append requires the exact frozen listing draft slot to be empty',
        { reason: 'SLOT_OCCUPIED' },
      );
    }
    if (input.mode === 'replace' && !beforeState.assignment) {
      throw new AiMediaApplicationMutationError(
        'TARGET_CONFLICT',
        'Replace requires the exact frozen listing draft slot to be occupied',
        { reason: 'SLOT_EMPTY' },
      );
    }
    const assignment = buildCandidateAssignment({
      skuKey,
      slotKey,
      assetId: asset.id,
      operation: job.operation,
    });
    const afterState: AiMediaListingDraftAssignmentProjection = {
      version: AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
      assignment,
    };
    const beforeStateHash = hashAiMediaListingDraftAssignment(beforeState);
    const afterStateHash = hashAiMediaListingDraftAssignment(afterState);
    if (beforeStateHash === afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_NO_CHANGE',
        'The reviewed output is already assigned to the frozen slot',
      );
    }
    const applicationId = randomUUID();
    const now = new Date();
    const assignments = replaceSlot(draft, skuKey, slotKey, assignment);
    const next = nextDraft(draft, assignments, {
      actorUserId, applicationId, workflowId, kind: 'APPLY',
    }, now);
    const persisted = await applySourceListingDraftCasInTransaction(tx, {
      draftId: draft.id,
      ownerUserId,
      actorUserId,
      expectedRevision: draft.revision,
      next,
    }, now);
    const targetSequence = await nextTargetSequence(tx, ownerUserId, draft.id);
    const mutation = await tx.aiMediaListingDraftApplicationMutation.create({
      data: {
        id: applicationId,
        ownerUserId,
        actorUserId,
        workflowId,
        jobId: job.id,
        assetId: asset.id,
        sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
        operation: job.operation,
        kind: 'APPLY',
        revision: 1,
        targetId: draft.id,
        targetSequence,
        mode: input.mode.toUpperCase(),
        replaceConfirmed: input.mode === 'replace',
        contextSkuKey: skuKey,
        contextSlotKey: slotKey,
        contextDraftRevision: workflow.contextDraftRevision,
        contextDraftVersion: workflow.contextDraftVersion,
        operationKey,
        requestFingerprint,
        workflowRevisionBefore: workflow.revision,
        workflowRevisionAfter: workflow.revision + 1,
        targetRevisionBefore: draft.revision,
        targetDraftVersionBefore: draft.draftVersion,
        targetRevisionAfter: persisted.revision,
        targetDraftVersionAfter: persisted.draftVersion,
        beforeState,
        beforeStateHash,
        afterState,
        afterStateHash,
      },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    });
    const changedJob = await tx.aiImageJob.updateMany({
      where: { id: job.id, ownerUserId, status: 'SUCCEEDED', appliedAt: null },
      data: {
        appliedMode: input.mode,
        applyTargetType: 'listing-draft',
        applyTargetId: draft.id,
        appliedAt: now,
      },
    });
    if (changedJob.count !== 1) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'AI media candidate application state changed concurrently',
      );
    }
    const changedWorkflow = await tx.aiMediaWorkflow.updateMany({
      where: { id: workflowId, ownerUserId, revision: workflow.revision },
      data: { revision: { increment: 1 } },
    });
    if (changedWorkflow.count !== 1) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
      );
    }
    await appendAiAuditEvent(tx, mutation, 'LISTING_DRAFT_APPLIED');
    return {
      contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
      application: publicMutation(mutation),
      target: publicTarget(persisted),
      replayed: false,
    };
  });
}

export async function rollbackAiMediaListingDraftApplication(
  database: any,
  input: RollbackAiMediaListingDraftApplicationInput,
) {
  const applicationId = requiredString(input.applicationId, 'Application ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const actorUserId = requiredString(input.actorUserId, 'Actor user ID', 200);
  const operationKey = requiredOperationKey(input.operationKey);
  const expectedApplicationRevision = positiveInteger(
    input.expectedApplicationRevision,
    'Application revision',
  );
  const expectedWorkflowRevision = positiveInteger(
    input.expectedWorkflowRevision,
    'Workflow revision',
  );
  const expectedTargetRevision = positiveInteger(input.expectedTargetRevision, 'Target revision');
  const expectedTargetDraftVersion = positiveInteger(
    input.expectedTargetDraftVersion,
    'Target draft version',
  );
  const requestFingerprint = operationFingerprint({
    kind: 'ROLLBACK', applicationId, expectedApplicationRevision, expectedWorkflowRevision,
    expectedTargetRevision, expectedTargetDraftVersion,
  });

  return applicationTransaction(database, {
    ownerUserId, operationKey, requestFingerprint,
  }, async (tx) => {
    const replay = await loadReplay(tx, ownerUserId, operationKey, requestFingerprint);
    if (replay) return replayResult(tx, replay);
    const initial = await tx.aiMediaListingDraftApplicationMutation.findFirst({
      where: { id: applicationId, ownerUserId, kind: 'APPLY' },
      select: { id: true, workflowId: true, targetId: true },
    });
    if (!initial) {
      throw new AiMediaApplicationMutationError(
        'NOT_FOUND',
        'Reversible listing draft application was not found',
      );
    }
    await lockAiWorkflow(tx, initial.workflowId, ownerUserId);
    const workflow = await loadWorkflow(tx, initial.workflowId, ownerUserId);
    const draft = await lockCurrentSourceListingDraft(tx, {
      draftId: initial.targetId,
      ownerUserId,
    });
    if (!draft) {
      throw new AiMediaApplicationMutationError('TARGET_NOT_FOUND', 'Listing draft not found');
    }
    await assertActorAuthority(tx, ownerUserId, actorUserId);
    const applyMutation = await tx.aiMediaListingDraftApplicationMutation.findFirst({
      where: { id: applicationId, ownerUserId, kind: 'APPLY' },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    });
    if (!applyMutation) {
      throw new AiMediaApplicationMutationError('NOT_FOUND', 'Application was not found');
    }
    if (applyMutation.revision !== expectedApplicationRevision) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'Listing draft application revision changed concurrently',
      );
    }
    if (applyMutation.rolledBackBy) {
      throw new AiMediaApplicationMutationError(
        'ALREADY_ROLLED_BACK',
        'Listing draft application was already rolled back',
      );
    }
    if (workflow.revision !== expectedWorkflowRevision) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
        { workflowRevision: workflow.revision },
      );
    }
    if (draft.revision !== expectedTargetRevision
      || draft.draftVersion !== expectedTargetDraftVersion) {
      throw new AiMediaApplicationMutationError(
        'TARGET_CONFLICT',
        'Listing draft revision changed',
        { revision: draft.revision, draftVersion: draft.draftVersion },
      );
    }
    if (draft.sourceCaptureSnapshotId !== applyMutation.sourceCaptureSnapshotId) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_TARGET_CHANGED',
        'Listing draft changed after this application',
      );
    }
    if (applyMutation.contextSkuKey != null
      && !draft.selectedSkuKeys.includes(applyMutation.contextSkuKey)) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_TARGET_CHANGED',
        'The listing draft SKU scope changed after this application',
      );
    }
    const frontier = await tx.aiMediaListingDraftApplicationMutation.findFirst({
      where: { ownerUserId, targetId: draft.id, kind: 'APPLY', rolledBackBy: null },
      orderBy: { targetSequence: 'desc' },
      select: { id: true },
    });
    if (frontier?.id !== applyMutation.id) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_ORDER_CONFLICT',
        'A later listing draft application must be rolled back first',
        { frontierApplicationId: frontier?.id || null },
      );
    }
    const persistedBefore = assertAiMediaListingDraftAssignmentProjection(
      applyMutation.beforeState,
    );
    const persistedAfter = assertAiMediaListingDraftAssignmentProjection(
      applyMutation.afterState,
    );
    if (hashAiMediaListingDraftAssignment(persistedBefore) !== applyMutation.beforeStateHash
      || hashAiMediaListingDraftAssignment(persistedAfter) !== applyMutation.afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_STATE_INVALID',
        'Stored listing draft assignment no longer matches its immutable hash',
      );
    }
    const currentState = captureAiMediaListingDraftAssignment(
      draft,
      applyMutation.contextSkuKey || null,
      applyMutation.contextSlotKey,
    );
    if (hashAiMediaListingDraftAssignment(currentState) !== applyMutation.afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_TARGET_CHANGED',
        'The managed listing draft slot changed after this application',
      );
    }
    const rollbackId = randomUUID();
    const now = new Date();
    const assignments = replaceSlot(
      draft,
      applyMutation.contextSkuKey || null,
      applyMutation.contextSlotKey,
      persistedBefore.assignment,
    );
    const next = nextDraft(draft, assignments, {
      actorUserId,
      applicationId: rollbackId,
      workflowId: workflow.id,
      kind: 'ROLLBACK',
    }, now);
    const persisted = await applySourceListingDraftCasInTransaction(tx, {
      draftId: draft.id,
      ownerUserId,
      actorUserId,
      expectedRevision: draft.revision,
      next,
    }, now);
    const targetSequence = await nextTargetSequence(tx, ownerUserId, draft.id);
    const rollbackMutation = await tx.aiMediaListingDraftApplicationMutation.create({
      data: {
        id: rollbackId,
        ownerUserId,
        actorUserId,
        workflowId: applyMutation.workflowId,
        jobId: applyMutation.jobId,
        assetId: applyMutation.assetId,
        sourceCaptureSnapshotId: applyMutation.sourceCaptureSnapshotId,
        operation: applyMutation.operation,
        kind: 'ROLLBACK',
        revision: 1,
        rollbackOfId: applyMutation.id,
        targetId: applyMutation.targetId,
        targetSequence,
        mode: applyMutation.mode,
        replaceConfirmed: applyMutation.replaceConfirmed === true,
        contextSkuKey: applyMutation.contextSkuKey,
        contextSlotKey: applyMutation.contextSlotKey,
        contextDraftRevision: applyMutation.contextDraftRevision,
        contextDraftVersion: applyMutation.contextDraftVersion,
        operationKey,
        requestFingerprint,
        workflowRevisionBefore: workflow.revision,
        workflowRevisionAfter: workflow.revision + 1,
        targetRevisionBefore: draft.revision,
        targetDraftVersionBefore: draft.draftVersion,
        targetRevisionAfter: persisted.revision,
        targetDraftVersionAfter: persisted.draftVersion,
        beforeState: persistedAfter,
        beforeStateHash: applyMutation.afterStateHash,
        afterState: persistedBefore,
        afterStateHash: applyMutation.beforeStateHash,
      },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    });
    const changedWorkflow = await tx.aiMediaWorkflow.updateMany({
      where: { id: workflow.id, ownerUserId, revision: workflow.revision },
      data: { revision: { increment: 1 } },
    });
    if (changedWorkflow.count !== 1) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
      );
    }
    await appendAiAuditEvent(tx, rollbackMutation, 'LISTING_DRAFT_APPLICATION_ROLLED_BACK');
    return {
      contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
      application: publicMutation(rollbackMutation),
      target: publicTarget(persisted),
      replayed: false,
    };
  });
}

function listInput(input: { limit?: number; beforeSequence?: number; operationKey?: string }) {
  return {
    limit: Number.isInteger(input.limit) ? Math.min(100, Math.max(1, Number(input.limit))) : 25,
    beforeSequence: input.beforeSequence == null
      ? null
      : positiveInteger(input.beforeSequence, 'Before sequence'),
    operationKey: input.operationKey == null ? null : requiredOperationKey(input.operationKey),
  };
}

async function listSnapshot(
  database: any,
  input: ReturnType<typeof listInput> & { targetId: string; ownerUserId: string },
) {
  const target = await loadCurrentTarget(database, input.targetId, input.ownerUserId);
  const rows = await database.aiMediaListingDraftApplicationMutation.findMany({
    where: {
      ownerUserId: input.ownerUserId,
      targetId: input.targetId,
      ...(input.beforeSequence ? { targetSequence: { lt: input.beforeSequence } } : {}),
    },
    orderBy: { targetSequence: 'desc' },
    take: input.limit + 1,
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const frontier = await database.aiMediaListingDraftApplicationMutation.findFirst({
    where: { ownerUserId: input.ownerUserId, targetId: input.targetId, kind: 'APPLY', rolledBackBy: null },
    orderBy: { targetSequence: 'desc' },
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  const currentProjection = frontier
    ? captureAiMediaListingDraftAssignment(
        target,
        frontier.contextSkuKey || null,
        frontier.contextSlotKey,
      )
    : null;
  const frontierEligible = Boolean(frontier
    && target.sourceCaptureSnapshotId === frontier.sourceCaptureSnapshotId
    && (frontier.contextSkuKey == null || target.selectedSkuKeys.includes(frontier.contextSkuKey))
    && currentProjection
    && hashAiMediaListingDraftAssignment(currentProjection) === frontier.afterStateHash);
  const recoveredOperation = input.operationKey
    ? await database.aiMediaListingDraftApplicationMutation.findFirst({
        where: { ownerUserId: input.ownerUserId, operationKey: input.operationKey, targetId: input.targetId },
        include: { rolledBackBy: { select: rollbackSummarySelect } },
      })
    : null;
  return {
    contractVersion: AI_MEDIA_LISTING_DRAFT_APPLICATION_CONTRACT_VERSION,
    items: page.map((row: any) => publicMutation(row, {
      rollbackEligible: row.kind === 'APPLY' && row.id === frontier?.id && frontierEligible,
      rollbackReason: row.kind !== 'APPLY'
        ? 'NOT_APPLY'
        : row.rolledBackBy
          ? 'ALREADY_ROLLED_BACK'
          : row.id !== frontier?.id
            ? 'NOT_FRONTIER'
            : frontierEligible
              ? 'READY'
              : 'TARGET_CHANGED',
    })),
    nextBeforeSequence: hasMore ? page[page.length - 1]?.targetSequence || null : null,
    frontier: frontier ? publicMutation(frontier, {
      rollbackEligible: frontierEligible,
      rollbackReason: frontierEligible ? 'READY' : 'TARGET_CHANGED',
    }) : null,
    recoveredOperation: recoveredOperation ? publicMutation(recoveredOperation) : null,
    target: publicTarget(target),
  };
}

export async function listAiMediaListingDraftApplications(
  database: any,
  input: ListAiMediaListingDraftApplicationsInput,
) {
  const targetId = requiredString(input.targetId, 'Target ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const normalized = listInput(input);
  return database.$transaction(
    (tx: any) => listSnapshot(tx, { targetId, ownerUserId, ...normalized }),
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function listAiMediaListingDraftWorkflowApplications(
  database: any,
  input: ListAiMediaListingDraftWorkflowApplicationsInput,
) {
  const workflowId = requiredString(input.workflowId, 'Workflow ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const normalized = listInput(input);
  return database.$transaction(async (tx: any) => {
    const workflow = await tx.aiMediaWorkflow.findFirst({
      where: { id: workflowId, ownerUserId, contextType: 'listing-draft' },
      select: { contextId: true },
    });
    if (!workflow?.contextId) {
      throw new AiMediaApplicationMutationError('NOT_FOUND', 'AI media workflow not found');
    }
    return listSnapshot(tx, {
      targetId: workflow.contextId,
      ownerUserId,
      ...normalized,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
