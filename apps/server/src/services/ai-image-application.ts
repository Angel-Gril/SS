export type AiImageApplyMode = 'append' | 'replace';
export type AiImageApplyTargetType = 'collect' | 'product';

export interface ApplyAiImageAssetsInput {
  jobId: string;
  ownerUserId: string;
  mode: AiImageApplyMode;
  targetType: AiImageApplyTargetType;
  targetId: string;
}

export interface ApplyAiImageAssetsResult {
  jobId: string;
  mode: AiImageApplyMode;
  targetType: AiImageApplyTargetType;
  targetId: string;
  images: unknown[];
  mainImage: string | null;
  appliedAt: Date;
}

export class AiImageApplicationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiImageApplicationError';
  }
}

interface GeneratedAssetRow {
  ownerUserId: string;
  aiImageJobId: string | null;
  url: string;
}

interface AiImageJobRow {
  id: string;
  ownerUserId: string;
  status: string;
  appliedAt: Date | null;
  assets: GeneratedAssetRow[];
}

interface ImageTargetRow {
  id: string;
  images: unknown;
  userId?: string;
  shop?: { userId: string };
}

interface TransactionClient {
  aiImageJob: {
    findUnique(args: unknown): Promise<AiImageJobRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  supplyGoods: {
    findFirst(args: unknown): Promise<ImageTargetRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  product: {
    findFirst(args: unknown): Promise<ImageTargetRow | null>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface AiImageApplicationDatabase {
  $transaction<T>(callback: (tx: TransactionClient) => Promise<T>, options?: { isolationLevel: 'Serializable' }): Promise<T>;
}

function generatedUrls(job: AiImageJobRow, ownerUserId: string): string[] {
  if (!job.assets.length) {
    throw new AiImageApplicationError('INVALID_ASSETS', 'AI image job has no generated assets');
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const asset of job.assets) {
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

async function findOwnedTarget(tx: TransactionClient, input: ApplyAiImageAssetsInput): Promise<ImageTargetRow> {
  if (input.targetType === 'collect') {
    const target = await tx.supplyGoods.findFirst({
      where: { id: input.targetId, userId: input.ownerUserId },
      select: { id: true, userId: true, images: true },
    });
    if (target) return target;
  } else {
    const target = await tx.product.findFirst({
      where: { id: input.targetId, shop: { userId: input.ownerUserId } },
      select: { id: true, images: true, shop: { select: { userId: true } } },
    });
    if (target?.shop?.userId === input.ownerUserId) return target;
  }
  throw new AiImageApplicationError('TARGET_NOT_FOUND', 'Image application target not found');
}

export async function applyAiImageAssets(
  database: AiImageApplicationDatabase,
  input: ApplyAiImageAssetsInput,
): Promise<ApplyAiImageAssetsResult> {
  if (!input.jobId || !input.ownerUserId || !input.targetId) {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Job, owner and target are required');
  }
  if (input.mode !== 'append' && input.mode !== 'replace') {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Apply mode must be append or replace');
  }
  if (input.targetType !== 'collect' && input.targetType !== 'product') {
    throw new AiImageApplicationError('INVALID_REQUEST', 'Apply target must be collect or product');
  }

  return database.$transaction(async (tx) => {
    const job = await tx.aiImageJob.findUnique({
      where: { id: input.jobId },
      include: { assets: true },
    });
    if (!job || job.ownerUserId !== input.ownerUserId) {
      throw new AiImageApplicationError('NOT_FOUND', 'AI image job not found');
    }
    if (job.status !== 'SUCCEEDED') {
      throw new AiImageApplicationError('INVALID_STATE', 'Only succeeded jobs can be applied');
    }
    if (job.appliedAt) {
      throw new AiImageApplicationError('ALREADY_APPLIED', 'AI image job has already been applied');
    }

    const urls = generatedUrls(job, input.ownerUserId);
    const target = await findOwnedTarget(tx, input);
    const images = mergeImages(target.images, urls, input.mode);
    const appliedAt = new Date();

    if (input.targetType === 'collect') {
      await tx.supplyGoods.update({ where: { id: target.id }, data: { images } });
    } else {
      await tx.product.update({ where: { id: target.id }, data: { images } });
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

    return {
      jobId: job.id,
      mode: input.mode,
      targetType: input.targetType,
      targetId: input.targetId,
      images,
      mainImage: images.find((image): image is string => typeof image === 'string') || null,
      appliedAt,
    };
  }, { isolationLevel: 'Serializable' });
}
