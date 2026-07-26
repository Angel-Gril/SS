import type {
  OzonListingDraft,
  OzonListingDraftMediaAssignment,
} from 'shared';
import type { ByokGeneratedAssetRecord } from './byok-generated-asset-ingest.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import type { ExtensionByokMediaIngestResolvedCommand } from './extension-byok-media-ingest-grant.js';
import type { ExtensionCommandBinding } from './extension-command-grants.js';
import {
  applySourceListingDraftCasInTransaction,
  lockCurrentSourceListingDraft,
  type SourceListingWorkflowSqlClient,
} from './source-listing-workflow-prisma.js';
import { OzonListingDraftRepositoryError } from './ozon-listing-draft.js';

export const BYOK_LISTING_MEDIA_BINDING_VERSION =
  'byok-listing-media-binding/v1' as const;

export type ByokListingMediaBindingErrorCode =
  | 'BYOK_LISTING_BINDING_INPUT_INVALID'
  | 'BYOK_LISTING_BINDING_DRAFT_STALE'
  | 'BYOK_LISTING_BINDING_ASSET_INVALID'
  | 'BYOK_LISTING_BINDING_SLOT_CONFLICT'
  | 'BYOK_LISTING_BINDING_ORDER_CONFLICT';

export class ByokListingMediaBindingError extends Error {
  constructor(
    public readonly code: ByokListingMediaBindingErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ByokListingMediaBindingError';
  }
}

export interface BindByokGeneratedAssetToListingDraftInput {
  binding: ExtensionCommandBinding;
  command: ExtensionByokMediaIngestResolvedCommand;
  actorUserId: string;
  asset: ByokGeneratedAssetRecord;
  now: Date;
}

export interface ByokListingMediaBindingResult {
  sourceDraftRevision: number;
  sourceDraftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  assignmentOrdinal: number;
  assignmentSha256: string;
  assignment: OzonListingDraftMediaAssignment;
  draft: OzonListingDraft;
}

function fail(
  code: ByokListingMediaBindingErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ByokListingMediaBindingError(code, statusCode, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function exactString(value: unknown, maximum = 1_024): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.normalize('NFKC').trim()
    || value.length > maximum
    || hasControlCharacter(value)) {
    fail('BYOK_LISTING_BINDING_INPUT_INVALID', 400, 'BYOK listing binding identity is invalid');
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function normalizedAssignment(
  value: unknown,
  selectedSkuKeys: ReadonlySet<string>,
): OzonListingDraftMediaAssignment {
  if (!isRecord(value)) {
    return fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing media assignment is invalid');
  }
  const scope = value.scope;
  const expectedKeys = scope === 'PRODUCT'
    ? ['scope', 'slotKey', 'assetId', 'source']
    : ['scope', 'skuKey', 'slotKey', 'assetId', 'source'];
  if (!exactKeys(value, expectedKeys)) {
    return fail(
      'BYOK_LISTING_BINDING_DRAFT_STALE',
      409,
      'Listing media assignment contains unsupported authority',
    );
  }
  const slotKey = exactString(value.slotKey, 200);
  const assetId = exactString(value.assetId, 500);
  const source = String(value.source || '');
  if (!['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(source)) {
    return fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing media source is invalid');
  }
  if (scope === 'PRODUCT') {
    return {
      scope: 'PRODUCT',
      slotKey,
      assetId,
      source: source as OzonListingDraftMediaAssignment['source'],
    };
  }
  if (scope !== 'SKU') {
    return fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing media scope is invalid');
  }
  const skuKey = exactString(value.skuKey, 500);
  if (!selectedSkuKeys.has(skuKey)) {
    return fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing media SKU is no longer selected');
  }
  return {
    scope: 'SKU',
    skuKey,
    slotKey,
    assetId,
    source: source as OzonListingDraftMediaAssignment['source'],
  };
}

function normalizedAssignments(draft: OzonListingDraft): OzonListingDraftMediaAssignment[] {
  if (!isRecord(draft.media)
    || !Array.isArray(draft.media.assignments)
    || draft.media.assignments.length > 500) {
    return fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing media state is invalid');
  }
  const selected = new Set(draft.selectedSkuKeys);
  const assignments = draft.media.assignments.map((value) => normalizedAssignment(value, selected));
  const assets = new Set<string>();
  const slots = new Set<string>();
  for (const assignment of assignments) {
    if (assets.has(assignment.assetId) || slots.has(assignment.slotKey)) {
      return fail(
        'BYOK_LISTING_BINDING_DRAFT_STALE',
        409,
        'Listing media state contains ambiguous asset or slot authority',
      );
    }
    assets.add(assignment.assetId);
    slots.add(assignment.slotKey);
  }
  return assignments;
}

function assertDraftAuthority(
  draft: OzonListingDraft,
  input: BindByokGeneratedAssetToListingDraftInput,
): void {
  const { binding, command } = input;
  if (!binding.shopId
    || !binding.workflowId
    || binding.draftVersion == null
    || draft.id !== binding.workflowId
    || draft.ownerUserId !== binding.ownerUserId
    || draft.shopId !== binding.shopId
    || draft.revision !== command.draftRevision
    || draft.draftVersion !== binding.draftVersion
    || draft.sourceCaptureSnapshotId !== command.authority.sourceCaptureSnapshotId
    || !Array.isArray(draft.selectedSkuKeys)
    || !draft.selectedSkuKeys.includes(command.skuKey)
    || draft.stage === 'PUBLISHED'
    || draft.runState === 'CANCELLED'
    || draft.runState === 'PERMANENT_FAILURE') {
    fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'The listing draft changed before BYOK binding');
  }
  const prefix = `sku:${command.skuKey}:`;
  if (!command.slotKey.startsWith(prefix) || command.slotKey.length <= prefix.length) {
    fail('BYOK_LISTING_BINDING_INPUT_INVALID', 400, 'BYOK slot does not belong to the selected SKU');
  }
}

function assertAssetAuthority(
  input: BindByokGeneratedAssetToListingDraftInput,
): void {
  const { asset, binding, command } = input;
  const metadata = isRecord(asset.metadata) ? asset.metadata : null;
  if (!metadata
    || asset.ownerUserId !== binding.ownerUserId
    || asset.kind !== 'AI_GENERATED'
    || asset.aiImageJobId !== null
    || asset.sourceUrl !== null
    || asset.sourceCaptureSnapshotId !== command.authority.sourceCaptureSnapshotId
    || !['local', 'oss'].includes(asset.storageBackend)
    || !asset.storageKey
    || !asset.url
    || !asset.sha256
    || metadata.ingestContractVersion !== 'byok-generated-asset-ingest/v1'
    || metadata.generatedAssetSource !== 'EXTENSION_BYOK'
    || metadata.executionMode !== 'BYOK'
    || metadata.outputRole !== 'BYOK_ACCEPTED'
    || metadata.requestHash !== binding.requestHash
    || metadata.providerResultSha256 !== command.resultSha256
    || metadata.normalizedSha256 !== asset.sha256) {
    fail('BYOK_LISTING_BINDING_ASSET_INVALID', 409, 'BYOK asset authority is invalid');
  }
}

function sourceForOperation(
  operation: ExtensionByokMediaIngestResolvedCommand['providerOperation'],
): 'GENERATED' | 'EDITED' {
  if (operation === 'TEXT_TO_IMAGE' || operation === 'IMAGE_TO_IMAGE') return 'GENERATED';
  if (operation === 'FULL_EDIT' || operation === 'INPAINT') return 'EDITED';
  return fail('BYOK_LISTING_BINDING_INPUT_INVALID', 400, 'BYOK media operation is unsupported');
}

function assignmentMatches(
  assignment: OzonListingDraftMediaAssignment,
  skuKey: string,
  slotKey: string,
): boolean {
  return assignment.scope === 'SKU'
    && assignment.skuKey === skuKey
    && assignment.slotKey === slotKey;
}

function plannedAssignments(
  current: OzonListingDraftMediaAssignment[],
  input: BindByokGeneratedAssetToListingDraftInput,
  assignment: OzonListingDraftMediaAssignment,
): OzonListingDraftMediaAssignment[] {
  const { command, asset } = input;
  const existingIndex = current.findIndex((value) => (
    assignmentMatches(value, command.skuKey, command.slotKey)
  ));
  const duplicateAssetIndex = current.findIndex((value) => value.assetId === asset.id);
  if (duplicateAssetIndex >= 0 && duplicateAssetIndex !== existingIndex) {
    fail('BYOK_LISTING_BINDING_SLOT_CONFLICT', 409, 'BYOK asset is already assigned to another slot');
  }
  if (command.assignmentMode === 'APPEND') {
    if (command.replaceConfirmed || existingIndex >= 0) {
      fail('BYOK_LISTING_BINDING_SLOT_CONFLICT', 409, 'BYOK append requires an empty exact slot');
    }
    if (current.length >= 500 || command.assignmentOrdinal > current.length) {
      fail('BYOK_LISTING_BINDING_ORDER_CONFLICT', 409, 'BYOK assignment ordinal is out of range');
    }
    const next = [...current];
    next.splice(command.assignmentOrdinal, 0, assignment);
    return next;
  }
  if (!command.replaceConfirmed
    || existingIndex < 0
    || existingIndex !== command.assignmentOrdinal) {
    fail(
      existingIndex < 0
        ? 'BYOK_LISTING_BINDING_SLOT_CONFLICT'
        : 'BYOK_LISTING_BINDING_ORDER_CONFLICT',
      409,
      'BYOK replacement does not match the frozen slot and order',
    );
  }
  if (current[existingIndex]!.assetId === asset.id) {
    fail('BYOK_LISTING_BINDING_SLOT_CONFLICT', 409, 'BYOK replacement would not change the slot');
  }
  const next = [...current];
  next.splice(existingIndex, 1, assignment);
  return next;
}

export function planByokGeneratedAssetListingBinding(
  draft: OzonListingDraft,
  input: BindByokGeneratedAssetToListingDraftInput,
): ByokListingMediaBindingResult {
  assertDraftAuthority(draft, input);
  assertAssetAuthority(input);
  if (input.actorUserId !== input.binding.ownerUserId) {
    fail('BYOK_LISTING_BINDING_INPUT_INVALID', 403, 'BYOK binding actor is not the device owner');
  }
  if (!isRecord(draft.validation)
    || !isRecord(draft.freshness)
    || !isRecord(draft.freshness.media)
    || !isRecord(draft.freshness.validation)
    || !isRecord(draft.grantRevocation)
    || !Array.isArray(draft.auditEvents)) {
    fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing draft mutation state is invalid');
  }
  const current = normalizedAssignments(draft);
  const assignment: OzonListingDraftMediaAssignment = {
    scope: 'SKU',
    skuKey: input.command.skuKey,
    slotKey: input.command.slotKey,
    assetId: input.asset.id,
    source: sourceForOperation(input.command.providerOperation),
  };
  const assignments = plannedAssignments(current, input, assignment);
  const sourceDraftRevision = draft.revision;
  const sourceDraftVersion = draft.draftVersion;
  const boundDraftRevision = sourceDraftRevision + 1;
  const boundDraftVersion = sourceDraftVersion + 1;
  const assignmentSha256 = hashAiMediaPlanningJson({
    contractVersion: BYOK_LISTING_MEDIA_BINDING_VERSION,
    ownerUserId: input.binding.ownerUserId,
    shopId: input.binding.shopId,
    workflowId: input.binding.workflowId,
    sourceDraftRevision,
    sourceDraftVersion,
    boundDraftRevision,
    boundDraftVersion,
    skuKey: input.command.skuKey,
    slotKey: input.command.slotKey,
    assignmentOrdinal: input.command.assignmentOrdinal,
    assignmentMode: input.command.assignmentMode,
    assignment,
    providerResultSha256: input.command.resultSha256,
    normalizedResultSha256: input.asset.sha256,
    requestHash: input.binding.requestHash,
    policyRevision: input.command.readiness.policyRevision,
  });
  const next = structuredClone(draft);
  next.revision = boundDraftRevision;
  next.draftVersion = boundDraftVersion;
  next.media.assignments = assignments;
  next.validation.status = 'STALE';
  next.freshness.media = { state: 'CURRENT', reason: null };
  next.freshness.validation = { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' };
  next.grantRevocation = {
    required: true,
    reason: 'MEDIA_ASSIGNMENT_CHANGED',
    previousShopId: null,
  };
  next.updatedAt = input.now.toISOString();
  if (!Array.isArray(next.auditEvents)) {
    fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'Listing draft audit history is invalid');
  }
  const eventDigest = hashAiMediaPlanningJson({
    contractVersion: BYOK_LISTING_MEDIA_BINDING_VERSION,
    ownerUserId: input.binding.ownerUserId,
    idempotencyKey: input.binding.idempotencyKey,
  });
  next.auditEvents.push({
    id: `byok-media-binding:${eventDigest.slice(0, 48)}`,
    type: 'BYOK_MEDIA_ASSIGNMENT_BOUND',
    actorUserId: input.actorUserId,
    draftVersion: boundDraftVersion,
    occurredAt: input.now.toISOString(),
    details: {
      assetId: input.asset.id,
      skuKey: input.command.skuKey,
      slotKey: input.command.slotKey,
      assignmentOrdinal: input.command.assignmentOrdinal,
      assignmentMode: input.command.assignmentMode,
      assignmentSha256,
      reason: 'MEDIA_ASSIGNMENT_CHANGED',
    },
  });
  return {
    sourceDraftRevision,
    sourceDraftVersion,
    boundDraftRevision,
    boundDraftVersion,
    assignmentOrdinal: input.command.assignmentOrdinal,
    assignmentSha256,
    assignment,
    draft: next,
  };
}

export async function bindByokGeneratedAssetToListingDraft(
  client: Pick<SourceListingWorkflowSqlClient, '$queryRawUnsafe'>,
  input: BindByokGeneratedAssetToListingDraftInput,
): Promise<ByokListingMediaBindingResult> {
  const transaction = client as SourceListingWorkflowSqlClient;
  const current = await lockCurrentSourceListingDraft(transaction, {
    draftId: input.binding.workflowId || '',
    ownerUserId: input.binding.ownerUserId,
  });
  if (!current) {
    fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'The listing draft no longer exists');
  }
  const planned = planByokGeneratedAssetListingBinding(current, input);
  let persisted: OzonListingDraft;
  try {
    persisted = await applySourceListingDraftCasInTransaction(transaction, {
      draftId: current.id,
      ownerUserId: input.binding.ownerUserId,
      actorUserId: input.actorUserId,
      expectedRevision: current.revision,
      next: planned.draft,
    }, input.now);
  } catch (error) {
    if (error instanceof OzonListingDraftRepositoryError
      && ['NOT_FOUND', 'VERSION_CONFLICT'].includes(error.code)) {
      fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'The listing draft changed during BYOK binding');
    }
    throw error;
  }
  if (persisted.revision !== planned.boundDraftRevision
    || persisted.draftVersion !== planned.boundDraftVersion) {
    fail('BYOK_LISTING_BINDING_DRAFT_STALE', 409, 'The listing draft binding did not persist exactly');
  }
  return { ...planned, draft: persisted };
}
