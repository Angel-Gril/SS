import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type {
  ImageUploadOptions,
  ImageUploadResult,
  OwnedImageStorageBackend,
} from '../services/image-storage.js';
import {
  ByokGeneratedAssetIngestError,
  BYOK_GENERATED_ASSET_INGEST_VERSION,
  BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
  createByokGeneratedAssetIngestService,
  normalizeByokGeneratedImage,
  prepareByokGeneratedAsset,
  readBoundedByokImageInput,
  type ByokGeneratedAssetCreateInput,
  type ByokGeneratedAssetRecord,
} from '../services/byok-generated-asset-ingest.js';

const REQUEST_HASH = 'a'.repeat(64);

async function image(
  format: 'png' | 'jpeg' | 'webp' = 'png',
  width = 3,
  height = 2,
) {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 214, g: 38, b: 55, alpha: 1 },
    },
  });
  if (format === 'png') return pipeline.png().toBuffer();
  if (format === 'webp') return pipeline.webp().toBuffer();
  return pipeline.jpeg().toBuffer();
}

async function orientedJpeg() {
  return sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: { r: 214, g: 38, b: 55 },
    },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
}

async function animatedWebp() {
  const frameBytes = 2 * 2 * 3;
  const frames = Buffer.concat([
    Buffer.alloc(frameBytes, 0),
    Buffer.alloc(frameBytes, 255),
  ]);
  return sharp(frames, {
    raw: {
      width: 2,
      height: 4,
      pageHeight: 2,
      channels: 3,
    },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
}

function expectError(code: string) {
  return expect.objectContaining({
    name: 'ByokGeneratedAssetIngestError',
    code,
  });
}

function rawHash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function ingestInput(buffer: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    idempotencyKey: 'byok-ingest-test-0001',
    requestHash: REQUEST_HASH,
    expectedProviderResultSha256: rawHash(buffer),
    declaredMimeType: 'image/png',
    source: buffer,
    ...overrides,
  } as any;
}

class MemoryStorage implements OwnedImageStorageBackend {
  readonly backendType = 'local' as const;
  readonly namespaceId = '1'.repeat(64);
  readonly uploads: Array<{ buffer: Buffer; result: ImageUploadResult }> = [];
  readonly deleted: ImageUploadResult[] = [];
  failUpload = false;
  uploadedBackend: 'local' | 'oss' | 'ozon-cdn' = 'local';
  uploadedUrl: string | null = null;

  async upload(): Promise<ImageUploadResult> {
    throw new Error('file path uploads are not used by this fixture');
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    if (this.failUpload) throw new Error('upload failed');
    const key = `${options?.idempotencyKey || filename}.${mimeType?.split('/')[1] || 'bin'}`;
    const result = {
      url: this.uploadedUrl || `http://localhost:3001/uploads/${key}`,
      filename: key,
      backend: this.uploadedBackend,
      key,
      objectKey: key,
    } as ImageUploadResult;
    this.uploads.push({ buffer: Buffer.from(buffer), result });
    return result;
  }

  async deleteUploaded(result: ImageUploadResult) {
    this.deleted.push(result);
  }
}

class MemoryRepository {
  readonly rows = new Map<string, ByokGeneratedAssetRecord>();
  failCreate = false;

  async findById(input: { assetId: string; ownerUserId: string }) {
    const row = this.rows.get(input.assetId);
    return row && row.ownerUserId === input.ownerUserId ? row : null;
  }

  async createOrReplay(input: ByokGeneratedAssetCreateInput) {
    if (this.failCreate) throw new Error('database failed');
    const existing = this.rows.get(input.id);
    if (existing) return { kind: 'replayed' as const, asset: existing };
    this.rows.set(input.id, input);
    return { kind: 'created' as const, asset: input };
  }
}

describe('BYOK generated asset normalization and ingest', () => {
  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpeg'],
    ['image/webp', 'webp'],
  ] as const)('accepts a verified single-frame %s and deterministically re-encodes it', async (mime, format) => {
    const source = await image(format);
    const first = await normalizeByokGeneratedImage({ buffer: source, declaredMimeType: mime });
    const second = await normalizeByokGeneratedImage({ buffer: source, declaredMimeType: mime });

    expect(first).toMatchObject({
      mimeType: mime,
      sourceMimeType: mime,
      width: 3,
      height: 2,
      normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(first.sha256).toBe(rawHash(first.buffer));
    const metadata = await sharp(first.buffer, { animated: true }).metadata();
    expect(metadata.pages ?? 1).toBe(1);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  it('applies EXIF orientation while stripping metadata', async () => {
    const source = await orientedJpeg();
    const normalized = await normalizeByokGeneratedImage({
      buffer: source,
      declaredMimeType: 'image/jpeg',
    });
    expect(normalized).toMatchObject({ mimeType: 'image/jpeg', width: 2, height: 3 });
    const metadata = await sharp(normalized.buffer).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('rejects unsupported MIME, magic mismatches, malformed bytes, and animation', async () => {
    const png = await image('png');
    await expect(normalizeByokGeneratedImage({ buffer: png, declaredMimeType: 'image/jpeg' }))
      .rejects.toEqual(expectError('BYOK_IMAGE_MIME_MISMATCH'));
    await expect(normalizeByokGeneratedImage({ buffer: png, declaredMimeType: 'image/gif' }))
      .rejects.toEqual(expectError('BYOK_IMAGE_UNSUPPORTED_MIME'));
    await expect(normalizeByokGeneratedImage({
      buffer: Buffer.from('not-an-image'), declaredMimeType: 'image/png',
    })).rejects.toEqual(expectError('BYOK_IMAGE_UNSUPPORTED_MIME'));
    const animated = await animatedWebp();
    await expect(normalizeByokGeneratedImage({ buffer: animated, declaredMimeType: 'image/webp' }))
      .rejects.toEqual(expectError('BYOK_IMAGE_ANIMATION_UNSUPPORTED'));
  });

  it('enforces byte, edge, pixel, and declared-size limits before persistence', async () => {
    const source = await image('png', 5, 2);
    await expect(normalizeByokGeneratedImage({
      buffer: source,
      declaredMimeType: 'image/png',
      limits: { maxDimension: 4 },
    })).rejects.toEqual(expectError('BYOK_IMAGE_DIMENSION_LIMIT_EXCEEDED'));
    const pixelSource = await image('png', 3, 2);
    await expect(normalizeByokGeneratedImage({
      buffer: pixelSource,
      declaredMimeType: 'image/png',
      limits: { maxPixels: 5 },
    })).rejects.toEqual(expectError('BYOK_IMAGE_PIXEL_LIMIT_EXCEEDED'));
    await expect(readBoundedByokImageInput({
      source: Buffer.alloc(11),
      limits: { maxInputBytes: 10, maxTotalBytes: 10 },
    })).rejects.toEqual(expectError('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED'));
    await expect(readBoundedByokImageInput({
      source: Buffer.from('abc'), declaredSizeBytes: 2,
    })).rejects.toEqual(expectError('BYOK_IMAGE_INPUT_INVALID'));
  });

  it('bounds an async stream and calls its return method on overflow', async () => {
    let returned = false;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            index += 1;
            return index === 1
              ? { done: false as const, value: Buffer.alloc(6) }
              : { done: false as const, value: Buffer.alloc(6) };
          },
          async return() {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    await expect(readBoundedByokImageInput({
      source,
      limits: { maxInputBytes: 10, maxTotalBytes: 10 },
    })).rejects.toEqual(expectError('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED'));
    expect(returned).toBe(true);
  });

  it('normalizes, stores, and replays the same deterministic MediaAsset', async () => {
    const source = await image('png');
    const storage = new MemoryStorage();
    const repository = new MemoryRepository();
    const service = createByokGeneratedAssetIngestService({
      repository,
      getStorage: async () => storage,
    });
    const input = ingestInput(source);

    const first = await service.ingest(input);
    const second = await service.ingest({
      ...input,
      source: Buffer.from('this replay body is not read'),
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.sha256).toBe(first.asset.sha256);
    expect(storage.uploads).toHaveLength(1);
    expect(repository.rows).toHaveLength(1);
    expect(first.asset).toMatchObject({
      kind: 'AI_GENERATED',
      sourceUrl: null,
      storageBackend: 'local',
      metadata: {
        ingestContractVersion: BYOK_GENERATED_ASSET_INGEST_VERSION,
        generatedAssetSource: 'EXTENSION_BYOK',
        executionMode: 'BYOK',
        pixelOrientationNormalized: true,
      },
    });
  });

  it('fails closed on idempotency reuse with a different granted hash', async () => {
    const source = await image('png');
    const storage = new MemoryStorage();
    const repository = new MemoryRepository();
    const service = createByokGeneratedAssetIngestService({ repository, getStorage: async () => storage });
    await service.ingest(ingestInput(source));
    await expect(service.ingest(ingestInput(await image('png'), {
      expectedProviderResultSha256: 'b'.repeat(64),
    }))).rejects.toEqual(expectError('BYOK_IMAGE_IDEMPOTENCY_CONFLICT'));
    expect(storage.uploads).toHaveLength(1);
  });

  it('uses an attempt-unique key and deletes only the losing upload on a conflicting race', async () => {
    const source = await image('png');
    const firstStorage = new MemoryStorage();
    const firstRepository = new MemoryRepository();
    const firstService = createByokGeneratedAssetIngestService({
      repository: firstRepository,
      getStorage: async () => firstStorage,
    });
    const winner = (await firstService.ingest(ingestInput(source))).asset;

    const racingStorage = new MemoryStorage();
    let findCount = 0;
    const racingRepository = {
      async findById() {
        findCount += 1;
        return findCount === 1 ? null : winner;
      },
      async createOrReplay() {
        return { kind: 'replayed' as const, asset: winner };
      },
    };
    const racingService = createByokGeneratedAssetIngestService({
      repository: racingRepository,
      getStorage: async () => racingStorage,
    });
    await expect(racingService.ingest(ingestInput(source, {
      requestHash: 'f'.repeat(64),
    }))).rejects.toEqual(expectError('BYOK_IMAGE_IDEMPOTENCY_CONFLICT'));
    expect(racingStorage.uploads).toHaveLength(1);
    expect(racingStorage.uploads[0]!.result.objectKey).not.toBe(winner.storageKey);
    expect(racingStorage.deleted).toEqual([racingStorage.uploads[0]!.result]);
  });

  it('compensates an uploaded object when the MediaAsset transaction fails', async () => {
    const source = await image('png');
    const storage = new MemoryStorage();
    const repository = new MemoryRepository();
    repository.failCreate = true;
    const service = createByokGeneratedAssetIngestService({ repository, getStorage: async () => storage });
    await expect(service.ingest(ingestInput(source))).rejects.toThrow('database failed');
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deleted).toHaveLength(1);
    expect(repository.rows).toHaveLength(0);
  });

  it('rejects a non-owned storage result and removes it before any asset row is created', async () => {
    const source = await image('png');
    const storage = new MemoryStorage();
    storage.uploadedBackend = 'ozon-cdn';
    const repository = new MemoryRepository();
    const service = createByokGeneratedAssetIngestService({ repository, getStorage: async () => storage });
    await expect(service.ingest(ingestInput(source))).rejects.toEqual(
      expectError('BYOK_IMAGE_STORAGE_RESULT_INVALID'),
    );
    expect(storage.deleted).toHaveLength(1);
    expect(repository.rows).toHaveLength(0);
  });

  it('rejects a signed or credential-shaped storage URL before it can enter MediaAsset', async () => {
    const source = await image('png');
    const storage = new MemoryStorage();
    storage.uploadedUrl = 'https://cdn.example/generated.png?signature=must-not-persist';
    const repository = new MemoryRepository();
    const service = createByokGeneratedAssetIngestService({ repository, getStorage: async () => storage });
    await expect(service.ingest(ingestInput(source))).rejects.toEqual(
      expectError('BYOK_IMAGE_STORAGE_RESULT_INVALID'),
    );
    expect(storage.deleted).toHaveLength(1);
    expect(repository.rows).toHaveLength(0);
  });

  it('exposes a prepared asset for a caller-owned serializable grant transaction', async () => {
    const source = await image('png');
    const prepared = await prepareByokGeneratedAsset(ingestInput(source));
    expect(prepared).toMatchObject({
      assetId: expect.stringMatching(/^byok_[a-f0-9]{48}$/u),
      sourceMediaKey: expect.stringMatching(/^extension-byok:[a-f0-9]{64}$/u),
      providerResultSha256: rawHash(source),
      normalized: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    });
  });

  it('uses a typed error with a safe status code', () => {
    const error = new ByokGeneratedAssetIngestError(
      'BYOK_IMAGE_HASH_MISMATCH',
      'hash mismatch',
      409,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(409);
  });
});
