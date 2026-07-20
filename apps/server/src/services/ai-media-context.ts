import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SourceProductCaptureV2 } from 'shared';
import sharp from 'sharp';
import { getStorageBackend } from './image-storage.js';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import { downloadPublicImage } from './source-public-image-download.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';
import {
  AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO,
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  isAiMediaEditReadySourceAsset,
} from './ai-image-edit-source.js';

export {
  AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO,
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  isAiMediaEditReadySourceAsset,
} from './ai-image-edit-source.js';

type AiMediaInternalizePurpose = 'GENERAL' | 'EDIT';

interface AiMediaContextDependencies {
  downloadPublicImage: typeof downloadPublicImage;
  sanitizeOzonPublishImageBuffer: typeof sanitizeOzonPublishImageBuffer;
  getStorageBackend: typeof getStorageBackend;
  loadStoredSourceAsset: (asset: any) => Promise<Buffer>;
}

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

function editSourceMediaKey(sourceMediaKey: string) {
  return `ai-edit-source:v1:${createHash('sha256').update(sourceMediaKey).digest('hex')}`;
}

async function inspectAiMediaSourceBuffer(buffer: Buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > AI_MEDIA_EDIT_SOURCE_MAX_BYTES) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source image exceeds the edit byte limit');
  }
  try {
    const metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
    }).metadata();
    if (
      !metadata.format
      || Number(metadata.pages || 1) !== 1
      || !Number.isSafeInteger(metadata.width)
      || !Number.isSafeInteger(metadata.height)
      || Number(metadata.width) < 1
      || Number(metadata.height) < 1
      || Number(metadata.width) > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
      || Number(metadata.height) > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
      || Number(metadata.width) * Number(metadata.height) > AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
      || Math.max(Number(metadata.width), Number(metadata.height))
        / Math.min(Number(metadata.width), Number(metadata.height)) > AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO
    ) {
      throw new Error('invalid source metadata');
    }
    return metadata;
  } catch {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source image exceeds edit dimensions or cannot be decoded safely');
  }
}

export async function normalizeAiMediaSourceBuffer(input: {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
}) {
  const metadata = await inspectAiMediaSourceBuffer(input.buffer);
  if (!['jpeg', 'png'].includes(String(metadata.format || ''))) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Normalized edit source must be JPEG or PNG');
  }
  const sourceOrientation = metadata.orientation || 1;
  if (sourceOrientation === 1) {
    return {
      buffer: input.buffer,
      width: metadata.width || null,
      height: metadata.height || null,
      sourceOrientation,
      orientationNormalizationApplied: false,
    };
  }
  const pipeline = sharp(input.buffer, {
    animated: false,
    limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  }).rotate();
  const buffer = input.mimeType === 'image/png'
    ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  if (buffer.length > AI_MEDIA_EDIT_SOURCE_MAX_BYTES) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Normalized edit source exceeds the byte limit');
  }
  const normalized = await inspectAiMediaSourceBuffer(buffer);
  return {
    buffer,
    width: normalized.width || null,
    height: normalized.height || null,
    sourceOrientation,
    orientationNormalizationApplied: true,
  };
}

export function createAiMediaContextService(
  client: PrismaClient,
  dependencyOverrides: Partial<AiMediaContextDependencies> = {},
) {
  const dependencies: AiMediaContextDependencies = {
    downloadPublicImage,
    sanitizeOzonPublishImageBuffer,
    getStorageBackend,
    loadStoredSourceAsset: (asset) => loadAiImageEditInputBuffer(asset),
    ...dependencyOverrides,
  };

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
    const mediaKeys = media.map((item) => item.key);
    const editKeyToSourceKey = new Map(mediaKeys.map((key) => [editSourceMediaKey(key), key]));
    const assets = await client.mediaAsset.findMany({
      where: {
        ownerUserId,
        sourceCaptureSnapshotId: snapshot.id,
        sourceMediaKey: { in: [...mediaKeys, ...editKeyToSourceKey.keys()] },
        kind: 'SOURCE_ORIGINAL',
      },
    });
    const assetByKey = new Map<string | null, (typeof assets)[number]>();
    const editAssetByKey = new Map<string | null, (typeof assets)[number]>();
    const compatibleAssetsByKey = new Map<string | null, Array<(typeof assets)[number]>>();
    const storageRank = (backend: string) => (
      backend === 'oss' ? 0 : backend === 'local' ? 1 : 2
    );
    for (const asset of assets) {
      const sourceMediaKey = editKeyToSourceKey.get(String(asset.sourceMediaKey || ''))
        || asset.sourceMediaKey;
      compatibleAssetsByKey.set(sourceMediaKey, [
        ...(compatibleAssetsByKey.get(sourceMediaKey) || []),
        asset,
      ]);
      const existing = assetByKey.get(sourceMediaKey);
      if (!existing || storageRank(asset.storageBackend) < storageRank(existing.storageBackend)) {
        assetByKey.set(sourceMediaKey, asset);
      }
      if (isAiMediaEditReadySourceAsset(asset)) {
        const existingEdit = editAssetByKey.get(sourceMediaKey);
        if (!existingEdit || storageRank(asset.storageBackend) < storageRank(existingEdit.storageBackend)) {
          editAssetByKey.set(sourceMediaKey, asset);
        }
      }
    }
    return {
      target: { type: 'collect' as const, id: goods.id, label: goods.title },
      snapshot: { id: snapshot.id, version: snapshot.version, captureHash: snapshot.captureHash },
      inputs: media.map((item) => {
        const editAsset = editAssetByKey.get(item.key);
        const asset = editAsset || assetByKey.get(item.key);
        const compatibleAssetIds = [...new Set([
          ...(asset?.id ? [asset.id] : []),
          ...(compatibleAssetsByKey.get(item.key) || []).map((candidate) => candidate.id),
        ])];
        return {
          sourceMediaKey: item.key,
          role: item.role,
          sourceUrl: item.url!,
          assetId: asset?.id || null,
          assetUrl: asset?.url || null,
          mimeType: asset?.mimeType || null,
          width: asset?.width || null,
          height: asset?.height || null,
          editReady: Boolean(editAsset),
          compatibleAssetIds,
        };
      }),
    };
  }

  return {
    loadCollect,
    async internalizeCollect(
      ownerUserId: string,
      collectId: string,
      sourceMediaKey: string,
      purpose: AiMediaInternalizePurpose = 'GENERAL',
    ) {
      const context = await loadCollect(ownerUserId, collectId);
      const selected = context.inputs.find((item) => item.sourceMediaKey === sourceMediaKey);
      if (!selected) throw new AiMediaContextError('SOURCE_MEDIA_NOT_FOUND', 404, 'Source image was not found');
      if (selected.assetId && (purpose !== 'EDIT' || selected.editReady)) {
        return {
          id: selected.assetId,
          url: selected.assetUrl!,
          mimeType: selected.mimeType!,
          width: selected.width,
          height: selected.height,
          editReady: selected.editReady,
        };
      }
      if (purpose === 'GENERAL') {
        const downloaded = await dependencies.downloadPublicImage(selected.sourceUrl);
        const sanitized = await dependencies.sanitizeOzonPublishImageBuffer(
          downloaded.buffer,
          `ai-source-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
          downloaded.contentType,
        );
        const dimensions = await sharp(sanitized.buffer, { animated: false }).metadata();
        const storage = await dependencies.getStorageBackend();
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
            sourceUrl: selected.sourceUrl,
            finalSourceUrl: downloaded.finalUrl,
            sourceSha256: createHash('sha256').update(downloaded.buffer).digest('hex'),
            sourceSizeBytes: downloaded.buffer.length,
            sourceMimeType: downloaded.contentType,
            sourceFormat: sanitized.sourceFormat,
            redirectCount: downloaded.redirectCount,
          },
        };
        try {
          const created = await client.mediaAsset.create({ data });
          return { ...created, editReady: isAiMediaEditReadySourceAsset(created) };
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          const winner = await client.mediaAsset.findFirst({ where: {
            ownerUserId,
            sourceCaptureSnapshotId: context.snapshot.id,
            sourceMediaKey,
            storageBackend: uploaded.backend,
          } });
          if (!winner) throw error;
          return { ...winner, editReady: isAiMediaEditReadySourceAsset(winner) };
        }
      }
      const storedSource = selected.assetId
        ? await client.mediaAsset.findFirst({ where: {
            id: selected.assetId,
            ownerUserId,
            sourceCaptureSnapshotId: context.snapshot.id,
            kind: 'SOURCE_ORIGINAL',
          } })
        : null;
      let sourceBuffer: Buffer;
      let sourceContentType: string;
      let finalSourceUrl: string;
      let redirectCount: number;
      let sourceReadMode: 'owned_storage' | 'public_download';
      if (
        storedSource
        && ['local', 'oss'].includes(String(storedSource.storageBackend || ''))
        && String(storedSource.storageKey || '').trim()
        && Number.isSafeInteger(storedSource.sizeBytes)
        && storedSource.sizeBytes > 0
        && storedSource.sizeBytes <= AI_MEDIA_EDIT_SOURCE_MAX_BYTES
      ) {
        sourceBuffer = await dependencies.loadStoredSourceAsset(storedSource);
        sourceContentType = storedSource.mimeType;
        finalSourceUrl = storedSource.url;
        redirectCount = 0;
        sourceReadMode = 'owned_storage';
      } else {
        const downloaded = await dependencies.downloadPublicImage(selected.sourceUrl);
        sourceBuffer = downloaded.buffer;
        sourceContentType = downloaded.contentType;
        finalSourceUrl = downloaded.finalUrl;
        redirectCount = downloaded.redirectCount;
        sourceReadMode = 'public_download';
      }
      await inspectAiMediaSourceBuffer(sourceBuffer);
      const sanitized = await dependencies.sanitizeOzonPublishImageBuffer(
        sourceBuffer,
        `ai-source-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
        sourceContentType,
      );
      const normalized = await normalizeAiMediaSourceBuffer({
        buffer: sanitized.buffer,
        mimeType: sanitized.mimeType,
      });
      const normalizedSha256 = createHash('sha256').update(normalized.buffer).digest('hex');
      const normalizedSourceMediaKey = editSourceMediaKey(sourceMediaKey);
      const uploadIdempotencyKey = createHash('sha256').update([
        AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
        ownerUserId,
        context.snapshot.id,
        sourceMediaKey,
        normalizedSha256,
      ].join('\0')).digest('hex');
      const extension = sanitized.mimeType === 'image/png' ? 'png' : 'jpg';
      const storage = await dependencies.getStorageBackend();
      const uploaded = await storage.uploadBuffer(
        normalized.buffer,
        `ai-edit-source-${normalizedSha256.slice(0, 24)}.${extension}`,
        sanitized.mimeType,
        { category: 'raw', ownerId: ownerUserId, idempotencyKey: uploadIdempotencyKey },
      );
      const storageKey = (uploaded as { key?: string }).key || uploaded.filename || null;
      if (!uploaded.url || !storageKey || (purpose === 'EDIT' && !['local', 'oss'].includes(uploaded.backend))) {
        throw new AiMediaContextError('STORAGE_NOT_READY', 503, 'Edit source requires durable local or OSS storage');
      }
      const data = {
        ownerUserId,
        kind: 'SOURCE_ORIGINAL' as const,
        sourceCaptureSnapshotId: context.snapshot.id,
        sourceMediaKey: normalizedSourceMediaKey,
        sourceUrl: selected.sourceUrl,
        url: uploaded.url,
        storageBackend: uploaded.backend,
        storageKey,
        mimeType: sanitized.mimeType,
        sizeBytes: normalized.buffer.length,
        width: normalized.width,
        height: normalized.height,
        sha256: normalizedSha256,
        metadata: {
          lineageVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
          originalSourceMediaKey: sourceMediaKey,
          pixelOrientationNormalized: true,
          sourceOrientation: normalized.sourceOrientation,
          orientationNormalizationApplied: normalized.orientationNormalizationApplied,
          sourceCaptureHash: context.snapshot.captureHash,
          sourceUrl: selected.sourceUrl,
          finalSourceUrl,
          sourceReadMode,
          sourceSha256: createHash('sha256').update(sourceBuffer).digest('hex'),
          sourceSizeBytes: sourceBuffer.length,
          sourceMimeType: sourceContentType,
          sourceFormat: sanitized.sourceFormat,
          redirectCount,
        },
      };
      try {
        const created = await client.mediaAsset.create({ data });
        return { ...created, editReady: isAiMediaEditReadySourceAsset(created) };
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        const winner = await client.mediaAsset.findFirst({ where: {
          ownerUserId,
          sourceCaptureSnapshotId: context.snapshot.id,
          sourceMediaKey: normalizedSourceMediaKey,
          storageBackend: uploaded.backend,
        } });
        if (!winner) throw error;
        if (purpose === 'EDIT' && !isAiMediaEditReadySourceAsset(winner)) {
          throw new AiMediaContextError('INVALID_MEDIA_INPUT', 409, 'Persisted edit source conflicts with its normalization contract');
        }
        return { ...winner, editReady: isAiMediaEditReadySourceAsset(winner) };
      }
    },
  };
}

export type AiMediaContextService = ReturnType<typeof createAiMediaContextService>;
