import { Prisma, type PrismaClient } from '@prisma/client';
import {
  verifySourceProductCaptureV2Submission,
  type SourceCaptureMedia,
} from 'shared';
import type {
  SourceListingImportedMediaAsset,
  SourceListingMediaAssetCreateInput,
  SourceListingMediaImportDependencies,
} from './source-listing-media-import.js';

type MediaImportPrismaClient = Pick<PrismaClient, 'sourceCaptureSnapshot' | 'mediaAsset'>;

function captureMedia(payload: unknown): SourceCaptureMedia[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as { captureVersion?: unknown; media?: unknown };
  if (record.captureVersion !== 'source-product-capture-v2' || !Array.isArray(record.media)) return null;
  return record.media as SourceCaptureMedia[];
}

function lineageWhere(input: {
  ownerUserId: string;
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
}) {
  return {
    ownerUserId: input.ownerUserId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceMediaKey: input.sourceMediaKey,
    storageBackend: { in: ['oss', 'ozon-cdn'] },
  };
}

function isUniqueConflict(error: unknown): boolean {
  return String((error as { code?: unknown })?.code || '') === 'P2002';
}

export function createPrismaSourceListingMediaImportStore(
  client: MediaImportPrismaClient,
): Pick<
  SourceListingMediaImportDependencies,
  'loadCaptureAuthority' | 'findReusableAsset' | 'loadOwnedAssets' | 'createAsset'
> {
  const findReusableAsset = async (input: {
    ownerUserId: string;
    sourceCaptureSnapshotId: string;
    sourceMediaKey: string;
  }): Promise<SourceListingImportedMediaAsset | null> => (
    client.mediaAsset.findFirst({
      where: lineageWhere(input),
      orderBy: [{ storageBackend: 'asc' }, { createdAt: 'asc' }],
    }) as Promise<SourceListingImportedMediaAsset | null>
  );

  return {
    async loadCaptureAuthority(input) {
      const snapshot = await client.sourceCaptureSnapshot.findFirst({
        where: { id: input.snapshotId, subject: { ownerUserId: input.ownerUserId } },
        select: { id: true, captureHash: true, payloadBytes: true, payload: true },
      });
      if (!snapshot) return null;
      const verification = await verifySourceProductCaptureV2Submission({
        capture: snapshot.payload,
        captureHash: snapshot.captureHash,
        payloadBytes: snapshot.payloadBytes,
      });
      if (!verification.valid) return null;
      const media = captureMedia(snapshot.payload);
      if (!media) return null;
      return {
        snapshotId: snapshot.id,
        captureHash: snapshot.captureHash,
        media,
      };
    },

    findReusableAsset,

    async loadOwnedAssets(input) {
      return client.mediaAsset.findMany({
        where: { ownerUserId: input.ownerUserId, id: { in: input.assetIds } },
      }) as unknown as Promise<SourceListingImportedMediaAsset[]>;
    },

    async createAsset(input: SourceListingMediaAssetCreateInput) {
      const data = {
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
        sourceMediaKey: input.sourceMediaKey,
        sourceUrl: input.sourceUrl,
        url: input.url,
        storageBackend: input.storageBackend,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        sha256: input.sha256,
        metadata: input.metadata as Prisma.InputJsonValue,
      };
      try {
        return await client.mediaAsset.create({ data }) as unknown as SourceListingImportedMediaAsset;
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const winner = await findReusableAsset(input);
        if (!winner || winner.storageBackend !== input.storageBackend) {
          const exactWinner = await client.mediaAsset.findFirst({
            where: {
              ownerUserId: input.ownerUserId,
              sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
              sourceMediaKey: input.sourceMediaKey,
              storageBackend: input.storageBackend,
            },
            orderBy: { createdAt: 'asc' },
          }) as SourceListingImportedMediaAsset | null;
          if (!exactWinner) throw error;
          return exactWinner;
        }
        return winner;
      }
    },
  };
}
