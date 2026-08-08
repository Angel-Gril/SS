import { z } from 'zod';
import { containsSecretBearingIdentifier } from './extension-byok-media-provenance.js';

export const EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION =
  'extension-byok-workbench-launch-request/v1' as const;
export const EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2 =
  'extension-byok-workbench-launch-request/v2' as const;
export const EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3 =
  'extension-byok-workbench-launch-request/v3' as const;
export const EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION =
  'extension-byok-workbench-launch-decision/v2' as const;
export const EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_DECISION_VERSION =
  'extension-byok-workbench-launch-decision/v3' as const;
export const EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION =
  'extension-byok-workbench-launch-context/v1' as const;
export const EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_CONTEXT_VERSION =
  'extension-byok-workbench-review-launch-context/v1' as const;
export const EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION =
  'extension-byok-workbench-batch-launch-context/v1' as const;

const SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'] as const;
const SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'] as const;
const MAX_ASSIGNMENTS = 500;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

const identifier = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/[?#]/u.test(value))
  .refine((value) => !/(?:https?|ftp|data):/iu.test(value))
  .refine((value) => !containsSecretBearingIdentifier(value));

const launchAuthoritySchema = z.object({
  sourcePlatform: z.enum(SOURCE_PLATFORMS),
  sourceProductId: identifier(200),
  sourceCaptureSnapshotId: identifier(200),
  supplyGoodsId: identifier(200),
  shopId: identifier(200),
  workflowId: identifier(200),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
});

const launchRequestSchema = z.discriminatedUnion('contractVersion', [
  launchAuthoritySchema.extend({
    contractVersion: z.literal(EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION),
  }).strict(),
  launchAuthoritySchema.extend({
    contractVersion: z.literal(EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2),
    preferredSkuKey: identifier(500).nullable(),
    selectionKind: z.enum(['HINT', 'EXPLICIT']),
  }).strict(),
  launchAuthoritySchema.extend({
    contractVersion: z.literal(EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3),
    preferredSkuKey: identifier(500).nullable(),
    selectionKind: z.enum(['HINT', 'EXPLICIT']),
    supportedLaunchModes: z.tuple([
      z.literal('GENERATE'),
      z.literal('REVIEW_PUBLISH_ONLY'),
    ]),
  }).strict(),
]);

export type ExtensionByokWorkbenchLaunchRequest = z.infer<typeof launchRequestSchema>;
export type ExtensionByokWorkbenchLaunchRequestV1 = Extract<
  ExtensionByokWorkbenchLaunchRequest,
  { contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION }
>;
export type ExtensionByokWorkbenchLaunchRequestV2 = Extract<
  ExtensionByokWorkbenchLaunchRequest,
  { contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2 }
>;
export type ExtensionByokWorkbenchLaunchRequestV3 = Extract<
  ExtensionByokWorkbenchLaunchRequest,
  { contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3 }
>;
type ExtensionByokWorkbenchLaunchRequestWithSelection =
  | ExtensionByokWorkbenchLaunchRequestV2
  | ExtensionByokWorkbenchLaunchRequestV3;

export type ExtensionByokWorkbenchLaunchBinding = Pick<
  ExtensionByokWorkbenchLaunchRequest,
  | 'sourcePlatform' | 'sourceProductId' | 'sourceCaptureSnapshotId' | 'supplyGoodsId'
  | 'shopId' | 'workflowId' | 'draftRevision' | 'draftVersion'
>;

export interface ExtensionByokWorkbenchLaunchContext {
  contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION;
  sourcePlatform: typeof SOURCE_PLATFORMS[number];
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
  skuKey: string;
  slotKey: string;
  assignmentMode: 'APPEND';
  assignmentOrdinal: number;
}

export type ExtensionByokWorkbenchLaunchDecision =
  | {
    contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION;
    state: 'READY';
    context: ExtensionByokWorkbenchLaunchContext;
  }
  | {
    contractVersion: typeof EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION;
    state: 'CHOICE_REQUIRED';
    binding: ExtensionByokWorkbenchLaunchBinding;
    skuKeys: string[];
  }
  | {
    contractVersion: typeof EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_DECISION_VERSION;
    state: 'REVIEW_PUBLISH_ONLY';
    context: ExtensionByokWorkbenchReviewLaunchContext;
  };

export interface ExtensionByokWorkbenchReviewLaunchContext {
  contractVersion: typeof EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_CONTEXT_VERSION;
  launchMode: 'REVIEW_PUBLISH_ONLY';
  sourcePlatform: typeof SOURCE_PLATFORMS[number];
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assetId: string;
  source: 'GENERATED';
}

export interface ExtensionByokWorkbenchBatchLaunchContext {
  contractVersion: typeof EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION;
  sourcePlatform: typeof SOURCE_PLATFORMS[number];
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
  anchorSkuKey: string;
  firstAssignmentOrdinal: number;
  targets: Array<{ skuKey: string; slotKey: string }>;
}

export type ExtensionByokWorkbenchSlotTarget = Pick<
  ExtensionByokWorkbenchLaunchContext,
  'skuKey' | 'slotKey' | 'assignmentMode' | 'assignmentOrdinal'
>;

export interface ExtensionByokWorkbenchBoundSlotCandidate
  extends Pick<ExtensionByokWorkbenchSlotTarget, 'skuKey' | 'slotKey' | 'assignmentOrdinal'> {
  assetId: string;
  source: 'GENERATED';
}

export interface ExtensionByokWorkbenchBoundSlotAuthorizationInput
  extends ExtensionByokWorkbenchBoundSlotCandidate {
  ownerUserId: string;
  requestingDeviceSessionId: string;
  sourcePlatform: typeof SOURCE_PLATFORMS[number];
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
}

export type ExtensionByokWorkbenchBoundSlotAuthorizationDecision =
  | { authorized: true; assetId: string }
  | { authorized: false; assetId: null };

export interface ExtensionByokWorkbenchDraft {
  id: string;
  ownerUserId: string;
  shopId: string;
  revision: number;
  draftVersion: number;
  supplyGoodsId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureCurrent: boolean;
  sourcePlatform: string;
  sourceProductId: string;
  selectedSkuKeys: string[];
  media: { assignments: unknown[] };
  stage: string;
  runState: string;
}

export class ExtensionByokWorkbenchLaunchError extends Error {
  constructor(
    public readonly code:
      | 'BYOK_WORKBENCH_LAUNCH_REQUEST_INVALID'
      | 'BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE'
      | 'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
    public readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokWorkbenchLaunchError';
  }
}

function fail(
  code: ExtensionByokWorkbenchLaunchError['code'],
  statusCode: ExtensionByokWorkbenchLaunchError['statusCode'],
  message: string,
): never {
  throw new ExtensionByokWorkbenchLaunchError(code, statusCode, message);
}

export function parseExtensionByokWorkbenchLaunchRequest(
  value: unknown,
): ExtensionByokWorkbenchLaunchRequest {
  const parsed = launchRequestSchema.safeParse(value);
  if (!parsed.success) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_REQUEST_INVALID',
      400,
      'BYOK workbench launch request is invalid',
    );
  }
  return parsed.data;
}

function canonicalIdentifier(value: unknown, maximum: number): string | null {
  const parsed = identifier(maximum).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizedAssignmentSlots(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNMENTS) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE',
      409,
      'Listing media assignments are invalid',
    );
  }
  const slots = new Set<string>();
  const assets = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'Listing media assignment is invalid');
    }
    const row = item as Record<string, unknown>;
    const expectedKeys = row.scope === 'PRODUCT'
      ? ['scope', 'slotKey', 'assetId', 'source']
      : ['scope', 'skuKey', 'slotKey', 'assetId', 'source'];
    if (Object.keys(row).length !== expectedKeys.length
      || Object.keys(row).some((key) => !expectedKeys.includes(key))
      || !['PRODUCT', 'SKU'].includes(String(row.scope || ''))
      || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(String(row.source || ''))) {
      return fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'Listing media assignment is invalid');
    }
    const slotKey = canonicalIdentifier(row.slotKey, 200);
    const assetId = canonicalIdentifier(row.assetId, 500);
    const skuKey = row.scope === 'SKU' ? canonicalIdentifier(row.skuKey, 500) : null;
    if (!slotKey || !assetId || (row.scope === 'SKU' && !skuKey)
      || slots.has(slotKey) || assets.has(assetId)) {
      return fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'Listing media authority is ambiguous');
    }
    slots.add(slotKey);
    assets.add(assetId);
  }
  return slots;
}

function assertDraftIdentity(
  ownerUserId: string,
  request: ExtensionByokWorkbenchLaunchRequest,
  draft: ExtensionByokWorkbenchDraft,
): void {
  if (draft.id !== request.workflowId
    || draft.ownerUserId !== ownerUserId
    || draft.shopId !== request.shopId
    || draft.revision !== request.draftRevision
    || draft.draftVersion !== request.draftVersion
    || draft.supplyGoodsId !== request.supplyGoodsId
    || draft.sourceCaptureSnapshotId !== request.sourceCaptureSnapshotId
    || draft.sourceCaptureCurrent !== true
    || draft.sourcePlatform !== request.sourcePlatform
    || draft.sourceProductId !== request.sourceProductId
    || draft.stage === 'PUBLISHED'
    || ['CANCELLED', 'PERMANENT_FAILURE'].includes(draft.runState)) {
    fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'BYOK workbench draft context changed');
  }
}

function resolveDraftMediaAuthority(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequest;
  draft: ExtensionByokWorkbenchDraft;
}) {
  const { ownerUserId, request, draft } = input;
  assertDraftIdentity(ownerUserId, request, draft);
  if (!Array.isArray(draft.selectedSkuKeys)
    || draft.selectedSkuKeys.length < 1
    || draft.selectedSkuKeys.length > MAX_ASSIGNMENTS) {
    return fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'Listing SKU authority is invalid');
  }
  const skuKeys = draft.selectedSkuKeys.map((value) => canonicalIdentifier(value, 500));
  if (skuKeys.some((value) => value === null)
    || new Set(skuKeys).size !== skuKeys.length
    || !draft.media
    || typeof draft.media !== 'object'
    || Array.isArray(draft.media)) {
    return fail('BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE', 409, 'Listing SKU authority is invalid');
  }
  const assignments = draft.media.assignments;
  const occupiedSlots = normalizedAssignmentSlots(assignments);
  if (assignments.length >= MAX_ASSIGNMENTS) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'No representable append ordinal is available for the first BYOK workbench release',
    );
  }
  return {
    skuKeys: skuKeys as string[],
    assignments,
    occupiedSlots,
  };
}

function emptySkuHeroKeys(authority: ReturnType<typeof resolveDraftMediaAuthority>): string[] {
  return authority.skuKeys.filter((skuKey) => {
    const slotKey = `sku:${skuKey}:hero`;
    return slotKey.length <= 200 && !authority.occupiedSlots.has(slotKey);
  });
}

function launchBinding(
  request: ExtensionByokWorkbenchLaunchRequest,
): ExtensionByokWorkbenchLaunchBinding {
  return {
    sourcePlatform: request.sourcePlatform,
    sourceProductId: request.sourceProductId,
    sourceCaptureSnapshotId: request.sourceCaptureSnapshotId,
    supplyGoodsId: request.supplyGoodsId,
    shopId: request.shopId,
    workflowId: request.workflowId,
    draftRevision: request.draftRevision,
    draftVersion: request.draftVersion,
  };
}

function launchContext(
  request: ExtensionByokWorkbenchLaunchRequest,
  skuKey: string,
  assignmentOrdinal: number,
): ExtensionByokWorkbenchLaunchContext {
  return {
    contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
    ...launchBinding(request),
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentMode: 'APPEND',
    assignmentOrdinal,
  };
}

export function resolveExtensionByokWorkbenchBoundSlotCandidate(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequestV3;
  draft: ExtensionByokWorkbenchDraft;
}): ExtensionByokWorkbenchBoundSlotCandidate | null {
  const { request } = input;
  const authority = resolveDraftMediaAuthority(input);
  const skuKey = request.preferredSkuKey;
  if (!skuKey || !authority.skuKeys.includes(skuKey)) return null;
  const slotKey = `sku:${skuKey}:hero`;
  if (slotKey.length > 200) return null;
  const assignmentOrdinal = authority.assignments.findIndex((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const assignment = value as Record<string, unknown>;
    return assignment.scope === 'SKU'
      && assignment.skuKey === skuKey
      && assignment.slotKey === slotKey
      && assignment.source === 'GENERATED';
  });
  if (assignmentOrdinal < 0) return null;
  const assignment = authority.assignments[assignmentOrdinal] as Record<string, unknown>;
  const assetId = canonicalIdentifier(assignment.assetId, 500);
  if (!assetId) return null;
  return {
    skuKey,
    slotKey,
    assignmentOrdinal,
    assetId,
    source: 'GENERATED',
  };
}

export function resolveExtensionByokWorkbenchBoundSlotLaunchDecision(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequestV3;
  draft: ExtensionByokWorkbenchDraft;
  authorizedCandidate: ExtensionByokWorkbenchBoundSlotCandidate;
}): Extract<ExtensionByokWorkbenchLaunchDecision, { state: 'REVIEW_PUBLISH_ONLY' }> {
  const current = resolveExtensionByokWorkbenchBoundSlotCandidate(input);
  const authorized = input.authorizedCandidate;
  if (!current
    || current.skuKey !== authorized?.skuKey
    || current.slotKey !== authorized?.slotKey
    || current.assignmentOrdinal !== authorized?.assignmentOrdinal
    || current.assetId !== authorized?.assetId
    || current.source !== authorized?.source) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'The authorized generated SKU hero is no longer bound to the current draft',
    );
  }
  return {
    contractVersion: EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_DECISION_VERSION,
    state: 'REVIEW_PUBLISH_ONLY',
    context: {
      contractVersion: EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_CONTEXT_VERSION,
      launchMode: 'REVIEW_PUBLISH_ONLY',
      ...launchBinding(input.request),
      skuKey: current.skuKey,
      slotKey: current.slotKey,
      assignmentOrdinal: current.assignmentOrdinal,
      assetId: current.assetId,
      source: current.source,
    },
  };
}

export function resolveExtensionByokWorkbenchSlotTarget(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequest;
  draft: ExtensionByokWorkbenchDraft;
  target: ExtensionByokWorkbenchSlotTarget;
}): ExtensionByokWorkbenchSlotTarget {
  const authority = resolveDraftMediaAuthority(input);
  const skuKey = canonicalIdentifier(input.target?.skuKey, 500);
  const slotKey = canonicalIdentifier(input.target?.slotKey, 200);
  if (!skuKey
    || !slotKey
    || input.target?.assignmentMode !== 'APPEND'
    || !Number.isSafeInteger(input.target?.assignmentOrdinal)
    || input.target.assignmentOrdinal !== authority.assignments.length) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE',
      409,
      'BYOK workbench slot target changed',
    );
  }
  const isSkuHero = authority.skuKeys.includes(skuKey)
    && slotKey === `sku:${skuKey}:hero`;
  const isSharedDetail = authority.skuKeys.includes(skuKey)
    && SHARED_DETAIL_ROLES.some((role) => slotKey === `shared:detail:${role}`);
  if (!isSkuHero && !isSharedDetail) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_CONTEXT_STALE',
      409,
      'BYOK workbench slot target is outside the current listing authority',
    );
  }
  if (authority.occupiedSlots.has(slotKey)) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'The exact BYOK workbench slot is no longer empty',
    );
  }
  return {
    skuKey,
    slotKey,
    assignmentMode: 'APPEND',
    assignmentOrdinal: input.target.assignmentOrdinal,
  };
}

export function resolveExtensionByokWorkbenchLaunchContext(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequestV1;
  draft: ExtensionByokWorkbenchDraft;
}): ExtensionByokWorkbenchLaunchContext {
  const { request } = input;
  const authority = resolveDraftMediaAuthority(input);
  const candidates = emptySkuHeroKeys(authority);
  if (authority.skuKeys.length !== 1 || candidates.length !== 1) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      authority.skuKeys.length !== 1
        ? 'An explicit SKU choice is required'
        : candidates.length === 0
        ? 'No empty SKU hero slot is available'
        : 'An explicit SKU choice is required',
    );
  }
  return launchContext(request, candidates[0]!, authority.assignments.length);
}

export function resolveExtensionByokWorkbenchLaunchDecision(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequestWithSelection;
  draft: ExtensionByokWorkbenchDraft;
}): ExtensionByokWorkbenchLaunchDecision {
  const { request } = input;
  const authority = resolveDraftMediaAuthority(input);
  const candidates = emptySkuHeroKeys(authority);
  if (request.preferredSkuKey !== null) {
    if (authority.skuKeys.includes(request.preferredSkuKey)
      && candidates.includes(request.preferredSkuKey)) {
      return {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
        state: 'READY',
        context: launchContext(request, request.preferredSkuKey, authority.assignments.length),
      };
    }
    if (request.selectionKind === 'EXPLICIT') {
      return fail(
        'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
        409,
        'The preferred SKU hero is not available',
      );
    }
  } else if (request.selectionKind === 'EXPLICIT') {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_REQUEST_INVALID',
      400,
      'An explicit SKU selection is required',
    );
  }
  if (candidates.length === 0) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'No empty SKU hero slot is available',
    );
  }
  if (candidates.length === 1 && request.preferredSkuKey === null) {
    return {
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
      state: 'READY',
      context: launchContext(request, candidates[0]!, authority.assignments.length),
    };
  }
  return {
    contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
    state: 'CHOICE_REQUIRED',
    binding: launchBinding(request),
    skuKeys: candidates,
  };
}

export function resolveExtensionByokWorkbenchBatchLaunchContext(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequest;
  draft: ExtensionByokWorkbenchDraft;
}): ExtensionByokWorkbenchBatchLaunchContext {
  const { request } = input;
  const authority = resolveDraftMediaAuthority(input);
  if (request.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION
    && authority.skuKeys.length !== 1) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'An explicit batch anchor SKU is required',
    );
  }
  const candidates = emptySkuHeroKeys(authority);
  const anchorSkuKey = request.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2
    ? request.preferredSkuKey
    : authority.skuKeys[0]!;
  if (request.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2
    && (request.selectionKind !== 'EXPLICIT'
      || !anchorSkuKey
      || !authority.skuKeys.includes(anchorSkuKey)
      || !candidates.includes(anchorSkuKey))) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'An exact empty batch anchor SKU is required',
    );
  }
  const orderedSkuKeys = request.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2
    ? [anchorSkuKey!, ...authority.skuKeys.filter((skuKey) => skuKey !== anchorSkuKey)]
    : authority.skuKeys;
  const targets = [
    ...orderedSkuKeys.map((skuKey) => ({ skuKey, slotKey: `sku:${skuKey}:hero` })),
    ...SHARED_DETAIL_ROLES.map((role) => ({
      skuKey: anchorSkuKey!,
      slotKey: `shared:detail:${role}`,
    })),
  ].filter((target) => target.slotKey.length <= 200
    && !authority.occupiedSlots.has(target.slotKey))
    .slice(0, MAX_ASSIGNMENTS - authority.assignments.length);
  if (targets.length === 0) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'No empty BYOK batch slot is available',
    );
  }
  return {
    contractVersion: EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION,
    sourcePlatform: request.sourcePlatform,
    sourceProductId: request.sourceProductId,
    sourceCaptureSnapshotId: request.sourceCaptureSnapshotId,
    supplyGoodsId: request.supplyGoodsId,
    shopId: request.shopId,
    workflowId: request.workflowId,
    draftRevision: request.draftRevision,
    draftVersion: request.draftVersion,
    anchorSkuKey: anchorSkuKey!,
    firstAssignmentOrdinal: authority.assignments.length,
    targets,
  };
}

export function sameExtensionByokWorkbenchLaunchContext(
  expected: ExtensionByokWorkbenchLaunchContext,
  candidate: Pick<ExtensionByokWorkbenchLaunchContext,
    | 'sourcePlatform' | 'sourceProductId' | 'sourceCaptureSnapshotId' | 'supplyGoodsId'
    | 'shopId' | 'workflowId' | 'draftRevision' | 'draftVersion' | 'skuKey' | 'slotKey'
    | 'assignmentMode' | 'assignmentOrdinal'>,
): boolean {
  return [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal',
  ].every((key) => (
    expected[key as keyof ExtensionByokWorkbenchLaunchContext]
      === candidate[key as keyof typeof candidate]
  ));
}
