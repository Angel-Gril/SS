import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared';
import type {
  ImageUploadResult,
  OwnedImageStorageBackend,
} from './image-storage.js';

export const BYOK_GENERATED_ASSET_INGEST_VERSION =
  'byok-generated-asset-ingest/v1' as const;
export const BYOK_GENERATED_ASSET_NORMALIZER_VERSION =
  'byok-generated-asset-normalizer/v1' as const;

export const BYOK_GENERATED_ASSET_DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes,
  maxTotalBytes: AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes,
  maxOutputBytes: AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes,
  maxDimension: AI_IMAGE_WORKBENCH_LIMITS.maxDimension,
  maxPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
} as const);

export type ByokGeneratedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ByokGeneratedAssetLimits {
  maxInputBytes: number;
  maxTotalBytes: number;
  maxOutputBytes: number;
  maxDimension: number;
  maxPixels: number;
}

export type ByokGeneratedAssetIngestErrorCode =
  | 'BYOK_IMAGE_INPUT_INVALID'
  | 'BYOK_IMAGE_BYTE_LIMIT_EXCEEDED'
  | 'BYOK_IMAGE_UNSUPPORTED_MIME'
  | 'BYOK_IMAGE_MIME_MISMATCH'
  | 'BYOK_IMAGE_HASH_MISMATCH'
  | 'BYOK_IMAGE_DECODE_FAILED'
  | 'BYOK_IMAGE_ANIMATION_UNSUPPORTED'
  | 'BYOK_IMAGE_DIMENSION_LIMIT_EXCEEDED'
  | 'BYOK_IMAGE_PIXEL_LIMIT_EXCEEDED'
  | 'BYOK_IMAGE_NORMALIZATION_FAILED'
  | 'BYOK_IMAGE_STORAGE_UNAVAILABLE'
  | 'BYOK_IMAGE_STORAGE_RESULT_INVALID'
  | 'BYOK_IMAGE_STORAGE_CLEANUP_FAILED'
  | 'BYOK_IMAGE_IDEMPOTENCY_CONFLICT';

export class ByokGeneratedAssetIngestError extends Error {
  constructor(
    public readonly code: ByokGeneratedAssetIngestErrorCode,
    message: string,
    public readonly statusCode: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ByokGeneratedAssetIngestError';
  }
}

export type ByokImageByteSource =
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | AsyncIterable<unknown>;

export interface ReadBoundedByokImageInput {
  source: ByokImageByteSource;
  declaredSizeBytes?: number;
  limits?: Partial<ByokGeneratedAssetLimits>;
}

export interface BoundedByokImageInput {
  buffer: Buffer;
  sizeBytes: number;
  sha256: string;
}

export interface NormalizeByokGeneratedImageInput {
  buffer: Buffer;
  declaredMimeType: string;
  limits?: Partial<ByokGeneratedAssetLimits>;
}

export interface NormalizedByokGeneratedImage {
  buffer: Buffer;
  mimeType: ByokGeneratedImageMimeType;
  width: number;
  height: number;
  sha256: string;
  sourceMimeType: ByokGeneratedImageMimeType;
  sourceWidth: number;
  sourceHeight: number;
  normalizerVersion: typeof BYOK_GENERATED_ASSET_NORMALIZER_VERSION;
}

export interface ByokGeneratedAssetIngestInput {
  ownerUserId: string;
  sourceCaptureSnapshotId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedProviderResultSha256: string;
  declaredMimeType: string;
  declaredSizeBytes?: number;
  source: ByokImageByteSource;
}

export type ByokGeneratedAssetIdentityInput = Omit<ByokGeneratedAssetIngestInput, 'source'>;

export interface ByokGeneratedAssetIdInput {
  ownerUserId: string;
  idempotencyKey: string;
}

export interface ByokGeneratedAssetMetadata {
  ingestContractVersion: typeof BYOK_GENERATED_ASSET_INGEST_VERSION;
  normalizerVersion: typeof BYOK_GENERATED_ASSET_NORMALIZER_VERSION;
  generatedAssetSource: 'EXTENSION_BYOK';
  executionMode: 'BYOK';
  outputRole: 'BYOK_ACCEPTED';
  pixelOrientationNormalized: true;
  idempotencyKeySha256: string;
  requestHash: string;
  providerResultSha256: string;
  providerResultMimeType: ByokGeneratedImageMimeType;
  providerResultSizeBytes: number;
  normalizedSha256: string;
}

export interface ByokGeneratedAssetRecord {
  id: string;
  ownerUserId: string;
  aiImageJobId?: string | null;
  kind: 'AI_GENERATED';
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
  sourceUrl: null;
  url: string;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  mimeType: ByokGeneratedImageMimeType;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  metadata: ByokGeneratedAssetMetadata;
  createdAt?: Date;
}

export type ByokGeneratedAssetCreateInput = ByokGeneratedAssetRecord;

export type ByokGeneratedAssetCreateResult =
  | { kind: 'created' | 'replayed'; asset: ByokGeneratedAssetRecord }
  | { kind: 'conflict' };

export interface ByokGeneratedAssetRepository {
  findById(input: {
    assetId: string;
    ownerUserId: string;
  }): Promise<ByokGeneratedAssetRecord | null>;
  createOrReplay(
    input: ByokGeneratedAssetCreateInput,
  ): Promise<ByokGeneratedAssetCreateResult>;
}

export interface ByokGeneratedAssetIngestDependencies {
  repository: ByokGeneratedAssetRepository;
  getStorage(): Promise<OwnedImageStorageBackend>;
}

export interface PreparedByokGeneratedAsset {
  assetId: string;
  sourceMediaKey: string;
  ownerUserId: string;
  sourceCaptureSnapshotId: string;
  idempotencyKeySha256: string;
  requestHash: string;
  providerResultSha256: string;
  providerResultMimeType: ByokGeneratedImageMimeType;
  providerResultSizeBytes: number;
  normalized: NormalizedByokGeneratedImage;
}

export interface UploadedPreparedByokGeneratedAsset {
  upload: ImageUploadResult;
  createInput: ByokGeneratedAssetCreateInput;
}

function fail(
  code: ByokGeneratedAssetIngestErrorCode,
  statusCode: number,
  message: string,
  cause?: unknown,
): never {
  throw new ByokGeneratedAssetIngestError(code, message, statusCode, { cause });
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) || 0;
    return code <= 31 || code === 127;
  });
}

function exactIdentifier(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string'
    || value !== value.normalize('NFKC').trim()
    || value.length < minimum
    || value.length > maximum
    || hasControlCharacter(value)) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, `${field} is invalid`);
  }
  return value;
}

function positiveBoundedInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, `${field} is invalid`);
  }
  return Number(value);
}

function resolvedLimits(
  overrides: Partial<ByokGeneratedAssetLimits> = {},
): ByokGeneratedAssetLimits {
  const limits = {
    ...BYOK_GENERATED_ASSET_DEFAULT_LIMITS,
    ...overrides,
  };
  limits.maxInputBytes = positiveBoundedInteger(
    limits.maxInputBytes,
    'maxInputBytes',
    AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes,
  );
  limits.maxTotalBytes = positiveBoundedInteger(
    limits.maxTotalBytes,
    'maxTotalBytes',
    AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes,
  );
  limits.maxOutputBytes = positiveBoundedInteger(
    limits.maxOutputBytes,
    'maxOutputBytes',
    AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes,
  );
  limits.maxDimension = positiveBoundedInteger(
    limits.maxDimension,
    'maxDimension',
    AI_IMAGE_WORKBENCH_LIMITS.maxDimension,
  );
  limits.maxPixels = positiveBoundedInteger(
    limits.maxPixels,
    'maxPixels',
    AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
  );
  if (limits.maxInputBytes > limits.maxTotalBytes) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'The image byte limit exceeds the request total');
  }
  return limits;
}

function chunkBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image stream yielded invalid bytes');
}

function sourceAsSingleBuffer(source: ByokImageByteSource): Buffer | null {
  if (Buffer.isBuffer(source)) return Buffer.from(source);
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (source instanceof ArrayBuffer) return Buffer.from(source.slice(0));
  return null;
}

export async function readBoundedByokImageInput(
  input: ReadBoundedByokImageInput,
): Promise<BoundedByokImageInput> {
  if (!input || !input.source) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image input is required');
  }
  const limits = resolvedLimits(input.limits);
  let declaredSizeBytes: number | null = null;
  if (input.declaredSizeBytes != null) {
    if (!Number.isSafeInteger(input.declaredSizeBytes) || Number(input.declaredSizeBytes) < 1) {
      fail('BYOK_IMAGE_INPUT_INVALID', 400, 'declaredSizeBytes is invalid');
    }
    declaredSizeBytes = Number(input.declaredSizeBytes);
    if (declaredSizeBytes > limits.maxInputBytes || declaredSizeBytes > limits.maxTotalBytes) {
      fail('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED', 413, 'Declared image size exceeds the byte limit');
    }
  }
  const direct = sourceAsSingleBuffer(input.source);
  if (direct) {
    if (direct.length < 1) fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image input is empty');
    if (direct.length > limits.maxInputBytes || direct.length > limits.maxTotalBytes) {
      fail('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED', 413, 'Image input exceeds the byte limit');
    }
    if (declaredSizeBytes != null && declaredSizeBytes !== direct.length) {
      fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Declared image size does not match the stream');
    }
    return { buffer: direct, sizeBytes: direct.length, sha256: sha256(direct) };
  }

  const stream = input.source as AsyncIterable<unknown>;
  if (typeof stream[Symbol.asyncIterator] !== 'function') {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image input is not a readable stream');
  }
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  const digest = createHash('sha256');
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const item = await iterator.next();
      if (item.done) {
        completed = true;
        break;
      }
      const chunk = chunkBuffer(item.value);
      if (!chunk.length) continue;
      total += chunk.length;
      if (total > limits.maxInputBytes || total > limits.maxTotalBytes) {
        fail('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED', 413, 'Image input exceeds the byte limit');
      }
      chunks.push(chunk);
      digest.update(chunk);
    }
  } finally {
    if (!completed && typeof iterator.return === 'function') {
      await iterator.return().catch(() => undefined);
    }
  }
  if (total < 1) fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image input is empty');
  if (declaredSizeBytes != null && declaredSizeBytes !== total) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Declared image size does not match the stream');
  }
  return {
    buffer: Buffer.concat(chunks, total),
    sizeBytes: total,
    sha256: digest.digest('hex'),
  };
}

function normalizeMime(value: unknown): ByokGeneratedImageMimeType | null {
  const mime = String(value || '').split(';')[0]!.trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') return mime;
  return null;
}

function magicMime(buffer: Buffer): ByokGeneratedImageMimeType | null {
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function sharpMime(format: string | undefined): ByokGeneratedImageMimeType | null {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return null;
}

function validateDimensions(
  width: unknown,
  height: unknown,
  limits: ByokGeneratedAssetLimits,
): { width: number; height: number } {
  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || Number(width) < 1
    || Number(height) < 1) {
    fail('BYOK_IMAGE_DECODE_FAILED', 422, 'Image dimensions are invalid');
  }
  const resolvedWidth = Number(width);
  const resolvedHeight = Number(height);
  if (resolvedWidth > limits.maxDimension || resolvedHeight > limits.maxDimension) {
    fail('BYOK_IMAGE_DIMENSION_LIMIT_EXCEEDED', 413, 'Image dimensions exceed the limit');
  }
  if (resolvedWidth * resolvedHeight > limits.maxPixels) {
    fail('BYOK_IMAGE_PIXEL_LIMIT_EXCEEDED', 413, 'Image pixels exceed the limit');
  }
  return { width: resolvedWidth, height: resolvedHeight };
}

export async function normalizeByokGeneratedImage(
  input: NormalizeByokGeneratedImageInput,
): Promise<NormalizedByokGeneratedImage> {
  const limits = resolvedLimits(input.limits);
  if (!Buffer.isBuffer(input?.buffer) || input.buffer.length < 1) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image input is empty');
  }
  if (input.buffer.length > limits.maxInputBytes || input.buffer.length > limits.maxTotalBytes) {
    fail('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED', 413, 'Image input exceeds the byte limit');
  }
  const declaredMime = normalizeMime(input.declaredMimeType);
  if (!declaredMime) {
    fail('BYOK_IMAGE_UNSUPPORTED_MIME', 415, 'Image MIME must be PNG, JPEG, or WebP');
  }
  const detectedMime = magicMime(input.buffer);
  if (!detectedMime) {
    fail('BYOK_IMAGE_UNSUPPORTED_MIME', 415, 'Image magic must be PNG, JPEG, or WebP');
  }
  if (detectedMime !== declaredMime) {
    fail('BYOK_IMAGE_MIME_MISMATCH', 422, 'Image MIME does not match its magic bytes');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: limits.maxPixels,
    }).metadata();
  } catch (error) {
    if (/pixel limit/iu.test(String((error as { message?: unknown } | null)?.message || ''))) {
      fail('BYOK_IMAGE_PIXEL_LIMIT_EXCEEDED', 413, 'Image pixels exceed the limit', error);
    }
    fail('BYOK_IMAGE_DECODE_FAILED', 422, 'Image metadata could not be decoded safely', error);
  }
  if (sharpMime(metadata.format) !== detectedMime) {
    fail('BYOK_IMAGE_MIME_MISMATCH', 422, 'Decoded image format does not match its MIME');
  }
  if (Number(metadata.pages ?? 1) !== 1
    || (Array.isArray(metadata.delay) && metadata.delay.length > 0)) {
    fail('BYOK_IMAGE_ANIMATION_UNSUPPORTED', 422, 'Animated or multi-page images are not supported');
  }
  const sourceDimensions = validateDimensions(metadata.width, metadata.height, limits);
  const orientedDimensions = validateDimensions(
    metadata.autoOrient?.width || metadata.width,
    metadata.autoOrient?.height || metadata.height,
    limits,
  );

  let normalized: { data: Buffer; info: OutputInfo };
  try {
    let pipeline = sharp(input.buffer, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: limits.maxPixels,
    }).autoOrient().toColourspace('srgb');
    if (detectedMime === 'image/png') {
      pipeline = pipeline.png({
        compressionLevel: 9,
        adaptiveFiltering: false,
        palette: false,
        progressive: false,
      });
    } else if (detectedMime === 'image/jpeg') {
      pipeline = pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95, mozjpeg: true, progressive: false });
    } else {
      pipeline = pipeline.webp({
        quality: 95,
        alphaQuality: 100,
        smartSubsample: true,
        effort: 6,
      });
    }
    normalized = await pipeline.toBuffer({ resolveWithObject: true });
  } catch (error) {
    fail('BYOK_IMAGE_NORMALIZATION_FAILED', 422, 'Image could not be normalized safely', error);
  }
  if (normalized.data.length < 1 || normalized.data.length > limits.maxOutputBytes) {
    fail('BYOK_IMAGE_BYTE_LIMIT_EXCEEDED', 413, 'Normalized image exceeds the byte limit');
  }
  const normalizedMime = sharpMime(normalized.info.format);
  if (normalizedMime !== detectedMime || magicMime(normalized.data) !== normalizedMime) {
    fail('BYOK_IMAGE_NORMALIZATION_FAILED', 422, 'Normalized image format is invalid');
  }
  const normalizedDimensions = validateDimensions(
    normalized.info.width,
    normalized.info.height,
    limits,
  );
  if (normalizedDimensions.width !== orientedDimensions.width
    || normalizedDimensions.height !== orientedDimensions.height) {
    fail('BYOK_IMAGE_NORMALIZATION_FAILED', 422, 'Normalized image dimensions changed unexpectedly');
  }
  return {
    buffer: normalized.data,
    mimeType: normalizedMime,
    width: normalizedDimensions.width,
    height: normalizedDimensions.height,
    sha256: sha256(normalized.data),
    sourceMimeType: detectedMime,
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height,
    normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
  };
}

function deriveByokGeneratedAssetKeyIdentity(input: ByokGeneratedAssetIdInput) {
  const ownerUserId = exactIdentifier(input.ownerUserId, 'ownerUserId', 1, 200);
  const idempotencyKey = exactIdentifier(input.idempotencyKey, 'idempotencyKey', 16, 200);
  const idempotencyKeySha256 = sha256(idempotencyKey);
  const assetDigest = sha256([
    BYOK_GENERATED_ASSET_INGEST_VERSION,
    ownerUserId,
    idempotencyKeySha256,
  ].join('\u0000'));
  return {
    ownerUserId,
    idempotencyKey,
    idempotencyKeySha256,
    assetId: `byok_${assetDigest.slice(0, 48)}`,
    sourceMediaKey: `extension-byok:${assetDigest}`,
  };
}

export function deriveByokGeneratedAssetId(input: ByokGeneratedAssetIdInput): string {
  return deriveByokGeneratedAssetKeyIdentity(input).assetId;
}

export function deriveByokGeneratedAssetIdentity(input: ByokGeneratedAssetIdentityInput) {
  const keyIdentity = deriveByokGeneratedAssetKeyIdentity(input);
  const sourceCaptureSnapshotId = exactIdentifier(
    input.sourceCaptureSnapshotId,
    'sourceCaptureSnapshotId',
    1,
    200,
  );
  if (!isSha256(input.requestHash) || !isSha256(input.expectedProviderResultSha256)) {
    fail('BYOK_IMAGE_INPUT_INVALID', 400, 'Image request hashes are invalid');
  }
  return {
    ownerUserId: keyIdentity.ownerUserId,
    sourceCaptureSnapshotId,
    idempotencyKey: keyIdentity.idempotencyKey,
    idempotencyKeySha256: keyIdentity.idempotencyKeySha256,
    requestHash: input.requestHash,
    providerResultSha256: input.expectedProviderResultSha256,
    assetId: keyIdentity.assetId,
    sourceMediaKey: keyIdentity.sourceMediaKey,
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataMatches(
  value: unknown,
  expected: ByokGeneratedAssetMetadata,
): boolean {
  const actual = metadataRecord(value);
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => actual[key] === expected[key as keyof ByokGeneratedAssetMetadata]);
}

function assetMatchesReplayIdentity(
  asset: ByokGeneratedAssetRecord,
  identity: ReturnType<typeof deriveByokGeneratedAssetIdentity>,
): boolean {
  const metadata = metadataRecord(asset.metadata);
  return asset.id === identity.assetId
    && asset.ownerUserId === identity.ownerUserId
    && (asset.aiImageJobId ?? null) === null
    && asset.kind === 'AI_GENERATED'
    && asset.sourceCaptureSnapshotId === identity.sourceCaptureSnapshotId
    && asset.sourceMediaKey === identity.sourceMediaKey
    && asset.sourceUrl === null
    && ['local', 'oss'].includes(asset.storageBackend)
    && Boolean(asset.storageKey)
    && Boolean(asset.url)
    && normalizeMime(asset.mimeType) === asset.mimeType
    && Number.isSafeInteger(asset.sizeBytes)
    && asset.sizeBytes > 0
    && Number.isSafeInteger(asset.width)
    && asset.width > 0
    && Number.isSafeInteger(asset.height)
    && asset.height > 0
    && isSha256(asset.sha256)
    && metadata.ingestContractVersion === BYOK_GENERATED_ASSET_INGEST_VERSION
    && metadata.normalizerVersion === BYOK_GENERATED_ASSET_NORMALIZER_VERSION
    && metadata.generatedAssetSource === 'EXTENSION_BYOK'
    && metadata.executionMode === 'BYOK'
    && metadata.outputRole === 'BYOK_ACCEPTED'
    && metadata.pixelOrientationNormalized === true
    && metadata.idempotencyKeySha256 === identity.idempotencyKeySha256
    && metadata.requestHash === identity.requestHash
    && metadata.providerResultSha256 === identity.providerResultSha256
    && metadata.normalizedSha256 === asset.sha256;
}

export function byokGeneratedAssetMatchesCreateInput(
  asset: ByokGeneratedAssetRecord,
  input: ByokGeneratedAssetCreateInput,
): boolean {
  return byokGeneratedAssetMatchesSemanticIdentity(asset, input)
    && asset.url === input.url
    && asset.storageBackend === input.storageBackend
    && asset.storageKey === input.storageKey;
}

export function byokGeneratedAssetMatchesSemanticIdentity(
  asset: ByokGeneratedAssetRecord,
  input: ByokGeneratedAssetCreateInput,
): boolean {
  return assetMatchesReplayIdentity(asset, {
    ownerUserId: input.ownerUserId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    idempotencyKey: '',
    idempotencyKeySha256: input.metadata.idempotencyKeySha256,
    requestHash: input.metadata.requestHash,
    providerResultSha256: input.metadata.providerResultSha256,
    assetId: input.id,
    sourceMediaKey: input.sourceMediaKey,
  })
    && asset.mimeType === input.mimeType
    && asset.sizeBytes === input.sizeBytes
    && asset.width === input.width
    && asset.height === input.height
    && asset.sha256 === input.sha256
    && metadataMatches(asset.metadata, input.metadata);
}

export async function prepareByokGeneratedAsset(
  input: ByokGeneratedAssetIngestInput,
  limits?: Partial<ByokGeneratedAssetLimits>,
): Promise<PreparedByokGeneratedAsset> {
  const identity = deriveByokGeneratedAssetIdentity(input);
  const read = await readBoundedByokImageInput({
    source: input.source,
    declaredSizeBytes: input.declaredSizeBytes,
    limits,
  });
  if (read.sha256 !== identity.providerResultSha256) {
    fail('BYOK_IMAGE_HASH_MISMATCH', 409, 'Image bytes do not match the granted result hash');
  }
  const normalized = await normalizeByokGeneratedImage({
    buffer: read.buffer,
    declaredMimeType: input.declaredMimeType,
    limits,
  });
  return {
    assetId: identity.assetId,
    sourceMediaKey: identity.sourceMediaKey,
    ownerUserId: identity.ownerUserId,
    sourceCaptureSnapshotId: identity.sourceCaptureSnapshotId,
    idempotencyKeySha256: identity.idempotencyKeySha256,
    requestHash: identity.requestHash,
    providerResultSha256: identity.providerResultSha256,
    providerResultMimeType: normalized.sourceMimeType,
    providerResultSizeBytes: read.sizeBytes,
    normalized,
  };
}

function extensionForMime(mimeType: ByokGeneratedImageMimeType): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function byokGeneratedAssetUploadFilename(
  assetId: string,
  mimeType: ByokGeneratedImageMimeType,
): string {
  return `${exactIdentifier(assetId, 'assetId', 1, 200)}.${extensionForMime(mimeType)}`;
}

export function byokGeneratedAssetStorageIdempotencyKey(attemptId: string): string {
  return `byok-upload:${exactIdentifier(attemptId, 'attemptId', 8, 64)}`;
}

function exactStorageValue(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > 2_000
    || hasControlCharacter(value)) {
    fail('BYOK_IMAGE_STORAGE_RESULT_INVALID', 503, `${label} is invalid`);
  }
  return value;
}

function storageUrl(
  value: unknown,
  backend: 'local' | 'oss',
): string {
  const exact = exactStorageValue(value, 'Stored image URL');
  try {
    const url = new URL(exact);
    if (!['http:', 'https:'].includes(url.protocol)
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash) {
      throw new Error();
    }
    if (backend === 'oss' && url.protocol !== 'https:') throw new Error();
  } catch {
    fail('BYOK_IMAGE_STORAGE_RESULT_INVALID', 503, 'Stored image URL is invalid');
  }
  return exact;
}

function storageKey(result: ImageUploadResult): string {
  const key = exactStorageValue(
    result.objectKey || result.key || result.filename,
    'Stored image key',
  );
  if (key.includes('?')
    || key.includes('#')
    || /(?:https?|ftp):\/\//iu.test(key)
    || /(?:authorization|api[_-]?key|access[_-]?token|password|secret)\s*[:=]/iu.test(key)) {
    fail('BYOK_IMAGE_STORAGE_RESULT_INVALID', 503, 'Stored image key is invalid');
  }
  return key;
}

export function createByokGeneratedAssetCreateInputFromUpload(
  prepared: PreparedByokGeneratedAsset,
  upload: ImageUploadResult,
): ByokGeneratedAssetCreateInput {
  if (upload.backend !== 'local' && upload.backend !== 'oss') {
    fail(
      'BYOK_IMAGE_STORAGE_RESULT_INVALID',
      503,
      'Generated assets require ERP-owned local or OSS/R2 storage',
    );
  }
  const normalized = prepared.normalized;
  return {
    id: prepared.assetId,
    ownerUserId: prepared.ownerUserId,
    aiImageJobId: null,
    kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: prepared.sourceCaptureSnapshotId,
    sourceMediaKey: prepared.sourceMediaKey,
    sourceUrl: null,
    url: storageUrl(upload.url, upload.backend),
    storageBackend: upload.backend,
    storageKey: storageKey(upload),
    mimeType: normalized.mimeType,
    sizeBytes: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
    sha256: normalized.sha256,
    metadata: metadataForPreparedAsset(prepared),
  };
}

function metadataForPreparedAsset(
  prepared: PreparedByokGeneratedAsset,
): ByokGeneratedAssetMetadata {
  return {
    ingestContractVersion: BYOK_GENERATED_ASSET_INGEST_VERSION,
    normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
    generatedAssetSource: 'EXTENSION_BYOK',
    executionMode: 'BYOK',
    outputRole: 'BYOK_ACCEPTED',
    pixelOrientationNormalized: true,
    idempotencyKeySha256: prepared.idempotencyKeySha256,
    requestHash: prepared.requestHash,
    providerResultSha256: prepared.providerResultSha256,
    providerResultMimeType: prepared.providerResultMimeType,
    providerResultSizeBytes: prepared.providerResultSizeBytes,
    normalizedSha256: prepared.normalized.sha256,
  };
}

/**
 * Reuses an already persisted deterministic object before consulting the
 * current storage configuration. This is required for an exact response-loss
 * replay: a later CDN/base-URL change must not create a second object or make
 * the original successful receipt look conflicting.
 */
export function createByokGeneratedAssetCreateInputFromStoredAsset(
  prepared: PreparedByokGeneratedAsset,
  stored: ByokGeneratedAssetRecord,
): ByokGeneratedAssetCreateInput {
  const storedUrl = storageUrl(stored.url, stored.storageBackend);
  const storedKey = storageKey({
    url: storedUrl,
    filename: stored.storageKey,
    key: stored.storageKey,
    objectKey: stored.storageKey,
    backend: stored.storageBackend,
  });
  const expected: ByokGeneratedAssetCreateInput = {
    id: prepared.assetId,
    ownerUserId: prepared.ownerUserId,
    aiImageJobId: null,
    kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: prepared.sourceCaptureSnapshotId,
    sourceMediaKey: prepared.sourceMediaKey,
    sourceUrl: null,
    url: storedUrl,
    storageBackend: stored.storageBackend,
    storageKey: storedKey,
    mimeType: prepared.normalized.mimeType,
    sizeBytes: prepared.normalized.buffer.length,
    width: prepared.normalized.width,
    height: prepared.normalized.height,
    sha256: prepared.normalized.sha256,
    metadata: metadataForPreparedAsset(prepared),
  };
  if (!byokGeneratedAssetMatchesCreateInput(stored, expected)) {
    fail(
      'BYOK_IMAGE_IDEMPOTENCY_CONFLICT',
      409,
      'Stored BYOK generated asset conflicts with the granted result',
    );
  }
  return expected;
}

async function cleanupUpload(
  storage: OwnedImageStorageBackend,
  upload: ImageUploadResult,
  cause: unknown,
): Promise<never> {
  try {
    await storage.deleteUploaded(upload);
  } catch (cleanupError) {
    fail(
      'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
      503,
      'Generated image persistence failed and uploaded bytes could not be removed',
      { cause, cleanupError },
    );
  }
  throw cause;
}

function sameStoredObject(
  asset: ByokGeneratedAssetRecord,
  upload: ImageUploadResult,
): boolean {
  return asset.storageBackend === upload.backend
    && asset.storageKey === (upload.objectKey || upload.key || upload.filename);
}

/**
 * Uploads already-normalized bytes to an attempt-unique ERP-owned object key
 * and returns the exact MediaAsset insert.  A device route can call this
 * before opening its database transaction, then create the returned row in
 * the same transaction that consumes the grant and writes provenance.
 */
export async function uploadPreparedByokGeneratedAsset(
  prepared: PreparedByokGeneratedAsset,
  storage: OwnedImageStorageBackend,
  attemptId: string = randomUUID(),
): Promise<UploadedPreparedByokGeneratedAsset> {
  if (!storage
    || !['local', 'oss'].includes(storage.backendType)
    || typeof storage.uploadBuffer !== 'function'
    || typeof storage.deleteUploaded !== 'function') {
    fail(
      'BYOK_IMAGE_STORAGE_UNAVAILABLE',
      503,
      'ERP-owned generated image storage is unavailable',
    );
  }
  const normalized = prepared.normalized;
  const filename = byokGeneratedAssetUploadFilename(prepared.assetId, normalized.mimeType);
  const storageIdempotencyKey = byokGeneratedAssetStorageIdempotencyKey(attemptId);
  let upload: ImageUploadResult;
  try {
    upload = await storage.uploadBuffer(
      normalized.buffer,
      filename,
      normalized.mimeType,
      {
        category: 'ai-generated',
        ownerId: prepared.ownerUserId,
        idempotencyKey: storageIdempotencyKey,
      },
    );
  } catch (error) {
    fail('BYOK_IMAGE_STORAGE_UNAVAILABLE', 503, 'Generated image upload failed', error);
  }
  if (upload.backend !== storage.backendType) {
    return cleanupUpload(
      storage,
      upload,
      new ByokGeneratedAssetIngestError(
        'BYOK_IMAGE_STORAGE_RESULT_INVALID',
        'Generated image storage changed backend during upload',
        503,
      ),
    );
  }
  try {
    return {
      upload,
      createInput: createByokGeneratedAssetCreateInputFromUpload(prepared, upload),
    };
  } catch (error) {
    return cleanupUpload(storage, upload, error);
  }
}

export function createByokGeneratedAssetIngestService(
  dependencies: ByokGeneratedAssetIngestDependencies,
) {
  return {
    async ingest(
      input: ByokGeneratedAssetIngestInput,
      limits?: Partial<ByokGeneratedAssetLimits>,
    ): Promise<{ asset: ByokGeneratedAssetRecord; replayed: boolean }> {
      const identity = deriveByokGeneratedAssetIdentity(input);
      const existing = await dependencies.repository.findById({
        assetId: identity.assetId,
        ownerUserId: identity.ownerUserId,
      });
      if (existing) {
        if (!assetMatchesReplayIdentity(existing, identity)) {
          fail(
            'BYOK_IMAGE_IDEMPOTENCY_CONFLICT',
            409,
            'The BYOK image idempotency key was reused for another result',
          );
        }
        return { asset: existing, replayed: true };
      }

      const prepared = await prepareByokGeneratedAsset(input, limits);
      let storage: OwnedImageStorageBackend;
      try {
        storage = await dependencies.getStorage();
      } catch (error) {
        fail(
          'BYOK_IMAGE_STORAGE_UNAVAILABLE',
          503,
          'ERP-owned generated image storage is unavailable',
          error,
        );
      }
      const uploaded = await uploadPreparedByokGeneratedAsset(prepared, storage);
      const { upload, createInput } = uploaded;
      let committed: ByokGeneratedAssetCreateResult;
      try {
        committed = await dependencies.repository.createOrReplay(createInput);
      } catch (error) {
        return cleanupUpload(storage, upload, error);
      }
      if (committed.kind === 'conflict'
        || !byokGeneratedAssetMatchesSemanticIdentity(committed.asset, createInput)) {
        const conflict = new ByokGeneratedAssetIngestError(
          'BYOK_IMAGE_IDEMPOTENCY_CONFLICT',
          'The BYOK image idempotency key was reused for another result',
          409,
        );
        const winner = committed.kind === 'conflict'
          ? await dependencies.repository.findById({
            assetId: prepared.assetId,
            ownerUserId: prepared.ownerUserId,
          })
          : committed.asset;
        // A racing request may have committed the same deterministic object
        // key. Deleting that key would corrupt the winner's MediaAsset.
        if (winner && sameStoredObject(winner, upload)) throw conflict;
        return cleanupUpload(storage, upload, conflict);
      }
      if (committed.kind === 'replayed' && !sameStoredObject(committed.asset, upload)) {
        await storage.deleteUploaded(upload).catch((error) => {
          fail(
            'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
            503,
            'Concurrent replay bytes could not be removed',
            error,
          );
        });
      }
      return {
        asset: committed.asset,
        replayed: committed.kind === 'replayed',
      };
    },
  };
}

export type ByokGeneratedAssetIngestService = ReturnType<
  typeof createByokGeneratedAssetIngestService
>;
