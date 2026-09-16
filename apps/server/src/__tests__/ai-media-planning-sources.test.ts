import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAiMediaPlanningService,
  type AiMediaPlanningAuthority,
  type CreateRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';
import type { DownloadPublicImageOptions } from '../services/source-public-image-download.js';

const defaultIo = vi.hoisted(() => ({ download: vi.fn(), getStorage: vi.fn() }));
vi.mock('../services/source-public-image-download.js', async (original) => ({
  ...await original<typeof import('../services/source-public-image-download.js')>(),
  downloadPublicImage: defaultIo.download,
}));
vi.mock('../services/image-storage.js', () => ({
  getOwnedImageStorageBackend: defaultIo.getStorage,
}));

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

async function fixture() {
  const buffer = await sharp({
    create: { width: 512, height: 512, channels: 3, background: '#a7bccd' },
  }).withMetadata({ density: 96 }).jpeg({ quality: 88 }).toBuffer();
  const authority: AiMediaPlanningAuthority = {
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    capture: {
      captureVersion: 'source-product-capture-v2',
      facts: {}, fieldEvidence: {},
      skus: [{ key: 'sku-1', attributes: [] }],
      media: ['front', 'unselected'].map((key) => ({
        key, kind: 'image', disposition: 'accepted',
        url: `https://source.example/${key}.jpg`,
        width: 512, height: 512, mimeType: 'image/jpeg',
        role: 'product_main', skuKeys: ['sku-1'],
      })),
    } as never,
  };
  const input: CreateRuleBasedAiMediaPlanningInput = {
    ownerUserId: 'owner-1', actorUserId: 'actor-1',
    sourceSubjectId: 'subject-1', sourceCaptureSnapshotId: 'snapshot-1',
    context: { type: 'collect', id: 'goods-1' },
    idempotencyKey: 'planning-freeze-1', selectedSkuKeys: ['sku-1'],
    candidateMediaKeys: ['front'], galleryGoals: ['scene'],
  };
  const assets: any[] = [];
  const stored = new Map<string, Buffer>();
  const uploadBuffer = vi.fn(async (bytes: Buffer, _filename: string, _mime: string, options: any) => {
    const key = `raw/${options.idempotencyKey}.jpg`;
    stored.set(key, Buffer.from(bytes));
    return { backend: 'oss' as const, key, url: `https://assets.example/${key}` };
  });
  const storage = { backend: 'oss' as const, uploadBuffer };
  const download = vi.fn(async (url: string, _options?: DownloadPublicImageOptions) => ({
    sourceUrl: url, finalUrl: url, contentType: 'image/jpeg',
    buffer, redirectCount: 0,
  }));
  const getStorage = vi.fn(async () => storage);
  const latest = {
    snapshotId: input.sourceCaptureSnapshotId,
    captureHash: authority.sourceCaptureHash,
    profileHash: authority.sourceProfileHash,
    schemaVersion: authority.sourceSchemaVersion,
  };
  const repository = {
    loadRulePlanningAuthority: vi.fn(async () => authority),
    loadLatestSourceAuthority: vi.fn(async () => latest),
    findPlanningSourceAssets: vi.fn(async () => assets.slice()),
    createPlanningSourceAsset: vi.fn(async ({ asset }: any) => {
      const created = { ...asset, id: `asset-${assets.length + 1}` };
      assets.push(created);
      return created;
    }),
    createRulePlan: vi.fn(async () => ({
      kind: 'created' as const,
      plan: { id: 'plan-1', reviewStatus: 'PENDING', revision: 1 },
    })),
  };
  return {
    buffer, authority, input, assets, stored, repository, download,
    uploadBuffer, getStorage, storage, latest,
    service: createAiMediaPlanningService(repository as never, {
      sourcePreparation: { download, getStorage },
    }),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AI media planning source byte authority', () => {
  it('freezes selected original bytes before persisting a normal plan', async () => {
    const f = await fixture();
    await f.service.createRuleBased(f.input);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.download).toHaveBeenCalledWith('https://source.example/front.jpg', expect.objectContaining({
      maxBytes: 10 * 1024 * 1024, timeoutMs: expect.any(Number),
    }));
    expect(f.assets).toHaveLength(1);
    const asset = f.assets[0];
    expect(asset).toMatchObject({
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'front',
      sourceSha256: digest(f.buffer), kind: 'SOURCE_ORIGINAL',
      metadata: { sourceSha256: digest(f.buffer), sourceSizeBytes: f.buffer.length },
    });
    expect(asset.sha256).toBe(digest(f.stored.get(asset.storageKey)!));
    expect(asset.sha256).not.toBe(digest(f.buffer));
    expect(f.repository.createRulePlan).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({
        candidates: [expect.objectContaining({ id: 'front', contentHash: digest(f.buffer) })],
      }),
    }));
  });

  it('connects the default service to bounded download and owned storage', async () => {
    const f = await fixture();
    defaultIo.download.mockImplementation(f.download);
    defaultIo.getStorage.mockResolvedValue({ backendType: 'oss', uploadBuffer: f.uploadBuffer });
    const service = createAiMediaPlanningService(f.repository as never);
    await service.createRuleBased(f.input);
    expect(defaultIo.download).toHaveBeenCalledTimes(1);
    expect(defaultIo.getStorage).toHaveBeenCalledTimes(1);
    expect(f.assets[0]?.sourceSha256).toBe(digest(f.buffer));
  });

  it('reuses the frozen owned asset on exact replay without downloading mutable URLs again', async () => {
    const f = await fixture();
    await f.service.createRuleBased(f.input);
    await f.service.createRuleBased(f.input);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(f.repository.createPlanningSourceAsset).toHaveBeenCalledTimes(1);
    expect(f.repository.createRulePlan.mock.calls[1]).toEqual(f.repository.createRulePlan.mock.calls[0]);
  });

  it('rechecks the capture revision after download and refuses a stale plan', async () => {
    const f = await fixture();
    f.download.mockImplementation(async (url: string) => {
      f.latest.captureHash = 'c'.repeat(64);
      return { sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: f.buffer, redirectCount: 0 };
    });
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_CONTEXT_CHANGED', statusCode: 409,
    });
    expect(f.uploadBuffer).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('rejects missing or conflicting raw hashes instead of substituting normalized hashes', async () => {
    const f = await fixture();
    await f.service.createRuleBased(f.input);
    f.assets[0].sourceSha256 = null;
    f.assets[0].metadata.sourceSha256 = null;
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_ASSET_CONFLICT', statusCode: 409,
    });
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.repository.createRulePlan).toHaveBeenCalledTimes(1);
  });

  it('rejects a same-key asset from another owner before reuse', async () => {
    const f = await fixture();
    await f.service.createRuleBased(f.input);
    f.assets[0].ownerUserId = 'other-owner';
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_ASSET_CONFLICT', statusCode: 409,
    });
    expect(f.repository.createRulePlan).toHaveBeenCalledTimes(1);
  });

  it('enforces the byte limit even when an injected download omits enforcement', async () => {
    const f = await fixture();
    f.download.mockImplementation(async (url: string) => ({
      sourceUrl: url, finalUrl: url, contentType: 'image/jpeg',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1), redirectCount: 0,
    }));
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', statusCode: 413,
    });
    expect(f.uploadBuffer).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('uses the remaining round budget for each download and resumes from already frozen assets', async () => {
    const f = await fixture();
    f.input.candidateMediaKeys = ['front', 'unselected'];
    let time = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    f.download.mockImplementation(async (url: string) => {
      time += url.endsWith('/front.jpg') ? 55_000 : 5_001;
      return { sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: f.buffer, redirectCount: 0 };
    });
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_TIMEOUT', statusCode: 504,
    });
    expect(f.download.mock.calls[1]?.[1]?.timeoutMs).toBe(5_000);
    expect(f.assets).toHaveLength(1);
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
    f.download.mockImplementation(async (url: string) => ({
      sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: f.buffer, redirectCount: 0,
    }));
    await f.service.createRuleBased(f.input);
    expect(f.download.mock.calls.map(([url]) => url)).toEqual([
      'https://source.example/front.jpg', 'https://source.example/unselected.jpg',
      'https://source.example/unselected.jpg',
    ]);
    expect(f.assets).toHaveLength(2);
  });

  it('returns at the whole-round deadline even if storage does not settle', async () => {
    const f = await fixture();
    let started!: () => void;
    let finishUpload!: (value: { backend: 'oss'; key: string; url: string }) => void;
    const startedUpload = new Promise<void>((resolve) => { started = resolve; });
    const pendingUpload = new Promise<{ backend: 'oss'; key: string; url: string }>((resolve) => { finishUpload = resolve; });
    f.uploadBuffer.mockImplementation(async () => { started(); return pendingUpload; });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let observed: unknown;
    const operation = f.service.createRuleBased(f.input).then(
      (value) => { observed = value; }, (error) => { observed = error; },
    );
    await startedUpload;
    await vi.advanceTimersByTimeAsync(60_000);
    const outcomeAtDeadline = observed;
    finishUpload({ backend: 'oss', key: 'late-source.jpg', url: 'https://assets.example/late-source.jpg' });
    await operation;
    expect(outcomeAtDeadline).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_TIMEOUT', statusCode: 504 });
    expect(f.repository.createPlanningSourceAsset).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('keeps the legacy replay option internal and leaves legacy candidates without paid hash evidence', async () => {
    const f = await fixture();
    await createAiMediaPlanningService(f.repository as never, { sourcePreparation: false }).createRuleBased(f.input);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({ candidates: [expect.objectContaining({ contentHash: null })] }),
    }));
    await f.service.createRuleBased({ ...f.input, sourcePreparation: false } as CreateRuleBasedAiMediaPlanningInput);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.assets[0].sourceSha256).toBe(digest(f.buffer));
  });

  it('rejects a mismatched response MIME before storing any source bytes', async () => {
    const f = await fixture();
    f.download.mockImplementation(async (url: string) => ({
      sourceUrl: url, finalUrl: url, contentType: 'image/png', buffer: f.buffer, redirectCount: 0,
    }));
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_INVALID', statusCode: 422,
    });
    expect(f.uploadBuffer).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('rejects animated source images instead of silently freezing only the first frame', async () => {
    const f = await fixture();
    const animation = await sharp(Buffer.concat([
      Buffer.alloc(512 * 512 * 3, 10), Buffer.alloc(512 * 512 * 3, 200),
    ]), { raw: { width: 512, height: 1024, pageHeight: 512, channels: 3 } })
      .webp({ loop: 0, delay: [80, 80] }).toBuffer();
    expect((await sharp(animation).metadata()).pages).toBe(2);
    f.authority.capture.media[0]!.mimeType = 'image/webp';
    f.download.mockImplementation(async (url: string) => ({
      sourceUrl: url, finalUrl: url, contentType: 'image/webp', buffer: animation, redirectCount: 0,
    }));
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_INVALID', statusCode: 422,
    });
    expect(f.uploadBuffer).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('does not fall back to seller CDN storage', async () => {
    const f = await fixture();
    const service = createAiMediaPlanningService(f.repository as never, { sourcePreparation: {
      download: f.download, getStorage: async () => ({ backend: 'ozon-cdn', uploadBuffer: f.uploadBuffer }),
    } });
    await expect(service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY', statusCode: 503,
    });
    expect(f.uploadBuffer).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('rejects a capture revision changed during upload and never persists that plan', async () => {
    const f = await fixture();
    const upload = f.uploadBuffer.getMockImplementation()!;
    f.uploadBuffer.mockImplementation(async (...args) => {
      const result = await upload(...args);
      f.latest.profileHash = 'e'.repeat(64);
      return result;
    });
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_CONTEXT_CHANGED', statusCode: 409,
    });
    expect(f.repository.createPlanningSourceAsset).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('accepts the downloader canonical URL while preserving the exact capture source identity', async () => {
    const f = await fixture();
    const sourceUrl = 'https://SOURCE.example:443/front.jpg';
    f.authority.capture.media[0]!.url = sourceUrl;
    f.download.mockImplementation(async (url: string) => ({
      sourceUrl: new URL(url).href, finalUrl: new URL(url).href,
      contentType: 'image/jpeg', buffer: f.buffer, redirectCount: 0,
    }));
    await f.service.createRuleBased(f.input);
    expect(f.assets[0]).toMatchObject({ sourceUrl, metadata: { sourceUrl } });
    expect(f.repository.createRulePlan).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({
        candidates: [expect.objectContaining({ url: sourceUrl, contentHash: digest(f.buffer) })],
      }),
    }));
  });

  it('does not expose raw database connection errors through the input-validation response', async () => {
    const f = await fixture();
    const secret = 'PRIVATE_CONNECTION_SENTINEL';
    f.repository.loadLatestSourceAuthority.mockRejectedValueOnce(new Error(`database connection ${secret}`));
    const error = await f.service.createRuleBased(f.input).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_UNAVAILABLE', statusCode: 503 });
    expect((error as Error).message).not.toContain(secret);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });

  it('fills unknown capture dimensions and MIME only from the frozen source bytes without changing the capture', async () => {
    const f = await fixture();
    f.authority.capture.media[0]!.width = null;
    f.authority.capture.media[0]!.height = null;
    f.authority.capture.media[0]!.mimeType = null;
    const originalCapture = structuredClone(f.authority.capture);
    await f.service.createRuleBased(f.input);
    expect(f.repository.createRulePlan).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({ candidates: [expect.objectContaining({
        id: 'front', width: 512, height: 512, mimeType: 'image/jpeg', contentHash: digest(f.buffer),
      })] }),
      curation: expect.objectContaining({ selectedCandidateIds: ['front'] }),
    }));
    expect(f.authority.capture).toEqual(originalCapture);
    await f.service.createRuleBased(f.input);
    expect(f.repository.createRulePlan.mock.calls[1]).toEqual(f.repository.createRulePlan.mock.calls[0]);
    expect(f.download).toHaveBeenCalledTimes(1);
  });

  it('rejects known capture dimensions that disagree with the bytes instead of replacing them', async () => {
    const f = await fixture();
    f.authority.capture.media[0]!.width = 513;
    await expect(f.service.createRuleBased(f.input)).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_SOURCE_INVALID', statusCode: 422,
    });
    expect(f.authority.capture.media[0]!.width).toBe(513);
    expect(f.repository.createRulePlan).not.toHaveBeenCalled();
  });
});
