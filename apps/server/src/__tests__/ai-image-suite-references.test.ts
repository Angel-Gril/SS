import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiImageSuiteReferenceError,
  createAiImageSuiteReferenceService,
  type AiImageSuiteReferenceAsset,
  type AiImageSuiteReferenceAuthority,
  type AiImageSuiteReferenceRepository,
} from '../services/ai-image-suite-references.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

const sourceUrl = 'https://source.example/product.png';
let image: Buffer;
let authority: AiImageSuiteReferenceAuthority;

async function buildAuthority(overrides: Partial<AiImageSuiteReferenceAuthority> = {}) {
  const capture = structuredClone(fixture.capture) as SourceProductCaptureV2;
  const media = capture.media[0]!;
  media.url = sourceUrl;
  media.width = 4;
  media.height = 3;
  media.mimeType = 'image/png';
  media.fieldEvidence.url = { ...media.fieldEvidence.url, value: sourceUrl };
  media.fieldEvidence.width = {
    ...media.fieldEvidence.width,
    value: 4,
    missingReason: null,
    confidence: 1,
  };
  media.fieldEvidence.height = {
    ...media.fieldEvidence.height,
    value: 3,
    missingReason: null,
    confidence: 1,
  };
  media.fieldEvidence.mimeType = {
    ...media.fieldEvidence.mimeType,
    value: 'image/png',
    sourceType: 'network',
    confidence: 1,
    derivedFrom: [],
  };
  const submission = await createSourceProductCaptureV2Submission(capture);
  const profileHash = buildSourceProductProfileFromCapture(capture, {
    itemId: submission.captureHash,
    captureHash: submission.captureHash,
  }).hash;
  const reference = {
    candidateId: media.key,
    evidenceIds: ['evidence-1'],
    source: {
      url: sourceUrl,
      width: 4,
      height: 3,
      mimeType: 'image/png',
      role: media.role,
      skuKeys: [],
      contentHash: null,
    },
  };
  return {
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    revision: 1,
    status: 'PLANNED',
    provider: 'fake',
    model: 'fake-image-suite-v1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: submission.captureHash,
    sourceProfileHash: profileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'goods-1',
    slots: [
      { ordinal: 0, slotKey: 'sku:sku-1:hero', referencesSnapshot: [reference] },
      { ordinal: 1, slotKey: 'group:group-1:gallery:1', referencesSnapshot: [reference] },
    ],
    snapshot: {
      id: 'snapshot-1',
      ownerUserId: 'owner-1',
      subjectId: 'subject-1',
      captureHash: submission.captureHash,
      profileHash,
      schemaVersion: 'source-product-capture-v2',
      payloadBytes: submission.payloadBytes,
      payload: capture,
    },
    latestSnapshot: {
      id: 'snapshot-1',
      captureHash: submission.captureHash,
      profileHash,
      schemaVersion: 'source-product-capture-v2',
    },
    ...overrides,
  } satisfies AiImageSuiteReferenceAuthority;
}

function asset(overrides: Partial<AiImageSuiteReferenceAsset> = {}): AiImageSuiteReferenceAsset {
  const sha = 'a'.repeat(64);
  return {
    id: 'asset-1',
    ownerUserId: 'owner-1',
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceMediaKey: String((authority.snapshot.payload as SourceProductCaptureV2).media[0]!.key),
    sourceUrl,
    url: 'http://127.0.0.1:3001/uploads/source.png',
    storageBackend: 'local',
    storageKey: 'source.png',
    mimeType: 'image/png',
    sizeBytes: image.length,
    width: 4,
    height: 3,
    sha256: sha,
    sourceSha256: sha,
    metadata: {
      sourceCaptureHash: authority.sourceCaptureHash,
      lineageVersion: 'ai-image-suite-reference-set/v1',
      sourceSha256: sha,
      sourceSizeBytes: image.length,
      sourceMimeType: 'image/png',
    },
    ...overrides,
  };
}

function repository(overrides: Partial<AiImageSuiteReferenceRepository> = {}) {
  const createdAssets: AiImageSuiteReferenceAsset[] = [];
  const value: AiImageSuiteReferenceRepository = {
    findCommitReplay: vi.fn(async () => null),
    loadAuthority: vi.fn(async () => authority),
    findReusableAssets: vi.fn(async () => []),
    createAsset: vi.fn(async (input) => {
      const created = asset({
        id: `asset-${createdAssets.length + 1}`,
        ...input,
        sourceSha256: input.sourceSha256,
      });
      createdAssets.push(created);
      return created;
    }),
    commitBindings: vi.fn(async (input) => ({
      kind: 'committed' as const,
      referenceSetHash: input.referenceSetHash,
    })),
    ...overrides,
  };
  return value;
}

function dependencies(repo: AiImageSuiteReferenceRepository) {
  return {
    repository: repo,
    download: vi.fn(async () => ({
      sourceUrl,
      finalUrl: sourceUrl,
      contentType: 'image/png',
      buffer: image,
      redirectCount: 0,
    })),
    getStorage: vi.fn(async () => ({
      backend: 'local' as const,
      uploadBuffer: vi.fn(async () => ({
        url: 'http://127.0.0.1:3001/uploads/source.png',
        backend: 'local',
        filename: 'source.png',
      })),
    })),
  };
}

const input = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 1,
  operationKey: 'suite-reference-operation-1',
};

describe('AI image suite reference internalization', () => {
  beforeEach(async () => {
    image = await sharp({
      create: { width: 4, height: 3, channels: 4, background: '#2277aa' },
    }).png().toBuffer();
    authority = await buildAuthority();
  });

  it('downloads and uploads one unique candidate shared by multiple slots', async () => {
    const repo = repository();
    const deps = dependencies(repo);

    const result = await createAiImageSuiteReferenceService(deps).internalize(input);

    expect(result).toMatchObject({ suiteId: 'suite-1', referenceCount: 1, replayed: false });
    expect(result.referenceSetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.getStorage).toHaveBeenCalledTimes(1);
    expect(repo.createAsset).toHaveBeenCalledTimes(1);
    expect(repo.commitBindings).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 1,
      operationKey: input.operationKey,
      bindings: [expect.objectContaining({
        ordinal: 0,
        candidateId: (authority.snapshot.payload as SourceProductCaptureV2).media[0]!.key,
        assetId: 'asset-1',
        width: 4,
        height: 3,
      })],
    }));
    const storage = await deps.getStorage.mock.results[0]!.value;
    const upload = vi.mocked((await storage).uploadBuffer);
    expect(upload.mock.calls[0]?.[3].idempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reuses a fully frozen source asset without storage or network access', async () => {
    const reusable = asset();
    const repo = repository({ findReusableAssets: vi.fn(async () => [reusable]) });
    const deps = dependencies(repo);

    const result = await createAiImageSuiteReferenceService(deps).internalize(input);

    expect(result.bindings[0]).toMatchObject({ assetId: reusable.id, assetSha256: reusable.sha256 });
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.getStorage).not.toHaveBeenCalled();
    expect(repo.createAsset).not.toHaveBeenCalled();
  });

  it('redownloads and byte-validates a lineage-incomplete legacy source asset before reuse', async () => {
    const legacy = asset({
      sha256: createHash('sha256').update(image).digest('hex'),
      sourceSha256: null,
      metadata: { sourceCaptureHash: authority.sourceCaptureHash },
    });
    const repo = repository({ findReusableAssets: vi.fn(async () => [legacy]) });
    const deps = dependencies(repo);

    const result = await createAiImageSuiteReferenceService(deps).internalize(input);

    expect(result.bindings[0]).toMatchObject({
      assetId: legacy.id,
      assetSha256: legacy.sha256,
    });
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.getStorage).not.toHaveBeenCalled();
    expect(repo.createAsset).not.toHaveBeenCalled();
  });

  it('creates a local or OSS variant without writing to an existing Ozon CDN asset', async () => {
    const ozonAsset = asset({
      id: 'asset-ozon',
      storageBackend: 'ozon-cdn',
      storageKey: 'ozon/source.png',
      url: 'https://cdn.ozon.example/source.png',
    });
    const repo = repository({ findReusableAssets: vi.fn(async () => [ozonAsset]) });
    const deps = dependencies(repo);

    const result = await createAiImageSuiteReferenceService(deps).internalize(input);

    expect(result.bindings[0]).toMatchObject({
      assetId: 'asset-1',
      storageBackend: 'local',
    });
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.getStorage).toHaveBeenCalledOnce();
    expect(repo.createAsset).toHaveBeenCalledWith(expect.objectContaining({
      sourceMediaKey: (authority.snapshot.payload as SourceProductCaptureV2).media[0]!.key,
      storageBackend: 'local',
    }));
  });

  it('replays the immutable operation before reading mutable suite or source authority', async () => {
    const binding = {
      ordinal: 0,
      candidateId: 'media-1',
      sourceMediaKey: 'media-1',
      sourceUrl,
      expectedContentHash: null,
      sourceSha256: 'a'.repeat(64),
      assetId: 'asset-1',
      assetSha256: 'b'.repeat(64),
      assetUrl: 'http://127.0.0.1:3001/uploads/source.png',
      storageBackend: 'local',
      storageKey: 'source.png',
      mimeType: 'image/png',
      width: 4,
      height: 3,
    };
    const repo = repository({
      findCommitReplay: vi.fn(async () => ({
        kind: 'existing' as const,
        referenceSetHash: 'c'.repeat(64),
        bindings: [binding],
      })),
      loadAuthority: vi.fn(async () => {
        throw new Error('mutable authority must not be read for replay');
      }),
    });
    const deps = dependencies(repo);

    const result = await createAiImageSuiteReferenceService(deps).internalize(input);

    expect(result).toEqual({
      suiteId: input.suiteId,
      referenceCount: 1,
      referenceSetHash: 'c'.repeat(64),
      bindings: [binding],
      replayed: true,
    });
    expect(repo.loadAuthority).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(repo.commitBindings).not.toHaveBeenCalled();
  });

  it('counts reusable raw source bytes toward the aggregate preparation limit', async () => {
    const reusable = asset();
    const repo = repository({ findReusableAssets: vi.fn(async () => [reusable]) });

    await expect(createAiImageSuiteReferenceService(dependencies(repo), {
      maxTotalBytes: image.length - 1,
    }).internalize(input)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED',
      statusCode: 413,
    });
    expect(repo.commitBindings).not.toHaveBeenCalled();
  });

  it('rejects a different operation after the immutable barrier without reading mutable authority', async () => {
    const repo = repository({
      findCommitReplay: vi.fn(async () => ({
        kind: 'already-internalized' as const,
        referenceSetHash: 'c'.repeat(64),
      })),
    });

    await expect(createAiImageSuiteReferenceService(dependencies(repo)).internalize(input))
      .rejects.toMatchObject({
        code: 'AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED',
        statusCode: 409,
      });
    expect(repo.loadAuthority).not.toHaveBeenCalled();
  });

  it('requires frozen source byte hashes before any paid-provider preparation', async () => {
    authority = await buildAuthority({ provider: 'paid-provider', model: 'paid-model' });
    const repo = repository();
    const deps = dependencies(repo);

    await expect(createAiImageSuiteReferenceService(deps).internalize(input)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_REFERENCE_CONTENT_HASH_REQUIRED',
      statusCode: 409,
    });
    expect(deps.download).not.toHaveBeenCalled();
    expect(repo.commitBindings).not.toHaveBeenCalled();
  });

  it('rejects changed decoded dimensions and never commits a partial barrier', async () => {
    const changed = await sharp({
      create: { width: 5, height: 3, channels: 4, background: '#2277aa' },
    }).png().toBuffer();
    const repo = repository();
    const deps = dependencies(repo);
    deps.download.mockResolvedValue({
      sourceUrl,
      finalUrl: sourceUrl,
      contentType: 'image/png',
      buffer: changed,
      redirectCount: 0,
    });

    await expect(createAiImageSuiteReferenceService(deps).internalize(input)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED',
    });
    expect(repo.createAsset).not.toHaveBeenCalled();
    expect(repo.commitBindings).not.toHaveBeenCalled();
  });

  it('maps a completed different operation to an explicit conflict', async () => {
    const reusable = asset();
    const repo = repository({
      findReusableAssets: vi.fn(async () => [reusable]),
      commitBindings: vi.fn(async () => ({
        kind: 'already-internalized' as const,
        referenceSetHash: 'f'.repeat(64),
      })),
    });

    await expect(createAiImageSuiteReferenceService(dependencies(repo)).internalize(input))
      .rejects.toEqual(expect.objectContaining<Partial<AiImageSuiteReferenceError>>({
        code: 'AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED',
        statusCode: 409,
      }));
  });
});
