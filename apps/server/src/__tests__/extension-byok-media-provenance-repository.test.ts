import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokPublishProvenanceReader,
  PrismaExtensionByokMediaProvenanceRepository,
} from '../repositories/extension-byok-media-provenance-repository.js';
import {
  EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
  type ExtensionByokMediaProvenanceCreateInput,
} from '../services/extension-byok-media-provenance.js';

function input(overrides: Partial<ExtensionByokMediaProvenanceCreateInput> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 2,
    draftVersion: 1,
    boundDraftRevision: 3,
    boundDraftVersion: 2,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero:0',
    assignmentOrdinal: 0,
    assignmentSha256: 'e'.repeat(64),
    policyRevision: 7,
    endpointOriginSha256: 'a'.repeat(64),
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    providerRequestIdSha256: null,
    promptSha256: 'b'.repeat(64),
    negativePromptSha256: null,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
    resultSha256: 'c'.repeat(64),
    assetId: 'asset-1',
    resultMimeType: 'image/webp',
    resultWidth: 1024,
    resultHeight: 1024,
    idempotencyKey: 'byok-ingest:workflow-1:sku-1:hero:0:attempt:1',
    requestHash: 'd'.repeat(64),
    publishIntentId: null,
    publishReceiptId: null,
    erpAiChargeCents: 0,
    ...overrides,
  } satisfies ExtensionByokMediaProvenanceCreateInput;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provenance-1',
    ...input(),
    createdAt: new Date('2026-07-25T03:00:00.000Z'),
    updatedAt: new Date('2026-07-25T03:00:00.000Z'),
    ...overrides,
  };
}

describe('Prisma extension BYOK media provenance repository', () => {
  it('inspects selected MediaAsset BYOK markers together with exact draft provenance', async () => {
    const findMany = vi.fn(async () => [{
      id: 'byok_asset-1',
      ownerUserId: 'owner-1',
      sourceMediaKey: 'extension-byok:digest-1',
      metadata: { generatedAssetSource: 'EXTENSION_BYOK' },
      extensionByokMediaProvenance: [input({ assetId: 'byok_asset-1' })],
    }, {
      id: 'asset-source',
      ownerUserId: 'owner-1',
      sourceMediaKey: 'source:1',
      metadata: { generatedAssetSource: 'SOURCE_CAPTURE' },
      extensionByokMediaProvenance: [],
    }]);
    const reader = createPrismaExtensionByokPublishProvenanceReader({
      mediaAsset: { findMany },
    } as never);

    await expect(reader.inspectDraftAssets({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      assetIds: ['byok_asset-1', 'asset-source'],
    })).resolves.toEqual([expect.objectContaining({
      assetId: 'byok_asset-1',
      byokMarked: true,
      provenance: expect.objectContaining({
        assetId: 'byok_asset-1',
        deviceSessionId: 'session-1',
        operation: 'TEXT_TO_IMAGE',
      }),
    }), {
      assetId: 'asset-source',
      byokMarked: false,
      provenance: null,
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerUserId: 'owner-1',
        id: { in: ['byok_asset-1', 'asset-source'] },
      },
      select: expect.objectContaining({
        metadata: true,
        extensionByokMediaProvenance: expect.objectContaining({
          where: expect.objectContaining({
            executionMode: 'BYOK',
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            workflowId: 'workflow-1',
          }),
        }),
      }),
    }));
  });

  it('loads the live session, account, exact shop grant, and shop ownership boundary', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'session-1',
      status: 'ACTIVE',
      expiresAt: new Date('2026-07-27T00:00:00.000Z'),
      revokedAt: null,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      owner: { status: 'ACTIVE', role: 'USER' },
      actor: { status: 'ACTIVE', role: 'USER', parentId: null },
      shopGrants: [{
        status: 'ACTIVE',
        shop: { id: 'shop-1', userId: 'owner-1', status: 'ACTIVE', platform: 'OZON' },
      }],
    }));
    const reader = createPrismaExtensionByokPublishProvenanceReader({
      extensionDeviceSession: { findUnique },
    } as never);

    await expect(reader.loadDeviceAuthorization({
      sessionId: 'session-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    })).resolves.toMatchObject({
      sessionId: 'session-1',
      status: 'ACTIVE',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopGrantStatus: 'ACTIVE',
      shopId: 'shop-1',
      shopOwnerUserId: 'owner-1',
      shopStatus: 'ACTIVE',
      shopPlatform: 'OZON',
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      select: expect.objectContaining({
        shopGrants: expect.objectContaining({ where: { shopId: 'shop-1' } }),
      }),
    }));
  });

  it('creates only the closed non-secret persistence shape', async () => {
    const create = vi.fn(async ({ data }: any) => row(data));
    const client = {
      extensionByokMediaProvenance: {
        findUnique: vi.fn(async () => null),
        create,
      },
    };
    const repository = new PrismaExtensionByokMediaProvenanceRepository(client as never);

    await expect(repository.createOrReplay(input())).resolves.toMatchObject({
      kind: 'created',
      provenance: { id: 'provenance-1', erpAiChargeCents: 0 },
    });
    expect(create).toHaveBeenCalledWith({ data: input() });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/apiKey|authorization|rawBase64|providerResultUrl|providerBody|"prompt"/iu);
  });

  it('returns an exact replay and reports a request-hash conflict', async () => {
    const findUnique = vi.fn(async () => row());
    const create = vi.fn();
    const repository = new PrismaExtensionByokMediaProvenanceRepository({
      extensionByokMediaProvenance: { findUnique, create },
    } as never);

    await expect(repository.createOrReplay(input())).resolves.toMatchObject({
      kind: 'replayed',
      provenance: { id: 'provenance-1' },
    });
    await expect(repository.createOrReplay(input({ requestHash: 'e'.repeat(64) })))
      .resolves.toEqual({ kind: 'conflict' });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not replay a create when publish identities differ', async () => {
    const findUnique = vi.fn(async () => row({
      publishIntentId: 'intent-existing',
      publishReceiptId: 'receipt-existing',
    }));
    const create = vi.fn();
    const repository = new PrismaExtensionByokMediaProvenanceRepository({
      extensionByokMediaProvenance: { findUnique, create },
    } as never);

    await expect(repository.createOrReplay(input())).resolves.toEqual({ kind: 'conflict' });
    expect(create).not.toHaveBeenCalled();
  });

  it('classifies the winner of a concurrent unique-key race', async () => {
    const unique = Object.assign(new Error('unique'), { code: 'P2002' });
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row());
    const repository = new PrismaExtensionByokMediaProvenanceRepository({
      extensionByokMediaProvenance: {
        findUnique,
        create: vi.fn(async () => { throw unique; }),
      },
    } as never);

    await expect(repository.createOrReplay(input())).resolves.toMatchObject({
      kind: 'replayed',
      provenance: { id: 'provenance-1' },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('links publish intent and receipt only from null to one immutable identity', async () => {
    const before = row();
    const after = row({ publishIntentId: 'intent-1', publishReceiptId: 'receipt-1' });
    const findFirst = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaExtensionByokMediaProvenanceRepository({
      extensionByokMediaProvenance: { findFirst, updateMany },
    } as never);

    await expect(repository.linkPublish({
      provenanceId: 'provenance-1',
      ownerUserId: 'owner-1',
      publishIntentId: 'intent-1',
      publishReceiptId: 'receipt-1',
    })).resolves.toMatchObject({ kind: 'linked', provenance: { publishReceiptId: 'receipt-1' } });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'provenance-1',
        ownerUserId: 'owner-1',
        publishIntentId: null,
        publishReceiptId: null,
      },
      data: { publishIntentId: 'intent-1', publishReceiptId: 'receipt-1' },
    });

    const conflictRepository = new PrismaExtensionByokMediaProvenanceRepository({
      extensionByokMediaProvenance: {
        findFirst: vi.fn(async () => after),
        updateMany: vi.fn(),
      },
    } as never);
    await expect(conflictRepository.linkPublish({
      provenanceId: 'provenance-1',
      ownerUserId: 'owner-1',
      publishIntentId: 'intent-2',
      publishReceiptId: 'receipt-1',
    })).resolves.toEqual({ kind: 'conflict' });
  });
});
