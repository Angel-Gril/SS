import { z } from 'zod';

export const EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION =
  'extension-byok-workbench-launch-request/v1' as const;
export const EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION =
  'extension-byok-workbench-launch-context/v1' as const;

const SOURCE_PLATFORMS = ['1688', 'pdd', 'taobao', 'tmall'] as const;
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
  .refine((value) => !/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value));

const launchRequestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION),
  sourcePlatform: z.enum(SOURCE_PLATFORMS),
  sourceProductId: identifier(200),
  sourceCaptureSnapshotId: identifier(200),
  supplyGoodsId: identifier(200),
  shopId: identifier(200),
  workflowId: identifier(200),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
}).strict();

export type ExtensionByokWorkbenchLaunchRequest = z.infer<typeof launchRequestSchema>;

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

export function resolveExtensionByokWorkbenchLaunchContext(input: {
  ownerUserId: string;
  request: ExtensionByokWorkbenchLaunchRequest;
  draft: ExtensionByokWorkbenchDraft;
}): ExtensionByokWorkbenchLaunchContext {
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
    || !draft.media || typeof draft.media !== 'object') {
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
  const skuKey = skuKeys.find((candidate): candidate is string => {
    if (!candidate) return false;
    const slotKey = `sku:${candidate}:hero`;
    return slotKey.length <= 200 && !occupiedSlots.has(slotKey);
  });
  if (!skuKey) {
    return fail(
      'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
      409,
      'No empty SKU hero slot is available for the first BYOK workbench release',
    );
  }
  return {
    contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
    sourcePlatform: request.sourcePlatform,
    sourceProductId: request.sourceProductId,
    sourceCaptureSnapshotId: request.sourceCaptureSnapshotId,
    supplyGoodsId: request.supplyGoodsId,
    shopId: request.shopId,
    workflowId: request.workflowId,
    draftRevision: request.draftRevision,
    draftVersion: request.draftVersion,
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentMode: 'APPEND',
    assignmentOrdinal: assignments.length,
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
