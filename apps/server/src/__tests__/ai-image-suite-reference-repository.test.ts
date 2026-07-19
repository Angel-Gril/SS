import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageSuiteReferenceRepository } from '../repositories/ai-image-suite-reference-repository.js';
import {
  AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
  type AiImageSuiteReferenceAssetCreateInput,
  type AiImageSuiteReferenceBinding,
  type AiImageSuiteReferenceCommitInput,
} from '../services/ai-image-suite-references.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const sourceCaptureHash = 'a'.repeat(64);
const sourceProfileHash = 'b'.repeat(64);
const sourceSha256 = 'c'.repeat(64);
const assetSha256 = 'd'.repeat(64);
const sourceUrl = 'https://source.example/product.png';
const assetUrl = 'https://cdn.example/owner-1/product.png';

function frozenReference(evidenceId: string) {
  return {
    candidateId: 'media-1',
    evidenceIds: [evidenceId],
    source: {
      url: sourceUrl,
      width: 900,
      height: 1200,
      mimeType: 'image/png',
      role: 'product_main',
      skuKeys: ['sku-1'],
      contentHash: sourceSha256,
    },
  };
}

function suiteRow(overrides: Record<string, unknown> = {}) {
  const slots = [
    {
      ordinal: 0,
      slotKey: 'sku:sku-1:hero',
      slotHash: '1'.repeat(64),
      referencesSnapshot: [frozenReference('hero-evidence')],
    },
    {
      ordinal: 1,
      slotKey: 'group:group-1:gallery:1',
      slotHash: '2'.repeat(64),
      referencesSnapshot: [frozenReference('gallery-evidence')],
    },
  ];
  const claimPayload = {
    version: 'ai-image-suite-event/v1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    previewHash: '9'.repeat(64),
    itemCount: slots.length,
    maximumCostCents: 0,
    slotHashes: slots.map((slot) => slot.slotHash),
  };
  return {
    id: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'goods-1',
    status: 'PLANNED',
    revision: 1,
    provider: 'fake',
    model: 'fake-image-suite-v1',
    previewHash: claimPayload.previewHash,
    itemCount: slots.length,
    slots,
    events: [{
      id: 'claim-event-1',
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      revision: 1,
      eventType: 'CLAIMED',
      payload: claimPayload,
      payloadHash: hashAiMediaPlanningJson(claimPayload),
    }],
    plan: {
      id: 'plan-1',
      ownerUserId: 'owner-1',
      sourceSubjectId: 'subject-1',
      contextType: 'collect',
      contextId: 'goods-1',
      reviewStatus: 'APPROVED',
      currentVersionId: 'version-1',
      approvedVersionId: 'version-1',
      staleAt: null,
    },
    planVersion: {
      id: 'version-1',
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      sourceSubjectId: 'subject-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash,
      sourceProfileHash,
      sourceSchemaVersion: 'source-product-capture-v2',
    },
    sourceCaptureSnapshot: {
      id: 'snapshot-1',
      subjectId: 'subject-1',
      captureHash: sourceCaptureHash,
      profileHash: sourceProfileHash,
      schemaVersion: 'source-product-capture-v2',
      payloadBytes: 256,
      payload: { captureVersion: 'source-product-capture-v2', media: [] },
      subject: { ownerUserId: 'owner-1' },
    },
    ...overrides,
  };
}

function binding(overrides: Partial<AiImageSuiteReferenceBinding> = {}): AiImageSuiteReferenceBinding {
  return {
    ordinal: 0,
    candidateId: 'media-1',
    sourceMediaKey: 'media-1',
    sourceUrl,
    expectedContentHash: sourceSha256,
    sourceSha256,
    assetId: 'asset-1',
    assetSha256,
    assetUrl,
    storageBackend: 'oss',
    storageKey: 'owner-1/product.png',
    mimeType: 'image/png',
    width: 900,
    height: 1200,
    ...overrides,
  };
}

function commitInput(overrides: Partial<AiImageSuiteReferenceCommitInput> = {}) {
  const bindings = overrides.bindings || [binding()];
  const input = {
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    expectedRevision: 1,
    operationKey: 'suite-references-operation-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    bindings,
    ...overrides,
  };
  return {
    ...input,
    referenceSetHash: overrides.referenceSetHash || hashAiMediaPlanningJson({
      version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      bindings,
    }),
  } satisfies AiImageSuiteReferenceCommitInput;
}

function mediaAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    ownerUserId: 'owner-1',
    aiImageJobId: null,
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: 'media-1',
    sourceUrl,
    url: assetUrl,
    storageBackend: 'oss',
    storageKey: 'owner-1/product.png',
    mimeType: 'image/png',
    sizeBytes: 1234,
    width: 900,
    height: 1200,
    sha256: assetSha256,
    metadata: { sourceCaptureHash, sourceSha256 },
    ...overrides,
  };
}

function clientFixture(options: { latestId?: string; asset?: Record<string, unknown> } = {}) {
  const suite = suiteRow() as any;
  const events = new Map<string, any>();
  let referenceRows: any[] = [];
  const latest = {
    id: options.latestId || 'snapshot-1',
    captureHash: options.latestId ? 'e'.repeat(64) : sourceCaptureHash,
    profileHash: options.latestId ? 'f'.repeat(64) : sourceProfileHash,
    schemaVersion: 'source-product-capture-v2',
  };
  const asset = mediaAsset(options.asset);
  const tx: any = {
    aiMediaSuite: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === suite.id && where.ownerUserId === suite.ownerUserId ? suite : null
      )),
      updateMany: vi.fn(async ({ where }: any) => {
        if (where.id !== suite.id
          || where.ownerUserId !== suite.ownerUserId
          || where.revision !== suite.revision
          || where.status !== suite.status) return { count: 0 };
        suite.revision += 1;
        return { count: 1 };
      }),
    },
    sourceCaptureSubject: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === suite.sourceSubjectId
          && where.ownerUserId === suite.ownerUserId
          && where.legacySupplyGoodsId === suite.contextId
          && where.legacySupplyGoods.userId === suite.ownerUserId
          ? { snapshots: [latest] }
          : null
      )),
    },
    mediaAsset: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.ownerUserId !== asset.ownerUserId) return [];
        if (where.id?.in) return where.id.in.includes(asset.id) ? [asset] : [];
        return where.sourceCaptureSnapshotId === asset.sourceCaptureSnapshotId
          && where.sourceMediaKey?.in?.includes(asset.sourceMediaKey)
          ? [asset]
          : [];
      }),
      findFirst: vi.fn(async () => asset),
      create: vi.fn(async ({ data }: any) => ({ id: 'asset-created', aiImageJobId: null, ...data })),
    },
    aiMediaSuiteReferenceAsset: {
      createMany: vi.fn(async ({ data }: any) => {
        referenceRows = data.map((row: any, index: number) => ({ id: `reference-${index}`, ...row }));
        return { count: data.length };
      }),
      findMany: vi.fn(async () => referenceRows),
    },
    aiMediaSuiteEvent: {
      findUnique: vi.fn(async ({ where }: any) => events.get(where.eventKey) || null),
      findFirst: vi.fn(async ({ where }: any) => (
        [...events.values()].find((event) => (
          event.suiteId === where.suiteId
          && event.ownerUserId === where.ownerUserId
          && event.eventType === where.eventType
        )) || null
      )),
      create: vi.fn(async ({ data }: any) => {
        const event = { id: 'event-1', ...data };
        events.set(data.eventKey, event);
        return event;
      }),
    },
  };
  return {
    suite,
    latest,
    asset,
    events,
    tx,
    get referenceRows() { return referenceRows; },
    set referenceRows(rows: any[]) { referenceRows = rows; },
    client: {
      ...tx,
      $transaction: vi.fn(async (action: (transaction: any) => Promise<unknown>, settings: unknown) => {
        expect(settings).toEqual({ isolationLevel: 'Serializable' });
        return action(tx);
      }),
    } as any,
  };
}

function createAssetInput(): AiImageSuiteReferenceAssetCreateInput {
  return {
    ownerUserId: 'owner-1',
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: 'media-1',
    sourceUrl,
    url: assetUrl,
    storageBackend: 'oss',
    storageKey: 'owner-1/product.png',
    mimeType: 'image/png',
    sizeBytes: 1234,
    width: 900,
    height: 1200,
    sha256: assetSha256,
    sourceSha256,
    metadata: {
      sourceCaptureHash,
      sourceProfileHash,
      sourceSizeBytes: 1400,
    },
  };
}

describe('Prisma AI image suite reference repository', () => {
  it('loads one owner-scoped approved authority with its frozen and latest source snapshots', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteReferenceRepository(fixture.client);

    await expect(repository.loadAuthority({ suiteId: 'suite-1', ownerUserId: 'owner-1' }))
      .resolves.toMatchObject({
        suiteId: 'suite-1',
        ownerUserId: 'owner-1',
        sourceCaptureSnapshotId: 'snapshot-1',
        latestSnapshot: { id: 'snapshot-1', captureHash: sourceCaptureHash },
        slots: [{ ordinal: 0 }, { ordinal: 1 }],
      });
    expect(fixture.tx.aiMediaSuite.findFirst).toHaveBeenCalledWith({
      where: { id: 'suite-1', ownerUserId: 'owner-1' },
      include: expect.objectContaining({
        plan: expect.any(Object),
        planVersion: expect.any(Object),
        sourceCaptureSnapshot: expect.any(Object),
        slots: { orderBy: { ordinal: 'asc' } },
        events: expect.any(Object),
      }),
    });
    expect(fixture.tx.sourceCaptureSubject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'subject-1',
        ownerUserId: 'owner-1',
        legacySupplyGoodsId: 'goods-1',
        legacySupplyGoods: { userId: 'owner-1' },
      }),
    }));

    await expect(repository.loadAuthority({ suiteId: 'suite-1', ownerUserId: 'owner-2' }))
      .resolves.toBeNull();
  });

  it('uses exact source lineage for reuse and omits the service-only sourceSha256 column on create', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteReferenceRepository(fixture.client);

    await repository.findReusableAssets({
      ownerUserId: 'owner-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceMediaKeys: ['media-1'],
    });
    expect(fixture.tx.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'owner-1',
        kind: 'SOURCE_ORIGINAL',
        aiImageJobId: null,
        sourceCaptureSnapshotId: 'snapshot-1',
        sourceMediaKey: { in: ['media-1'] },
      },
      orderBy: [
        { sourceMediaKey: 'asc' },
        { storageBackend: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const input = createAssetInput();
    const created = await repository.createAsset(input);
    const data = fixture.tx.mediaAsset.create.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('sourceSha256');
    expect(data.metadata).toEqual({ ...input.metadata, sourceSha256 });
    expect(created.sourceSha256).toBe(sourceSha256);
  });

  it('accepts only a fully matching P2002 winner, including storage and provenance metadata', async () => {
    const input = createAssetInput();
    const unique = Object.assign(new Error('unique'), { code: 'P2002' });
    const winner = mediaAsset({ metadata: { ...input.metadata, sourceSha256 } });
    const client: any = {
      mediaAsset: {
        create: vi.fn(async () => { throw unique; }),
        findFirst: vi.fn(async () => winner),
      },
    };
    const repository = new PrismaAiImageSuiteReferenceRepository(client);

    await expect(repository.createAsset(input)).resolves.toMatchObject({ id: 'asset-1', sourceSha256 });
    client.mediaAsset.findFirst.mockResolvedValue({ ...winner, storageKey: 'other/key.png' });
    await expect(repository.createAsset(input)).rejects.toBe(unique);
    client.mediaAsset.findFirst.mockResolvedValue({
      ...winner,
      metadata: { ...input.metadata, sourceSha256, sourceSizeBytes: 999 },
    });
    await expect(repository.createAsset(input)).rejects.toBe(unique);
  });

  it('atomically binds the exact candidate set and advances the suite with one audit event', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteReferenceRepository(fixture.client);
    const input = commitInput();

    await expect(repository.commitBindings(input)).resolves.toEqual({
      kind: 'committed',
      referenceSetHash: input.referenceSetHash,
    });
    expect(fixture.tx.aiMediaSuite.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.aiMediaSuiteReferenceAsset.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        suiteId: 'suite-1',
        ownerUserId: 'owner-1',
        ordinal: 0,
        candidateId: 'media-1',
        assetId: 'asset-1',
        sizeBytes: 1234,
        bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      })],
    });
    expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        suiteId: 'suite-1',
        ownerUserId: 'owner-1',
        revision: 2,
        eventType: 'REFERENCES_INTERNALIZED',
        payload: expect.objectContaining({
          referenceSetHash: input.referenceSetHash,
          referenceCount: 1,
          sourceCaptureHash,
          sourceProfileHash,
        }),
      }),
    });
    expect(fixture.suite.revision).toBe(2);
  });

  it('recovers the ordered result before mutable checks and rejects tampered audit bindings', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteReferenceRepository(fixture.client);
    const input = commitInput();
    await repository.commitBindings(input);

    await expect(repository.findCommitReplay(input)).resolves.toEqual({
      kind: 'existing',
      referenceSetHash: input.referenceSetHash,
      bindings: input.bindings,
    });
    await expect(repository.commitBindings(input)).resolves.toEqual({
      kind: 'existing',
      referenceSetHash: input.referenceSetHash,
    });
    await expect(repository.findCommitReplay({ ...input, actorUserId: 'actor-2' }))
      .resolves.toEqual({ kind: 'conflict' });
    await expect(repository.findCommitReplay({
      ...input,
      expectedRevision: 2,
      operationKey: 'suite-references-operation-2',
    })).resolves.toEqual({
      kind: 'already-internalized',
      referenceSetHash: input.referenceSetHash,
    });

    fixture.referenceRows = fixture.referenceRows.map((row) => ({
      ...row,
      bindingHash: '0'.repeat(64),
    }));
    await expect(repository.findCommitReplay(input)).resolves.toEqual({ kind: 'conflict' });
  });

  it('distinguishes same-key mutation, a different completed operation, source drift, and foreign assets', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteReferenceRepository(fixture.client);
    const input = commitInput();
    await repository.commitBindings(input);

    const changedBinding = binding({ assetUrl: 'https://cdn.example/changed.png' });
    await expect(repository.commitBindings(commitInput({
      bindings: [changedBinding],
      operationKey: input.operationKey,
    }))).resolves.toEqual({ kind: 'conflict' });
    await expect(repository.commitBindings(commitInput({
      operationKey: 'suite-references-operation-2',
      expectedRevision: 2,
    }))).resolves.toEqual({
      kind: 'already-internalized',
      referenceSetHash: input.referenceSetHash,
    });

    const staleFixture = clientFixture({ latestId: 'snapshot-2' });
    await expect(new PrismaAiImageSuiteReferenceRepository(staleFixture.client)
      .commitBindings(commitInput())).resolves.toEqual({ kind: 'stale' });
    expect(staleFixture.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();

    const foreignFixture = clientFixture({ asset: { ownerUserId: 'owner-2' } });
    await expect(new PrismaAiImageSuiteReferenceRepository(foreignFixture.client)
      .commitBindings(commitInput())).resolves.toEqual({ kind: 'conflict' });
    expect(foreignFixture.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();
  });
});
