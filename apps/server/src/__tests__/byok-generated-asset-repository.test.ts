import { describe, expect, it, vi } from 'vitest';
import { createPrismaByokGeneratedAssetRepository } from '../repositories/byok-generated-asset-repository.js';
import {
  BYOK_GENERATED_ASSET_INGEST_VERSION,
  BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
  byokGeneratedAssetMatchesCreateInput,
  type ByokGeneratedAssetCreateInput,
} from '../services/byok-generated-asset-ingest.js';

const HASH = 'a'.repeat(64);

function asset(overrides: Partial<ByokGeneratedAssetCreateInput> = {}): ByokGeneratedAssetCreateInput {
  return {
    id: 'byok_123456789012345678901234567890123456789012345678',
    ownerUserId: 'owner-1',
    aiImageJobId: null,
    kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: `extension-byok:${'b'.repeat(64)}`,
    sourceUrl: null,
    url: 'https://cdn.example.com/byok.png',
    storageBackend: 'oss',
    storageKey: 'users/owner-1/ai-generated/idempotent/byok.png',
    mimeType: 'image/png',
    sizeBytes: 123,
    width: 3,
    height: 2,
    sha256: HASH,
    metadata: {
      ingestContractVersion: BYOK_GENERATED_ASSET_INGEST_VERSION,
      normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
      generatedAssetSource: 'EXTENSION_BYOK',
      executionMode: 'BYOK',
      outputRole: 'BYOK_ACCEPTED',
      pixelOrientationNormalized: true,
      idempotencyKeySha256: 'c'.repeat(64),
      requestHash: 'd'.repeat(64),
      providerResultSha256: 'e'.repeat(64),
      providerResultMimeType: 'image/png',
      providerResultSizeBytes: 140,
      normalizedSha256: HASH,
    },
    ...overrides,
  };
}

function persisted(input = asset()) {
  return { ...input, createdAt: new Date('2026-07-25T00:00:00.000Z') };
}

describe('Prisma BYOK generated asset repository', () => {
  it('creates an AI_GENERATED MediaAsset with no Provider URL or AI job binding', async () => {
    const input = asset();
    const mediaAsset = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => persisted(data)),
    };
    const repository = createPrismaByokGeneratedAssetRepository({ mediaAsset } as never);

    await expect(repository.createOrReplay(input)).resolves.toMatchObject({
      kind: 'created',
      asset: { id: input.id, kind: 'AI_GENERATED', sourceUrl: null, aiImageJobId: null },
    });
    expect(mediaAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: input.id,
        ownerUserId: 'owner-1',
        aiImageJobId: null,
        kind: 'AI_GENERATED',
        sourceUrl: null,
        sha256: HASH,
      }),
    });
  });

  it('replays the deterministic primary-key winner without another insert', async () => {
    const input = asset();
    const mediaAsset = {
      findUnique: vi.fn(async () => persisted(input)),
      create: vi.fn(),
    };
    const repository = createPrismaByokGeneratedAssetRepository({ mediaAsset } as never);
    await expect(repository.createOrReplay(input)).resolves.toMatchObject({
      kind: 'replayed', asset: { id: input.id },
    });
    const reloaded = await repository.findById({ assetId: input.id, ownerUserId: input.ownerUserId });
    expect(reloaded && byokGeneratedAssetMatchesCreateInput(reloaded, input)).toBe(true);
    expect(mediaAsset.create).not.toHaveBeenCalled();
  });

  it('treats JSONB key reordering as the same exact metadata instead of a conflict', async () => {
    const input = asset();
    const reorderedMetadata = Object.fromEntries(
      Object.entries(input.metadata).reverse(),
    ) as unknown as typeof input.metadata;
    const mediaAsset = {
      findUnique: vi.fn(async () => persisted({ ...input, metadata: reorderedMetadata })),
      create: vi.fn(),
    };
    const repository = createPrismaByokGeneratedAssetRepository({ mediaAsset } as never);
    await expect(repository.createOrReplay(input)).resolves.toMatchObject({
      kind: 'replayed', asset: { id: input.id },
    });
    const reloaded = await repository.findById({ assetId: input.id, ownerUserId: input.ownerUserId });
    expect(reloaded && byokGeneratedAssetMatchesCreateInput(reloaded, input)).toBe(true);
    expect(mediaAsset.create).not.toHaveBeenCalled();
  });

  it('classifies a concurrent primary-key winner as replay and an unrelated uniqueness error as conflict', async () => {
    const input = asset();
    const winner = persisted(input);
    const mediaAsset = {
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      create: vi.fn(async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }),
    };
    const repository = createPrismaByokGeneratedAssetRepository({ mediaAsset } as never);
    await expect(repository.createOrReplay(input)).resolves.toMatchObject({
      kind: 'replayed', asset: { id: input.id },
    });
    await expect(repository.createOrReplay(input)).resolves.toEqual({ kind: 'conflict' });
  });

  it('does not project an external source URL as a trusted generated asset', async () => {
    const mediaAsset = {
      findUnique: vi.fn(async () => persisted(asset({
        sourceUrl: 'https://provider.example/result.png' as never,
      }))),
      create: vi.fn(),
    };
    const repository = createPrismaByokGeneratedAssetRepository({ mediaAsset } as never);
    await expect(repository.findById({
      assetId: asset().id,
      ownerUserId: 'owner-1',
    })).rejects.toThrow('cannot retain an external source URL');
  });
});
