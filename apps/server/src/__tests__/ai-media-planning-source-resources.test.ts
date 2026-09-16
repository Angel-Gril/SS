import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MEDIA_PLANNING_SOURCE_TIMEOUT_MS,
  prepareAiMediaPlanningSources,
  type AiMediaPlanningSourceRepository,
  type AiMediaPlanningSourceScope,
} from '../services/ai-media-planning-sources.js';

vi.mock('../services/image-storage.js', () => ({
  getOwnedImageStorageBackend: () => { throw new Error('Resource tests must not use configured storage'); },
}));

function scope(ownerUserId = 'resource-owner'): AiMediaPlanningSourceScope {
  return {
    ownerUserId,
    sourceSubjectId: 'resource-subject',
    sourceCaptureSnapshotId: 'resource-snapshot',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'resource-goods',
  };
}

const candidate = {
  id: 'resource-front', url: 'https://fixture.invalid/front.png',
  width: 2, height: 2, mimeType: 'image/png', role: 'product_main' as const,
  skuKeys: ['resource-sku'], contentHash: null,
};

function repository() {
  return {
    loadLatestSourceAuthority: vi.fn(async () => ({
      snapshotId: 'resource-snapshot', captureHash: 'a'.repeat(64),
      profileHash: 'b'.repeat(64), schemaVersion: 'source-product-capture-v2',
    })),
    findPlanningSourceAssets: vi.fn(async () => []),
    createPlanningSourceAsset: vi.fn(async () => null),
  };
}

function blockedDownload() {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const download = vi.fn(async () => {
    await barrier;
    throw new Error('Synthetic download stopped without network');
  });
  const getStorage = vi.fn(async () => { throw new Error('No storage access is expected'); });
  return { release, download, getStorage };
}

function observe<T>(operation: Promise<T>) {
  let outcome: unknown;
  const done = operation.then(
    (value) => { outcome = value; },
    (error: unknown) => { outcome = error; },
  );
  return { done, outcome: () => outcome };
}

async function drain() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => { vi.useRealTimers(); });

describe('planning source resource admission', () => {
  it('merges six simultaneous identical scopes before any download or storage work', async () => {
    const repo = repository();
    const io = blockedDownload();
    const calls = Array.from({ length: 6 }, () => observe(
      prepareAiMediaPlanningSources(repo, { ...scope() }, [{ ...candidate }], io),
    ));
    try {
      await drain();
      expect(io.download).toHaveBeenCalledTimes(1);
      expect(repo.findPlanningSourceAssets).toHaveBeenCalledTimes(1);
    } finally {
      io.release();
      await Promise.all(calls.map(call => call.done));
    }
    for (const call of calls) expect(call.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_FETCH_FAILED' });
    expect(io.getStorage).not.toHaveBeenCalled();
  });

  it('rejects other scopes for the same owner instead of merging different capture or candidate authority', async () => {
    const repo = repository();
    const io = blockedDownload();
    const first = observe(prepareAiMediaPlanningSources(repo, scope(), [candidate], io));
    const variants = [
      { scope: { ...scope(), sourceSubjectId: 'other-subject' }, candidate },
      { scope: { ...scope(), sourceCaptureSnapshotId: 'other-snapshot' }, candidate },
      { scope: { ...scope(), sourceCaptureHash: 'c'.repeat(64) }, candidate },
      { scope: { ...scope(), sourceProfileHash: 'c'.repeat(64) }, candidate },
      { scope: { ...scope(), sourceSchemaVersion: 'other-schema' }, candidate },
      { scope: { ...scope(), contextId: 'other-goods' }, candidate },
      { scope: scope(), candidate: { ...candidate, url: 'https://fixture.invalid/other.png' } },
      { scope: scope(), candidate: { ...candidate, width: 3 } },
      { scope: scope(), candidate: { ...candidate, skuKeys: ['other-sku'] } },
    ];
    const others = variants.map(value => observe(
      prepareAiMediaPlanningSources(repo, value.scope, [value.candidate], io),
    ));
    try {
      await drain();
      expect(io.download).toHaveBeenCalledTimes(1);
      for (const call of others) expect(call.outcome()).toMatchObject({
        code: 'AI_MEDIA_PLANNING_SOURCE_BUSY', statusCode: 429,
      });
    } finally {
      io.release();
      await Promise.all([first.done, ...others.map(call => call.done)]);
    }
  });

  it('shares a successful byte freeze and stores one canonical asset for concurrent callers', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abcdee' } }).png().toBuffer();
    const repo = {
      ...repository(),
      createPlanningSourceAsset: vi.fn(async (
        { asset }: Parameters<AiMediaPlanningSourceRepository['createPlanningSourceAsset']>[0],
      ) => ({ id: 'shared-source-asset', ...asset })),
    };
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const download = vi.fn(async (url: string) => {
      await barrier;
      return { sourceUrl: url, finalUrl: url, contentType: 'image/png', buffer: bytes, redirectCount: 0 };
    });
    const uploadBuffer = vi.fn(async () => ({
      backend: 'oss', key: 'synthetic/shared.png', url: 'https://assets.invalid/shared.png',
    }));
    const calls = Array.from({ length: 6 }, () => prepareAiMediaPlanningSources(repo, scope(), [candidate], {
      download, getStorage: async () => ({ backend: 'oss', uploadBuffer }),
    }));
    try {
      await drain();
      expect(download).toHaveBeenCalledTimes(1);
    } finally { release(); }
    const results = await Promise.all(calls);
    for (const result of results) expect(result).toEqual([expect.objectContaining({
      ownerUserId: scope().ownerUserId, sourceCaptureSnapshotId: scope().sourceCaptureSnapshotId,
      sourceMediaKey: candidate.id,
    })]);
    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    expect(repo.createPlanningSourceAsset).toHaveBeenCalledTimes(1);
  });

  it('allows two different owners without coalescing their work and rejects process overflow', async () => {
    const repo = repository();
    const io = blockedDownload();
    const calls = ['owner-1', 'owner-2', 'owner-3'].map(owner => observe(
      prepareAiMediaPlanningSources(repo, scope(owner), [candidate], io),
    ));
    try {
      await drain();
      expect(io.download).toHaveBeenCalledTimes(2);
      expect(calls[0]!.outcome()).toBeUndefined();
      expect(calls[1]!.outcome()).toBeUndefined();
      expect(calls[2]!.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_BUSY', statusCode: 429 });
    } finally {
      io.release();
      await Promise.all(calls.map(call => call.done));
    }
  });

  it('retains both resource limits after the public deadline until the underlying upload settles', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abcdee' } }).png().toBuffer();
    const repo = repository();
    let started!: () => void;
    let finish!: () => void;
    const startedUpload = new Promise<void>((resolve) => { started = resolve; });
    const blockedUpload = new Promise<void>((resolve) => { finish = resolve; });
    const uploadBuffer = vi.fn(async () => {
      started();
      await blockedUpload;
      return { backend: 'oss', key: 'synthetic/source.png', url: 'https://assets.invalid/source.png' };
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const first = observe(prepareAiMediaPlanningSources(repo, scope('owner-1'), [candidate], {
      download: async (url) => ({ sourceUrl: url, finalUrl: url, contentType: 'image/png', buffer: bytes, redirectCount: 0 }),
      getStorage: async () => ({ backend: 'oss', uploadBuffer }),
    }));
    const io = blockedDownload();
    const others: ReturnType<typeof observe>[] = [];
    try {
      await startedUpload;
      await vi.advanceTimersByTimeAsync(AI_MEDIA_PLANNING_SOURCE_TIMEOUT_MS);
      expect(first.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_TIMEOUT', statusCode: 504 });
      expect(repo.createPlanningSourceAsset).not.toHaveBeenCalled();
      others.push(observe(prepareAiMediaPlanningSources(repo, scope('owner-1'), [{ ...candidate, id: 'other' }], io)));
      others.push(observe(prepareAiMediaPlanningSources(repo, scope('owner-2'), [candidate], io)));
      others.push(observe(prepareAiMediaPlanningSources(repo, scope('owner-3'), [candidate], io)));
      await drain();
      expect(others[0]!.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_BUSY', statusCode: 429 });
      expect(others[1]!.outcome()).toBeUndefined();
      expect(others[2]!.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_BUSY', statusCode: 429 });
      expect(io.download).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      io.release();
      await Promise.all([first.done, ...others.map(call => call.done)]);
      await drain();
    }
    expect(repo.createPlanningSourceAsset).not.toHaveBeenCalled();
    const next = observe(prepareAiMediaPlanningSources(repo, scope('owner-1'), [candidate], io));
    await next.done;
    expect(next.outcome()).toMatchObject({ code: 'AI_MEDIA_PLANNING_SOURCE_FETCH_FAILED' });
    expect(io.download).toHaveBeenCalledTimes(2);
  });
});
