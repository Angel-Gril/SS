import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SourceProductCaptureV2 } from 'shared';
import sharp from 'sharp';
import { getStorageBackend } from './image-storage.js';
import { downloadPublicImage } from './source-public-image-download.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';

export class AiMediaContextError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'AiMediaContextError';
  }
}

function productImages(capture: SourceProductCaptureV2) {
  return capture.media.filter((media) => (
    media.kind === 'image'
    && media.disposition === 'accepted'
    && media.role !== 'sku'
    && media.skuKeys.length === 0
    && Boolean(media.url)
  )).slice(0, 50);
}

export function createAiMediaContextService(client: PrismaClient) {
  async function loadCollect(ownerUserId: string, collectId: string) {
    const goods = await client.supplyGoods.findFirst({
      where: { id: collectId, userId: ownerUserId },
      select: {
        id: true,
        title: true,
        sourceCaptureSubject: {
          select: {
            snapshots: {
              orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { id: true, version: true, captureHash: true, payload: true },
            },
          },
        },
      },
    });
    const snapshot = goods?.sourceCaptureSubject?.snapshots[0];
    const capture = snapshot?.payload as unknown as SourceProductCaptureV2 | undefined;
    if (!goods || !snapshot || !capture || capture.captureVersion !== 'source-product-capture-v2') {
      throw new AiMediaContextError('AI_MEDIA_CONTEXT_NOT_FOUND', 404, 'Owned capture context was not found');
    }
    const media = productImages(capture);
    const assets = await client.mediaAsset.findMany({
      where: {
        ownerUserId,
        sourceCaptureSnapshotId: snapshot.id,
        sourceMediaKey: { in: media.map((item) => item.key) },
        kind: 'SOURCE_ORIGINAL',
      },
    });
    const assetByKey = new Map(assets.map((asset) => [asset.sourceMediaKey, asset]));
    return {
      target: { type: 'collect' as const, id: goods.id, label: goods.title },
      snapshot: { id: snapshot.id, version: snapshot.version, captureHash: snapshot.captureHash },
      inputs: media.map((item) => {
        const asset = assetByKey.get(item.key);
        return {
          sourceMediaKey: item.key,
          role: item.role,
          sourceUrl: item.url!,
          assetId: asset?.id || null,
          assetUrl: asset?.url || null,
          mimeType: asset?.mimeType || null,
          width: asset?.width || null,
          height: asset?.height || null,
        };
      }),
    };
  }

  return {
    loadCollect,
    async internalizeCollect(ownerUserId: string, collectId: string, sourceMediaKey: string) {
      const context = await loadCollect(ownerUserId, collectId);
      const selected = context.inputs.find((item) => item.sourceMediaKey === sourceMediaKey);
      if (!selected) throw new AiMediaContextError('SOURCE_MEDIA_NOT_FOUND', 404, 'Source image was not found');
      if (selected.assetId) {
        return {
          id: selected.assetId,
          url: selected.assetUrl!,
          mimeType: selected.mimeType!,
          width: selected.width,
          height: selected.height,
        };
      }
      const downloaded = await downloadPublicImage(selected.sourceUrl);
      const sanitized = await sanitizeOzonPublishImageBuffer(
        downloaded.buffer,
        `ai-source-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
        downloaded.contentType,
      );
      const dimensions = await sharp(sanitized.buffer, { animated: false }).metadata();
      const storage = await getStorageBackend();
      const uploaded = await storage.uploadBuffer(
        sanitized.buffer,
        sanitized.filename,
        sanitized.mimeType,
        { category: 'raw', ownerId: ownerUserId },
      );
      const data = {
        ownerUserId,
        kind: 'SOURCE_ORIGINAL' as const,
        sourceCaptureSnapshotId: context.snapshot.id,
        sourceMediaKey,
        sourceUrl: selected.sourceUrl,
        url: uploaded.url,
        storageBackend: uploaded.backend,
        storageKey: (uploaded as { key?: string }).key || uploaded.filename || null,
        mimeType: sanitized.mimeType,
        sizeBytes: sanitized.buffer.length,
        width: dimensions.width || null,
        height: dimensions.height || null,
        sha256: createHash('sha256').update(sanitized.buffer).digest('hex'),
        metadata: {
          lineageVersion: 'ai-media-source/v1',
          sourceCaptureHash: context.snapshot.captureHash,
          finalSourceUrl: downloaded.finalUrl,
          redirectCount: downloaded.redirectCount,
        },
      };
      try {
        return await client.mediaAsset.create({ data });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        const winner = await client.mediaAsset.findFirst({ where: {
          ownerUserId, sourceCaptureSnapshotId: context.snapshot.id, sourceMediaKey,
        } });
        if (!winner) throw error;
        return winner;
      }
    },
  };
}

export type AiMediaContextService = ReturnType<typeof createAiMediaContextService>;
