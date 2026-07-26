import { createHash } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { extensionByokMediaRoutes } from '../routes/extension-byok-media.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_REQUEST_VERSION,
} from '../services/extension-byok-media-ingest-request.js';
import type {
  ImageUploadOptions,
  ImageUploadResult,
  OwnedImageStorageBackend,
} from '../services/image-storage.js';
import { deriveOwnedImageStorageKey } from '../services/image-storage.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
  ExtensionByokGeneratedAssetCommitError,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function png() {
  return sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png({ compressionLevel: 1 }).toBuffer();
}

function command(bytes: Buffer) {
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://relay.example',
    providerOperation: 'TEXT_TO_IMAGE' as const,
    requestMode: 'json' as const,
    model: 'image-model-v1',
    providerRequestIdSha256: hash('provider-request-1'),
    promptSha256: hash('safe product prompt'),
    negativePromptSha256: null,
    draftRevision: 3,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 0,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    resultSha256: hash(bytes),
    resultMimeType: 'image/png' as const,
    resultSizeBytes: bytes.length,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
  };
}

function manifest(bytes: Buffer) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_INGEST_REQUEST_VERSION,
    operation: 'BYOK_MEDIA_INGEST' as const,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 4,
    idempotencyKey: 'byok-route-ingest-0001',
    command: command(bytes),
  };
}

function manifestHeader(bytes: Buffer) {
  return Buffer.from(JSON.stringify(manifest(bytes))).toString('base64url');
}

class MemoryOwnedStorage implements OwnedImageStorageBackend {
  readonly backendType = 'local' as const;
  readonly namespaceId = '1'.repeat(64);
  readonly uploads: Array<{ buffer: Buffer; result: ImageUploadResult }> = [];
  readonly deletes: ImageUploadResult[] = [];

  constructor(
    private readonly returnedKey?: string,
    private readonly deleteError?: Error,
  ) {}

  async upload(): Promise<ImageUploadResult> {
    throw new Error('unused');
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    _mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    const key = this.returnedKey || (options?.idempotencyKey
      ? deriveOwnedImageStorageKey('local', filename, options)
      : filename);
    const result = {
      url: `http://localhost:3001/uploads/${key}`,
      filename: key,
      key,
      objectKey: key,
      backend: 'local' as const,
    };
    this.uploads.push({ buffer: Buffer.from(buffer), result });
    return result;
  }

  async deleteUploaded(result: ImageUploadResult) {
    this.deletes.push(result);
    if (this.deleteError) throw this.deleteError;
  }
}

async function build(input: {
  scopes?: string[];
  resolutionKind?: 'allowed' | 'stale' | 'unavailable' | 'forbidden' | 'rollout_unavailable';
  commitError?: Error;
  commitImpl?: (value: any) => Promise<any>;
  findStoredAsset?: (value: any) => Promise<any>;
  grantInspectionKind?: 'allowed' | 'expired' | 'revoked' | 'scope_denied';
  grantInspection?: any;
  rateAllowed?: boolean;
  now?: () => Date;
  createReceiptId?: () => string;
  stagingStore?: any;
  storage?: MemoryOwnedStorage;
  authRejected?: boolean;
} = {}) {
  const storage = input.storage || new MemoryOwnedStorage();
  const commit = vi.fn(async (value: any) => {
    if (input.commitImpl) return input.commitImpl(value);
    if (input.commitError) throw input.commitError;
    return {
      replayed: false,
      receiptId: 'receipt-1',
      receipt: {
        contractVersion: EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
        requestHash: value.binding.requestHash,
        assetId: value.asset.id,
        provenanceId: 'provenance-1',
        normalizedSha256: value.asset.sha256,
        mimeType: value.asset.mimeType,
        width: value.asset.width,
        height: value.asset.height,
        workflowId: 'workflow-1',
        draftRevision: 3,
        draftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 0,
        assignmentSha256: 'e'.repeat(64),
        policyRevision: 7,
      },
      asset: value.asset,
    };
  });
  const resolveCommand = vi.fn(async (value: any) => {
    const kind = input.resolutionKind || 'allowed';
    if (kind !== 'allowed') return { kind };
    return {
      kind: 'allowed' as const,
      shopId: value.shopId,
      workflowId: value.workflowId,
      draftVersion: value.draftVersion,
      command: {
        ...value.command,
        readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
        authority: { sourceCaptureSnapshotId: 'snapshot-1' },
      },
    };
  });
  const inspectGrant = vi.fn(async () => input.grantInspection
    || ({ kind: input.grantInspectionKind || 'allowed' } as const));
  const ingestRateLimiter = {
    consume: vi.fn(async () => input.rateAllowed === false
      ? { kind: 'rate_limited' as const, limit: 10, retryAt: new Date(), occurredAt: new Date() }
      : { kind: 'allowed' as const, limit: 10, remaining: 9, occurredAt: new Date() }),
  };
  const stagingStore = input.stagingStore || {
    beginAttempt: vi.fn(async (value: any) => ({
      kind: 'created' as const,
      staging: {
        ...value,
        status: 'PENDING',
        expiresAt: new Date(value.now.getTime() + 60_000),
        cleanupLeaseToken: null,
        cleanupLeaseUntil: null,
        cleanupAttemptCount: 0,
        lastError: null,
        committedAt: null,
        cleanedAt: null,
        createdAt: value.now,
        updatedAt: value.now,
      },
    })),
    recordUploadedObject: vi.fn(async () => true),
    markImmediateCleaned: vi.fn(async () => true),
    markImmediateCleanupFailed: vi.fn(async () => true),
  } as any;
  const app = Fastify();
  const parserSpy = vi.fn((_request: FastifyRequest, body: Buffer, done: (error: Error | null, value?: Buffer) => void) => {
    done(null, body);
  });
  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, parserSpy);
  await app.register(extensionByokMediaRoutes, {
    authenticateDevice: async (request: FastifyRequest, reply: FastifyReply) => {
      if (input.authRejected) {
        return reply.status(401).send({ code: 0, errorCode: 'extension_device_unauthorized' });
      }
      (request as any).device = {
        sessionId: 'session-1',
        tokenId: 'jti-1',
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        scopes: input.scopes || [EXTENSION_BYOK_MEDIA_INGEST_SCOPE],
        allowedShopIds: ['shop-1'],
      };
    },
    resolveCommand,
    digestGrantToken: () => 'd'.repeat(64),
    inspectGrant,
    ingestRateLimiter,
    stagingStore,
    getStorage: async () => storage,
    findStoredAsset: input.findStoredAsset || (async () => null),
    commit,
    now: input.now || (() => new Date('2026-07-25T14:00:00.000Z')),
    createReceiptId: input.createReceiptId || (() => 'receipt-1'),
  });
  return {
    app, storage, commit, resolveCommand, inspectGrant, ingestRateLimiter, parserSpy, stagingStore,
  };
}

function headers(bytes: Buffer, overrides: Record<string, string> = {}) {
  return {
    'content-type': 'image/png',
    'x-ss-erp-command-grant': 'g'.repeat(43),
    'x-ss-erp-byok-ingest-manifest': manifestHeader(bytes),
    ...overrides,
  };
}

describe('extension BYOK generated media ingest route', () => {
  it('rejects unauthenticated traffic before invoking the image body parser', async () => {
    const bytes = await png();
    const { app, parserSpy, inspectGrant, ingestRateLimiter } = await build({ authRejected: true });
    const response = await app.inject({
      method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes,
    });
    expect(response.statusCode).toBe(401);
    expect(parserSpy).not.toHaveBeenCalled();
    expect(inspectGrant).not.toHaveBeenCalled();
    expect(ingestRateLimiter.consume).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an invalid grant before invoking the image body parser', async () => {
    const bytes = await png();
    const { app, parserSpy, inspectGrant, ingestRateLimiter } = await build({
      grantInspection: { kind: 'expired' },
    });
    const response = await app.inject({
      method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes,
    });
    expect(response.statusCode).toBe(410);
    expect(inspectGrant).toHaveBeenCalledOnce();
    expect(parserSpy).not.toHaveBeenCalled();
    expect(ingestRateLimiter.consume).not.toHaveBeenCalled();
    await app.close();
  });

  it('normalizes hostile Provider bytes and commits only a redacted deterministic asset result', async () => {
    const bytes = await png();
    const { app, storage, commit, resolveCommand } = await build();
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        replayed: false,
        receiptId: 'receipt-1',
        assetId: expect.stringMatching(/^byok_[a-f0-9]{48}$/u),
        provenanceId: 'provenance-1',
        normalizedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        mimeType: 'image/png',
        width: 3,
        height: 2,
        sourceDraftRevision: 3,
        sourceDraftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 0,
        assignmentSha256: 'e'.repeat(64),
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('relay.example');
    expect(storage.uploads).toHaveLength(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(resolveCommand).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'byok-route-ingest-0001',
      purpose: 'execute',
    }));
    const committed = commit.mock.calls[0]![0] as any;
    expect(committed.command.resultSha256).toBe(hash(bytes));
    expect(committed.asset.sha256).toBe(hash(storage.uploads[0]!.buffer));
    expect(committed.asset.metadata.providerResultSha256).toBe(hash(bytes));
    expect(committed.asset.sourceUrl).toBeNull();
    await app.close();
  });

  it('fails before storage for missing scope, stale policy/draft, MIME, or result hash', async () => {
    const bytes = await png();
    const cases = [
      { build: { scopes: ['listing:write'] }, headers: headers(bytes), expected: 403 },
      { build: { resolutionKind: 'stale' as const }, headers: headers(bytes), expected: 409 },
      { build: {}, headers: headers(bytes, { 'content-type': 'image/jpeg' }), expected: 415 },
      {
        build: {},
        headers: {
          ...headers(bytes),
          'x-ss-erp-byok-ingest-manifest': Buffer.from(JSON.stringify({
            ...manifest(bytes),
            command: { ...command(bytes), resultSha256: 'f'.repeat(64) },
          })).toString('base64url'),
        },
        expected: 409,
      },
      {
        build: {},
        headers: {
          ...headers(bytes),
          'x-ss-erp-byok-ingest-manifest': Buffer.from(JSON.stringify({
            ...manifest(bytes),
            command: {
              ...command(bytes), providerResultUrl: 'https://evil.example/result.png',
            },
          })).toString('base64url'),
        },
        expected: 400,
      },
    ];
    for (const item of cases) {
      const { app, storage, commit } = await build(item.build);
      const response = await app.inject({ method: 'POST', url: '/ingest', headers: item.headers, payload: bytes });
      expect(response.statusCode).toBe(item.expected);
      expect(storage.uploads).toHaveLength(0);
      expect(commit).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('reuses the deterministic stored asset before consulting a changed storage backend', async () => {
    const bytes = await png();
    const first = await build();
    const firstResponse = await first.app.inject({
      method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes,
    });
    expect(firstResponse.statusCode).toBe(200);
    const stored = (first.commit.mock.calls[0]![0] as any).asset;
    await first.app.close();

    const replay = await build({ findStoredAsset: async () => ({
      ...stored, createdAt: new Date('2026-07-25T14:00:00.000Z'),
    }) });
    const replayResponse = await replay.app.inject({
      method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes,
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replay.storage.uploads).toHaveLength(0);
    expect(replay.ingestRateLimiter.consume).toHaveBeenCalledOnce();
    expect(replay.commit).toHaveBeenCalledWith(expect.objectContaining({
      asset: expect.objectContaining({
        id: stored.id, url: stored.url, storageBackend: stored.storageBackend,
        storageKey: stored.storageKey,
      }),
    }));
    await replay.app.close();
  });

  it('deletes an unreferenced upload after a definite commit failure', async () => {
    const bytes = await png();
    const { app, storage } = await build({
      commitError: new ExtensionByokGeneratedAssetCommitError(
        'BYOK_INGEST_DRAFT_STALE', 409, 'draft stale',
      ),
    });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(409);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deletes).toHaveLength(1);
    await app.close();
  });

  it('never deletes a deterministic object when the database outcome cannot be checked', async () => {
    const bytes = await png();
    let findCount = 0;
    const { app, storage } = await build({
      commitError: new Error('database connection lost after commit'),
      findStoredAsset: async () => {
        findCount += 1;
        if (findCount === 1) return null;
        throw new Error('database unavailable');
      },
    });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(500);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deletes).toHaveLength(0);
    await app.close();
  });

  it.each([
    ['expired grant', { kind: 'expired' }, 410, 'byok_ingest_grant_expired'],
    ['pending replay', { kind: 'replay', receipt: { status: 'PENDING' } }, 409, 'byok_ingest_receipt_pending'],
    ['failed replay', { kind: 'replay', receipt: { status: 'FAILED' } }, 409, 'byok_ingest_receipt_failed'],
  ])('rejects %s before image decode, staging, or upload', async (
    _label,
    grantInspection,
    statusCode,
    errorCode,
  ) => {
    const bytes = Buffer.from('not-an-image');
    const {
      app, storage, commit, ingestRateLimiter, parserSpy, stagingStore,
    } = await build({ grantInspection });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({ code: 0, errorCode });
    expect(parserSpy).not.toHaveBeenCalled();
    if (grantInspection.kind === 'replay') {
      expect(ingestRateLimiter.consume).toHaveBeenCalledOnce();
    } else {
      expect(ingestRateLimiter.consume).not.toHaveBeenCalled();
    }
    expect(stagingStore.beginAttempt).not.toHaveBeenCalled();
    expect(storage.uploads).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a successful replay with no deterministic stored asset before decode or upload', async () => {
    const bytes = Buffer.from('not-an-image');
    const { app, storage, commit, ingestRateLimiter, stagingStore } = await build({
      grantInspection: { kind: 'replay', receipt: { status: 'SUCCEEDED' } },
      findStoredAsset: async () => null,
    });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'byok_ingest_replay_asset_missing' });
    expect(ingestRateLimiter.consume).toHaveBeenCalledOnce();
    expect(stagingStore.beginAttempt).not.toHaveBeenCalled();
    expect(storage.uploads).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    await app.close();
  });

  it('applies the per-device rate limit before image decode', async () => {
    const bytes = Buffer.from('not-an-image');
    const { app, storage, inspectGrant, ingestRateLimiter, stagingStore } = await build({ rateAllowed: false });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ errorCode: 'byok_ingest_rate_limited' });
    expect(inspectGrant).toHaveBeenCalledOnce();
    expect(ingestRateLimiter.consume).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', deviceSessionId: 'session-1', limit: 10,
    }));
    expect(stagingStore.beginAttempt).not.toHaveBeenCalled();
    expect(storage.uploads).toHaveLength(0);
    await app.close();
  });

  it('records the actual returned key before an immediate cleanup failure', async () => {
    const bytes = await png();
    const storage = new MemoryOwnedStorage(
      'provider-returned.png',
      new Error('temporary storage delete failure'),
    );
    const stagingStore = {
      beginAttempt: vi.fn(async (value: any) => ({ kind: 'created', staging: value })),
      recordUploadedObject: vi.fn(async () => true),
      markImmediateCleaned: vi.fn(async () => true),
      markImmediateCleanupFailed: vi.fn(async () => true),
    };
    const { app } = await build({ storage, stagingStore });
    const response = await app.inject({
      method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes,
    });
    expect(response.statusCode).toBe(503);
    expect(stagingStore.recordUploadedObject).toHaveBeenCalledWith(expect.objectContaining({
      id: 'receipt-1',
      expectedStorageKey: expect.not.stringMatching(/^provider-returned\.png$/u),
      actualStorageKey: 'provider-returned.png',
      storageNamespaceId: storage.namespaceId,
    }));
    expect(stagingStore.markImmediateCleanupFailed).toHaveBeenCalledOnce();
    await app.close();
  });

  it('uses a fresh time for final grant consumption after image work', async () => {
    const bytes = await png();
    const times = [
      new Date('2026-07-25T14:00:00.000Z'),
      new Date('2026-07-25T14:01:01.000Z'),
      new Date('2026-07-25T14:01:02.000Z'),
    ];
    let timeIndex = 0;
    const { app, storage, stagingStore } = await build({
      now: () => times[Math.min(timeIndex++, times.length - 1)]!,
      commitImpl: async (value) => {
        expect(value.now).toEqual(times[1]);
        throw new ExtensionByokGeneratedAssetCommitError(
          'BYOK_INGEST_GRANT_EXPIRED', 410, 'grant expired during image work',
        );
      },
    });
    const response = await app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes });
    expect(response.statusCode).toBe(410);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deletes).toEqual([storage.uploads[0]!.result]);
    expect(stagingStore.markImmediateCleaned).toHaveBeenCalledWith({
      id: 'receipt-1', now: times[2],
    });
    await app.close();
  });

  it('keeps the barrier winner and deletes only the attempt-unique losing upload', async () => {
    const bytes = await png();
    let receiptSequence = 0;
    let commitSequence = 0;
    let releaseSecond!: () => void;
    let releaseWinner!: () => void;
    const secondEntered = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const winnerCommitted = new Promise<void>((resolve) => { releaseWinner = resolve; });
    let winner: any;
    const resultFor = (value: any, replayed: boolean, asset: any, receiptId: string) => ({
      replayed,
      receiptId,
      receipt: {
        contractVersion: EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
        requestHash: value.binding.requestHash,
        assetId: asset.id,
        provenanceId: 'provenance-winner',
        normalizedSha256: asset.sha256,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        workflowId: 'workflow-1',
        draftRevision: 3,
        draftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 0,
        assignmentSha256: 'e'.repeat(64),
        policyRevision: 7,
      },
      asset,
    });
    const { app, storage } = await build({
      createReceiptId: () => `receipt-${++receiptSequence}`,
      commitImpl: async (value) => {
        commitSequence += 1;
        if (commitSequence === 1) {
          await secondEntered;
          winner = resultFor(value, false, value.asset, value.receiptId);
          releaseWinner();
          return winner;
        }
        releaseSecond();
        await winnerCommitted;
        return resultFor(value, true, winner.asset, winner.receiptId);
      },
    });
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes }),
      app.inject({ method: 'POST', url: '/ingest', headers: headers(bytes), payload: bytes }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(storage.uploads).toHaveLength(2);
    expect(storage.uploads[0]!.result.objectKey).not.toBe(storage.uploads[1]!.result.objectKey);
    expect(storage.deletes).toEqual([storage.uploads[1]!.result]);
    expect(first.json().data).toMatchObject({ replayed: false, receiptId: 'receipt-1' });
    expect(second.json().data).toMatchObject({ replayed: true, receiptId: 'receipt-1' });
    await app.close();
  });
});
