import { createHash } from 'node:crypto';
import type {
  OzonListingDraft,
  OzonListingDraftVideoBinding,
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
import {
  ExtensionWorkbenchByokPublishProvenanceError,
  type ExtensionWorkbenchByokPublishProvenanceLinkInput,
} from './extension-workbench-byok-publish-provenance.js';

export const EXTENSION_BYOK_LISTING_PUBLISH_VERSION =
  'extension-byok-listing-publish/v1' as const;

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

const bindingShape = {
  contractVersion: z.literal(EXTENSION_BYOK_LISTING_PUBLISH_VERSION),
  shopId: identifier(),
  workflowId: identifier(),
  sourceDraftRevision: z.number().int().positive(),
  sourceDraftVersion: z.number().int().positive(),
  boundDraftRevision: z.number().int().positive(),
  boundDraftVersion: z.number().int().positive(),
  assetId: identifier(500),
  provenanceId: identifier(),
  normalizedSha256: sha256,
  skuKey: identifier(500),
  slotKey: identifier(),
  assignmentOrdinal: z.number().int().min(0).max(499),
  assignmentSha256: sha256,
};

function refineBinding(input: z.infer<z.ZodObject<typeof bindingShape>>, context: z.RefinementCtx) {
  if (input.boundDraftRevision !== input.sourceDraftRevision + 1
    || input.boundDraftVersion !== input.sourceDraftVersion + 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['boundDraftRevision'],
      message: 'bound draft must be the immediate ingest successor',
    });
  }
  if (!input.slotKey.startsWith(`sku:${input.skuKey}:`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slotKey'],
      message: 'slotKey must belong to the selected SKU',
    });
  }
}

const previewInputSchema = z.object(bindingShape).strict().superRefine(refineBinding);
const prepareInputSchema = z.object({
  ...bindingShape,
  previewHash: sha256,
  idempotencyKey: identifier().refine((value) => value.length >= 16),
}).strict().superRefine(refineBinding);

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
  contractVersion: z.literal(EXTENSION_BYOK_LISTING_PUBLISH_VERSION),
  previewHash: sha256,
  requestHash: sha256,
  provenanceId: identifier(),
  envelope: publishEnvelopeSchema,
}).strict();

export type ExtensionByokListingPublishBinding = z.infer<typeof previewInputSchema>;
export type ExtensionByokListingPublishEnvelope = z.infer<typeof publishEnvelopeSchema>;
export type ExtensionByokListingPublishStatusResult = RepositoryPublishStatusResult;

export interface ExtensionByokAcceptedPublishProvenance {
  id: string;
  executionMode: string;
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assignmentSha256: string;
  assetId: string;
  normalizedSha256: string;
  publishIntentId: string | null;
  publishReceiptId: string | null;
  erpAiChargeCents: number;
}

export interface ExtensionByokListingPublishActor {
  sessionId: string;
  ownerUserId: string;
  actorUserId: string;
}

export interface ExtensionByokListingPublishOrderedMedia {
  ordinal: number;
  scope: 'PRODUCT' | 'SKU';
  skuKey: string | null;
  slotKey: string;
  assetId: string;
  source: OzonListingDraftMediaAssignment['source'];
}

export interface ExtensionByokListingPublishPreview
  extends ExtensionByokListingPublishBinding {
  previewHash: string;
  selectedSkuKeys: string[];
  orderedMedia: ExtensionByokListingPublishOrderedMedia[];
  videoBindings: OzonListingDraftVideoBinding[];
}

export interface ExtensionByokListingPublishPrepared {
  contractVersion: typeof EXTENSION_BYOK_LISTING_PUBLISH_VERSION;
  previewHash: string;
  requestHash: string;
  replayed: boolean;
  envelope: ExtensionByokListingPublishEnvelope;
}

export interface ExtensionByokListingPublishStatusProjection {
  contractVersion: typeof EXTENSION_BYOK_LISTING_PUBLISH_VERSION;
  state: 'NOT_COMMITTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
  receiptId: string | null;
  failureCode: string | null;
}

export class ExtensionByokListingPublishError extends Error {
  constructor(
    public readonly code:
      | 'EXTENSION_BYOK_LISTING_PUBLISH_INVALID'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_OWNER_REQUIRED'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_NOT_FOUND'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_STALE'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_NOT_READY'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_PROVENANCE_CONFLICT'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_PREVIEW_CONFLICT'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_INTENT_CONFLICT'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_STATUS_CONFLICT'
      | 'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExtensionByokListingPublishError';
  }
}

function fail(
  code: ExtensionByokListingPublishError['code'],
  statusCode: number,
  message: string,
): never {
  throw new ExtensionByokListingPublishError(code, message, statusCode);
}

function parsePreviewInput(input: unknown): ExtensionByokListingPublishBinding {
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('EXTENSION_BYOK_LISTING_PUBLISH_INVALID', 400, 'Publish preview input is invalid');
  }
  return parsed.data;
}

function exactActor(actor: ExtensionByokListingPublishActor): ExtensionByokListingPublishActor {
  const parsed = z.object({
    sessionId: identifier(),
    ownerUserId: identifier(),
    actorUserId: identifier(),
  }).strict().safeParse(actor);
  if (!parsed.success) {
    return fail('EXTENSION_BYOK_LISTING_PUBLISH_INVALID', 400, 'Publish actor is invalid');
  }
  if (parsed.data.actorUserId !== parsed.data.ownerUserId) {
    return fail(
      'EXTENSION_BYOK_LISTING_PUBLISH_OWNER_REQUIRED',
      403,
      'Only the listing owner may publish accepted BYOK media',
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
      'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is invalid',
    );
  }
  const parsed = draft.selectedSkuKeys.map((value) => identifier(500).safeParse(value));
  if (parsed.some((result) => !result.success)) {
    return fail(
      'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is invalid',
    );
  }
  const values = parsed.map((result) => (result as { success: true; data: string }).data);
  if (new Set(values).size !== values.length) {
    return fail(
      'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
      503,
      'Listing draft SKU selection is ambiguous',
    );
  }
  return values;
}

function orderedMedia(
  draft: OzonListingDraft,
  selectedSkuKeys: readonly string[],
): ExtensionByokListingPublishOrderedMedia[] {
  const assignments = draft.media?.assignments;
  if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > 500) {
    return fail(
      'EXTENSION_BYOK_LISTING_PUBLISH_NOT_READY',
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
        'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
        503,
        'Listing draft media order is invalid',
      );
    }
    slots.add(slot.data);
    assets.add(asset.data);
    if (assignment.scope === 'PRODUCT') {
      if (assignment.skuKey !== undefined) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
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
        'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
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

function exactBindingFromProvenance(
  provenance: ExtensionByokAcceptedPublishProvenance,
): ExtensionByokListingPublishBinding {
  return parsePreviewInput({
    contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
    shopId: provenance.shopId,
    workflowId: provenance.workflowId,
    sourceDraftRevision: provenance.draftRevision,
    sourceDraftVersion: provenance.draftVersion,
    boundDraftRevision: provenance.boundDraftRevision,
    boundDraftVersion: provenance.boundDraftVersion,
    assetId: provenance.assetId,
    provenanceId: provenance.id,
    normalizedSha256: provenance.normalizedSha256,
    skuKey: provenance.skuKey,
    slotKey: provenance.slotKey,
    assignmentOrdinal: provenance.assignmentOrdinal,
    assignmentSha256: provenance.assignmentSha256,
  });
}

function provenanceMatchesBinding(
  provenance: ExtensionByokAcceptedPublishProvenance,
  binding: ExtensionByokListingPublishBinding,
  actor: ExtensionByokListingPublishActor,
): boolean {
  return provenance.id === binding.provenanceId
    && provenance.executionMode === 'BYOK'
    && provenance.ownerUserId === actor.ownerUserId
    && provenance.actorUserId === actor.ownerUserId
    && provenance.shopId === binding.shopId
    && provenance.workflowId === binding.workflowId
    && provenance.draftRevision === binding.sourceDraftRevision
    && provenance.draftVersion === binding.sourceDraftVersion
    && provenance.boundDraftRevision === binding.boundDraftRevision
    && provenance.boundDraftVersion === binding.boundDraftVersion
    && provenance.assetId === binding.assetId
    && provenance.normalizedSha256 === binding.normalizedSha256
    && provenance.skuKey === binding.skuKey
    && provenance.slotKey === binding.slotKey
    && provenance.assignmentOrdinal === binding.assignmentOrdinal
    && provenance.assignmentSha256 === binding.assignmentSha256
    && provenance.erpAiChargeCents === 0;
}

function isCurrentFreshness(draft: OzonListingDraft): boolean {
  return Boolean(draft.freshness)
    && Object.values(draft.freshness).length === 6
    && Object.values(draft.freshness).every((value) => value?.state === 'CURRENT');
}

function validateReadyState(draft: OzonListingDraft): void {
  if (draft.revision < 1 || draft.draftVersion < 1) {
    return fail(
      'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
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
      'EXTENSION_BYOK_LISTING_PUBLISH_NOT_READY',
      409,
      'Listing draft is not ready to publish',
    );
  }
}

function previewHash(
  input: Omit<ExtensionByokListingPublishPreview, 'previewHash'>,
  publishDraftRevision: number,
): string {
  return createHash('sha256').update(JSON.stringify({
    publishDraftRevision,
    ...input,
  })).digest('hex');
}

function commandRequestHash(envelope: ExtensionByokListingPublishEnvelope): string {
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
  assetId: string,
): boolean {
  return Boolean(decision)
    && Array.isArray(decision.byokAssetIds)
    && decision.byokAssetIds.includes(assetId)
    && decision.byokAssetIds.every((value) => identifier(500).safeParse(value).success)
    && (decision.policyRevision === null
      || (Number.isSafeInteger(decision.policyRevision) && decision.policyRevision! >= 0));
}

function sameOrderedMedia(
  left: readonly ExtensionByokListingPublishOrderedMedia[],
  right: readonly ExtensionByokListingPublishOrderedMedia[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    if (!other) return false;
    return item.ordinal === other.ordinal
      && item.scope === other.scope
      && item.skuKey === other.skuKey
      && item.slotKey === other.slotKey
      && item.assetId === other.assetId
      && item.source === other.source;
  });
}

export function createExtensionByokListingPublishService(options: {
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<OzonListingDraft | null>;
  loadAcceptedProvenance(input: {
    provenanceId: string;
    ownerUserId: string;
  }): Promise<ExtensionByokAcceptedPublishProvenance | null>;
  authorizePublish(
    input: ExtensionByokPublishAuthorizationInput,
  ): Promise<ExtensionByokPublishAuthorizationDecision>;
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
  }): Promise<ExtensionByokListingPublishStatusResult>;
  linkPublish(input: ExtensionWorkbenchByokPublishProvenanceLinkInput): Promise<unknown>;
}) {
  async function provenanceBoundary<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ExtensionWorkbenchByokPublishProvenanceError) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_PROVENANCE_CONFLICT',
          409,
          'Accepted BYOK media has an unsafe prior publish result',
        );
      }
      throw error;
    }
  }

  async function loadProvenance(
    provenanceId: string,
    actor: ExtensionByokListingPublishActor,
  ): Promise<ExtensionByokAcceptedPublishProvenance> {
    const provenance = await options.loadAcceptedProvenance({
      provenanceId,
      ownerUserId: actor.ownerUserId,
    });
    if (!provenance) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_NOT_FOUND',
        404,
        'Accepted BYOK media provenance was not found',
      );
    }
    return provenance;
  }

  async function verifyContext(
    binding: ExtensionByokListingPublishBinding,
    provenance: ExtensionByokAcceptedPublishProvenance,
    actor: ExtensionByokListingPublishActor,
    phase: 'preview' | 'prepare',
  ): Promise<{
    draft: OzonListingDraft;
    previewDraftRevision: number;
    selectedSkuKeys: string[];
    orderedMedia: ExtensionByokListingPublishOrderedMedia[];
  }> {
    if (!provenanceMatchesBinding(provenance, binding, actor)) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_PROVENANCE_CONFLICT',
        409,
        'Accepted BYOK media provenance no longer matches the listing draft',
      );
    }
    if ((phase === 'preview' || phase === 'prepare')
      && (provenance.publishIntentId !== null || provenance.publishReceiptId !== null)) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_PROVENANCE_CONFLICT',
        409,
        'Accepted BYOK media is already linked to a publish receipt',
      );
    }
    const draft = await options.loadDraft({
      workflowId: binding.workflowId,
      ownerUserId: actor.ownerUserId,
    });
    if (!draft || draft.id !== binding.workflowId || draft.ownerUserId !== actor.ownerUserId) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_NOT_FOUND',
        404,
        'Listing draft was not found',
      );
    }
    if (draft.shopId !== binding.shopId || draft.draftVersion !== binding.boundDraftVersion) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_STALE',
        409,
        'Listing draft changed after BYOK media approval',
      );
    }
    validateReadyState(draft);
    let previewDraftRevision: number;
    if (phase === 'preview') {
      if (draft.revision < binding.boundDraftRevision || draft.stage !== 'READY_TO_PUBLISH') {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_STALE',
          409,
          'Listing draft changed before publish preview',
        );
      }
      previewDraftRevision = draft.revision;
    } else {
      const isReady = draft.revision >= binding.boundDraftRevision
        && draft.stage === 'READY_TO_PUBLISH';
      const isIntentSuccessor = draft.revision > binding.boundDraftRevision
        && draft.stage === 'PUBLISH_INTENT_RECORDED';
      if (!isReady && !isIntentSuccessor) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_STALE',
          409,
          'Listing draft changed before publish confirmation',
        );
      }
      previewDraftRevision = isIntentSuccessor ? draft.revision - 1 : draft.revision;
    }

    const selectedSkuKeys = normalizedSelectedSkuKeys(draft);
    const media = orderedMedia(draft, selectedSkuKeys);
    const target = media[binding.assignmentOrdinal];
    if (!target
      || target.scope !== 'SKU'
      || target.skuKey !== binding.skuKey
      || target.slotKey !== binding.slotKey
      || target.assetId !== binding.assetId
      || target.source !== 'GENERATED') {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_STALE',
        409,
        'Accepted BYOK media is no longer bound to the exact listing slot',
      );
    }
    let decision: ExtensionByokPublishAuthorizationDecision;
    decision = await options.authorizePublish({
      ownerUserId: actor.ownerUserId,
      shopId: binding.shopId,
      workflowId: binding.workflowId,
      assignments: draft.media.assignments,
      requestingDeviceSessionId: actor.sessionId,
    });
    if (!validPublishDecision(decision, binding.assetId)) {
      return fail(
        'EXTENSION_BYOK_LISTING_PUBLISH_DEPENDENCY_INVALID',
        503,
        'BYOK publish authorization returned an invalid decision',
      );
    }
    return { draft, previewDraftRevision, selectedSkuKeys, orderedMedia: media };
  }

  function publicPreview(
    binding: ExtensionByokListingPublishBinding,
    selectedSkuKeys: string[],
    media: ExtensionByokListingPublishOrderedMedia[],
    publishDraftRevision: number,
    videoBindings: OzonListingDraftVideoBinding[],
  ): ExtensionByokListingPublishPreview {
    const content = { ...binding, selectedSkuKeys, orderedMedia: media, videoBindings: structuredClone(videoBindings) };
    return { ...content, previewHash: previewHash(content, publishDraftRevision) };
  }

  return {
    async preview(
      input: unknown,
      rawActor: ExtensionByokListingPublishActor,
    ): Promise<ExtensionByokListingPublishPreview> {
      const actor = exactActor(rawActor);
      const binding = parsePreviewInput(input);
      const provenance = await loadProvenance(binding.provenanceId, actor);
      const context = await verifyContext(binding, provenance, actor, 'preview');
      return publicPreview(
        binding,
        context.selectedSkuKeys,
        context.orderedMedia,
        context.previewDraftRevision,
        context.draft.media.videoBindings || [],
      );
    },

    async prepare(
      input: unknown,
      rawActor: ExtensionByokListingPublishActor,
    ): Promise<ExtensionByokListingPublishPrepared> {
      const actor = exactActor(rawActor);
      const parsed = prepareInputSchema.safeParse(input);
      if (!parsed.success) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_INVALID',
          400,
          'Publish confirmation input is invalid',
        );
      }
      const { previewHash: confirmedHash, idempotencyKey, ...binding } = parsed.data;
      const provenance = await loadProvenance(binding.provenanceId, actor);
      const context = await verifyContext(binding, provenance, actor, 'prepare');
      const preview = publicPreview(
        binding,
        context.selectedSkuKeys,
        context.orderedMedia,
        context.previewDraftRevision,
        context.draft.media.videoBindings || [],
      );
      if (preview.previewHash !== confirmedHash) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_PREVIEW_CONFLICT',
          409,
          'Publish preview changed before confirmation',
        );
      }
      const recorded = await options.recordPublishIntent({
        draftId: binding.workflowId,
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
        || intent.draftId !== binding.workflowId
        || intent.ownerUserId !== actor.ownerUserId
        || intent.actorUserId !== actor.ownerUserId
        || intent.shopId !== binding.shopId
        || intent.draftVersion !== binding.boundDraftVersion
        || intent.revision !== context.previewDraftRevision + 1
        || intent.idempotencyKey !== idempotencyKey
        || !SHA256_PATTERN.test(intent.payloadHash)
        || frozenDraft.id !== binding.workflowId
        || frozenDraft.ownerUserId !== actor.ownerUserId
        || frozenDraft.shopId !== binding.shopId
        || frozenDraft.draftVersion !== binding.boundDraftVersion
        || frozenDraft.revision !== intent.revision
        || frozenDraft.stage !== 'PUBLISH_INTENT_RECORDED'
        || !Array.isArray(frozenDraft.publishTaskIds)
        || !frozenDraft.publishTaskIds.includes(intent.id)) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_INTENT_CONFLICT',
          409,
          'Publish intent does not match the confirmed preview',
        );
      }
      const frozenSkuKeys = normalizedSelectedSkuKeys(frozenDraft);
      const frozenMedia = orderedMedia(frozenDraft, frozenSkuKeys);
      if (!sameArray(frozenSkuKeys, context.selectedSkuKeys)
        || !sameOrderedMedia(frozenMedia, context.orderedMedia)) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_INTENT_CONFLICT',
          409,
          'Publish intent changed the confirmed listing content',
        );
      }
      const envelope: ExtensionByokListingPublishEnvelope = {
        operation: 'OZON_PUBLISH',
        shopId: binding.shopId,
        workflowId: binding.workflowId,
        draftVersion: binding.boundDraftVersion,
        idempotencyKey,
        command: {
          schemaVersion: 'ozon-publish-command/v1',
          draftRevision: intent.revision,
          publishIntentId: intent.id,
          selectedSkuKeys: frozenSkuKeys,
        },
      };
      return {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        previewHash: confirmedHash,
        requestHash: commandRequestHash(envelope),
        replayed: recorded.idempotent,
        envelope,
      };
    },

    async status(
      input: unknown,
      rawActor: ExtensionByokListingPublishActor,
    ): Promise<ExtensionByokListingPublishStatusProjection> {
      const actor = exactActor(rawActor);
      const parsed = statusInputSchema.safeParse(input);
      if (!parsed.success) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_INVALID',
          400,
          'Publish status input is invalid',
        );
      }
      const provenance = await loadProvenance(parsed.data.provenanceId, actor);
      const binding = exactBindingFromProvenance(provenance);
      const envelope = parsed.data.envelope;
      if (!provenanceMatchesBinding(provenance, binding, actor)
        || envelope.shopId !== binding.shopId
        || envelope.workflowId !== binding.workflowId
        || envelope.draftVersion !== binding.boundDraftVersion
        || envelope.command.draftRevision <= binding.boundDraftRevision
        || !envelope.command.selectedSkuKeys.includes(binding.skuKey)
        || (provenance.publishIntentId !== null
          && provenance.publishIntentId !== envelope.command.publishIntentId)
        || commandRequestHash(envelope) !== parsed.data.requestHash) {
        return fail(
          'EXTENSION_BYOK_LISTING_PUBLISH_STATUS_CONFLICT',
          409,
          'Publish status identity does not match accepted BYOK media',
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
      if (result.kind === 'succeeded' || result.kind === 'failed') {
        await provenanceBoundary(() => options.linkPublish({
          ownerUserId: actor.ownerUserId,
          shopId: envelope.shopId,
          workflowId: envelope.workflowId,
          assetIds: [provenance.assetId],
          publishIntentId: envelope.command.publishIntentId,
          publishReceiptId: result.receiptId,
          requestHash: parsed.data.requestHash,
        }));
      }
      return {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        state: result.kind.toUpperCase() as ExtensionByokListingPublishStatusProjection['state'],
        receiptId: result.kind === 'not_committed' ? null : result.receiptId,
        failureCode: result.kind === 'failed' ? result.failureCode : null,
      };
    },
  };
}

export type ExtensionByokListingPublishService = ReturnType<
  typeof createExtensionByokListingPublishService
>;
