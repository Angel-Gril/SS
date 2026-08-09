import { createHash } from 'node:crypto';
import type {
  OzonListingDraft,
  OzonListingDraftMediaAssignment,
  OzonListingPublishIntent,
} from 'shared';
import { z } from 'zod';
import type {
  ExtensionByokListingPublishStatusResult as RepositoryPublishStatusResult,
} from '../repositories/extension-byok-publish-status-repository.js';
import { hashExtensionCommandRequest } from './extension-command-grants.js';
import type {
  ExtensionByokPublishAuthorizationDecision,
  ExtensionByokPublishAuthorizationInput,
} from './extension-byok-publish-authorization.js';

export const EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION =
  'extension-workbench-listing-publish/v1' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MEDIA_SOURCES = [
  'SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED',
] as const;

const identifier = (maximum = 200) => z.string().min(1).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => ![...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  }));
const sha256 = z.string().regex(SHA256_PATTERN);

const selectedMediaSchema = z.object({
  scope: z.enum(['PRODUCT', 'SKU']),
  skuKey: identifier(500).nullable(),
  slotKey: identifier(),
  assetId: identifier(500),
}).strict().superRefine((input, context) => {
  if ((input.scope === 'PRODUCT' && input.skuKey !== null)
    || (input.scope === 'SKU' && input.skuKey === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['skuKey'],
      message: 'SKU identity does not match media scope',
    });
  }
});

const publishBasisShape = {
  contractVersion: z.literal(EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION),
  executionMode: z.enum(['ERP_HOSTED', 'BYOK']),
  shopId: identifier(),
  workflowId: identifier(),
  basisDraftRevision: z.number().int().positive(),
  basisDraftVersion: z.number().int().positive(),
  selectedMedia: z.array(selectedMediaSchema).min(1).max(500)
    .superRefine((rows, context) => {
      const slots = new Set<string>();
      const assets = new Set<string>();
      rows.forEach((row, index) => {
        if (slots.has(row.slotKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'slotKey'],
            message: 'Selected media slots must be unique',
          });
        }
        if (assets.has(row.assetId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'assetId'],
            message: 'Selected media assets must be unique',
          });
        }
        slots.add(row.slotKey);
        assets.add(row.assetId);
      });
    }),
};

const previewInputSchema = z.object(publishBasisShape).strict();
const prepareInputSchema = z.object({
  ...publishBasisShape,
  previewHash: sha256,
  idempotencyKey: identifier().refine((value) => value.length >= 16),
}).strict();

const publishCommandSchema = z.object({
  schemaVersion: z.literal('ozon-publish-command/v1'),
  draftRevision: z.number().int().positive(),
  publishIntentId: identifier(),
  selectedSkuKeys: z.array(identifier(500)).min(1).max(500)
    .refine((values) => new Set(values).size === values.length),
}).strict();

const publishEnvelopeSchema = z.object({
  operation: z.literal('OZON_PUBLISH'),
  shopId: identifier(),
  workflowId: identifier(),
  draftVersion: z.number().int().positive(),
  idempotencyKey: identifier().refine((value) => value.length >= 16),
  command: publishCommandSchema,
}).strict();

const statusInputSchema = z.object({
  contractVersion: z.literal(EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION),
  previewHash: sha256,
  requestHash: sha256,
  envelope: publishEnvelopeSchema,
}).strict();

export type ExtensionWorkbenchListingPublishBasis = z.infer<typeof previewInputSchema>;
export type ExtensionWorkbenchListingPublishSelectedMedia = z.infer<typeof selectedMediaSchema>;
export type ExtensionWorkbenchListingPublishEnvelope = z.infer<typeof publishEnvelopeSchema>;
export type ExtensionWorkbenchListingPublishStatusResult = RepositoryPublishStatusResult;

export interface ExtensionWorkbenchListingPublishActor {
  sessionId: string;
  ownerUserId: string;
  actorUserId: string;
}

export interface ExtensionWorkbenchListingPublishOrderedMedia {
  ordinal: number;
  scope: 'PRODUCT' | 'SKU';
  skuKey: string | null;
  slotKey: string;
  assetId: string;
  source: OzonListingDraftMediaAssignment['source'];
}

export interface ExtensionWorkbenchListingPublishPreview
  extends ExtensionWorkbenchListingPublishBasis {
  currentDraftRevision: number;
  currentDraftVersion: number;
  previewHash: string;
  selectedSkuKeys: string[];
  orderedMedia: ExtensionWorkbenchListingPublishOrderedMedia[];
}

export interface ExtensionWorkbenchListingPublishPrepared {
  contractVersion: typeof EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION;
  previewHash: string;
  requestHash: string;
  replayed: boolean;
  envelope: ExtensionWorkbenchListingPublishEnvelope;
}

export interface ExtensionWorkbenchListingPublishStatusProjection {
  contractVersion: typeof EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION;
  state: 'NOT_COMMITTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
  receiptId: string | null;
  failureCode: string | null;
}

export class ExtensionWorkbenchListingPublishError extends Error {
  constructor(
    public readonly code:
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_INVALID'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_OWNER_REQUIRED'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_NOT_FOUND'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_STALE'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_NOT_READY'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_MEDIA_CONFLICT'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_PREVIEW_CONFLICT'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_INTENT_CONFLICT'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_STATUS_CONFLICT'
      | 'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExtensionWorkbenchListingPublishError';
  }
}

function fail(
  code: ExtensionWorkbenchListingPublishError['code'],
  statusCode: number,
  message: string,
): never {
  throw new ExtensionWorkbenchListingPublishError(code, message, statusCode);
}

function exactActor(
  actor: ExtensionWorkbenchListingPublishActor,
): ExtensionWorkbenchListingPublishActor {
  const parsed = z.object({
    sessionId: identifier(),
    ownerUserId: identifier(),
    actorUserId: identifier(),
  }).strict().safeParse(actor);
  if (!parsed.success) {
    return fail('EXTENSION_WORKBENCH_LISTING_PUBLISH_INVALID', 400, 'Publish actor is invalid');
  }
  if (parsed.data.actorUserId !== parsed.data.ownerUserId) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_OWNER_REQUIRED',
      403,
      'Only the listing owner may publish workbench media',
    );
  }
  return parsed.data;
}

function parsePreviewInput(input: unknown): ExtensionWorkbenchListingPublishBasis {
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_INVALID',
      400,
      'Workbench publish preview input is invalid',
    );
  }
  return parsed.data;
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedSelectedSkuKeys(draft: OzonListingDraft): string[] {
  if (!Array.isArray(draft.selectedSkuKeys)
    || draft.selectedSkuKeys.length < 1
    || draft.selectedSkuKeys.length > 500) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is invalid',
    );
  }
  const parsed = draft.selectedSkuKeys.map((value) => identifier(500).safeParse(value));
  if (parsed.some((result) => !result.success)) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is invalid',
    );
  }
  const values = parsed.map((result) => (result as { success: true; data: string }).data);
  if (new Set(values).size !== values.length) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is ambiguous',
    );
  }
  return values;
}

function orderedMedia(
  draft: OzonListingDraft,
  selectedSkuKeys: readonly string[],
): ExtensionWorkbenchListingPublishOrderedMedia[] {
  const assignments = draft.media?.assignments;
  if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > 500) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_NOT_READY',
      409,
      'Listing draft has no publishable media',
    );
  }
  const selected = new Set(selectedSkuKeys);
  const slots = new Set<string>();
  const assets = new Set<string>();
  return assignments.map((assignment, ordinal) => {
    const slot = identifier().safeParse(assignment?.slotKey);
    const asset = identifier(500).safeParse(assignment?.assetId);
    const source = z.enum(MEDIA_SOURCES).safeParse(assignment?.source);
    if (!slot.success || !asset.success || !source.success
      || slots.has(slot.data) || assets.has(asset.data)) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
        503,
        'Listing draft media order is invalid',
      );
    }
    slots.add(slot.data);
    assets.add(asset.data);
    if (assignment.scope === 'PRODUCT') {
      if (assignment.skuKey !== undefined) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
          503,
          'Product media contains an unexpected SKU identity',
        );
      }
      return {
        ordinal,
        scope: 'PRODUCT' as const,
        skuKey: null,
        slotKey: slot.data,
        assetId: asset.data,
        source: source.data,
      };
    }
    const sku = identifier(500).safeParse(assignment.skuKey);
    if (assignment.scope !== 'SKU' || !sku.success || !selected.has(sku.data)) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
        503,
        'SKU media does not belong to the selected SKU set',
      );
    }
    return {
      ordinal,
      scope: 'SKU' as const,
      skuKey: sku.data,
      slotKey: slot.data,
      assetId: asset.data,
      source: source.data,
    };
  });
}

function isCurrentFreshness(draft: OzonListingDraft): boolean {
  return Boolean(draft.freshness)
    && Object.values(draft.freshness).length === 6
    && Object.values(draft.freshness).every((value) => value?.state === 'CURRENT');
}

function validateReadyState(
  draft: OzonListingDraft,
  phase: 'preview' | 'prepare',
): number {
  if (draft.revision < 1 || draft.draftVersion < 1) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft identity is invalid',
    );
  }
  if (draft.runState !== 'ACTIVE'
    || draft.validation?.status !== 'VALID'
    || !Array.isArray(draft.blockers)
    || draft.blockers.length !== 0
    || !isCurrentFreshness(draft)) {
    return fail(
      'EXTENSION_WORKBENCH_LISTING_PUBLISH_NOT_READY',
      409,
      'Listing draft is not ready to publish',
    );
  }
  if (draft.stage === 'READY_TO_PUBLISH') return draft.revision;
  if (phase === 'prepare'
    && draft.stage === 'PUBLISH_INTENT_RECORDED'
    && draft.revision > 1) return draft.revision - 1;
  return fail(
    'EXTENSION_WORKBENCH_LISTING_PUBLISH_STALE',
    409,
    'Listing draft changed before publish confirmation',
  );
}

function sameSelectedMedia(
  left: readonly ExtensionWorkbenchListingPublishSelectedMedia[],
  right: readonly ExtensionWorkbenchListingPublishSelectedMedia[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return Boolean(other)
      && item.scope === other!.scope
      && item.skuKey === other!.skuKey
      && item.slotKey === other!.slotKey
      && item.assetId === other!.assetId;
  });
}

function selectedMediaFromDraft(
  media: readonly ExtensionWorkbenchListingPublishOrderedMedia[],
  selection: readonly ExtensionWorkbenchListingPublishSelectedMedia[],
): ExtensionWorkbenchListingPublishSelectedMedia[] {
  const slots = new Set(selection.map((item) => item.slotKey));
  return media.filter((item) => slots.has(item.slotKey)).map((item) => ({
    scope: item.scope,
    skuKey: item.skuKey,
    slotKey: item.slotKey,
    assetId: item.assetId,
  }));
}

function previewHash(
  input: Omit<ExtensionWorkbenchListingPublishPreview, 'previewHash'>,
): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function commandRequestHash(envelope: ExtensionWorkbenchListingPublishEnvelope): string {
  return hashExtensionCommandRequest({
    operation: envelope.operation,
    shopId: envelope.shopId,
    workflowId: envelope.workflowId,
    draftVersion: envelope.draftVersion,
    command: envelope.command,
  });
}

function validPublishDecision(
  decision: ExtensionByokPublishAuthorizationDecision,
  assetIds: readonly string[],
): boolean {
  const selected = new Set(assetIds);
  return Boolean(decision)
    && Array.isArray(decision.byokAssetIds)
    && new Set(decision.byokAssetIds).size === decision.byokAssetIds.length
    && decision.byokAssetIds.every((value) => (
      identifier(500).safeParse(value).success && selected.has(value)
    ))
    && (decision.policyRevision === null
      || (Number.isSafeInteger(decision.policyRevision) && decision.policyRevision! >= 0));
}

function sameOrderedMedia(
  left: readonly ExtensionWorkbenchListingPublishOrderedMedia[],
  right: readonly ExtensionWorkbenchListingPublishOrderedMedia[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return Boolean(other)
      && item.ordinal === other!.ordinal
      && item.scope === other!.scope
      && item.skuKey === other!.skuKey
      && item.slotKey === other!.slotKey
      && item.assetId === other!.assetId
      && item.source === other!.source;
  });
}

export function createExtensionWorkbenchListingPublishService(options: {
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<OzonListingDraft | null>;
  authorizePublish(
    input: ExtensionByokPublishAuthorizationInput,
  ): Promise<ExtensionByokPublishAuthorizationDecision>;
  preflightPublishAuthority(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<void>;
  recordPublishIntent(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<{ draft: OzonListingDraft; intent: OzonListingPublishIntent; idempotent: boolean }>;
  findPublishStatus(input: {
    sessionId: string;
    ownerUserId: string;
    shopId: string;
    workflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ExtensionWorkbenchListingPublishStatusResult>;
  linkPublishedByokAssets(input: {
    ownerUserId: string;
    workflowId: string;
    assetIds: string[];
    publishIntentId: string;
    publishReceiptId: string;
  }): Promise<unknown>;
}) {
  async function verifyContext(
    basis: ExtensionWorkbenchListingPublishBasis,
    actor: ExtensionWorkbenchListingPublishActor,
    phase: 'preview' | 'prepare',
  ) {
    const draft = await options.loadDraft({
      workflowId: basis.workflowId,
      ownerUserId: actor.ownerUserId,
    });
    if (!draft || draft.id !== basis.workflowId || draft.ownerUserId !== actor.ownerUserId) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_NOT_FOUND',
        404,
        'Listing draft was not found',
      );
    }
    if (draft.shopId !== basis.shopId
      || draft.revision < basis.basisDraftRevision
      || draft.draftVersion < basis.basisDraftVersion) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_STALE',
        409,
        'Listing draft is older than the workbench publish basis',
      );
    }
    const previewDraftRevision = validateReadyState(draft, phase);
    const selectedSkuKeys = normalizedSelectedSkuKeys(draft);
    const media = orderedMedia(draft, selectedSkuKeys);
    const authoritativeSelection = selectedMediaFromDraft(media, basis.selectedMedia);
    if (!sameSelectedMedia(authoritativeSelection, basis.selectedMedia)) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_MEDIA_CONFLICT',
        409,
        'Selected workbench media is not bound in the current draft order',
      );
    }
    const decision = await options.authorizePublish({
      ownerUserId: actor.ownerUserId,
      shopId: basis.shopId,
      workflowId: basis.workflowId,
      assignments: draft.media.assignments,
      requestingDeviceSessionId: actor.sessionId,
    });
    if (!validPublishDecision(decision, media.map((item) => item.assetId))) {
      return fail(
        'EXTENSION_WORKBENCH_LISTING_PUBLISH_DEPENDENCY_INVALID',
        503,
        'Workbench publish authorization returned an invalid decision',
      );
    }
    return { draft, previewDraftRevision, selectedSkuKeys, orderedMedia: media };
  }

  function publicPreview(
    basis: ExtensionWorkbenchListingPublishBasis,
    context: Awaited<ReturnType<typeof verifyContext>>,
  ): ExtensionWorkbenchListingPublishPreview {
    const content = {
      ...basis,
      currentDraftRevision: context.previewDraftRevision,
      currentDraftVersion: context.draft.draftVersion,
      selectedSkuKeys: context.selectedSkuKeys,
      orderedMedia: context.orderedMedia,
    };
    return { ...content, previewHash: previewHash(content) };
  }

  return {
    async preview(
      input: unknown,
      rawActor: ExtensionWorkbenchListingPublishActor,
    ): Promise<ExtensionWorkbenchListingPublishPreview> {
      const actor = exactActor(rawActor);
      const basis = parsePreviewInput(input);
      const context = await verifyContext(basis, actor, 'preview');
      return publicPreview(basis, context);
    },

    async prepare(
      input: unknown,
      rawActor: ExtensionWorkbenchListingPublishActor,
    ): Promise<ExtensionWorkbenchListingPublishPrepared> {
      const actor = exactActor(rawActor);
      const parsed = prepareInputSchema.safeParse(input);
      if (!parsed.success) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_INVALID',
          400,
          'Workbench publish confirmation input is invalid',
        );
      }
      const { previewHash: confirmedHash, idempotencyKey, ...basis } = parsed.data;
      const context = await verifyContext(basis, actor, 'prepare');
      const preview = publicPreview(basis, context);
      if (preview.previewHash !== confirmedHash) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_PREVIEW_CONFLICT',
          409,
          'Workbench publish preview changed before confirmation',
        );
      }
      if (context.draft.stage === 'READY_TO_PUBLISH') {
        await options.preflightPublishAuthority({
          ownerUserId: actor.ownerUserId,
          draft: context.draft,
        });
      }
      const recorded = await options.recordPublishIntent({
        draftId: basis.workflowId,
        ownerUserId: actor.ownerUserId,
        actorUserId: actor.actorUserId,
        expectedRevision: context.previewDraftRevision,
        idempotencyKey,
      });
      const intent = recorded?.intent;
      const frozenDraft = recorded?.draft;
      if (!intent || !frozenDraft
        || typeof recorded.idempotent !== 'boolean'
        || intent.id !== String(intent.id || '').normalize('NFKC').trim()
        || !intent.id
        || intent.draftId !== basis.workflowId
        || intent.ownerUserId !== actor.ownerUserId
        || intent.actorUserId !== actor.ownerUserId
        || intent.shopId !== basis.shopId
        || intent.draftVersion !== context.draft.draftVersion
        || intent.revision !== context.previewDraftRevision + 1
        || intent.idempotencyKey !== idempotencyKey
        || !SHA256_PATTERN.test(intent.payloadHash)
        || frozenDraft.id !== basis.workflowId
        || frozenDraft.ownerUserId !== actor.ownerUserId
        || frozenDraft.shopId !== basis.shopId
        || frozenDraft.draftVersion !== context.draft.draftVersion
        || frozenDraft.revision !== intent.revision
        || frozenDraft.stage !== 'PUBLISH_INTENT_RECORDED'
        || !Array.isArray(frozenDraft.publishTaskIds)
        || !frozenDraft.publishTaskIds.includes(intent.id)) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_INTENT_CONFLICT',
          409,
          'Publish intent does not match the confirmed workbench preview',
        );
      }
      const frozenSkuKeys = normalizedSelectedSkuKeys(frozenDraft);
      const frozenMedia = orderedMedia(frozenDraft, frozenSkuKeys);
      if (!sameArray(frozenSkuKeys, context.selectedSkuKeys)
        || !sameOrderedMedia(frozenMedia, context.orderedMedia)) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_INTENT_CONFLICT',
          409,
          'Publish intent changed the confirmed listing content',
        );
      }
      const envelope: ExtensionWorkbenchListingPublishEnvelope = {
        operation: 'OZON_PUBLISH',
        shopId: basis.shopId,
        workflowId: basis.workflowId,
        draftVersion: context.draft.draftVersion,
        idempotencyKey,
        command: {
          schemaVersion: 'ozon-publish-command/v1',
          draftRevision: intent.revision,
          publishIntentId: intent.id,
          selectedSkuKeys: frozenSkuKeys,
        },
      };
      return {
        contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
        previewHash: confirmedHash,
        requestHash: commandRequestHash(envelope),
        replayed: recorded.idempotent,
        envelope,
      };
    },

    async status(
      input: unknown,
      rawActor: ExtensionWorkbenchListingPublishActor,
    ): Promise<ExtensionWorkbenchListingPublishStatusProjection> {
      const actor = exactActor(rawActor);
      const parsed = statusInputSchema.safeParse(input);
      if (!parsed.success) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_INVALID',
          400,
          'Workbench publish status input is invalid',
        );
      }
      const envelope = parsed.data.envelope;
      const draft = await options.loadDraft({
        workflowId: envelope.workflowId,
        ownerUserId: actor.ownerUserId,
      });
      if (!draft
        || draft.id !== envelope.workflowId
        || draft.ownerUserId !== actor.ownerUserId
        || draft.shopId !== envelope.shopId
        || draft.draftVersion !== envelope.draftVersion
        || !Array.isArray(draft.publishTaskIds)
        || !draft.publishTaskIds.includes(envelope.command.publishIntentId)
        || !sameArray(draft.selectedSkuKeys, envelope.command.selectedSkuKeys)
        || commandRequestHash(envelope) !== parsed.data.requestHash) {
        return fail(
          'EXTENSION_WORKBENCH_LISTING_PUBLISH_STATUS_CONFLICT',
          409,
          'Publish status identity does not match the workbench draft',
        );
      }
      const result = await options.findPublishStatus({
        sessionId: actor.sessionId,
        ownerUserId: actor.ownerUserId,
        shopId: envelope.shopId,
        workflowId: envelope.workflowId,
        draftVersion: envelope.draftVersion,
        idempotencyKey: envelope.idempotencyKey,
        requestHash: parsed.data.requestHash,
      });
      if (result.kind !== 'not_committed') {
        await options.linkPublishedByokAssets({
          ownerUserId: actor.ownerUserId,
          workflowId: envelope.workflowId,
          assetIds: draft.media.assignments.map((assignment) => assignment.assetId),
          publishIntentId: envelope.command.publishIntentId,
          publishReceiptId: result.receiptId,
        });
      }
      return {
        contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
        state: result.kind.toUpperCase() as ExtensionWorkbenchListingPublishStatusProjection['state'],
        receiptId: result.kind === 'not_committed' ? null : result.receiptId,
        failureCode: result.kind === 'failed' ? result.failureCode : null,
      };
    },
  };
}

export type ExtensionWorkbenchListingPublishService = ReturnType<
  typeof createExtensionWorkbenchListingPublishService
>;
