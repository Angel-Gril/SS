import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

export const AI_MEDIA_APPLICATION_CONTRACT_VERSION = 'ai-media-application-mutation/v1';
export const AI_MEDIA_COLLECT_PROJECTION_VERSION = 'ai-media-collect-projection/v1';
export const AI_MEDIA_APPLICATION_MAX_STATE_ITEMS = 100;
export const AI_MEDIA_APPLICATION_MAX_STATE_BYTES = 256 * 1024;

export type AiMediaApplicationMode = 'append' | 'replace';
export type AiMediaApplicationMutationKind = 'APPLY' | 'ROLLBACK';

export interface ApplyAiMediaWorkflowApplicationInput {
  workflowId: string;
  ownerUserId: string;
  actorUserId: string;
  mode: AiMediaApplicationMode;
  operationKey: string;
  expectedWorkflowRevision: number;
  expectedTargetUpdatedAt: string;
  replaceConfirmed?: boolean;
  production?: boolean;
  suiteId?: string;
  suiteSlotId?: string;
}

export interface RollbackAiMediaWorkflowApplicationInput {
  applicationId: string;
  ownerUserId: string;
  actorUserId: string;
  operationKey: string;
  expectedApplicationRevision: number;
  expectedWorkflowRevision: number;
  expectedTargetUpdatedAt: string;
}

export interface ListAiMediaWorkflowApplicationsInput {
  workflowId: string;
  ownerUserId: string;
  limit?: number;
  beforeSequence?: number;
  operationKey?: string;
}

export interface ListAiMediaTargetApplicationsInput {
  targetId: string;
  ownerUserId: string;
  limit?: number;
  beforeSequence?: number;
  operationKey?: string;
}

export interface AiMediaManagedField {
  present: boolean;
  value: unknown;
}

export interface AiMediaCollectProjection {
  version: typeof AI_MEDIA_COLLECT_PROJECTION_VERSION;
  images: unknown;
  watermarkedImages: AiMediaManagedField;
  editedImages: AiMediaManagedField;
}

export class AiMediaApplicationMutationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AiMediaApplicationMutationError';
  }
}

function jsonClone<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Value is not JSON serializable');
    return JSON.parse(serialized) as T;
  } catch {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Product image state is not valid JSON',
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertManagedField(value: unknown): asserts value is AiMediaManagedField {
  if (!isPlainObject(value)
    || typeof value.present !== 'boolean'
    || Object.keys(value).some((key) => key !== 'present' && key !== 'value')
    || !Object.prototype.hasOwnProperty.call(value, 'value')) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Product image state has an invalid managed field',
    );
  }
  jsonClone(value.value);
}

function managedField(metadata: Record<string, unknown>, key: string): AiMediaManagedField {
  const present = Object.prototype.hasOwnProperty.call(metadata, key);
  return { present, value: present ? jsonClone(metadata[key]) : [] };
}

function stateItemCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function postgresJsonNumber(value: number): string {
  const encoded = JSON.stringify(value);
  const exponent = encoded.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u);
  if (!exponent) return encoded;
  const sign = exponent[1] || '';
  const integer = exponent[2]!;
  const fraction = exponent[3] || '';
  const rawPower = exponent[4]!;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + Number(rawPower);
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function postgresJsonbTextByteLength(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (typeof value === 'number') return Buffer.byteLength(postgresJsonNumber(value), 'utf8');
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (Array.isArray(value)) {
    return 2 + value.reduce(
      (bytes, entry, index) => bytes + (index ? 2 : 0) + postgresJsonbTextByteLength(entry),
      0,
    );
  }
  if (isPlainObject(value)) {
    return 2 + Object.entries(value).reduce(
      (bytes, [key, entry], index) => bytes
        + (index ? 2 : 0)
        + Buffer.byteLength(JSON.stringify(key), 'utf8')
        + 2
        + postgresJsonbTextByteLength(entry),
      0,
    );
  }
  throw new Error('Value is not JSON serializable');
}

export function assertBoundedAiMediaCollectProjection(
  projection: AiMediaCollectProjection,
): AiMediaCollectProjection {
  if (!isPlainObject(projection)
    || projection.version !== AI_MEDIA_COLLECT_PROJECTION_VERSION
    || Object.keys(projection).some((key) => ![
      'version', 'images', 'watermarkedImages', 'editedImages',
    ].includes(key))
    || !Object.prototype.hasOwnProperty.call(projection, 'images')) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Product image state uses an unsupported projection contract',
    );
  }
  jsonClone(projection.images);
  assertManagedField(projection.watermarkedImages);
  assertManagedField(projection.editedImages);
  const values: unknown[] = [
    projection.images,
    projection.watermarkedImages.value,
    projection.editedImages.value,
  ];
  if (values.some((value) => stateItemCount(value) > AI_MEDIA_APPLICATION_MAX_STATE_ITEMS)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_TOO_LARGE',
      'Product image state has too many entries for reversible application',
    );
  }
  let persistedBytes: number;
  try {
    persistedBytes = postgresJsonbTextByteLength(jsonClone(projection));
  } catch {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Product image state is not valid JSON',
    );
  }
  if (persistedBytes > AI_MEDIA_APPLICATION_MAX_STATE_BYTES) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_TOO_LARGE',
      'Product image state is too large for reversible application',
    );
  }
  return projection;
}

export function captureCollectMediaProjection(
  images: unknown,
  metadataValue: unknown,
): AiMediaCollectProjection {
  if (metadataValue != null && !isPlainObject(metadataValue)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Product metadata must be a JSON object for reversible application',
    );
  }
  const metadata = metadataValue ?? {};
  return assertBoundedAiMediaCollectProjection({
    version: AI_MEDIA_COLLECT_PROJECTION_VERSION,
    images: jsonClone(images),
    watermarkedImages: managedField(metadata, 'watermarkedImages'),
    editedImages: managedField(metadata, 'editedImages'),
  });
}

function mergeImages(existing: unknown, generated: string[], mode: AiMediaApplicationMode): unknown[] {
  if (mode === 'replace') return [...generated];
  const result: unknown[] = [];
  const seenUrls = new Set<string>();
  for (const image of Array.isArray(existing) ? existing : []) {
    if (typeof image === 'string') {
      const url = image.trim();
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      result.push(url);
    } else if (image != null) {
      result.push(jsonClone(image));
    }
  }
  for (const url of generated) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    result.push(url);
  }
  return result;
}

function generatedUrls(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url || url.length > 8_000 || seen.has(url)) {
      if (!url || url.length > 8_000) {
        throw new AiMediaApplicationMutationError(
          'APPLICATION_OUTPUT_INVALID',
          'Application output URL is invalid',
        );
      }
      continue;
    }
    seen.add(url);
    result.push(url);
  }
  if (!result.length || result.length > AI_MEDIA_APPLICATION_MAX_STATE_ITEMS) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_OUTPUT_INVALID',
      'Application requires a bounded output set',
    );
  }
  return result;
}

export function applyCollectMediaProjection(
  before: AiMediaCollectProjection,
  outputUrls: string[],
  mode: AiMediaApplicationMode,
): AiMediaCollectProjection {
  assertBoundedAiMediaCollectProjection(before);
  if (mode !== 'append' && mode !== 'replace') {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Application projection contract is invalid',
    );
  }
  const outputs = generatedUrls(outputUrls);
  const publishAuthority = before.watermarkedImages.present
    && Array.isArray(before.watermarkedImages.value)
    && before.watermarkedImages.value.length > 0
    ? before.watermarkedImages.value
    : before.images;
  const images = mergeImages(publishAuthority, outputs, mode);
  const editedImages = mergeImages(before.editedImages.value, outputs, mode);
  return assertBoundedAiMediaCollectProjection({
    version: AI_MEDIA_COLLECT_PROJECTION_VERSION,
    images,
    watermarkedImages: { present: true, value: images },
    editedImages: { present: true, value: editedImages },
  });
}

export function restoreCollectMediaProjection(
  currentMetadataValue: unknown,
  projection: AiMediaCollectProjection,
): { images: unknown; metadata: Record<string, unknown> } {
  assertBoundedAiMediaCollectProjection(projection);
  if (!isPlainObject(currentMetadataValue)) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_STATE_INVALID',
      'Current product metadata must be a JSON object for rollback',
    );
  }
  const metadata = jsonClone(currentMetadataValue);
  if (projection.watermarkedImages.present) {
    metadata.watermarkedImages = jsonClone(projection.watermarkedImages.value);
  } else {
    delete metadata.watermarkedImages;
  }
  if (projection.editedImages.present) {
    metadata.editedImages = jsonClone(projection.editedImages.value);
  } else {
    delete metadata.editedImages;
  }
  return { images: jsonClone(projection.images), metadata };
}

export function hashAiMediaCollectProjection(projection: AiMediaCollectProjection): string {
  assertBoundedAiMediaCollectProjection(projection);
  return hashAiMediaPlanningJson(projection);
}

export function nextAiMediaTargetVersion(current: Date, now = new Date()): Date {
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new AiMediaApplicationMutationError(
      'APPLICATION_TARGET_VERSION_INVALID',
      'Product target version is invalid',
    );
  }
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  return new Date(Math.max(nowMs, current.getTime() + 1));
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      `${label} is invalid`,
    );
  }
  return normalized;
}

function requiredOperationKey(value: unknown): string {
  const normalized = requiredString(value, 'Application operation key', 128);
  if (normalized.length < 8) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      'Application operation key is invalid',
    );
  }
  return normalized;
}

function requiredRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      'Workflow revision is invalid',
    );
  }
  return Number(value);
}

function requiredTimestamp(value: unknown): Date {
  const timestamp = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new AiMediaApplicationMutationError(
      'INVALID_REQUEST',
      'Target version is invalid',
    );
  }
  return timestamp;
}

function applicationRequestFingerprint(value: Record<string, unknown>): string {
  return hashAiMediaPlanningJson({
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    ...value,
  });
}

function publicStateCounts(value: unknown) {
  const projection = assertBoundedAiMediaCollectProjection(value as AiMediaCollectProjection);
  return {
    images: stateItemCount(projection.images),
    watermarkedImages: stateItemCount(projection.watermarkedImages.value),
    editedImages: stateItemCount(projection.editedImages.value),
  };
}

const rollbackSummarySelect = {
  id: true,
  createdAt: true,
  targetVersionAfter: true,
} as const;

function publicApplicationMutation(row: any, options: {
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
    rollbackOfId: row.rollbackOfId || null,
    rolledBackById: row.rolledBackBy?.id || null,
    rolledBackAt: row.rolledBackBy?.createdAt || null,
    rollbackTargetVersionAfter: row.rolledBackBy?.targetVersionAfter || null,
    targetType: row.targetType,
    targetId: row.targetId,
    targetSequence: row.targetSequence,
    mode: String(row.mode || '').toLowerCase(),
    contextSkuKey: row.contextSkuKey || null,
    contextSlotKey: row.contextSlotKey || null,
    operationKey: row.operationKey,
    workflowRevisionBefore: row.workflowRevisionBefore,
    workflowRevisionAfter: row.workflowRevisionAfter,
    targetVersionBefore: row.targetVersionBefore,
    targetVersionAfter: row.targetVersionAfter,
    beforeStateHash: row.beforeStateHash,
    afterStateHash: row.afterStateHash,
    beforeCounts: publicStateCounts(row.beforeState),
    afterCounts: publicStateCounts(row.afterState),
    createdAt: row.createdAt,
    rollbackEligible: options.rollbackEligible ?? false,
    rollbackReason: options.rollbackReason ?? null,
  };
}

function publicCollectTarget(target: any) {
  const metadata = isPlainObject(target.metadata) ? target.metadata : {};
  const images = jsonClone(target.images);
  const editedImages = Array.isArray(metadata.editedImages)
    ? jsonClone(metadata.editedImages)
    : [];
  return {
    type: 'collect' as const,
    id: target.id,
    updatedAt: target.updatedAt,
    images,
    editedImages,
    mainImage: Array.isArray(images)
      ? images.find((image: unknown): image is string => typeof image === 'string') || null
      : null,
  };
}

async function lockCollectTarget(tx: any, targetId: string, ownerUserId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe(
    'SELECT "id" FROM "supply_goods" WHERE "id" = $1 AND "user_id" = $2 FOR UPDATE',
    targetId,
    ownerUserId,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AiMediaApplicationMutationError(
      'TARGET_NOT_FOUND',
      'Image application target not found',
    );
  }
}

async function lockWorkflow(tx: any, workflowId: string, ownerUserId: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe(
    'SELECT "id" FROM "ai_media_workflows" WHERE "id" = $1 AND "owner_user_id" = $2 FOR UPDATE',
    workflowId,
    ownerUserId,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AiMediaApplicationMutationError(
      'NOT_FOUND',
      'AI media workflow not found',
    );
  }
}

async function loadWorkflow(tx: any, workflowId: string, ownerUserId: string) {
  const workflow = await tx.aiMediaWorkflow.findFirst({
    where: { id: workflowId, ownerUserId },
    include: {
      selectedOutputAsset: true,
      inputs: { include: { asset: { select: { sourceCaptureSnapshotId: true } } } },
      suiteSlot: {
        include: {
          suite: {
            include: {
              plan: {
                select: {
                  id: true,
                  ownerUserId: true,
                  sourceSubjectId: true,
                  currentVersionId: true,
                  approvedVersionId: true,
                  reviewStatus: true,
                  staleAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!workflow) {
    throw new AiMediaApplicationMutationError('NOT_FOUND', 'AI media workflow not found');
  }
  if (workflow.contextType !== 'collect' || !workflow.contextId) {
    throw new AiMediaApplicationMutationError(
      'UNSUPPORTED_TARGET',
      'Reversible application currently supports collect products only',
    );
  }
  return workflow;
}

async function loadCollectTarget(tx: any, targetId: string, ownerUserId: string) {
  const target = await tx.supplyGoods.findFirst({
    where: { id: targetId, userId: ownerUserId },
    select: {
      id: true,
      images: true,
      metadata: true,
      updatedAt: true,
      sourceCaptureSubject: {
        select: {
          id: true,
          snapshots: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: {
              id: true,
              captureHash: true,
              profileHash: true,
              schemaVersion: true,
            },
          },
        },
      },
    },
  });
  if (!target) {
    throw new AiMediaApplicationMutationError(
      'TARGET_NOT_FOUND',
      'Image application target not found',
    );
  }
  return target;
}

function assertWorkflowSourceCurrent(workflow: any, target: any) {
  const currentSnapshotId = target.sourceCaptureSubject?.snapshots?.[0]?.id || null;
  const frozenSnapshotIds = Array.isArray(workflow.inputs)
    ? workflow.inputs
      .filter((input: any) => input?.role !== 'MASK')
      .map((input: any) => input?.asset?.sourceCaptureSnapshotId || null)
    : [];
  if (!currentSnapshotId
    || !frozenSnapshotIds.length
    || frozenSnapshotIds.some((snapshotId: string | null) => snapshotId !== currentSnapshotId)) {
    throw new AiMediaApplicationMutationError(
      'STALE_MEDIA_WORKFLOW',
      'The workflow source snapshot changed; review and generate a new candidate',
    );
  }
}

function assertApplicationAuthority(
  workflow: any,
  job: any,
  target: any,
  input: ApplyAiMediaWorkflowApplicationInput,
) {
  const slot = workflow.suiteSlot;
  if (!slot) {
    if (input.suiteId || input.suiteSlotId) {
      throw new AiMediaApplicationMutationError(
        'INVALID_REQUEST',
        'Suite application scope does not match this workflow',
      );
    }
    if (input.production && job.provider === 'fake') {
      throw new AiMediaApplicationMutationError(
        'PROVIDER_NOT_READY',
        'Test-only AI media candidates cannot be applied in production',
      );
    }
    return;
  }

  const suite = slot.suite;
  const plan = suite?.plan;
  const latest = target.sourceCaptureSubject?.snapshots?.[0];
  if (!input.suiteId || !input.suiteSlotId
    || input.suiteId !== slot.suiteId
    || input.suiteSlotId !== slot.id) {
    throw new AiMediaApplicationMutationError(
      'SUITE_APPLICATION_ENDPOINT_REQUIRED',
      'Suite child candidates must be applied through their suite slot',
    );
  }
  if (input.production && suite.provider === 'fake') {
    throw new AiMediaApplicationMutationError(
      'PROVIDER_NOT_READY',
      'Test-only AI media suite candidates cannot be applied in production',
    );
  }
  if (slot.status !== 'SUCCEEDED'
    || Number(slot.attempt) !== Number(workflow.currentAttempt)
    || workflow.contextType !== 'collect'
    || workflow.contextId !== suite.contextId
    || workflow.contextSlotKey !== slot.slotKey
    || job.operation !== 'IMAGE_TO_IMAGE'
    || job.provider !== suite.provider
    || job.model !== suite.model
    || !plan
    || plan.staleAt
    || plan.reviewStatus !== 'APPROVED'
    || plan.id !== suite.planId
    || plan.ownerUserId !== suite.ownerUserId
    || plan.sourceSubjectId !== suite.sourceSubjectId
    || plan.currentVersionId !== suite.planVersionId
    || plan.approvedVersionId !== suite.planVersionId
    || target.sourceCaptureSubject?.id !== suite.sourceSubjectId
    || latest?.id !== suite.sourceCaptureSnapshotId
    || latest?.captureHash !== suite.sourceCaptureHash
    || latest?.profileHash !== suite.sourceProfileHash
    || latest?.schemaVersion !== suite.sourceSchemaVersion
    || workflow.inputs.some((entry: any) => (
      entry?.asset?.sourceCaptureSnapshotId !== suite.sourceCaptureSnapshotId
    ))) {
    throw new AiMediaApplicationMutationError(
      'STALE_MEDIA_WORKFLOW',
      'Suite candidate authority no longer matches the approved frozen plan',
    );
  }
}

function assertExpectedTargetVersion(target: any, expected: Date): void {
  if (!(target.updatedAt instanceof Date) || target.updatedAt.getTime() !== expected.getTime()) {
    const metadata = isPlainObject(target.metadata) ? target.metadata : {};
    throw new AiMediaApplicationMutationError(
      'TARGET_CONFLICT',
      'Target images were updated by another operation',
      {
        targetUpdatedAt: target.updatedAt instanceof Date ? target.updatedAt : null,
        managedCounts: {
          images: stateItemCount(target.images),
          watermarkedImages: stateItemCount(metadata.watermarkedImages),
          editedImages: stateItemCount(metadata.editedImages),
        },
      },
    );
  }
}

async function nextTargetSequence(tx: any, ownerUserId: string, targetId: string): Promise<number> {
  const latest = await tx.aiMediaApplicationMutation.findFirst({
    where: { ownerUserId, targetType: 'collect', targetId },
    orderBy: { targetSequence: 'desc' },
    select: { targetSequence: true },
  });
  return Number(latest?.targetSequence || 0) + 1;
}

async function loadReplay(tx: any, ownerUserId: string, operationKey: string, fingerprint: string) {
  const existing = await tx.aiMediaApplicationMutation.findFirst({
    where: { ownerUserId, operationKey },
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  if (!existing) return null;
  if (existing.requestFingerprint !== fingerprint) {
    throw new AiMediaApplicationMutationError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Application operation key was already used for a different request',
    );
  }
  return existing;
}

async function replayResult(tx: any, mutation: any) {
  const target = await loadCollectTarget(tx, mutation.targetId, mutation.ownerUserId);
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    application: publicApplicationMutation(mutation),
    target: publicCollectTarget(target),
    replayed: true,
  };
}

function isApplicationOperationKeyUniqueConflict(error: unknown): boolean {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; meta?: unknown }
    : {};
  if (candidate.code !== 'P2002') return false;
  const metadata = JSON.stringify(candidate.meta || {}).toLowerCase();
  return metadata.includes('ai_media_application_mutation_owner_operation_key')
    || (metadata.includes('owner_user_id') && metadata.includes('operation_key'));
}

async function runAiMediaApplicationMutationTransaction(
  database: any,
  input: { ownerUserId: string; operationKey: string; requestFingerprint: string },
  action: (tx: any) => Promise<any>,
) {
  try {
    return await runAiMediaSerializableTransaction(database, action);
  } catch (error) {
    if (!isApplicationOperationKeyUniqueConflict(error)) throw error;
    const existing = await loadReplay(
      database,
      input.ownerUserId,
      input.operationKey,
      input.requestFingerprint,
    );
    if (!existing) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'Application operation changed concurrently',
      );
    }
    return replayResult(database, existing);
  }
}

async function appendApplicationMutationEvent(
  tx: any,
  mutation: any,
  eventType: 'APPLIED' | 'SUITE_CANDIDATE_APPLIED' | 'APPLICATION_ROLLED_BACK',
) {
  const payload = {
    version: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    applicationId: mutation.id,
    kind: mutation.kind,
    rollbackOfId: mutation.rollbackOfId || null,
    operationKey: mutation.operationKey,
    mode: String(mutation.mode).toLowerCase(),
    targetType: mutation.targetType,
    targetId: mutation.targetId,
    targetSequence: mutation.targetSequence,
    targetUpdatedAt: mutation.targetVersionAfter.toISOString(),
  };
  await tx.aiMediaWorkflowEvent.create({
    data: {
      workflowId: mutation.workflowId,
      ownerUserId: mutation.ownerUserId,
      actorUserId: mutation.actorUserId,
      jobId: mutation.jobId,
      assetId: mutation.assetId,
      eventKey: `${mutation.workflowId}:application-mutation:${mutation.id}`,
      eventType,
      payload,
      payloadHash: hashAiMediaPlanningJson(payload),
    },
  });
}

export async function applyAiMediaWorkflowApplication(
  database: any,
  input: ApplyAiMediaWorkflowApplicationInput,
) {
  const workflowId = requiredString(input.workflowId, 'Workflow ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const actorUserId = requiredString(input.actorUserId, 'Actor user ID', 200);
  const operationKey = requiredOperationKey(input.operationKey);
  const expectedWorkflowRevision = requiredRevision(input.expectedWorkflowRevision);
  const expectedTargetVersion = requiredTimestamp(input.expectedTargetUpdatedAt);
  if (input.mode !== 'append' && input.mode !== 'replace') {
    throw new AiMediaApplicationMutationError('INVALID_REQUEST', 'Application mode is invalid');
  }
  if (input.mode === 'replace' && input.replaceConfirmed !== true) {
    throw new AiMediaApplicationMutationError(
      'REPLACE_CONFIRMATION_REQUIRED',
      'Replacing all publish images requires explicit confirmation',
    );
  }
  const requestFingerprint = applicationRequestFingerprint({
    kind: 'APPLY',
    workflowId,
    mode: input.mode,
    suiteId: input.suiteId || null,
    suiteSlotId: input.suiteSlotId || null,
    expectedWorkflowRevision,
    expectedTargetUpdatedAt: expectedTargetVersion.toISOString(),
  });

  return runAiMediaApplicationMutationTransaction(database, {
    ownerUserId,
    operationKey,
    requestFingerprint,
  }, async (tx: any) => {
    const replay = await loadReplay(tx, ownerUserId, operationKey, requestFingerprint);
    if (replay) return replayResult(tx, replay);

    await lockWorkflow(tx, workflowId, ownerUserId);
    const initialWorkflow = await loadWorkflow(tx, workflowId, ownerUserId);
    await lockCollectTarget(tx, initialWorkflow.contextId, ownerUserId);
    const [workflow, target] = await Promise.all([
      loadWorkflow(tx, workflowId, ownerUserId),
      loadCollectTarget(tx, initialWorkflow.contextId, ownerUserId),
    ]);
    if (workflow.revision !== expectedWorkflowRevision) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
        { workflowRevision: workflow.revision },
      );
    }
    if (workflow.status !== 'SUCCEEDED'
      || workflow.reviewStatus !== 'APPROVED'
      || !workflow.selectedOutputAssetId
      || workflow.selectedOutputAsset?.id !== workflow.selectedOutputAssetId) {
      throw new AiMediaApplicationMutationError(
        'INVALID_STATE',
        'Workflow output must be approved before application',
      );
    }
    const asset = workflow.selectedOutputAsset;
    if (asset.kind !== 'AI_GENERATED' || !asset.aiImageJobId || !String(asset.url || '').trim()) {
      throw new AiMediaApplicationMutationError(
        'INVALID_STATE',
        'Reviewed workflow output is not an applicable generated asset',
      );
    }
    const job = await tx.aiImageJob.findFirst({
      where: { id: asset.aiImageJobId, ownerUserId, workflowId },
      select: {
        id: true,
        status: true,
        operation: true,
        provider: true,
        model: true,
        appliedAt: true,
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
    const existingApplication = await tx.aiMediaApplicationMutation.findFirst({
      where: { ownerUserId, jobId: job.id, kind: 'APPLY' },
      select: { id: true },
    });
    if (existingApplication) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'This candidate already has an immutable application record',
        { applicationId: existingApplication.id },
      );
    }
    if (job.appliedAt) {
      throw new AiMediaApplicationMutationError(
        'LEGACY_APPLICATION',
        'This candidate was already applied without a reversible mutation record',
      );
    }
    if (input.mode === 'replace' && (
      job.operation !== 'IMAGE_TO_IMAGE' || workflow.suiteSlot
    )) {
      throw new AiMediaApplicationMutationError(
        'UNSAFE_APPLY_MODE',
        'Replace is available only for a standalone image-to-image candidate',
      );
    }
    if (input.mode !== 'append' && ['IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT'].includes(job.operation)) {
      throw new AiMediaApplicationMutationError(
        'UNSAFE_APPLY_MODE',
        'This operation is append-only',
      );
    }
    assertApplicationAuthority(workflow, job, target, input);
    assertWorkflowSourceCurrent(workflow, target);
    assertExpectedTargetVersion(target, expectedTargetVersion);

    const beforeState = captureCollectMediaProjection(target.images, target.metadata);
    const afterState = applyCollectMediaProjection(beforeState, [String(asset.url).trim()], input.mode);
    const beforeStateHash = hashAiMediaCollectProjection(beforeState);
    const afterStateHash = hashAiMediaCollectProjection(afterState);
    if (beforeStateHash === afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_NO_CHANGE',
        'The reviewed output is already present in the managed image projection',
      );
    }
    const targetVersionAfter = nextAiMediaTargetVersion(target.updatedAt);
    const restored = restoreCollectMediaProjection(target.metadata ?? {}, afterState);
    const targetSequence = await nextTargetSequence(tx, ownerUserId, target.id);
    const mutation = await tx.aiMediaApplicationMutation.create({
      data: {
        ownerUserId,
        actorUserId,
        workflowId,
        jobId: job.id,
        assetId: asset.id,
        kind: 'APPLY',
        revision: 1,
        targetType: 'collect',
        targetId: target.id,
        targetSequence,
        mode: input.mode.toUpperCase(),
        contextSkuKey: workflow.contextSkuKey,
        contextSlotKey: workflow.contextSlotKey,
        operationKey,
        requestFingerprint,
        workflowRevisionBefore: workflow.revision,
        workflowRevisionAfter: workflow.revision + 1,
        targetVersionBefore: target.updatedAt,
        targetVersionAfter,
        beforeState,
        beforeStateHash,
        afterState,
        afterStateHash,
      },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    });
    const changedTarget = await tx.supplyGoods.updateMany({
      where: { id: target.id, userId: ownerUserId, updatedAt: target.updatedAt },
      data: {
        images: restored.images,
        metadata: restored.metadata,
        updatedAt: targetVersionAfter,
      },
    });
    if (changedTarget.count !== 1) {
      throw new AiMediaApplicationMutationError(
        'TARGET_CONFLICT',
        'Target images were updated by another operation',
      );
    }
    if (!workflow.suiteSlot) {
      const changedJob = await tx.aiImageJob.updateMany({
        where: { id: job.id, ownerUserId, status: 'SUCCEEDED', appliedAt: null },
        data: {
          appliedMode: input.mode,
          applyTargetType: 'collect',
          applyTargetId: target.id,
          appliedAt: targetVersionAfter,
        },
      });
      if (changedJob.count !== 1) {
        throw new AiMediaApplicationMutationError(
          'APPLICATION_CONFLICT',
          'AI media candidate application state changed concurrently',
        );
      }
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
    await appendApplicationMutationEvent(
      tx,
      mutation,
      workflow.suiteSlot ? 'SUITE_CANDIDATE_APPLIED' : 'APPLIED',
    );

    return {
      contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
      application: publicApplicationMutation(mutation),
      target: publicCollectTarget({
        id: target.id,
        images: restored.images,
        metadata: restored.metadata,
        updatedAt: targetVersionAfter,
      }),
      replayed: false,
    };
  });
}

export async function rollbackAiMediaWorkflowApplication(
  database: any,
  input: RollbackAiMediaWorkflowApplicationInput,
) {
  const applicationId = requiredString(input.applicationId, 'Application ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const actorUserId = requiredString(input.actorUserId, 'Actor user ID', 200);
  const operationKey = requiredOperationKey(input.operationKey);
  const expectedApplicationRevision = requiredRevision(input.expectedApplicationRevision);
  const expectedWorkflowRevision = requiredRevision(input.expectedWorkflowRevision);
  const expectedTargetVersion = requiredTimestamp(input.expectedTargetUpdatedAt);
  const requestFingerprint = applicationRequestFingerprint({
    kind: 'ROLLBACK',
    applicationId,
    expectedApplicationRevision,
    expectedWorkflowRevision,
    expectedTargetUpdatedAt: expectedTargetVersion.toISOString(),
  });

  return runAiMediaApplicationMutationTransaction(database, {
    ownerUserId,
    operationKey,
    requestFingerprint,
  }, async (tx: any) => {
    const replay = await loadReplay(tx, ownerUserId, operationKey, requestFingerprint);
    if (replay) return replayResult(tx, replay);

    const initialApply = await tx.aiMediaApplicationMutation.findFirst({
      where: { id: applicationId, ownerUserId, kind: 'APPLY' },
      select: { id: true, workflowId: true, targetId: true },
    });
    if (!initialApply) {
      throw new AiMediaApplicationMutationError(
        'NOT_FOUND',
        'Reversible AI media application was not found',
      );
    }
    await lockWorkflow(tx, initialApply.workflowId, ownerUserId);
    await lockCollectTarget(tx, initialApply.targetId, ownerUserId);
    const [applyMutation, workflow, target] = await Promise.all([
      tx.aiMediaApplicationMutation.findFirst({
        where: { id: applicationId, ownerUserId, kind: 'APPLY' },
        include: { rolledBackBy: { select: rollbackSummarySelect } },
      }),
      loadWorkflow(tx, initialApply.workflowId, ownerUserId),
      loadCollectTarget(tx, initialApply.targetId, ownerUserId),
    ]);
    if (!applyMutation) {
      throw new AiMediaApplicationMutationError('NOT_FOUND', 'Reversible application was not found');
    }
    if (applyMutation.revision !== expectedApplicationRevision) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_CONFLICT',
        'AI media application revision changed concurrently',
        { applicationRevision: applyMutation.revision },
      );
    }
    if (applyMutation.rolledBackBy) {
      throw new AiMediaApplicationMutationError(
        'ALREADY_ROLLED_BACK',
        'AI media application was already rolled back',
      );
    }
    if (workflow.revision !== expectedWorkflowRevision) {
      throw new AiMediaApplicationMutationError(
        'WORKFLOW_CONFLICT',
        'AI media workflow was updated by another operation',
        { workflowRevision: workflow.revision },
      );
    }
    assertExpectedTargetVersion(target, expectedTargetVersion);

    const frontier = await tx.aiMediaApplicationMutation.findFirst({
      where: {
        ownerUserId,
        targetType: 'collect',
        targetId: target.id,
        kind: 'APPLY',
        rolledBackBy: null,
      },
      orderBy: { targetSequence: 'desc' },
      select: { id: true },
    });
    if (frontier?.id !== applyMutation.id) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_ORDER_CONFLICT',
        'A later application must be rolled back first',
        { frontierApplicationId: frontier?.id || null },
      );
    }

    const persistedBeforeState = assertBoundedAiMediaCollectProjection(
      applyMutation.beforeState as AiMediaCollectProjection,
    );
    const persistedAfterState = assertBoundedAiMediaCollectProjection(
      applyMutation.afterState as AiMediaCollectProjection,
    );
    if (hashAiMediaCollectProjection(persistedBeforeState) !== applyMutation.beforeStateHash
      || hashAiMediaCollectProjection(persistedAfterState) !== applyMutation.afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'APPLICATION_STATE_INVALID',
        'Stored application projection no longer matches its immutable hash',
      );
    }
    const currentState = captureCollectMediaProjection(target.images, target.metadata);
    const currentStateHash = hashAiMediaCollectProjection(currentState);
    if (currentStateHash !== applyMutation.afterStateHash) {
      throw new AiMediaApplicationMutationError(
        'ROLLBACK_TARGET_CHANGED',
        'Managed target images changed after this application',
        { currentStateHash, expectedStateHash: applyMutation.afterStateHash },
      );
    }
    const restored = restoreCollectMediaProjection(target.metadata, persistedBeforeState);
    const targetVersionAfter = nextAiMediaTargetVersion(target.updatedAt);
    const targetSequence = await nextTargetSequence(tx, ownerUserId, target.id);
    const rollbackMutation = await tx.aiMediaApplicationMutation.create({
      data: {
        ownerUserId,
        actorUserId,
        workflowId: applyMutation.workflowId,
        jobId: applyMutation.jobId,
        assetId: applyMutation.assetId,
        kind: 'ROLLBACK',
        revision: 1,
        rollbackOfId: applyMutation.id,
        targetType: applyMutation.targetType,
        targetId: applyMutation.targetId,
        targetSequence,
        mode: applyMutation.mode,
        contextSkuKey: applyMutation.contextSkuKey,
        contextSlotKey: applyMutation.contextSlotKey,
        operationKey,
        requestFingerprint,
        workflowRevisionBefore: workflow.revision,
        workflowRevisionAfter: workflow.revision + 1,
        targetVersionBefore: target.updatedAt,
        targetVersionAfter,
        beforeState: applyMutation.afterState,
        beforeStateHash: applyMutation.afterStateHash,
        afterState: applyMutation.beforeState,
        afterStateHash: applyMutation.beforeStateHash,
      },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    });
    const changedTarget = await tx.supplyGoods.updateMany({
      where: { id: target.id, userId: ownerUserId, updatedAt: target.updatedAt },
      data: {
        images: restored.images,
        metadata: restored.metadata,
        updatedAt: targetVersionAfter,
      },
    });
    if (changedTarget.count !== 1) {
      throw new AiMediaApplicationMutationError(
        'TARGET_CONFLICT',
        'Target images were updated by another operation',
      );
    }
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
    await appendApplicationMutationEvent(tx, rollbackMutation, 'APPLICATION_ROLLED_BACK');

    return {
      contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
      application: publicApplicationMutation(rollbackMutation),
      target: publicCollectTarget({
        id: target.id,
        images: restored.images,
        metadata: restored.metadata,
        updatedAt: targetVersionAfter,
      }),
      replayed: false,
    };
  });
}

interface NormalizedAiMediaApplicationListInput {
  limit: number;
  beforeSequence: number | null;
  operationKey: string | null;
}

function normalizeAiMediaApplicationListInput(input: {
  limit?: number;
  beforeSequence?: number;
  operationKey?: string;
}): NormalizedAiMediaApplicationListInput {
  return {
    limit: Number.isInteger(input.limit) ? Math.min(100, Math.max(1, Number(input.limit))) : 25,
    beforeSequence: input.beforeSequence == null ? null : requiredRevision(input.beforeSequence),
    operationKey: input.operationKey == null ? null : requiredOperationKey(input.operationKey),
  };
}

async function listAiMediaTargetApplicationsSnapshot(
  database: any,
  input: NormalizedAiMediaApplicationListInput & { targetId: string; ownerUserId: string },
) {
  const { targetId, ownerUserId, limit, beforeSequence, operationKey } = input;
  const target = await loadCollectTarget(database, targetId, ownerUserId);
  const rows = await database.aiMediaApplicationMutation.findMany({
    where: {
      ownerUserId,
      targetType: 'collect',
      targetId,
      ...(beforeSequence ? { targetSequence: { lt: beforeSequence } } : {}),
    },
    orderBy: { targetSequence: 'desc' },
    take: limit + 1,
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const frontier = await database.aiMediaApplicationMutation.findFirst({
    where: {
      ownerUserId,
      targetType: 'collect',
      targetId,
      kind: 'APPLY',
      rolledBackBy: null,
    },
    orderBy: { targetSequence: 'desc' },
    include: { rolledBackBy: { select: rollbackSummarySelect } },
  });
  let currentStateHash: string | null = null;
  let targetStateValid = true;
  try {
    currentStateHash = hashAiMediaCollectProjection(
      captureCollectMediaProjection(target.images, target.metadata),
    );
  } catch {
    targetStateValid = false;
  }
  const frontierEligible = Boolean(
    frontier && targetStateValid && currentStateHash === frontier.afterStateHash,
  );
  const frontierReason = !frontier
    ? 'NO_APPLICATION'
    : !targetStateValid
      ? 'TARGET_STATE_INVALID'
      : frontierEligible
        ? 'READY'
        : 'TARGET_CHANGED';
  const recoveredOperation = operationKey
    ? await database.aiMediaApplicationMutation.findFirst({
      where: { ownerUserId, operationKey, targetType: 'collect', targetId },
      include: { rolledBackBy: { select: rollbackSummarySelect } },
    })
    : null;
  const legacyJobs = await database.aiImageJob.findMany({
    where: {
      ownerUserId,
      appliedAt: { not: null },
      applyTargetType: 'collect',
      applyTargetId: targetId,
      applicationMutations: { none: { kind: 'APPLY' } },
    },
    orderBy: { appliedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      appliedMode: true,
      applyTargetType: true,
      applyTargetId: true,
      appliedAt: true,
    },
  });
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    items: page.map((row: any) => publicApplicationMutation(row, {
      rollbackEligible: row.kind === 'APPLY' && row.id === frontier?.id && frontierEligible,
      rollbackReason: row.kind !== 'APPLY'
        ? 'NOT_APPLY'
        : row.rolledBackBy
          ? 'ALREADY_ROLLED_BACK'
          : row.id !== frontier?.id
            ? 'NOT_FRONTIER'
            : frontierReason,
    })),
    nextBeforeSequence: hasMore ? page[page.length - 1]?.targetSequence || null : null,
    frontier: frontier ? publicApplicationMutation(frontier, {
      rollbackEligible: frontierEligible,
      rollbackReason: frontierReason,
    }) : null,
    recoveredOperation: recoveredOperation
      ? publicApplicationMutation(recoveredOperation)
      : null,
    legacyApplications: legacyJobs.map((job: any) => ({
      jobId: job.id,
      mode: job.appliedMode,
      targetType: job.applyTargetType,
      targetId: job.applyTargetId,
      appliedAt: job.appliedAt,
      rollbackEligible: false,
      rollbackReason: 'LEGACY_APPLICATION',
    })),
    target: publicCollectTarget(target),
  };
}

export async function listAiMediaTargetApplications(
  database: any,
  input: ListAiMediaTargetApplicationsInput,
) {
  const targetId = requiredString(input.targetId, 'Target ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const listInput = normalizeAiMediaApplicationListInput(input);
  return database.$transaction(
    (tx: any) => listAiMediaTargetApplicationsSnapshot(tx, {
      targetId,
      ownerUserId,
      ...listInput,
    }),
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function listAiMediaWorkflowApplications(
  database: any,
  input: ListAiMediaWorkflowApplicationsInput,
) {
  const workflowId = requiredString(input.workflowId, 'Workflow ID', 200);
  const ownerUserId = requiredString(input.ownerUserId, 'Owner user ID', 200);
  const listInput = normalizeAiMediaApplicationListInput(input);
  return database.$transaction(async (tx: any) => {
    const workflow = await loadWorkflow(tx, workflowId, ownerUserId);
    return listAiMediaTargetApplicationsSnapshot(tx, {
      targetId: workflow.contextId,
      ownerUserId,
      ...listInput,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
