import type { PrismaClient } from '@prisma/client';
import { assertWanxHostedEditPrompt } from '../services/ai-image-edit-provider-contract.js';
import { getFrozenAiImageTaskPrice } from '../services/ai-image-task-cost.js';
import {
  AI_MEDIA_WORKFLOW_MODEL,
  AI_MEDIA_WORKFLOW_PROVIDER,
  aiMediaPayloadHash,
  createAiImageTranslationWorkflowFingerprint,
  createAiImageEditWorkflowFingerprint,
  createAiMediaWorkflowFingerprint,
  normalizeAiMediaProviderExecutionConfig,
  normalizeAiImageTranslationOptions,
  normalizeAiMediaWorkflowReferences,
  type AiMediaWorkflowRecord,
  type AiMediaWorkflowRepository,
  type CreateAiImageTranslationWorkflowInput,
  type CreateAiImageEditWorkflowInput,
  type CreateAiMediaWorkflowInput,
} from '../services/ai-media-workflows.js';
import {
  AI_IMAGE_EDIT_MODEL,
  AI_IMAGE_EDIT_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { isWanxHostedEdit } from '../services/ai-image-edit-provider-contract.js';
import { assertWanxImageToImageInput } from '../services/ai-image-wanx-image-to-image.js';
import {
  AI_IMAGE_EDIT_MAX_INPUT_BYTES,
  AI_IMAGE_EDIT_POLICY_VERSION,
} from '../services/ai-image-edit.js';
import {
  isAiMediaEditInputFromContext,
  isAiMediaEditReadyCandidateAsset,
  isAiMediaEditReadySourceAsset,
} from '../services/ai-image-edit-source.js';
import {
  AiMediaContextError,
  createAiMediaContextService,
  type AiMediaListingDraftContextScope,
} from '../services/ai-media-context.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  releaseAiCostInTransaction,
  reserveAiCostInTransaction,
} from '../services/ai-cost-ledger.js';
import {
  AI_IMAGE_BILLED_JOB_STATUSES,
  aiImageReservedQuotaWhere,
} from '../services/ai-image-quota.js';
import {
  lockGlobalAiCostBudgetInTransaction,
  reserveGlobalAiCostBudgetInTransaction,
} from '../services/ai-cost-budget.js';

function costReservationIdempotencyKey(jobId: string) {
  return `${jobId}:cost:reserve`;
}

function costReleaseIdempotencyKey(jobId: string) {
  return `${jobId}:cost:release`;
}

function workflowRecord(row: any): AiMediaWorkflowRecord {
  return {
    ...row,
    suiteId: row?.suiteSlot?.suiteId ?? null,
  } as AiMediaWorkflowRecord;
}

function eventData(input: {
  workflowId: string;
  ownerUserId: string;
  actorUserId?: string | null;
  jobId?: string | null;
  assetId?: string | null;
  eventKey: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const payload = input.payload || {};
  return { ...input, payload, payloadHash: aiMediaPayloadHash(payload) };
}

async function assertListingDraftContextAssets(
  tx: any,
  input: {
    ownerUserId: string;
    context: Extract<CreateAiMediaWorkflowInput['context'], { type: 'listing-draft' }>;
    assets: Array<{ id: string; sourceCaptureSnapshotId: string | null; sourceMediaKey?: string | null }>;
  },
) {
  const scope: AiMediaListingDraftContextScope = {
    expectedRevision: input.context.revision,
    expectedDraftVersion: input.context.draftVersion,
    skuKey: input.context.skuKey,
    slotKey: input.context.slotKey,
  };
  const context = await createAiMediaContextService(tx as any).loadListingDraft(
    input.ownerUserId,
    input.context.id,
    scope,
  );
  const allowedAssetIds = new Set(context.inputs.flatMap((item) => [
    item.assetId,
    ...(Array.isArray(item.compatibleAssetIds) ? item.compatibleAssetIds : []),
  ]).filter((id): id is string => Boolean(id)));
  if (!input.assets.length || input.assets.some((asset) => (
    !allowedAssetIds.has(asset.id)
    || asset.sourceCaptureSnapshotId !== context.snapshot.id
  ))) {
    throw Object.assign(new Error('Source asset does not belong to the current listing draft context'), {
      code: 'AI_MEDIA_CONTEXT_MISMATCH',
    });
  }
  return context;
}

async function assertListingDraftEditSource(
  tx: any,
  input: {
    ownerUserId: string;
    context: Extract<CreateAiMediaWorkflowInput['context'], { type: 'listing-draft' }>;
    source: FrozenEditAsset;
  },
) {
  if (input.source.kind === 'SOURCE_ORIGINAL') {
    return assertListingDraftContextAssets(tx, {
      ownerUserId: input.ownerUserId,
      context: input.context,
      assets: [input.source],
    });
  }
  const context = await createAiMediaContextService(tx as any).loadListingDraft(
    input.ownerUserId,
    input.context.id,
    {
      expectedRevision: input.context.revision,
      expectedDraftVersion: input.context.draftVersion,
      skuKey: input.context.skuKey,
      slotKey: input.context.slotKey,
    },
  );
  if (!isAiMediaEditInputFromContext(input.source, {
    ownerUserId: input.ownerUserId,
    contextType: 'listing-draft',
    contextId: input.context.id,
    contextSkuKey: input.context.skuKey,
    contextSlotKey: input.context.slotKey,
    contextDraftRevision: input.context.revision,
    contextDraftVersion: input.context.draftVersion,
    sourceCaptureSnapshotId: context.snapshot.id,
  })) {
    throw Object.assign(new Error('Edit candidate does not belong to the current listing draft context'), {
      code: 'AI_MEDIA_CONTEXT_MISMATCH',
    });
  }
  return context;
}

async function assertCollectContextAssets(
  tx: any,
  ownerUserId: string,
  contextId: string,
  assets: Array<{ sourceCaptureSnapshotId: string | null }>,
) {
  const context = await tx.supplyGoods.findFirst({
    where: { id: contextId, userId: ownerUserId },
    select: {
      id: true,
      sourceCaptureSubject: {
        select: {
          snapshots: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  const snapshotId = context?.sourceCaptureSubject?.snapshots[0]?.id;
  if (!context || assets.some((asset) => asset.sourceCaptureSnapshotId !== snapshotId)) {
    throw Object.assign(new Error('Source asset does not belong to the requested collect context'), {
      code: 'AI_MEDIA_CONTEXT_MISMATCH',
    });
  }
  return snapshotId;
}

function contextDraftVersionData(context: CreateAiMediaWorkflowInput['context']) {
  return context.type === 'listing-draft'
    ? {
      contextDraftRevision: context.revision,
      contextDraftVersion: context.draftVersion,
    }
    : {
      contextDraftRevision: null,
      contextDraftVersion: null,
    };
}

function imageToImageFingerprintFromFrozenInputs(
  input: CreateAiMediaWorkflowInput,
  frozenInputs: Array<{ assetSha256?: string | null }>,
) {
  const hashes = frozenInputs.map((row) => row.assetSha256 || null);
  return aiMediaPayloadHash({
    request: createAiMediaWorkflowFingerprint(input),
    ...(input.references
      ? { referenceAssetSha256: hashes }
      : { sourceAssetSha256: hashes[0] || null }),
  });
}

const applicationSummarySelect = {
  id: true,
  mode: true,
  workflowId: true,
  jobId: true,
  assetId: true,
  targetType: true,
  targetId: true,
  contextSkuKey: true,
  contextSlotKey: true,
  createdAt: true,
  targetVersionAfter: true,
  rolledBackBy: {
    select: {
      id: true,
      createdAt: true,
      targetVersionAfter: true,
    },
  },
} as const;

const listingDraftApplicationSummarySelect = {
  id: true,
  mode: true,
  workflowId: true,
  jobId: true,
  assetId: true,
  targetId: true,
  contextSkuKey: true,
  contextSlotKey: true,
  createdAt: true,
  rolledBackBy: {
    select: {
      id: true,
      createdAt: true,
    },
  },
} as const;

const detailInclude = {
  suiteSlot: { select: { suiteId: true, ownerUserId: true } },
  inputs: { include: { asset: true }, orderBy: { ordinal: 'asc' } },
  jobs: {
    include: { assets: true, costReservation: { select: { status: true } } },
    orderBy: { workflowAttempt: 'asc' },
  },
  events: { orderBy: { createdAt: 'asc' }, take: 200 },
  applicationMutations: {
    where: { kind: 'APPLY' },
    orderBy: { targetSequence: 'desc' },
    take: 1,
    select: applicationSummarySelect,
  },
  listingDraftApplicationMutations: {
    where: { kind: 'APPLY' },
    orderBy: { targetSequence: 'desc' },
    take: 1,
    select: listingDraftApplicationSummarySelect,
  },
} as const;

const historyInclude = {
  inputs: { include: { asset: true }, orderBy: { ordinal: 'asc' } },
  jobs: {
    include: { assets: true, costReservation: { select: { status: true } } },
    orderBy: { workflowAttempt: 'desc' },
    take: 1,
  },
  applicationMutations: {
    where: { kind: 'APPLY' },
    orderBy: { targetSequence: 'desc' },
    take: 1,
    select: applicationSummarySelect,
  },
  listingDraftApplicationMutations: {
    where: { kind: 'APPLY' },
    orderBy: { targetSequence: 'desc' },
    take: 1,
    select: listingDraftApplicationSummarySelect,
  },
} as const;

async function assertWorkflowSourceSnapshotCurrent(tx: any, workflow: any) {
  if (!workflow?.contextId || !['collect', 'listing-draft'].includes(String(workflow.contextType))) return;
  let listingSnapshotId: string | null = null;
  if (workflow.contextType === 'listing-draft') {
    try {
      const listingContext = await createAiMediaContextService(tx as any).loadListingDraft(
        workflow.ownerUserId,
        workflow.contextId,
        {
          expectedRevision: workflow.contextDraftRevision,
          expectedDraftVersion: workflow.contextDraftVersion,
          skuKey: workflow.contextSkuKey,
          slotKey: workflow.contextSlotKey,
        },
      );
      listingSnapshotId = listingContext.snapshot.id;
    } catch (error: any) {
      if (!(error instanceof AiMediaContextError)) throw error;
      throw Object.assign(new Error('The listing draft changed; review and generate a new candidate'), {
        code: 'STALE_MEDIA_WORKFLOW',
        cause: error,
      });
    }
  }
  const inputSnapshotIds = Array.isArray(workflow.inputs)
    ? workflow.inputs.map((input: any) => String(input.asset?.sourceCaptureSnapshotId || '').trim())
    : [];
  if (!inputSnapshotIds.length || inputSnapshotIds.some((id: string) => !id)) {
    throw Object.assign(new Error('The workflow source snapshot is no longer available'), {
      code: 'STALE_MEDIA_WORKFLOW',
    });
  }
  if (workflow.contextType === 'listing-draft') {
    const currentSnapshotId = String(listingSnapshotId || '').trim();
    if (!currentSnapshotId || inputSnapshotIds.some((id: string) => id !== currentSnapshotId)) {
      throw Object.assign(new Error('The listing draft source snapshot is no longer available'), {
        code: 'STALE_MEDIA_WORKFLOW',
      });
    }
    return;
  }
  const context = await tx.supplyGoods.findFirst({
    where: { id: workflow.contextId, userId: workflow.ownerUserId },
    select: {
      sourceCaptureSubject: {
        select: {
          snapshots: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  const currentSnapshotId = context?.sourceCaptureSubject?.snapshots[0]?.id || null;
  if (!currentSnapshotId || inputSnapshotIds.some((id: string) => id !== currentSnapshotId)) {
    throw Object.assign(new Error('The workflow source snapshot changed; review and generate a new candidate'), {
      code: 'STALE_MEDIA_WORKFLOW',
    });
  }
}

interface FrozenSourceAsset {
  id: string;
  sha256: string | null;
  sourceCaptureSnapshotId: string | null;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

interface FrozenEditAsset extends FrozenSourceAsset {
  ownerUserId: string;
  kind: string;
  storageBackend: string;
  storageKey: string | null;
  sizeBytes: number;
  metadata: unknown;
}

function validFrozenEditAsset(asset: FrozenEditAsset | undefined, kind: 'SOURCE_ORIGINAL' | 'EDIT_MASK') {
  if (kind === 'SOURCE_ORIGINAL') {
    return isAiMediaEditReadySourceAsset(asset) || isAiMediaEditReadyCandidateAsset(asset);
  }
  return Boolean(
    asset
    && asset.kind === kind
    && /^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''))
    && ['local', 'oss'].includes(asset.storageBackend)
    && asset.storageKey
    && Number.isSafeInteger(asset.width)
    && Number.isSafeInteger(asset.height)
    && Number(asset.width) >= 1
    && Number(asset.height) >= 1
    && Number(asset.width) * Number(asset.height) <= 12_000_000
    && Number.isSafeInteger(asset.sizeBytes)
    && asset.sizeBytes > 0
    && asset.sizeBytes <= AI_IMAGE_EDIT_MAX_INPUT_BYTES,
  );
}

function editRequestFingerprint(
  input: CreateAiImageEditWorkflowInput,
  source: FrozenEditAsset,
  mask: FrozenEditAsset | null,
) {
  return aiMediaPayloadHash({
    request: createAiImageEditWorkflowFingerprint(input),
    sourceAssetSha256: source.sha256,
    maskAssetSha256: mask?.sha256 || null,
  });
}

function editRequestFingerprintFromHashes(
  input: CreateAiImageEditWorkflowInput,
  sourceAssetSha256: string | null | undefined,
  maskAssetSha256: string | null | undefined,
) {
  return aiMediaPayloadHash({
    request: createAiImageEditWorkflowFingerprint(input),
    sourceAssetSha256: sourceAssetSha256 || null,
    maskAssetSha256: maskAssetSha256 || null,
  });
}

function replayImageEditWorkflow(existing: any, input: CreateAiImageEditWorkflowInput) {
  const inputs = Array.isArray(existing?.inputs) ? existing.inputs : [];
  const source = inputs.find((row: any) => row?.role === 'REFERENCE' && row?.ordinal === 0);
  const mask = inputs.find((row: any) => row?.role === 'MASK' && row?.ordinal === 0);
  const fingerprint = editRequestFingerprintFromHashes(
    input,
    source?.assetSha256,
    mask?.assetSha256,
  );
  const jobId = String(existing?.jobs?.[existing.jobs.length - 1]?.id || '');
  return {
    kind: existing?.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
    workflow: workflowRecord(existing),
    jobId,
  };
}

async function assertImageGenerationDailyQuota(
  tx: any,
  ownerUserId: string,
  dailyLimit: number,
  requestedUnits: number,
  errorCode: 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED' | 'AI_IMAGE_EDIT_QUOTA_EXCEEDED',
  label: string,
) {
  if (dailyLimit <= 0) return;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [active, completed] = await Promise.all([
    tx.aiImageJob.aggregate({
      where: {
        ownerUserId,
        createdAt: { gte: dayStart },
        ...aiImageReservedQuotaWhere(),
      },
      _sum: { requestedImageCount: true },
    }),
    tx.aiImageJob.aggregate({
      where: {
        ownerUserId,
        createdAt: { gte: dayStart },
        status: { in: [...AI_IMAGE_BILLED_JOB_STATUSES] },
        billedUnits: { gt: 0 },
      },
      _sum: { billedUnits: true },
    }),
  ]);
  const used = Number(active._sum.requestedImageCount || 0) + Number(completed._sum.billedUnits || 0);
  if (used + requestedUnits > dailyLimit) {
    throw Object.assign(new Error(`${label} daily quota exceeded (${used}/${dailyLimit})`), {
      code: errorCode,
      used,
      limit: dailyLimit,
    });
  }
}

function orderSourceAssets(
  rows: FrozenSourceAsset[],
  references: Array<{ assetId: string }>,
): FrozenSourceAsset[] | null {
  const assetsById = new Map(rows.map((asset) => [String(asset.id), asset]));
  const ordered: FrozenSourceAsset[] = [];
  for (const reference of references) {
    const asset = assetsById.get(reference.assetId);
    if (!asset) return null;
    ordered.push(asset);
  }
  return ordered;
}

export class PrismaAiMediaWorkflowRepository implements AiMediaWorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createImageToImage(input: CreateAiMediaWorkflowInput) {
    const references = normalizeAiMediaWorkflowReferences(input);
    const execution = normalizeAiMediaProviderExecutionConfig(input, {
      provider: AI_MEDIA_WORKFLOW_PROVIDER,
      model: AI_MEDIA_WORKFLOW_MODEL,
    }, { count: input.count, width: input.width, height: input.height });
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      if (execution.paid) await lockGlobalAiCostBudgetInTransaction(tx);
      const existingBeforeAuthority = typeof tx.aiMediaWorkflow?.findUnique === 'function'
        ? await tx.aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        })
        : null;
      if (existingBeforeAuthority) {
        let frozenInputs = Array.isArray(existingBeforeAuthority.inputs)
          ? existingBeforeAuthority.inputs
          : [];
        if (!frozenInputs.length && typeof tx.mediaAsset?.findMany === 'function') {
          const frozenRows = await tx.mediaAsset.findMany({
            where: {
              id: { in: references.map((reference) => reference.assetId) },
              ownerUserId: input.ownerUserId,
              kind: 'SOURCE_ORIGINAL',
            },
          });
          const frozenAssets = orderSourceAssets(frozenRows as FrozenSourceAsset[], references);
          if (frozenAssets) {
            frozenInputs = frozenAssets.map((asset) => ({ assetSha256: asset.sha256 }));
          }
        }
        const fingerprint = imageToImageFingerprintFromFrozenInputs(
          input,
          frozenInputs,
        );
        const jobId = String(existingBeforeAuthority.jobs?.[existingBeforeAuthority.jobs.length - 1]?.id || '');
        return {
          kind: existingBeforeAuthority.requestFingerprint === fingerprint
            ? 'existing' as const
            : 'conflict' as const,
          workflow: workflowRecord(existingBeforeAuthority),
          jobId,
        };
      }
      const assetRows = await tx.mediaAsset.findMany({
        where: {
          id: { in: references.map((reference) => reference.assetId) },
          ownerUserId: input.ownerUserId,
          kind: 'SOURCE_ORIGINAL',
        },
      }) as FrozenSourceAsset[];
      const assets = orderSourceAssets(assetRows, references);
      if (!assets) {
        throw Object.assign(new Error('Owned source asset not found'), { code: 'SOURCE_ASSET_NOT_FOUND' });
      }
      const primaryAsset = assets[0]!;
      if (assets.some((asset) => !/^[a-f0-9]{64}$/u.test(String(asset.sha256 || '')))) {
        throw Object.assign(new Error('Source asset has no immutable content hash'), { code: 'SOURCE_ASSET_INVALID' });
      }
      if (new Set(assets.map((asset) => asset.sha256)).size !== assets.length) {
        throw Object.assign(new Error('Source references must have unique content'), { code: 'SOURCE_ASSET_DUPLICATE' });
      }
      if (input.context.type === 'listing-draft') {
        await assertListingDraftContextAssets(tx, {
          ownerUserId: input.ownerUserId,
          context: input.context,
          assets,
        });
      } else {
        await assertCollectContextAssets(
          tx,
          input.ownerUserId,
          input.context.id,
          assets,
        );
      }
      const fingerprint = aiMediaPayloadHash({
        request: createAiMediaWorkflowFingerprint(input),
        ...(input.references
          ? { referenceAssetSha256: assets.map((asset) => asset.sha256) }
          : { sourceAssetSha256: primaryAsset.sha256 }),
      });
      await assertImageGenerationDailyQuota(
        tx,
        input.ownerUserId,
        input.dailyLimit,
        input.count,
        'AI_IMAGE_GENERATION_QUOTA_EXCEEDED',
        'AI image generation',
      );
      if (execution.paid) {
        await reserveGlobalAiCostBudgetInTransaction(tx, {
          limit: execution.globalDailyBudgetCents,
          requestedMaximumCostMinor: execution.estimatedCostCents,
          currency: execution.providerRuntimeContract?.currency ?? 'USD',
        }, { alreadyLocked: true });
      }
      const workflow = await tx.aiMediaWorkflow.create({ data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        operation: 'IMAGE_TO_IMAGE',
        status: 'QUEUED',
        reviewStatus: 'NOT_READY',
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        contextType: input.context.type,
        contextId: input.context.id,
        contextSkuKey: input.context.skuKey || null,
        contextSlotKey: input.context.slotKey || null,
        ...contextDraftVersionData(input.context),
      } });
      for (const [ordinal, asset] of assets.entries()) {
        await tx.aiMediaWorkflowInput.create({ data: {
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          assetId: asset.id,
          role: 'REFERENCE',
          ordinal,
          assetSha256: asset.sha256,
          assetUrl: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        } });
      }
      const job = await tx.aiImageJob.create({ data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        operation: 'IMAGE_TO_IMAGE',
        workflowId: workflow.id,
        workflowAttempt: 1,
        status: 'QUEUED',
        provider: execution.provider,
        model: execution.model,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        ...(isWanxHostedEdit(execution.provider, execution.model)
          ? assertWanxImageToImageInput({ ...input, referenceCount: references.length }) : {}),
        requestedImageCount: input.count,
        width: input.width,
        height: input.height,
        maxAttempts: 1,
        idempotencyKey: `${input.idempotencyKey}:attempt:1`,
        requestFingerprint: fingerprint,
        inputAssets: assets.map((asset, ordinal) => ({
          assetId: asset.id,
          role: 'REFERENCE',
          ordinal,
          sha256: asset.sha256,
        })),
        operationConfig: execution.providerRuntimeContract || undefined,
        estimatedCostCents: execution.estimatedCostCents,
      } });
      await reserveAiCostInTransaction(tx, {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        workflowId: workflow.id,
        jobId: job.id,
        idempotencyKey: costReservationIdempotencyKey(job.id),
        requestFingerprint: fingerprint,
        provider: execution.provider,
        model: execution.model,
        operation: 'IMAGE_TO_IMAGE',
        currency: execution.providerRuntimeContract?.currency ?? 'USD',
        estimatedCostMinor: execution.estimatedCostCents,
        maximumCostMinor: execution.estimatedCostCents,
      });
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: workflow.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        jobId: job.id, eventKey: `${workflow.id}:created`, eventType: 'CREATED',
        payload: { operation: 'IMAGE_TO_IMAGE', attempt: 1, referenceCount: assets.length },
      }) });
      const created = await tx.aiMediaWorkflow.findUnique({ where: { id: workflow.id }, include: detailInclude });
      return { kind: 'created' as const, workflow: workflowRecord(created), jobId: job.id };
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const existing = await (this.prisma as any).aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
      });
      if (!existing) throw error;
      const fingerprint = imageToImageFingerprintFromFrozenInputs(input, existing.inputs || []);
      const jobId = String(existing.jobs?.[existing.jobs.length - 1]?.id || '');
      return {
        kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
        workflow: workflowRecord(existing), jobId,
      };
    }
  }

  async createImageEdit(input: CreateAiImageEditWorkflowInput) {
    assertWanxHostedEditPrompt(input);
    const execution = normalizeAiMediaProviderExecutionConfig(input, {
      provider: AI_IMAGE_EDIT_PROVIDER,
      model: AI_IMAGE_EDIT_MODEL,
    }, { count: 1, width: input.width, height: input.height });
    const sourceAssetId = input.sourceAssetId.trim();
    const maskAssetId = input.operation === 'INPAINT' ? String(input.maskAssetId || '').trim() : '';
    const assetIds = [sourceAssetId, ...(maskAssetId ? [maskAssetId] : [])];
    const loadAssets = async (client: any) => {
      const rows = await client.mediaAsset.findMany({
        where: { id: { in: assetIds }, ownerUserId: input.ownerUserId },
        include: {
          aiImageJob: {
            include: { workflow: { include: { suiteSlot: true } } },
          },
        },
      }) as FrozenEditAsset[];
      const byId = new Map(rows.map((asset) => [asset.id, asset]));
      return {
        source: byId.get(sourceAssetId),
        mask: maskAssetId ? byId.get(maskAssetId) : null,
      };
    };
    const assertAssets = (source: FrozenEditAsset | undefined, mask: FrozenEditAsset | null | undefined) => {
      if (!validFrozenEditAsset(source, 'SOURCE_ORIGINAL')) {
        throw Object.assign(new Error('Owned immutable source asset not found'), { code: 'SOURCE_ASSET_NOT_FOUND' });
      }
      if (source!.width !== input.width || source!.height !== input.height) {
        throw Object.assign(new Error('Source image dimensions changed before the edit was frozen'), {
          code: 'STALE_MEDIA_WORKFLOW',
        });
      }
      if (input.operation === 'INPAINT') {
        if (!validFrozenEditAsset(mask || undefined, 'EDIT_MASK')) {
          throw Object.assign(new Error('Owned immutable edit mask not found'), { code: 'MASK_ASSET_NOT_FOUND' });
        }
        const maskMetadata = mask!.metadata && typeof mask!.metadata === 'object'
          ? mask!.metadata as Record<string, unknown>
          : {};
        const maskContextMatches = input.context.type === 'listing-draft'
          ? maskMetadata.contextType === 'listing-draft'
            && maskMetadata.contextId === input.context.id
            && maskMetadata.contextDraftRevision === input.context.revision
            && maskMetadata.contextDraftVersion === input.context.draftVersion
            && (maskMetadata.contextSkuKey ?? null) === (input.context.skuKey ?? null)
            && (maskMetadata.contextSlotKey ?? null) === (input.context.slotKey ?? null)
          : maskMetadata.contextType == null || (
            maskMetadata.contextType === 'collect'
            && maskMetadata.contextId === input.context.id
            && (maskMetadata.contextSkuKey ?? null) === (input.context.skuKey ?? null)
            && (maskMetadata.contextSlotKey ?? null) === (input.context.slotKey ?? null)
          );
        if (
          mask!.sourceCaptureSnapshotId !== source!.sourceCaptureSnapshotId
          || mask!.width !== source!.width
          || mask!.height !== source!.height
          || maskMetadata.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS
          || maskMetadata.sourceAssetId !== source!.id
          || maskMetadata.sourceSha256 !== source!.sha256
          || !maskContextMatches
        ) {
          throw Object.assign(new Error('Edit mask does not match the frozen source contract'), {
            code: 'MASK_ASSET_INVALID',
          });
        }
      } else if (mask) {
        throw Object.assign(new Error('Full-image edit cannot include a mask asset'), { code: 'MASK_ASSET_INVALID' });
      }
      return { source: source!, mask: mask || null };
    };

    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        if (execution.paid) await lockGlobalAiCostBudgetInTransaction(tx);
        const existingBeforeAuthority = await tx.aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId,
            idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        });
        if (existingBeforeAuthority) {
          return replayImageEditWorkflow(existingBeforeAuthority, input);
        }
        const loaded = await loadAssets(tx);
        const { source, mask } = assertAssets(loaded.source, loaded.mask);
        let snapshotId: string | null = null;
        if (input.context.type === 'listing-draft') {
          const context = await assertListingDraftEditSource(tx, {
            ownerUserId: input.ownerUserId,
            context: input.context,
            source,
          });
          snapshotId = context.snapshot.id;
        } else {
          const context = await tx.supplyGoods.findFirst({
            where: { id: input.context.id, userId: input.ownerUserId },
            select: { id: true, sourceCaptureSubject: { select: {
              snapshots: {
                orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
                take: 1,
                select: { id: true },
              },
            } } },
          });
          snapshotId = context?.sourceCaptureSubject?.snapshots[0]?.id || null;
          if (!context || !snapshotId || !isAiMediaEditInputFromContext(source, {
            ownerUserId: input.ownerUserId,
            contextType: 'collect',
            contextId: input.context.id,
            contextSkuKey: input.context.skuKey,
            contextSlotKey: input.context.slotKey,
            sourceCaptureSnapshotId: snapshotId,
          })) {
            throw Object.assign(new Error('Source asset does not belong to the current collect context'), {
              code: 'AI_MEDIA_CONTEXT_MISMATCH',
            });
          }
        }
        const fingerprint = editRequestFingerprint(input, source, mask);
        await assertImageGenerationDailyQuota(
          tx,
          input.ownerUserId,
          input.dailyLimit,
          1,
          'AI_IMAGE_EDIT_QUOTA_EXCEEDED',
          'AI image edit',
        );
        const frozenExecution = normalizeAiMediaProviderExecutionConfig(input, {
          provider: AI_IMAGE_EDIT_PROVIDER,
          model: AI_IMAGE_EDIT_MODEL,
        }, { count: 1, width: Number(source.width), height: Number(source.height) });
        if (frozenExecution.paid) {
          await reserveGlobalAiCostBudgetInTransaction(tx, {
            limit: frozenExecution.globalDailyBudgetCents,
            requestedMaximumCostMinor: frozenExecution.estimatedCostCents,
            currency: frozenExecution.providerRuntimeContract?.currency ?? 'USD',
          }, { alreadyLocked: true });
        }

        const workflow = await tx.aiMediaWorkflow.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: input.operation,
          status: 'QUEUED',
          reviewStatus: 'NOT_READY',
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          contextType: input.context.type,
          contextId: input.context.id,
          contextSkuKey: input.context.skuKey || null,
          contextSlotKey: input.context.slotKey || null,
          ...contextDraftVersionData(input.context),
        } });
        const frozenInputs = [
          { asset: source, role: 'REFERENCE' as const },
          ...(mask ? [{ asset: mask, role: 'MASK' as const }] : []),
        ];
        for (const frozen of frozenInputs) {
          await tx.aiMediaWorkflowInput.create({ data: {
            workflowId: workflow.id,
            ownerUserId: input.ownerUserId,
            assetId: frozen.asset.id,
            role: frozen.role,
            ordinal: 0,
            assetSha256: frozen.asset.sha256,
            assetUrl: frozen.asset.url,
            mimeType: frozen.asset.mimeType,
            width: frozen.asset.width,
            height: frozen.asset.height,
          } });
        }
        const operationConfig = {
          policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
          contextType: input.context.type,
          contextId: input.context.id,
          contextSkuKey: input.context.skuKey || null,
          contextSlotKey: input.context.slotKey || null,
          ...(input.context.type === 'listing-draft' ? {
            contextDraftRevision: input.context.revision,
            contextDraftVersion: input.context.draftVersion,
          } : {}),
          sourceAssetSha256: source.sha256,
          ...(mask ? {
            maskAssetSha256: mask.sha256,
            maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          } : {}),
          ...(frozenExecution.providerRuntimeContract ? {
            providerRuntime: frozenExecution.providerRuntimeContract,
          } : {}),
        };
        const job = await tx.aiImageJob.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: input.operation,
          workflowId: workflow.id,
          workflowAttempt: 1,
          status: 'QUEUED',
          provider: frozenExecution.provider,
          model: frozenExecution.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          resolvedPrompt: input.resolvedPrompt,
          resolvedNegativePrompt: input.resolvedNegativePrompt,
          templateKey: input.templateKey,
          templateReleaseId: input.templateReleaseId,
          templateChecksum: input.templateChecksum,
          templateSnapshot: input.templateSnapshot,
          requestFingerprint: fingerprint,
          inputAssets: frozenInputs.map((frozen) => ({
            assetId: frozen.asset.id,
            role: frozen.role,
            ordinal: 0,
            sha256: frozen.asset.sha256,
            sizeBytes: frozen.asset.sizeBytes,
          })),
          operationConfig,
          requestedImageCount: 1,
          width: source.width,
          height: source.height,
          maxAttempts: 1,
          idempotencyKey: `${input.idempotencyKey}:attempt:1`,
          estimatedCostCents: frozenExecution.estimatedCostCents,
        } });
        await reserveAiCostInTransaction(tx, {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          workflowId: workflow.id,
          jobId: job.id,
          idempotencyKey: costReservationIdempotencyKey(job.id),
          requestFingerprint: fingerprint,
          provider: frozenExecution.provider,
          model: frozenExecution.model,
          operation: input.operation,
          currency: frozenExecution.providerRuntimeContract?.currency ?? 'USD',
          estimatedCostMinor: frozenExecution.estimatedCostCents,
          maximumCostMinor: frozenExecution.estimatedCostCents,
        });
        await tx.aiMediaWorkflowEvent.create({ data: eventData({
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          jobId: job.id,
          eventKey: `${workflow.id}:created`,
          eventType: 'CREATED',
          payload: {
            operation: input.operation,
            attempt: 1,
            sourceAssetId: source.id,
            maskAssetId: mask?.id || null,
            maskSemantics: mask ? AI_IMAGE_EDIT_MASK_SEMANTICS : null,
          },
        }) });
        const created = await tx.aiMediaWorkflow.findUnique({
          where: { id: workflow.id },
          include: detailInclude,
        });
        return { kind: 'created' as const, workflow: workflowRecord(created), jobId: job.id };
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const existing = await (this.prisma as any).aiMediaWorkflow.findUnique({
        where: { ai_media_workflow_owner_idempotency: {
          ownerUserId: input.ownerUserId,
          idempotencyKey: input.idempotencyKey,
        } },
        include: detailInclude,
      });
      if (!existing) throw error;
      return replayImageEditWorkflow(existing, input);
    }
  }

  async createImageTranslation(input: CreateAiImageTranslationWorkflowInput & {
    options: ReturnType<typeof normalizeAiImageTranslationOptions>;
  }) {
    const sourceAssetId = input.sourceAssetId.trim();
    const references = [{ assetId: sourceAssetId }];
    const estimatedCostCents = Math.max(0, Math.round(input.estimatedCostCents || 0));
    const paid = input.provider !== 'fake';
    const currency = input.translationRuntimeContract?.currency ?? 'USD';
    const fingerprintForSha = (sourceAssetSha256: string | null | undefined) => aiMediaPayloadHash({
      request: createAiImageTranslationWorkflowFingerprint({ ...input, sourceAssetId, options: input.options }),
      sourceAssetSha256,
    });
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        if (paid) await lockGlobalAiCostBudgetInTransaction(tx);
        const existingBeforeContext = await tx.aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        });
        if (existingBeforeContext) {
          const frozenInput = existingBeforeContext.inputs?.find((row: any) => row.ordinal === 0);
          const fingerprint = fingerprintForSha(frozenInput?.assetSha256);
          const jobId = String(existingBeforeContext.jobs?.[existingBeforeContext.jobs.length - 1]?.id || '');
          return {
            kind: existingBeforeContext.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
            workflow: workflowRecord(existingBeforeContext), jobId,
          };
        }
        const assetRows = await tx.mediaAsset.findMany({
          where: {
            id: sourceAssetId,
            ownerUserId: input.ownerUserId,
            kind: 'SOURCE_ORIGINAL',
          },
        }) as FrozenSourceAsset[];
        const assets = orderSourceAssets(assetRows, references);
        if (!assets) throw Object.assign(new Error('Owned source asset not found'), { code: 'SOURCE_ASSET_NOT_FOUND' });
        const asset = assets[0]!;
        if (!/^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''))) {
          throw Object.assign(new Error('Source asset has no immutable content hash'), { code: 'SOURCE_ASSET_INVALID' });
        }
        if (input.context.type === 'listing-draft') {
          await assertListingDraftContextAssets(tx, {
            ownerUserId: input.ownerUserId,
            context: input.context,
            assets,
          });
        } else {
          await assertCollectContextAssets(
            tx,
            input.ownerUserId,
            input.context.id,
            assets,
          );
        }
        const fingerprint = fingerprintForSha(assets[0]?.sha256);
        const existing = await tx.aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        });
        if (existing) {
          const jobId = String(existing.jobs?.[existing.jobs.length - 1]?.id || '');
          return {
            kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
            workflow: workflowRecord(existing), jobId,
          };
        }
        if (input.dailyLimit > 0) {
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const active = await tx.aiImageJob.aggregate({
            where: {
              ownerUserId: input.ownerUserId,
              operation: 'IMAGE_TRANSLATE',
              createdAt: { gte: dayStart },
              ...aiImageReservedQuotaWhere(),
            },
            _sum: { requestedImageCount: true },
          });
          const completed = await tx.aiImageJob.aggregate({
            where: {
              ownerUserId: input.ownerUserId,
              operation: 'IMAGE_TRANSLATE',
              createdAt: { gte: dayStart },
              status: { in: [...AI_IMAGE_BILLED_JOB_STATUSES] },
              billedUnits: { gt: 0 },
            },
            _sum: { billedUnits: true },
          });
          const used = Number(active._sum.requestedImageCount || 0) + Number(completed._sum.billedUnits || 0);
          if (used + 1 > input.dailyLimit) {
            throw Object.assign(new Error(`Image translation daily quota exceeded (${used}/${input.dailyLimit})`), {
              code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
            });
          }
        }
        if (paid) {
          await reserveGlobalAiCostBudgetInTransaction(tx, {
            limit: Number(input.globalDailyBudgetCents ?? 0),
            requestedMaximumCostMinor: estimatedCostCents,
            currency,
          }, { alreadyLocked: true });
        }
        const workflow = await tx.aiMediaWorkflow.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: 'IMAGE_TRANSLATE',
          status: 'QUEUED',
          reviewStatus: 'NOT_READY',
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          contextType: input.context.type,
          contextId: input.context.id,
          contextSkuKey: input.context.skuKey || null,
          contextSlotKey: input.context.slotKey || null,
          ...contextDraftVersionData(input.context),
        } });
        await tx.aiMediaWorkflowInput.create({ data: {
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          assetId: asset.id,
          role: 'REFERENCE',
          ordinal: 0,
          assetSha256: asset.sha256,
          assetUrl: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        } });
        const job = await tx.aiImageJob.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: 'IMAGE_TRANSLATE',
          workflowId: workflow.id,
          workflowAttempt: 1,
          status: 'QUEUED',
          provider: input.provider,
          model: input.model,
          prompt: String(input.prompt || 'Translate the selected product image').trim(),
          negativePrompt: null,
          resolvedPrompt: input.resolvedPrompt || input.options.domainHint,
          resolvedNegativePrompt: input.resolvedNegativePrompt || null,
          templateKey: input.templateKey || null,
          templateReleaseId: input.templateReleaseId || null,
          templateChecksum: input.templateChecksum || null,
          templateSnapshot: input.templateSnapshot || undefined,
          operationConfig: {
            ...input.options,
            ...(input.translationRuntimeContract ? { translationRuntime: input.translationRuntimeContract } : {}),
            contextType: input.context.type,
            contextId: input.context.id,
            contextSkuKey: input.context.skuKey || null,
            contextSlotKey: input.context.slotKey || null,
            ...contextDraftVersionData(input.context),
          },
          requestedImageCount: 1,
          width: asset.width || 1024,
          height: asset.height || 1024,
          maxAttempts: 3,
          idempotencyKey: `${input.idempotencyKey}:attempt:1`,
          requestFingerprint: fingerprint,
          inputAssets: [{ assetId: asset.id, role: 'REFERENCE', ordinal: 0, sha256: asset.sha256 }],
          estimatedCostCents,
        } });
        await reserveAiCostInTransaction(tx, {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          workflowId: workflow.id,
          jobId: job.id,
          idempotencyKey: costReservationIdempotencyKey(job.id),
          requestFingerprint: fingerprint,
          provider: input.provider,
          model: input.model,
          operation: 'IMAGE_TRANSLATE',
          currency,
          estimatedCostMinor: estimatedCostCents,
          maximumCostMinor: estimatedCostCents,
        });
        await tx.aiMediaWorkflowEvent.create({ data: eventData({
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          jobId: job.id,
          eventKey: `${workflow.id}:created`,
          eventType: 'CREATED',
          payload: {
            operation: 'IMAGE_TRANSLATE',
            attempt: 1,
            sourceLanguage: input.options.sourceLanguage,
            targetLanguage: input.options.targetLanguage,
          },
        }) });
        const created = await tx.aiMediaWorkflow.findUnique({ where: { id: workflow.id }, include: detailInclude });
        return { kind: 'created' as const, workflow: workflowRecord(created), jobId: job.id };
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const [assetRows, existing] = await Promise.all([
        (this.prisma as any).mediaAsset.findMany({
          where: { id: sourceAssetId, ownerUserId: input.ownerUserId, kind: 'SOURCE_ORIGINAL' },
        }),
        (this.prisma as any).aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        }),
      ]);
      if (!existing) throw error;
      const assets = orderSourceAssets(assetRows as FrozenSourceAsset[], references);
      const frozenInput = existing.inputs?.find((row: any) => row.ordinal === 0);
      const fingerprint = fingerprintForSha(assets?.[0]?.sha256 || frozenInput?.assetSha256);
      const jobId = String(existing.jobs?.[existing.jobs.length - 1]?.id || '');
      return {
        kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
        workflow: workflowRecord(existing), jobId,
      };
    }
  }

  async listOwned(input: {
    ownerUserId: string;
    contextType?: string;
    contextId?: string;
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
    includePriority?: boolean;
  }) {
    const baseWhere = {
      ownerUserId: input.ownerUserId,
      suiteSlot: { is: null },
      ...(input.contextType ? { contextType: input.contextType } : {}),
      ...(input.contextId ? { contextId: input.contextId } : {}),
    };
    const [rows, priorityPage] = await Promise.all([
      (this.prisma as any).aiMediaWorkflow.findMany({
        where: {
          ...baseWhere,
          ...(input.cursor ? {
            OR: [
              { createdAt: { lt: input.cursor.createdAt } },
              { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
            ],
          } : {}),
        },
        include: historyInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      }),
      input.includePriority && input.contextType && input.contextId
        ? this.listPriorityOwned({
          ownerUserId: input.ownerUserId,
          contextType: input.contextType,
          contextId: input.contextId,
          limit: 100,
        })
        : Promise.resolve({ items: [], nextCursor: null }),
    ]);
    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(workflowRecord),
      priorityItems: priorityPage.items,
      priorityItemsTruncated: Boolean(priorityPage.nextCursor),
      priorityNextCursor: priorityPage.nextCursor,
      nextCursor: rows.length > input.limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    };
  }

  async listPriorityOwned(input: {
    ownerUserId: string;
    contextType: string;
    contextId: string;
    limit: number;
    cursor?: { updatedAt: Date; id: string; recentCutoff: Date } | null;
  }) {
    const recentCutoff = input.cursor?.recentCutoff
      || new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const rows = await (this.prisma as any).aiMediaWorkflow.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        suiteSlot: { is: null },
        contextType: input.contextType,
        contextId: input.contextId,
        AND: [
          {
            OR: [
              { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
              { status: 'SUCCEEDED', reviewStatus: 'PENDING' },
              {
                status: 'SUCCEEDED',
                reviewStatus: 'APPROVED',
                selectedOutputAsset: { is: { aiImageJob: { is: { appliedAt: null } } } },
              },
              {
                jobs: { some: { providerReconciliationStatus: {
                  in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'],
                } } },
              },
              { updatedAt: { gte: recentCutoff } },
            ],
          },
          ...(input.cursor ? [{
            OR: [
              { updatedAt: { lt: input.cursor.updatedAt } },
              { updatedAt: input.cursor.updatedAt, id: { lt: input.cursor.id } },
            ],
          }] : []),
        ],
      },
      include: historyInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(workflowRecord),
      nextCursor: rows.length > input.limit && last
        ? { updatedAt: last.updatedAt, id: last.id, recentCutoff }
        : null,
    };
  }

  async getOwned(id: string, ownerUserId: string) {
    const row = await (this.prisma as any).aiMediaWorkflow.findFirst({
      where: { id, ownerUserId }, include: detailInclude,
    });
    return row ? workflowRecord(row) : null;
  }

  async cancelOwned(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const workflow = await tx.aiMediaWorkflow.findFirst({
        where: { id, ownerUserId, revision: expectedRevision, suiteSlot: { is: null } },
      });
      if (!workflow || !['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(workflow.status)) return null;
      if (workflow.status === 'CANCEL_REQUESTED') {
        return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id }, include: detailInclude }));
      }
      const active = await tx.aiImageJob.findFirst({ where: { workflowId: id, workflowAttempt: workflow.currentAttempt } });
      const submitted = Boolean(active?.providerJobId) || active?.status === 'RUNNING';
      const status = submitted ? 'CANCEL_REQUESTED' : 'CANCELLED';
      await tx.aiMediaWorkflow.update({ where: { id }, data: {
        status, revision: { increment: 1 }, cancelRequestedAt: new Date(),
        ...(status === 'CANCELLED' ? { completedAt: new Date() } : {}),
      } });
      if (active) await tx.aiImageJob.update({ where: { id: active.id }, data: { status } });
      if (active && status === 'CANCELLED') {
        const reservation = await tx.aiCostReservation.findUnique({
          where: { ai_cost_reservation_job_owner: { jobId: active.id, ownerUserId } },
        });
        if (reservation) {
          await releaseAiCostInTransaction(tx, {
            reservationId: reservation.id,
            ownerUserId,
            actorUserId,
            idempotencyKey: costReleaseIdempotencyKey(active.id),
            requestFingerprint: reservation.requestFingerprint,
            actualCostMinor: 0,
            billedUnits: 0,
            reason: 'cancelled before provider submission',
          });
        }
      }
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: id, ownerUserId, actorUserId, jobId: active?.id,
        eventKey: `${id}:cancel:${expectedRevision}`, eventType: status,
      }) });
      return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id }, include: detailInclude }));
    });
  }

  async retryOwned(input: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
    dailyLimit?: number;
    globalDailyBudgetCents?: number;
  }) {
    const eventKey = `${input.id}:retry:${input.idempotencyKey}`;
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await tx.aiMediaWorkflowEvent.findUnique({ where: { eventKey } });
        if (replay) {
          const workflow = await tx.aiMediaWorkflow.findFirst({
            where: { id: input.id, ownerUserId: input.ownerUserId, suiteSlot: { is: null } },
            include: detailInclude,
          });
          const job = workflow?.jobs?.find((row: any) => row.id === replay.jobId);
          return workflow && job ? { workflow: workflowRecord(workflow), jobId: job.id, replayed: true } : null;
        }
        const workflow = await tx.aiMediaWorkflow.findFirst({
          where: {
            id: input.id,
            ownerUserId: input.ownerUserId,
            revision: input.expectedRevision,
            suiteSlot: { is: null },
          },
          include: {
            inputs: { include: { asset: { select: { sourceCaptureSnapshotId: true } } } },
          },
        });
        if (!workflow || workflow.status !== 'FAILED') return null;
        await assertWorkflowSourceSnapshotCurrent(tx, workflow);
        const previous = await tx.aiImageJob.findFirst({ where: { workflowId: input.id, workflowAttempt: workflow.currentAttempt } });
        if (!previous) return null;
        const previousCost = tx.aiCostReservation?.findUnique
          ? await tx.aiCostReservation.findUnique({ where: {
            ai_cost_reservation_job_owner: { jobId: previous.id, ownerUserId: previous.ownerUserId },
          } })
          : null;
        const providerReconciliationAllowsRetry = ['NO_OUTPUT', 'NOT_SUBMITTED']
          .includes(String(previous.providerReconciliationStatus || 'NOT_REQUIRED'));
        const providerResultRequiresReconciliation = Boolean(previous.providerJobId)
          || previous.errorCode === 'PROVIDER_SUBMISSION_UNCERTAIN'
          || !['NOT_REQUIRED', 'NO_OUTPUT', 'NOT_SUBMITTED']
            .includes(String(previous.providerReconciliationStatus || 'NOT_REQUIRED'));
        if (previousCost) {
          if (!['SETTLED', 'RELEASED'].includes(previousCost.status)) return null;
          if (providerResultRequiresReconciliation && !providerReconciliationAllowsRetry) return null;
        } else if (providerResultRequiresReconciliation && !providerReconciliationAllowsRetry) {
          return null;
        }
        const estimatedCostCents = Math.max(0, Number(previous.estimatedCostCents || 0));
        const paid = previous.provider !== 'fake';
        const currency = getFrozenAiImageTaskPrice({ ...previous, estimatedCostCents, costReservation: previousCost }).currency;
        if (paid) {
          await lockGlobalAiCostBudgetInTransaction(tx);
          try {
            await reserveGlobalAiCostBudgetInTransaction(tx, {
              limit: Number(input.globalDailyBudgetCents ?? 0),
              requestedMaximumCostMinor: estimatedCostCents,
              currency,
            }, { alreadyLocked: true });
          } catch (error: any) {
            if (error?.code === 'BUDGET_EXCEEDED') throw error;
            throw Object.assign(new Error(error instanceof Error
              ? error.message
              : 'Global AI budget is unavailable'), { code: 'BUDGET_EXCEEDED' });
          }
        }
        if (previous.operation === 'IMAGE_TRANSLATE') {
          if (!Number.isSafeInteger(input.dailyLimit) || Number(input.dailyLimit) < 0) {
            throw Object.assign(new Error('Image translation retry quota is not available'), {
              code: 'IMAGE_TRANSLATION_QUOTA_UNAVAILABLE',
            });
          }
        }
        if (['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(String(previous.operation))) {
          if (!Number.isSafeInteger(input.dailyLimit) || Number(input.dailyLimit) < 0) {
            throw Object.assign(new Error('AI image generation retry quota is not available'), {
              code: 'AI_IMAGE_GENERATION_QUOTA_UNAVAILABLE',
            });
          }
          const edit = previous.operation === 'FULL_EDIT' || previous.operation === 'INPAINT';
          await assertImageGenerationDailyQuota(
            tx,
            input.ownerUserId,
            Number(input.dailyLimit),
            Number(previous.requestedImageCount || 1),
            edit ? 'AI_IMAGE_EDIT_QUOTA_EXCEEDED' : 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED',
            edit ? 'AI image edit' : 'AI image generation',
          );
        }
        if (previous.operation === 'IMAGE_TRANSLATE' && Number(input.dailyLimit) > 0) {
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const active = await tx.aiImageJob.aggregate({
            where: {
              ownerUserId: input.ownerUserId,
              operation: 'IMAGE_TRANSLATE',
              createdAt: { gte: dayStart },
              ...aiImageReservedQuotaWhere(),
            },
            _sum: { requestedImageCount: true },
          });
          const completed = await tx.aiImageJob.aggregate({
            where: {
              ownerUserId: input.ownerUserId,
              operation: 'IMAGE_TRANSLATE',
              createdAt: { gte: dayStart },
              status: { in: [...AI_IMAGE_BILLED_JOB_STATUSES] },
              billedUnits: { gt: 0 },
            },
            _sum: { billedUnits: true },
          });
          const used = Number(active._sum.requestedImageCount || 0) + Number(completed._sum.billedUnits || 0);
          if (used + 1 > Number(input.dailyLimit)) {
            throw Object.assign(new Error(`Image translation daily quota exceeded (${used}/${input.dailyLimit})`), {
              code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
            });
          }
        }
        const attempt = workflow.currentAttempt + 1;
        const job = await tx.aiImageJob.create({ data: {
          ownerUserId: previous.ownerUserId, actorUserId: input.actorUserId,
          operation: previous.operation, workflowId: input.id, workflowAttempt: attempt,
          status: 'QUEUED', provider: previous.provider, model: previous.model,
          prompt: previous.prompt, negativePrompt: previous.negativePrompt,
          resolvedPrompt: previous.resolvedPrompt, resolvedNegativePrompt: previous.resolvedNegativePrompt,
          templateKey: previous.templateKey, templateReleaseId: previous.templateReleaseId,
          templateChecksum: previous.templateChecksum, templateSnapshot: previous.templateSnapshot,
          requestFingerprint: previous.requestFingerprint, inputAssets: previous.inputAssets,
          operationConfig: previous.operationConfig,
          requestedImageCount: previous.requestedImageCount, width: previous.width, height: previous.height,
          maxAttempts: 1, idempotencyKey: `${workflow.id}:attempt:${attempt}`, estimatedCostCents,
        } });
        await reserveAiCostInTransaction(tx, {
          ownerUserId: previous.ownerUserId,
          actorUserId: input.actorUserId,
          workflowId: input.id,
          jobId: job.id,
          idempotencyKey: costReservationIdempotencyKey(job.id),
          requestFingerprint: previous.requestFingerprint,
          provider: previous.provider,
          model: previous.model,
          operation: previous.operation,
          currency,
          estimatedCostMinor: estimatedCostCents,
          maximumCostMinor: estimatedCostCents,
        });
        await tx.aiMediaWorkflow.update({ where: { id: input.id }, data: {
          status: 'QUEUED', reviewStatus: 'NOT_READY', selectedOutputAssetId: null,
          currentAttempt: attempt, revision: { increment: 1 }, completedAt: null,
        } });
        await tx.aiMediaWorkflowEvent.create({ data: eventData({
          workflowId: input.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
          jobId: job.id, eventKey, eventType: 'RETRY_REQUESTED', payload: { attempt },
        }) });
        const updated = await tx.aiMediaWorkflow.findUnique({ where: { id: input.id }, include: detailInclude });
        return { workflow: workflowRecord(updated), jobId: job.id, replayed: false };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      const replay = await (this.prisma as any).aiMediaWorkflowEvent.findUnique({ where: { eventKey } });
      if (replay?.workflowId === input.id && replay.ownerUserId === input.ownerUserId) {
        const workflow = await (this.prisma as any).aiMediaWorkflow.findFirst({
          where: { id: input.id, ownerUserId: input.ownerUserId, suiteSlot: { is: null } }, include: detailInclude,
        });
        const job = workflow?.jobs?.find((row: any) => row.id === replay.jobId);
        if (!workflow || !job) throw error;
        return { workflow: workflowRecord(workflow), jobId: job.id, replayed: true };
      }
      const current = await (this.prisma as any).aiMediaWorkflow.findFirst({
        where: { id: input.id, ownerUserId: input.ownerUserId, suiteSlot: { is: null } },
        select: { revision: true, status: true },
      });
      if (!current || current.revision !== input.expectedRevision || current.status !== 'FAILED') return null;
      throw error;
    }
  }

  async reviewOwned(input: { id: string; ownerUserId: string; actorUserId: string; expectedRevision: number; outputAssetId: string; decision: 'APPROVE' | 'REJECT'; note: string | null; operationKey?: string }) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const workflow = await tx.aiMediaWorkflow.findFirst({ where: {
        id: input.id, ownerUserId: input.ownerUserId, revision: input.expectedRevision,
        status: 'SUCCEEDED', reviewStatus: 'PENDING', suiteSlot: { is: null },
      }, include: {
        inputs: { include: { asset: { select: { sourceCaptureSnapshotId: true } } } },
      } });
      if (!workflow) return null;
      await assertWorkflowSourceSnapshotCurrent(tx, workflow);
      const output = await tx.mediaAsset.findFirst({ where: {
        id: input.outputAssetId, ownerUserId: input.ownerUserId,
        kind: 'AI_GENERATED',
        aiImageJob: {
          workflowId: input.id,
          workflowAttempt: workflow.currentAttempt,
          operation: workflow.operation,
          status: 'SUCCEEDED',
        },
      } });
      if (!output) return null;
      const reviewStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.aiMediaWorkflow.update({ where: { id: input.id }, data: {
        reviewStatus, revision: { increment: 1 }, selectedOutputAssetId: output.id,
        reviewedByUserId: input.actorUserId, reviewedAt: new Date(),
      } });
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: input.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        assetId: output.id, eventKey: `${input.id}:review:${input.expectedRevision}`,
        eventType: input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
        payload: input.operationKey
          ? { note: input.note, operationKey: input.operationKey }
          : { note: input.note },
      }) });
      return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id: input.id }, include: detailInclude }));
    });
  }
}
