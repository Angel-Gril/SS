import { aiMediaPayloadHash } from './ai-media-workflows.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

export type AiImageApplyMode = 'append' | 'replace';
export type AiImageApplyTargetType = 'collect' | 'product';

export interface ApplyAiImageAssetsInput {
  jobId: string;
  ownerUserId: string;
  actorUserId: string;
  mode: AiImageApplyMode;
  targetType: AiImageApplyTargetType;
  targetId: string;
  selectedAssetId?: string | null;
  expectedTargetUpdatedAt?: string | null;
}

export interface ApplyAiImageAssetsResult {
  jobId: string;
  mode: AiImageApplyMode;
  targetType: AiImageApplyTargetType;
  targetId: string;
  images: unknown[];
  mainImage: string | null;
  editedImages: unknown[];
  targetUpdatedAt: Date;
  appliedAt: Date;
}

export class AiImageApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AiImageApplicationError';
  }
}

interface GeneratedAssetRow {
  id?: string;
  ownerUserId: string;
  aiImageJobId: string | null;
  url: string;
}

interface AiImageJobRow {
  id: string;
  ownerUserId: string;
  workflowId?: string | null;
  operation?: string | null;
  provider?: string | null;
  status: string;
  appliedAt: Date | null;
  assets: GeneratedAssetRow[];
  workflow?: {
    contextType: string | null;
    contextId: string | null;
    inputs: Array<{ asset?: { sourceCaptureSnapshotId: string | null } | null }>;
  } | null;
}

interface ImageTargetRow {
  id: string;
  images: unknown;
  metadata?: unknown;
  updatedAt: Date;
  userId?: string;
  shop?: { userId: string };
  sourceCaptureSubject?: { snapshots: Array<{ id: string }> } | null;
}

interface TransactionClient {
  aiImageJob: {
    findUnique(args: unknown): Promise<AiImageJobRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  aiMediaWorkflowEvent: {
    create(args: unknown): Promise<unknown>;
  };
  supplyGoods: {
    findFirst(args: unknown): Promise<ImageTargetRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  product: {
    findFirst(args: unknown): Promise<ImageTargetRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface AiImageApplicationDatabase {
  $transaction<T>(callback: (tx: TransactionClient) => Promise<T>, options?: { isolationLevel: 'Serializable' }): Promise<T>;
}

function generatedUrls(job: AiImageJobRow, ownerUserId: string, selectedAssetId?: string | null): string[] {
  const selected = selectedAssetId
    ? job.assets.filter((asset) => asset.id === selectedAssetId)
    : job.assets;
  if (!selected.length) {
    throw new AiImageApplicationError('INVALID_ASSETS', 'AI image job has no generated assets');
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const asset of selected) {
    const url = typeof asset.url === 'string' ? asset.url.trim() : '';
    if (asset.ownerUserId !== ownerUserId || asset.aiImageJobId !== job.id || !url) {
      throw new AiImageApplicationError('INVALID_ASSETS', 'Generated assets do not belong to this job and owner');
    }
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function mergeImages(existing: unknown, generated: string[], mode: AiImageApplyMode): unknown[] {
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
      result.push(image);
    }
  }
  for (const url of generated) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    result.push(url);
  }
  return result;
}

export interface CollectImageAppendProjection {
  images: unknown[];
  editedImages: unknown[];
  metadata: Record<string, unknown>;
  mainImage: string | null;
}

export function projectCollectImageAppend(
  currentImages: unknown,
  currentMetadata: unknown,
  generatedUrls: string[],
): CollectImageAppendProjection {
  const metadata = currentMetadata && typeof currentMetadata === 'object' && !Array.isArray(currentMetadata)
    ? { ...(currentMetadata as Record<string, unknown>) }
    : {};
  const existingPublishImages = Array.isArray(metadata.watermarkedImages)
    && metadata.watermarkedImages.length > 0
    ? metadata.watermarkedImages
    : currentImages;
  const images = mergeImages(existingPublishImages, generatedUrls, 'append');
  const editedImages = mergeImages(metadata.editedImages, generatedUrls, 'append');
  return {
    images,
    editedImages,
    metadata: { ...metadata, watermarkedImages: images, editedImages },
    mainImage: images.find((image): image is string => typeof image === 'string') || null,
  };
}

function assertWorkflowSourceSnapshotCurrent(
  job: AiImageJobRow,
  target: ImageTargetRow,
  input: ApplyAiImageAssetsInput,
) {
  if (!job.workflowId) return;
  if (
    input.targetType !== 'collect'
    || job.workflow?.contextType !== 'collect'
    || job.workflow.contextId !== input.targetId
  ) {
    throw new AiImageApplicationError(
      'INVALID_STATE',
      'Workflow output can only be applied to its frozen collect context',
    );
  }
  const currentSnapshotId = target.sourceCaptureSubject?.snapshots[0]?.id || null;
  const inputSnapshotIds = job.workflow.inputs.map((row) => row.asset?.sourceCaptureSnapshotId || null);
  if (
    !currentSnapshotId
    || !inputSnapshotIds.length
    || inputSnapshotIds.some((snapshotId) => snapshotId !== currentSnapshotId)
  ) {
    throw new AiImageApplicationError(
      'STALE_MEDIA_WORKFLOW',
      'The workflow source snapshot changed; review and generate a new candidate',
    );
  }
}

async function findOwnedTarget(tx: TransactionClient, input: ApplyAiImageAssetsInput): Promise<ImageTargetRow> {
  if (input.targetType === 'collect') {
    const target = await tx.supplyGoods.findFirst({
      where: { id: input.targetId, userId: input.ownerUserId },
      select: {
        id: true,
        userId: true,
        images: true,
        metadata: true,
        updatedAt: true,
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
    if (target) return target;
  } else {
    const target = await tx.product.findFirst({
      where: { id: input.targetId, shop: { userId: input.ownerUserId } },
      select: { id: true, images: true, updatedAt: true, shop: { select: { userId: true } } },
    });
    if (target?.shop?.userId === input.ownerUserId) return target;
  }
  throw new AiImageApplicationError('TARGET_NOT_FOUND', 'Image application target not found');
}

export async function applyAiImageAssets(
  database: AiImageApplicationDatabase,
  input: ApplyAiImageAssetsInput,
): Promise<ApplyAiImageAssetsResult> {
  if (!input.jobId || !input.ownerUserId || !input.actorUserId || !input.targetId) {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Job, owner, actor and target are required');
  }
  if (input.mode !== 'append' && input.mode !== 'replace') {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Apply mode must be append or replace');
  }
  if (input.targetType !== 'collect' && input.targetType !== 'product') {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Apply target must be collect or product');
  }

  try {
    return await runAiMediaSerializableTransaction(database, async (tx: TransactionClient) => {
    const job = await tx.aiImageJob.findUnique({
      where: { id: input.jobId },
      include: {
        assets: true,
        workflow: {
          include: {
            inputs: { include: { asset: { select: { sourceCaptureSnapshotId: true } } } },
          },
        },
      },
    });
    if (!job || job.ownerUserId !== input.ownerUserId) {
      throw new AiImageApplicationError('NOT_FOUND', 'AI image job not found');
    }
    if (job.workflowId && job.provider === 'fake' && process.env.NODE_ENV === 'production') {
      throw new AiImageApplicationError(
        'PROVIDER_NOT_READY',
        'Test-only AI media candidates cannot be applied in production',
      );
    }
    if (job.operation === 'IMAGE_TRANSLATE' && input.mode !== 'append') {
      throw new AiImageApplicationError(
        'UNSAFE_APPLY_MODE',
        'Image translation candidates can only be appended to existing product images',
      );
    }
    if (job.status !== 'SUCCEEDED') {
      throw new AiImageApplicationError('INVALID_STATE', 'Only succeeded jobs can be applied');
    }
    if (job.appliedAt) {
      throw new AiImageApplicationError('ALREADY_APPLIED', 'AI image job has already been applied');
    }

    const urls = generatedUrls(job, input.ownerUserId, input.selectedAssetId);
    const target = await findOwnedTarget(tx, input);
    assertWorkflowSourceSnapshotCurrent(job, target, input);
    const expectedTargetUpdatedAt = input.expectedTargetUpdatedAt
      ? new Date(input.expectedTargetUpdatedAt)
      : null;
    if (input.expectedTargetUpdatedAt && Number.isNaN(expectedTargetUpdatedAt?.getTime())) {
      throw new AiImageApplicationError('INVALID_REQUEST', 'Target version must be a valid timestamp');
    }
    if (job.workflowId && input.targetType === 'collect' && !expectedTargetUpdatedAt) {
      throw new AiImageApplicationError('INVALID_REQUEST', 'Target version is required for workflow application');
    }
    if (expectedTargetUpdatedAt && target.updatedAt.getTime() !== expectedTargetUpdatedAt.getTime()) {
      throw new AiImageApplicationError('TARGET_CONFLICT', 'Target images were updated by another operation', {
        targetUpdatedAt: target.updatedAt,
        images: target.images,
        metadata: target.metadata || {},
      });
    }
    const metadata = target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
      ? { ...(target.metadata as Record<string, unknown>) }
      : {};
    const projected = input.targetType === 'collect' && input.mode === 'append'
      ? projectCollectImageAppend(target.images, metadata, urls)
      : null;
    const existingPublishImages = input.targetType === 'collect'
      && Array.isArray(metadata.watermarkedImages)
      && metadata.watermarkedImages.length > 0
      ? metadata.watermarkedImages
      : target.images;
    const images = projected?.images || mergeImages(existingPublishImages, urls, input.mode);
    const editedImages = projected?.editedImages || mergeImages(metadata.editedImages, urls, input.mode);
    const appliedAt = new Date();

    if (input.targetType === 'collect') {
      const changed = await tx.supplyGoods.updateMany({
        where: {
          id: target.id,
          userId: input.ownerUserId,
          ...(expectedTargetUpdatedAt ? { updatedAt: expectedTargetUpdatedAt } : {}),
        },
        data: {
          images,
          metadata: projected?.metadata || { ...metadata, watermarkedImages: images, editedImages },
          updatedAt: appliedAt,
        },
      });
      if (changed.count !== 1) {
        throw new AiImageApplicationError('TARGET_CONFLICT', 'Target images were updated by another operation');
      }
    } else {
      const changed = await tx.product.updateMany({
        where: {
          id: target.id,
          shop: { userId: input.ownerUserId },
          ...(expectedTargetUpdatedAt ? { updatedAt: expectedTargetUpdatedAt } : {}),
        },
        data: { images, updatedAt: appliedAt },
      });
      if (changed.count !== 1) {
        throw new AiImageApplicationError('TARGET_CONFLICT', 'Target images were updated by another operation');
      }
    }

    const application = await tx.aiImageJob.updateMany({
      where: { id: job.id, ownerUserId: input.ownerUserId, status: 'SUCCEEDED', appliedAt: null },
      data: {
        appliedMode: input.mode,
        applyTargetType: input.targetType,
        applyTargetId: input.targetId,
        appliedAt,
      },
    });
    if (application.count !== 1) {
      throw new AiImageApplicationError('ALREADY_APPLIED', 'AI image job has already been applied');
    }
    if (job.workflowId) {
      const payload = {
        mode: input.mode,
        targetType: input.targetType,
        targetId: input.targetId,
        outputAssetId: input.selectedAssetId || null,
      };
      await tx.aiMediaWorkflowEvent.create({ data: {
        workflowId: job.workflowId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        jobId: job.id,
        assetId: input.selectedAssetId || null,
        eventKey: `${job.workflowId}:applied:${job.id}`,
        eventType: 'APPLIED',
        payload,
        payloadHash: aiMediaPayloadHash(payload),
      } });
    }

    return {
      jobId: job.id,
      mode: input.mode,
      targetType: input.targetType,
      targetId: input.targetId,
      images,
      mainImage: projected?.mainImage
        ?? images.find((image): image is string => typeof image === 'string')
        ?? null,
      editedImages,
      targetUpdatedAt: appliedAt,
      appliedAt,
    };
    });
  } catch (error) {
    if (error instanceof AiImageApplicationError && error.code === 'TARGET_CONFLICT' && !error.data) {
      try {
        const current = await database.$transaction(
          (tx) => findOwnedTarget(tx, input),
          { isolationLevel: 'Serializable' },
        );
        throw new AiImageApplicationError('TARGET_CONFLICT', error.message, {
          targetUpdatedAt: current.updatedAt,
          images: current.images,
          metadata: current.metadata || {},
        });
      } catch (reloadError) {
        if (reloadError instanceof AiImageApplicationError && reloadError.code === 'TARGET_CONFLICT') {
          throw reloadError;
        }
      }
    }
    throw error;
  }
}
