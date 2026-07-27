import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  extensionByokMediaBatchRoutes,
  readExtensionByokMediaBatchFilePart,
} from '../routes/extension-byok-media-batch.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION,
} from '../services/extension-byok-media-batch-ingest-request.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
} from '../repositories/extension-byok-generated-asset-batch-commit-prisma.js';
import {
  ExtensionByokGeneratedAssetCommitError,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import {
  deriveOwnedImageStorageKey,
  type ImageUploadOptions,
  type ImageUploadResult,
  type OwnedImageStorageBackend,
} from '../services/image-storage.js';

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function image(red: number) {
  return sharp({
    create: {
      width: 3, height: 2, channels: 4,
      background: { r: red, g: 20, b: 30, alpha: 1 },
    },
  }).png({ compressionLevel: 1 }).toBuffer();
}

function commandItem(bytes: Buffer, index: number) {
  const skuKey = index === 0 ? 'sku-1' : 'sku-1';
  const slotKeys = [
    'sku:sku-1:hero',
    'shared:detail:DETAIL',
    'shared:detail:SCENE',
    'shared:detail:SPEC',
  ];
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://relay.example',
    providerOperation: 'TEXT_TO_IMAGE' as const,
    requestMode: 'json' as const,
    model: 'image-model-v1',
    executionIntentId: `intent-${index + 1}`,
    providerIdempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
    providerRequestHash: String(index + 1).repeat(64),
    providerRequestIdSha256: null,
    promptSha256: 'a'.repeat(64),
    negativePromptSha256: null,
    draftRevision: 3,
    skuKey,
    slotKey: slotKeys[index],
    assignmentOrdinal: 7 + index,
    assignmentMode: 'APPEND' as const,
    replaceConfirmed: false,
    resultSha256: hash(bytes),
    resultMimeType: 'image/png' as const,
    resultSizeBytes: bytes.length,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
  };
}

function manifest(images: Buffer[]) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION,
    operation: 'BYOK_MEDIA_INGEST' as const,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 4,
    idempotencyKey: 'byok-batch-ingest-0001',
    executionBatchId: 'execution-batch-1',
    command: {
      schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
      executionBatchId: 'execution-batch-1',
      items: images.map(commandItem),
    },
  };
}

function multipartBody(input: {
  manifest: unknown;
  images: Buffer[];
  manifestFirst?: boolean;
  imageNames?: string[];
  mimeTypes?: string[];
}) {
  const boundary = 'ss-erp-byok-batch-boundary';
  const chunks: Buffer[] = [];
  const appendManifest = () => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n`
      + `${JSON.stringify(input.manifest)}\r\n`,
    ));
  };
  const appendImage = (bytes: Buffer, index: number) => {
    const name = input.imageNames?.[index] || `image-${index}`;
    const mime = input.mimeTypes?.[index] || 'image/png';
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.png"\r\n`
      + `Content-Type: ${mime}\r\n\r\n`,
    ));
    chunks.push(bytes, Buffer.from('\r\n'));
  };
  if (input.manifestFirst !== false) appendManifest();
  input.images.forEach(appendImage);
  if (input.manifestFirst === false) appendManifest();
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

class MemoryStorage implements OwnedImageStorageBackend {
  readonly backendType = 'local' as const;
  readonly namespaceId = '1'.repeat(64);
  readonly uploads: ImageUploadResult[] = [];
  readonly deletes: ImageUploadResult[] = [];

  constructor(private readonly uploadErrorAfterPersist: Error | null = null) {}

  async upload(): Promise<ImageUploadResult> {
    throw new Error('unused');
  }

  async uploadBuffer(
    _buffer: Buffer,
    filename: string,
    _mimeType?: string,
    options?: ImageUploadOptions,
  ) {
    const key = deriveOwnedImageStorageKey('local', filename, options || {});
    const result = {
      url: `http://localhost:3001/uploads/${key}`,
      filename: key,
      key,
      objectKey: key,
      backend: 'local' as const,
    };
    this.uploads.push(result);
    if (this.uploadErrorAfterPersist) throw this.uploadErrorAfterPersist;
    return result;
  }

  async deleteUploaded(result: ImageUploadResult) {
    this.deletes.push(result);
  }
}

function receiptFromCommit(value: any) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
    executionBatchId: value.command.executionBatchId || 'execution-batch-1',
    requestHash: value.binding.requestHash,
    sourceDraftRevision: 3,
    sourceDraftVersion: 4,
    boundDraftRevision: 4,
    boundDraftVersion: 5,
    erpAiChargeCents: 0 as const,
    items: value.items.map((item: any, index: number) => ({
      assetId: item.asset.id,
      provenanceId: `provenance-${index + 1}`,
      executionIntentId: value.command.items[index].executionIntentId,
      providerRequestHash: value.command.items[index].providerRequestHash,
      providerResultSha256: value.command.items[index].resultSha256,
      normalizedSha256: item.asset.sha256,
      mimeType: item.asset.mimeType,
      width: item.asset.width,
      height: item.asset.height,
      skuKey: value.command.items[index].skuKey,
      slotKey: value.command.items[index].slotKey,
      assignmentOrdinal: value.command.items[index].assignmentOrdinal,
      assignmentSha256: String(index + 3).repeat(64),
      assignment: value.command.items[index].slotKey.startsWith('shared:')
        ? {
          scope: 'PRODUCT', slotKey: value.command.items[index].slotKey,
          assetId: item.asset.id, source: 'GENERATED',
        }
        : {
          scope: 'SKU', skuKey: value.command.items[index].skuKey,
          slotKey: value.command.items[index].slotKey,
          assetId: item.asset.id, source: 'GENERATED',
        },
      policyRevision: 7,
    })),
  };
}

async function build(options: {
  inspect?: any;
  commitError?: Error;
  status?: any;
  rateLimited?: boolean;
  stagingActive?: boolean;
  uploadErrorAfterPersist?: Error;
  committedWinnerAfterUpload?: boolean;
} = {}) {
  const storage = new MemoryStorage(options.uploadErrorAfterPersist || null);
  const stagingStore = {
    beginAttempt: vi.fn(async (value: any) => ({
      kind: options.stagingActive ? 'active' : 'created',
      staging: { ...value, status: 'PENDING' },
    })),
    recordUploadedObject: vi.fn(async () => true),
    markImmediateCleaned: vi.fn(async () => true),
    markImmediateCleanupFailed: vi.fn(async () => true),
  } as any;
  const resolveCommand = vi.fn(async (value: any) => ({
    kind: 'allowed' as const,
    shopId: value.shopId,
    workflowId: value.workflowId,
    draftVersion: value.draftVersion,
    command: {
      ...value.command,
      items: value.command.items.map((item: any) => ({
        ...item,
        readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
        authority: { sourceCaptureSnapshotId: 'snapshot-1' },
      })),
    },
  }));
  const inspectGrant = vi.fn(async () => options.inspect || ({ kind: 'allowed' as const }));
  const commit = vi.fn(async (value: any) => {
    if (options.commitError) throw options.commitError;
    return {
      replayed: false,
      receiptId: 'receipt-batch-1',
      receipt: receiptFromCommit(value),
      assets: value.items.map((item: any) => item.asset),
    };
  });
  const findBatchStatus = vi.fn(async () => options.status || ({ kind: 'not_found' as const }));
  const app = Fastify();
  const observedContentLengths: Array<string | undefined> = [];
  app.addHook('onRequest', async (request) => {
    observedContentLengths.push(request.headers['content-length']);
  });
  await app.register(extensionByokMediaBatchRoutes, {
    authenticateDevice: async (request: FastifyRequest, _reply: FastifyReply) => {
      (request as any).device = {
        sessionId: 'session-1', tokenId: 'token-id-1', ownerUserId: 'owner-1',
        actorUserId: 'owner-1', scopes: [EXTENSION_BYOK_MEDIA_INGEST_SCOPE],
        allowedShopIds: ['shop-1'],
      };
    },
    resolveCommand,
    digestGrantToken: () => 'd'.repeat(64),
    inspectGrant,
    ingestRateLimiter: {
      consume: vi.fn(async () => options.rateLimited
        ? { kind: 'rate_limited', limit: 10, retryAt: new Date(), occurredAt: new Date() }
        : { kind: 'allowed', limit: 10, remaining: 9, occurredAt: new Date() }),
    } as any,
    stagingStore,
    getStorage: async () => storage,
    findStoredAsset: async () => {
      const uploaded = storage.uploads[0];
      if (!options.committedWinnerAfterUpload || !uploaded) return null;
      return {
        storageBackend: uploaded.backend,
        storageKey: uploaded.objectKey || uploaded.key || uploaded.filename,
      } as any;
    },
    commit,
    findBatchStatus,
    now: () => new Date('2026-07-28T09:00:00.000Z'),
    createReceiptId: () => 'receipt-batch-1',
  });
  return {
    app,
    storage,
    stagingStore,
    resolveCommand,
    inspectGrant,
    commit,
    findBatchStatus,
    observedContentLengths,
  };
}

function requestHeaders(contentType: string) {
  return {
    'content-type': contentType,
    'x-ss-erp-command-grant': 'g'.repeat(43),
  };
}

describe('extension BYOK media batch routes', () => {
  it('stops reading a file as soon as the remaining aggregate byte budget is exceeded', async () => {
    let pulls = 0;
    const file = (async function* chunks() {
      pulls += 1;
      yield Buffer.alloc(4, 1);
      pulls += 1;
      yield Buffer.alloc(4, 2);
      pulls += 1;
      yield Buffer.alloc(4, 3);
    }());
    Object.assign(file, { truncated: false });

    await expect(readExtensionByokMediaBatchFilePart({
      type: 'file', fieldname: 'image-2', mimetype: 'image/png', file,
    }, 'image-2', 'image/png', 5)).rejects.toMatchObject({
      code: 'BYOK_IMAGE_BYTE_LIMIT_EXCEEDED',
      statusCode: 413,
    });
    expect(pulls).toBe(2);
  });

  it('rejects chunked multipart aggregate overflow without relying on Content-Length', async () => {
    const mib = 1024 * 1024;
    const actualImages = [
      Buffer.alloc(19 * mib, 10),
      Buffer.alloc(19 * mib, 40),
      Buffer.alloc(13 * mib, 70),
    ];
    const declaredImages = [
      actualImages[0]!,
      actualImages[1]!,
      actualImages[2]!.subarray(0, 12 * mib),
    ];
    const payload = multipartBody({ manifest: manifest(declaredImages), images: actualImages });
    const fixture = await build();
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType),
      payload: Readable.from((function* bodyChunks() {
        for (let offset = 0; offset < payload.body.length; offset += 64 * 1024) {
          yield payload.body.subarray(offset, offset + 64 * 1024);
        }
      }())),
    });

    expect(fixture.observedContentLengths).toEqual([undefined]);
    expect(response.statusCode).toBe(413);
    expect(fixture.storage.uploads).toHaveLength(0);
    expect(fixture.commit).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('normalizes, stages, uploads and atomically commits two reviewed images', async () => {
    const images = [await image(10), await image(40)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const fixture = await build();
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
        replayed: false,
        receiptId: 'receipt-batch-1',
        executionBatchId: 'execution-batch-1',
        erpAiChargeCents: 0,
        items: [
          { executionIntentId: 'intent-1', slotKey: 'sku:sku-1:hero' },
          { executionIntentId: 'intent-2', slotKey: 'shared:detail:DETAIL' },
        ],
      },
    });
    expect(fixture.commit).toHaveBeenCalledTimes(1);
    expect(fixture.storage.uploads).toHaveLength(2);
    expect(fixture.stagingStore.beginAttempt).toHaveBeenCalledTimes(2);
    expect(fixture.stagingStore.recordUploadedObject).toHaveBeenCalledTimes(2);
    await fixture.app.close();
  });

  it('rejects a manifest that is not the first multipart part before policy or upload', async () => {
    const images = [await image(10)];
    const payload = multipartBody({ manifest: manifest(images), images, manifestFirst: false });
    const fixture = await build();
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(400);
    expect(fixture.resolveCommand).not.toHaveBeenCalled();
    expect(fixture.storage.uploads).toHaveLength(0);
    await fixture.app.close();
  });

  it('rejects wrong file order and releases owned staging leases', async () => {
    const images = [await image(10), await image(40)];
    const payload = multipartBody({
      manifest: manifest(images), images, imageNames: ['image-1', 'image-0'],
    });
    const fixture = await build();
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(400);
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.stagingStore.markImmediateCleaned).toHaveBeenCalledTimes(2);
    await fixture.app.close();
  });

  it('compensates uploads after an explicit atomic transaction rollback', async () => {
    const images = [await image(10), await image(40)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const fixture = await build({
      commitError: new ExtensionByokGeneratedAssetCommitError(
        'BYOK_INGEST_DRAFT_STALE', 409, 'draft stale',
      ),
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(409);
    expect(fixture.storage.uploads).toHaveLength(2);
    expect(fixture.storage.deletes).toHaveLength(2);
    expect(fixture.stagingStore.markImmediateCleaned).toHaveBeenCalledTimes(2);
    await fixture.app.close();
  });

  it('leaves uploaded objects staged when the commit outcome is unknown', async () => {
    const images = [await image(10), await image(40)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const fixture = await build({
      commitError: new Error('connection closed after transaction dispatch'),
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(500);
    expect(fixture.commit).toHaveBeenCalledTimes(1);
    expect(fixture.storage.uploads).toHaveLength(2);
    expect(fixture.storage.deletes).toHaveLength(0);
    expect(fixture.stagingStore.markImmediateCleaned).not.toHaveBeenCalled();
    expect(fixture.stagingStore.markImmediateCleanupFailed).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('leaves the staging record open when upload bytes may have persisted before an error', async () => {
    const images = [await image(10)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const fixture = await build({
      uploadErrorAfterPersist: new Error('object persisted before transport error'),
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(503);
    expect(fixture.storage.uploads).toHaveLength(1);
    expect(fixture.storage.deletes).toHaveLength(0);
    expect(fixture.stagingStore.recordUploadedObject).not.toHaveBeenCalled();
    expect(fixture.stagingStore.markImmediateCleaned).not.toHaveBeenCalled();
    expect(fixture.stagingStore.markImmediateCleanupFailed).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('never deletes an object already owned by a committed winner during rollback cleanup', async () => {
    const images = [await image(10)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const fixture = await build({
      commitError: new ExtensionByokGeneratedAssetCommitError(
        'BYOK_INGEST_DRAFT_STALE', 409, 'draft stale',
      ),
      committedWinnerAfterUpload: true,
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(409);
    expect(fixture.storage.uploads).toHaveLength(1);
    expect(fixture.storage.deletes).toHaveLength(0);
    expect(fixture.stagingStore.markImmediateCleaned).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('returns an exact successful grant replay without uploading or committing again', async () => {
    const images = [await image(10), await image(40)];
    const payload = multipartBody({ manifest: manifest(images), images });
    const stored = receiptFromCommit({
      binding: { requestHash: 'f'.repeat(64) },
      command: { executionBatchId: 'execution-batch-1', items: images.map(commandItem) },
      items: images.map((bytes, index) => ({
        asset: {
          id: `asset-${index + 1}`, sha256: hash(bytes), mimeType: 'image/png',
          width: 3, height: 2,
        },
      })),
    });
    const fixture = await build({
      inspect: { kind: 'replay', receipt: { status: 'SUCCEEDED' } },
      status: { kind: 'succeeded', receiptId: 'receipt-batch-1', receipt: stored },
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest',
      headers: requestHeaders(payload.contentType), payload: payload.body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ replayed: true, receiptId: 'receipt-batch-1' });
    expect(fixture.storage.uploads).toHaveLength(0);
    expect(fixture.commit).not.toHaveBeenCalled();
    await fixture.app.close();
  });

  it('returns the rich receipt through the read-only status route', async () => {
    const images = [await image(10), await image(40)];
    const stored = receiptFromCommit({
      binding: { requestHash: 'f'.repeat(64) },
      command: { executionBatchId: 'execution-batch-1', items: images.map(commandItem) },
      items: images.map((bytes, index) => ({
        asset: {
          id: `asset-${index + 1}`, sha256: hash(bytes), mimeType: 'image/png',
          width: 3, height: 2,
        },
      })),
    });
    const fixture = await build({
      status: { kind: 'succeeded', receiptId: 'receipt-batch-1', receipt: stored },
    });
    const response = await fixture.app.inject({
      method: 'POST', url: '/batch-ingest-status',
      payload: {
        contractVersion: 'extension-byok-media-batch-ingest-status/v1',
        executionBatchId: 'execution-batch-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        idempotencyKey: 'byok-batch-ingest-0001', requestHash: 'f'.repeat(64),
        items: images.map((bytes, index) => ({
          executionIntentId: `intent-${index + 1}`,
          providerRequestHash: String(index + 1).repeat(64),
          providerResultSha256: hash(bytes),
          skuKey: 'sku-1',
          slotKey: index === 0 ? 'sku:sku-1:hero' : 'shared:detail:DETAIL',
          assignmentOrdinal: 7 + index,
        })),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      replayed: true, receiptId: 'receipt-batch-1',
      executionBatchId: 'execution-batch-1', erpAiChargeCents: 0,
    });
    expect(fixture.findBatchStatus).toHaveBeenCalledTimes(1);
    expect(fixture.findBatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ executionBatchId: 'execution-batch-1' }),
    );
    expect(fixture.commit).not.toHaveBeenCalled();
    await fixture.app.close();
  });
});
