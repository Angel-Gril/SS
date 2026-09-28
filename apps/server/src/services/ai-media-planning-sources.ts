import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ImageCurationCandidate } from './ai-image-curation.js';
import {
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
} from './ai-image-edit-source.js';
import { isPublicHttpsStorageUrl } from './ai-image-translation-storage.js';
import { getOwnedImageStorageBackend } from './image-storage.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';
import {
  downloadPublicImage,
  normalizePublicSourceUrl,
  type DownloadedPublicImage,
  type DownloadPublicImageOptions,
} from './source-public-image-download.js';

export const AI_MEDIA_PLANNING_SOURCE_VERSION = 'ai-media-planning-source/v1';
export const AI_MEDIA_PLANNING_SOURCE_MAX_CANDIDATES = 25;
export const AI_MEDIA_PLANNING_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const AI_MEDIA_PLANNING_SOURCE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const AI_MEDIA_PLANNING_SOURCE_TIMEOUT_MS = 60_000;
export const AI_MEDIA_PLANNING_SOURCE_DOWNLOAD_TIMEOUT_MS = 20_000;
export const AI_MEDIA_PLANNING_SOURCE_MAX_CONCURRENT = 2;
export const AI_MEDIA_PLANNING_SOURCE_MAX_CONCURRENT_PER_OWNER = 1;

export interface AiMediaPlanningSourceScope {
  ownerUserId: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  contextType: 'collect';
  contextId: string;
}

export interface AiMediaPlanningSourceAsset {
  id: string;
  ownerUserId: string;
  kind: string;
  sourceCaptureSnapshotId: string | null;
  sourceMediaKey: string | null;
  sourceUrl: string | null;
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  /** Server-owned metadata projection; never the normalized asset digest. */
  sourceSha256: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AiMediaPlanningSourceAssetCreateInput extends Omit<
  AiMediaPlanningSourceAsset,
  'id' | 'kind' | 'sourceCaptureSnapshotId' | 'sourceMediaKey' | 'sourceUrl'
  | 'storageBackend' | 'storageKey' | 'mimeType' | 'width' | 'height' | 'sha256'
  | 'sourceSha256' | 'metadata'
> {
  kind: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
  sourceUrl: string;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sha256: string;
  sourceSha256: string;
  metadata: Record<string, unknown>;
}

export interface PreparedAiMediaPlanningSource extends AiMediaPlanningSourceScope {
  sourceMediaKey: string;
  sourceUrl: string;
  sourceSha256: string;
  width: number;
  height: number;
  sourceMimeType: string;
}

export interface AiMediaPlanningSourceRepository {
  loadLatestSourceAuthority(input: {
    ownerUserId: string;
    sourceSubjectId: string;
    contextType: string;
    contextId: string;
  }): Promise<{
    snapshotId: string;
    captureHash: string;
    profileHash: string;
    schemaVersion: string;
  } | null>;
  findPlanningSourceAssets(input: {
    ownerUserId: string;
    sourceCaptureSnapshotId: string;
    sourceMediaKeys: string[];
  }): Promise<AiMediaPlanningSourceAsset[]>;
  createPlanningSourceAsset(input: {
    scope: AiMediaPlanningSourceScope;
    asset: AiMediaPlanningSourceAssetCreateInput;
  }): Promise<AiMediaPlanningSourceAsset | null>;
}

export interface AiMediaPlanningSourceStorage {
  backend: 'local' | 'oss' | 'ozon-cdn';
  uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options: { category: 'raw'; ownerId: string; idempotencyKey: string },
  ): Promise<{ url: string; backend: string; key?: string; objectKey?: string; filename?: string }>;
}

export interface AiMediaPlanningSourceDependencies {
  download?: (url: string, options?: DownloadPublicImageOptions) => Promise<DownloadedPublicImage>;
  getStorage?: () => Promise<AiMediaPlanningSourceStorage>;
}

export type AiMediaPlanningSourceErrorCode =
  | 'AI_MEDIA_PLANNING_CONTEXT_CHANGED'
  | 'AI_MEDIA_PLANNING_SOURCE_ASSET_CONFLICT'
  | 'AI_MEDIA_PLANNING_SOURCE_FETCH_FAILED'
  | 'AI_MEDIA_PLANNING_SOURCE_INVALID'
  | 'AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED'
  | 'AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY'
  | 'AI_MEDIA_PLANNING_SOURCE_UNAVAILABLE'
  | 'AI_MEDIA_PLANNING_SOURCE_BUSY'
  | 'AI_MEDIA_PLANNING_SOURCE_TIMEOUT';

export class AiMediaPlanningSourceError extends Error {
  constructor(
    public readonly code: AiMediaPlanningSourceErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiMediaPlanningSourceError';
  }
}

const digest = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

function fail(code: AiMediaPlanningSourceErrorCode, status: number, message: string): never {
  throw new AiMediaPlanningSourceError(code, status, message);
}

function decodedMime(format: string | undefined, compression?: string): string | null {
  if (format === 'heif') return compression === 'av1' ? 'image/avif' : null;
  return ({
    jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    avif: 'image/avif', tiff: 'image/tiff',
  } as Record<string, string>)[format || ''] || null;
}

function normalizedMime(value: unknown): string | null {
  return typeof value === 'string' ? value.split(';')[0]!.trim().toLowerCase() || null : null;
}

function assetConflict(): never {
  return fail('AI_MEDIA_PLANNING_SOURCE_ASSET_CONFLICT', 409,
    'Frozen source asset does not match the owned capture and original byte provenance');
}

function publicSourceUrl(value: string): string {
  try {
    return normalizePublicSourceUrl(value).href;
  } catch {
    return fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'A selected source image has an invalid public URL');
  }
}

function assertAsset(
  asset: AiMediaPlanningSourceAsset,
  scope: AiMediaPlanningSourceScope,
  candidate: ImageCurationCandidate,
) {
  const metadata = asset.metadata;
  const rawHash = asset.sourceSha256;
  const sourceMime = normalizedMime(metadata?.sourceMimeType);
  if (!asset.id || asset.ownerUserId !== scope.ownerUserId || asset.kind !== 'SOURCE_ORIGINAL'
    || asset.sourceCaptureSnapshotId !== scope.sourceCaptureSnapshotId
    || asset.sourceMediaKey !== candidate.id || asset.sourceUrl !== candidate.url
    || !metadata || metadata.sourceCaptureHash !== scope.sourceCaptureHash
    || metadata.sourceUrl !== candidate.url || !hash(rawHash) || metadata.sourceSha256 !== rawHash
    || !positiveInteger(metadata.sourceSizeBytes) || metadata.sourceSizeBytes > AI_MEDIA_PLANNING_SOURCE_MAX_BYTES
    || !sourceMime || !Object.values({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', avif: 'image/avif', tiff: 'image/tiff' }).includes(sourceMime)
    || (candidate.mimeType != null && normalizedMime(candidate.mimeType) !== sourceMime)
    || !hash(asset.sha256) || !asset.storageKey || !asset.url
    || !['local', 'oss'].includes(asset.storageBackend)
    || (asset.storageBackend === 'oss' && !isPublicHttpsStorageUrl(asset.url))
    || !positiveInteger(asset.sizeBytes) || asset.sizeBytes > AI_MEDIA_PLANNING_SOURCE_MAX_BYTES
    || !positiveInteger(asset.width) || !positiveInteger(asset.height)
    || asset.width > AI_MEDIA_EDIT_SOURCE_MAX_EDGE || asset.height > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    || asset.width * asset.height > AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
    || (candidate.width != null && candidate.width !== asset.width)
    || (candidate.height != null && candidate.height !== asset.height)
    || asset.mimeType !== (sourceMime === 'image/png' ? 'image/png' : 'image/jpeg')
    || (metadata.sourceProfileHash != null && metadata.sourceProfileHash !== scope.sourceProfileHash)
    || (metadata.canonicalSha256 != null && metadata.canonicalSha256 !== asset.sha256)) assetConflict();
  if (metadata.lineageVersion === AI_MEDIA_PLANNING_SOURCE_VERSION
    && (metadata.sourceProfileHash !== scope.sourceProfileHash
      || metadata.sourceSubjectId !== scope.sourceSubjectId
      || metadata.sourceSchemaVersion !== scope.sourceSchemaVersion
      || metadata.canonicalSha256 !== asset.sha256
      || metadata.pixelOrientationNormalized !== true)) assetConflict();
  return {
    rawHash, rawBytes: metadata.sourceSizeBytes,
    width: asset.width, height: asset.height, sourceMimeType: sourceMime,
  };
}

async function defaultStorage(): Promise<AiMediaPlanningSourceStorage> {
  const storage = await getOwnedImageStorageBackend();
  return { backend: storage.backendType, uploadBuffer: storage.uploadBuffer.bind(storage) };
}

const sourcePreparations = new Map<string, Promise<PreparedAiMediaPlanningSource[]>>();
const ownerPreparations = new Map<string, number>();

/** Freeze only server-selected capture candidates; never dispatch a Provider or create AI costs. */
export async function prepareAiMediaPlanningSources(
  repository: AiMediaPlanningSourceRepository,
  scope: AiMediaPlanningSourceScope,
  candidates: ImageCurationCandidate[],
  dependencies: AiMediaPlanningSourceDependencies = {},
): Promise<PreparedAiMediaPlanningSource[]> {
  if (candidates.length > AI_MEDIA_PLANNING_SOURCE_MAX_CANDIDATES
    || new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    fail('AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', 413, 'Planning source candidates exceed the bounded selection');
  }
  const frozenScope = { ...scope };
  const frozenCandidates = candidates.map(candidate => ({ ...candidate, skuKeys: [...candidate.skuKeys] }));
  const ownerUserId = frozenScope.ownerUserId;
  if (typeof ownerUserId !== 'string' || !ownerUserId || ownerUserId !== ownerUserId.trim()) {
    fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'Planning source preparation requires an owned scope');
  }
  // Candidate order and all capture/tenant bindings are part of the shared work identity.
  const preparationKey = digest(JSON.stringify([
    ownerUserId, frozenScope.sourceSubjectId, frozenScope.sourceCaptureSnapshotId,
    frozenScope.sourceCaptureHash, frozenScope.sourceProfileHash, frozenScope.sourceSchemaVersion,
    frozenScope.contextType, frozenScope.contextId,
    frozenCandidates.map(candidate => [
      candidate.id, candidate.url, candidate.width, candidate.height, candidate.mimeType,
      candidate.role, candidate.skuKeys, candidate.contentHash ?? null,
      candidate.decorative ?? null, candidate.continuityGroup ?? null,
    ]),
  ]));
  const existing = sourcePreparations.get(preparationKey);
  if (existing) return existing;
  const ownerCount = ownerPreparations.get(ownerUserId) || 0;
  if (sourcePreparations.size >= AI_MEDIA_PLANNING_SOURCE_MAX_CONCURRENT
    || ownerCount >= AI_MEDIA_PLANNING_SOURCE_MAX_CONCURRENT_PER_OWNER) {
    fail('AI_MEDIA_PLANNING_SOURCE_BUSY', 429, 'Planning source preparation is busy; retry after the current preparation finishes');
  }
  ownerPreparations.set(ownerUserId, ownerCount + 1);
  const deadline = Date.now() + AI_MEDIA_PLANNING_SOURCE_TIMEOUT_MS;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = () => new AiMediaPlanningSourceError(
    'AI_MEDIA_PLANNING_SOURCE_TIMEOUT', 504, 'Planning source preparation exceeded its time limit',
  );
  const remaining = () => {
    const value = deadline - Date.now();
    if (expired || value <= 0) throw timeoutError();
    return value;
  };
  const work = freezePlanningSources(repository, frozenScope, frozenCandidates, dependencies, remaining);
  // Keep admission occupied after the public deadline while download/Sharp/storage
  // still runs. A timed-out caller must not start another copy of that work.
  const release = () => {
    sourcePreparations.delete(preparationKey);
    const count = (ownerPreparations.get(ownerUserId) || 1) - 1;
    if (count === 0) ownerPreparations.delete(ownerUserId);
    else ownerPreparations.set(ownerUserId, count);
  };
  void work.then(release, release);
  const result = Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(timeoutError()); }, remaining());
    }),
  ]).catch((error: unknown) => {
    if (error instanceof AiMediaPlanningSourceError) throw error;
    // This boundary performs database and storage I/O inside the planner's
    // input-validation path. Never expose an infrastructure error as user input.
    return fail('AI_MEDIA_PLANNING_SOURCE_UNAVAILABLE', 503, 'Planning source preparation is temporarily unavailable');
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });
  sourcePreparations.set(preparationKey, result);
  return result;
}

async function freezePlanningSources(
  repository: AiMediaPlanningSourceRepository,
  scope: AiMediaPlanningSourceScope,
  candidates: ImageCurationCandidate[],
  dependencies: AiMediaPlanningSourceDependencies,
  remaining: () => number,
): Promise<PreparedAiMediaPlanningSource[]> {
  const assertCurrent = async () => {
    remaining();
    const current = await repository.loadLatestSourceAuthority(scope);
    if (!current || current.snapshotId !== scope.sourceCaptureSnapshotId
      || current.captureHash !== scope.sourceCaptureHash || current.profileHash !== scope.sourceProfileHash
      || current.schemaVersion !== scope.sourceSchemaVersion) {
      fail('AI_MEDIA_PLANNING_CONTEXT_CHANGED', 409, 'Source capture changed during planning source preparation');
    }
    remaining();
  };
  await assertCurrent();
  if (candidates.length === 0) return [];
  const rows = await repository.findPlanningSourceAssets({
    ownerUserId: scope.ownerUserId,
    sourceCaptureSnapshotId: scope.sourceCaptureSnapshotId,
    sourceMediaKeys: candidates.map((candidate) => candidate.id),
  });
  const byKey = new Map<string, AiMediaPlanningSourceAsset[]>();
  for (const row of rows) {
    const candidate = candidates.find((item) => item.id === row.sourceMediaKey);
    if (!candidate) assetConflict();
    assertAsset(row, scope, candidate);
    const variants = byKey.get(candidate.id) || [];
    if (variants.some((item) => item.storageBackend === row.storageBackend)) assetConflict();
    if (variants.some((item) => item.sourceSha256 !== row.sourceSha256)) assetConflict();
    variants.push(row);
    byKey.set(candidate.id, variants);
  }
  const download = dependencies.download || downloadPublicImage;
  const getStorage = dependencies.getStorage || defaultStorage;
  let storage: AiMediaPlanningSourceStorage | null = null;
  let rawBytes = 0;
  let normalizedBytes = 0;
  const accountBytes = (sourceSize: number, canonicalSize: number) => {
    rawBytes += sourceSize;
    normalizedBytes += canonicalSize;
    if (rawBytes > AI_MEDIA_PLANNING_SOURCE_MAX_TOTAL_BYTES
      || normalizedBytes > AI_MEDIA_PLANNING_SOURCE_MAX_TOTAL_BYTES) {
      fail('AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', 413, 'Planning source images exceed the total byte limit');
    }
  };
  const prepared: PreparedAiMediaPlanningSource[] = [];
  for (const candidate of candidates) {
    await assertCurrent();
    if (typeof candidate.url !== 'string' || !candidate.url) {
      fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'A selected source image has no download URL');
    }
    const canonicalSourceUrl = publicSourceUrl(candidate.url);
    const existing = (byKey.get(candidate.id) || []).sort((left, right) => (
      Number(right.storageBackend === 'oss') - Number(left.storageBackend === 'oss')
    ))[0];
    if (existing) {
      const identity = assertAsset(existing, scope, candidate);
      accountBytes(identity.rawBytes, existing.sizeBytes);
      prepared.push({
        ...scope, sourceMediaKey: candidate.id, sourceUrl: candidate.url, sourceSha256: identity.rawHash,
        width: identity.width, height: identity.height, sourceMimeType: identity.sourceMimeType,
      });
      continue;
    }
    if (rawBytes >= AI_MEDIA_PLANNING_SOURCE_MAX_TOTAL_BYTES) {
      fail('AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', 413, 'Planning source images exceed the total byte limit');
    }
    let downloaded: DownloadedPublicImage;
    try {
      downloaded = await download(candidate.url, {
        maxBytes: Math.min(AI_MEDIA_PLANNING_SOURCE_MAX_BYTES, AI_MEDIA_PLANNING_SOURCE_MAX_TOTAL_BYTES - rawBytes),
        timeoutMs: Math.min(AI_MEDIA_PLANNING_SOURCE_DOWNLOAD_TIMEOUT_MS, remaining()),
      });
    } catch {
      remaining();
      fail('AI_MEDIA_PLANNING_SOURCE_FETCH_FAILED', 502, 'A selected source image could not be downloaded safely');
    }
    await assertCurrent();
    if (!Buffer.isBuffer(downloaded.buffer) || downloaded.buffer.length < 1
      || downloaded.buffer.length > AI_MEDIA_PLANNING_SOURCE_MAX_BYTES) {
      fail('AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', 413, 'A planning source image exceeds its byte limit');
    }
    if (downloaded.sourceUrl !== canonicalSourceUrl || !Number.isSafeInteger(downloaded.redirectCount)
      || downloaded.redirectCount < 0 || downloaded.redirectCount > 5) {
      fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'Source download provenance is invalid');
    }
    publicSourceUrl(downloaded.finalUrl);
    accountBytes(downloaded.buffer.length, 0);
    let canonical: { buffer: Buffer; filename: string; mimeType: 'image/jpeg' | 'image/png'; sourceFormat: string };
    let sourceMime: string;
    let width: number;
    let height: number;
    try {
      const metadata = await sharp(downloaded.buffer, {
        animated: false, limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
      }).metadata();
      const detectedMime = decodedMime(metadata.format, metadata.compression);
      width = metadata.autoOrient?.width || metadata.width || 0;
      height = metadata.autoOrient?.height || metadata.height || 0;
      if (!detectedMime || detectedMime !== normalizedMime(downloaded.contentType)
        || (candidate.mimeType != null && detectedMime !== normalizedMime(candidate.mimeType))
        || Number(metadata.pages || 1) !== 1 || !positiveInteger(width) || !positiveInteger(height)
        || width > AI_MEDIA_EDIT_SOURCE_MAX_EDGE || height > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
        || width * height > AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
        || (candidate.width != null && candidate.width !== width)
        || (candidate.height != null && candidate.height !== height)) {
        fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'Downloaded source image does not match the capture metadata');
      }
      sourceMime = detectedMime;
      const sanitized = await sanitizeOzonPublishImageBuffer(
        downloaded.buffer, `planning-source-${digest(candidate.id).slice(0, 24)}.jpg`, sourceMime,
      );
      if (sanitized.converted) {
        canonical = sanitized;
      } else {
        const pipeline = sharp(downloaded.buffer, {
          animated: false, limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
        }).autoOrient();
        canonical = {
          ...sanitized,
          buffer: sanitized.mimeType === 'image/png'
            ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
            : await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer(),
        };
      }
    } catch (error) {
      if (error instanceof AiMediaPlanningSourceError) throw error;
      fail('AI_MEDIA_PLANNING_SOURCE_INVALID', 422, 'A selected source image could not be decoded safely');
    }
    if (canonical.buffer.length < 1 || canonical.buffer.length > AI_MEDIA_PLANNING_SOURCE_MAX_BYTES) {
      fail('AI_MEDIA_PLANNING_SOURCE_LIMIT_EXCEEDED', 413, 'A normalized planning source image exceeds its byte limit');
    }
    accountBytes(0, canonical.buffer.length);
    await assertCurrent();
    if (!storage) {
      try {
        storage = await getStorage();
      } catch {
        fail('AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY', 503, 'Planning sources require ERP-owned storage');
      }
      if (!['local', 'oss'].includes(storage.backend)) {
        fail('AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY', 503, 'Planning sources require ERP-owned storage');
      }
    }
    const sourceSha256 = digest(downloaded.buffer);
    const sha256 = digest(canonical.buffer);
    const idempotencyKey = digest([
      AI_MEDIA_PLANNING_SOURCE_VERSION, scope.ownerUserId, scope.sourceCaptureSnapshotId,
      candidate.id, sourceSha256, sha256,
    ].join('\0'));
    await assertCurrent();
    let uploaded: Awaited<ReturnType<AiMediaPlanningSourceStorage['uploadBuffer']>>;
    try {
      uploaded = await storage.uploadBuffer(canonical.buffer, canonical.filename, canonical.mimeType, {
        category: 'raw', ownerId: scope.ownerUserId, idempotencyKey,
      });
    } catch {
      fail('AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY', 503, 'A planning source image could not be stored');
    }
    await assertCurrent();
    const storageKey = uploaded.key || uploaded.objectKey || uploaded.filename;
    if (uploaded.backend !== storage.backend || !uploaded.url || !storageKey
      || (uploaded.backend === 'oss' && !isPublicHttpsStorageUrl(uploaded.url))) {
      fail('AI_MEDIA_PLANNING_SOURCE_STORAGE_NOT_READY', 503, 'Planning source storage returned invalid provenance');
    }
    const asset = await repository.createPlanningSourceAsset({ scope, asset: {
      ownerUserId: scope.ownerUserId, kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: scope.sourceCaptureSnapshotId,
      sourceMediaKey: candidate.id, sourceUrl: candidate.url,
      storageBackend: uploaded.backend as 'local' | 'oss', storageKey, url: uploaded.url,
      mimeType: canonical.mimeType, sizeBytes: canonical.buffer.length, width, height,
      sha256, sourceSha256,
      metadata: {
        lineageVersion: AI_MEDIA_PLANNING_SOURCE_VERSION,
        sourceSubjectId: scope.sourceSubjectId, sourceCaptureHash: scope.sourceCaptureHash,
        sourceProfileHash: scope.sourceProfileHash, sourceSchemaVersion: scope.sourceSchemaVersion,
        sourceUrl: candidate.url, finalSourceUrl: downloaded.finalUrl,
        sourceSha256, sourceSizeBytes: downloaded.buffer.length, sourceMimeType: sourceMime,
        sourceFormat: canonical.sourceFormat, redirectCount: downloaded.redirectCount,
        canonicalSha256: sha256, pixelOrientationNormalized: true,
      },
    } });
    if (!asset) fail('AI_MEDIA_PLANNING_CONTEXT_CHANGED', 409, 'Source capture changed before asset persistence');
    const winner = assertAsset(asset, scope, candidate);
    if (winner.rawHash !== sourceSha256 || asset.sha256 !== sha256
      || winner.rawBytes !== downloaded.buffer.length || asset.sizeBytes !== canonical.buffer.length) assetConflict();
    prepared.push({
      ...scope, sourceMediaKey: candidate.id, sourceUrl: candidate.url, sourceSha256,
      width, height, sourceMimeType: sourceMime,
    });
  }
  await assertCurrent();
  return prepared;
}
