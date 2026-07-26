import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ByokGeneratedAssetCreateInput,
  ByokGeneratedAssetCreateResult,
  ByokGeneratedAssetRecord,
  ByokGeneratedAssetRepository,
} from '../services/byok-generated-asset-ingest.js';

type MediaAssetClient = Pick<PrismaClient, 'mediaAsset'>;

function isUniqueConflict(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code || '') === 'P2002'
    || String((error as { code?: unknown } | null)?.code || '') === '23505';
}

function metadata(value: unknown): ByokGeneratedAssetRecord['metadata'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BYOK generated asset metadata is invalid');
  }
  return value as ByokGeneratedAssetRecord['metadata'];
}

function record(row: any): ByokGeneratedAssetRecord {
  if (row.sourceUrl != null) {
    throw new Error('BYOK generated assets cannot retain an external source URL');
  }
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    aiImageJobId: row.aiImageJobId == null ? null : String(row.aiImageJobId),
    kind: row.kind,
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    sourceMediaKey: String(row.sourceMediaKey),
    sourceUrl: null,
    url: String(row.url),
    storageBackend: row.storageBackend,
    storageKey: String(row.storageKey || ''),
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: Number(row.width),
    height: Number(row.height),
    sha256: String(row.sha256),
    metadata: metadata(row.metadata),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  };
}

function createData(input: ByokGeneratedAssetCreateInput) {
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    aiImageJobId: null,
    kind: input.kind,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceMediaKey: input.sourceMediaKey,
    sourceUrl: null,
    url: input.url,
    storageBackend: input.storageBackend,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    metadata: input.metadata as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Persistence adapter for the deterministic BYOK asset identity.  The
 * caller may construct this adapter around a Prisma interactive transaction
 * client, allowing grant consumption, draft binding, provenance, and this
 * row to commit atomically in one serializable transaction.
 */
export function createPrismaByokGeneratedAssetRepository(
  client: MediaAssetClient,
): ByokGeneratedAssetRepository {
  const delegate = client.mediaAsset as any;
  const findById = async (input: { assetId: string; ownerUserId: string }) => {
    const row = await delegate.findUnique({ where: { id: input.assetId } });
    if (!row || String(row.ownerUserId) !== input.ownerUserId) return null;
    return record(row);
  };

  return {
    findById,

    async createOrReplay(input): Promise<ByokGeneratedAssetCreateResult> {
      const existing = await findById({
        assetId: input.id,
        ownerUserId: input.ownerUserId,
      });
      if (existing) return { kind: 'replayed', asset: existing };
      try {
        const created = await delegate.create({ data: createData(input) });
        return { kind: 'created', asset: record(created) };
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const winner = await findById({
          assetId: input.id,
          ownerUserId: input.ownerUserId,
        });
        if (winner) return { kind: 'replayed', asset: winner };
        // A source-lineage uniqueness conflict from an unrelated row must not
        // be reported as a successful replay.
        return { kind: 'conflict' };
      }
    },
  };
}
