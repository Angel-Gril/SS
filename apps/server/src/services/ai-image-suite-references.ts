import { createHash } from 'node:crypto';
import {
  verifySourceProductCaptureV2Submission,
  type SourceCaptureMedia,
  type SourceProductCaptureV2,
} from 'shared';
import sharp from 'sharp';
import { isPublicHttpsStorageUrl } from './ai-image-translation-storage.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import {
  AiImageSuitePreparationLeaseError,
  type AiImageSuitePreparationLease,
} from './ai-image-suite-preparation-lease.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';
import {
  downloadPublicImage,
  type DownloadedPublicImage,
  type DownloadPublicImageOptions,
} from './source-public-image-download.js';
import { buildSourceProductProfileFromCapture } from './source-product-profile.js';
import { AI_MEDIA_PLANNING_SOURCE_VERSION } from './ai-media-planning-sources.js';

export const AI_IMAGE_SUITE_REFERENCE_SET_VERSION = 'ai-image-suite-reference-set/v1';
export const AI_IMAGE_SUITE_REFERENCE_MAX_COUNT = 25;
export const AI_IMAGE_SUITE_REFERENCE_MAX_BYTES_PER_IMAGE = 20 * 1024 * 1024;
export const AI_IMAGE_SUITE_REFERENCE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const AI_IMAGE_SUITE_REFERENCE_MAX_PIXELS = 40_000_000;

const MAX_IDENTIFIER_LENGTH = 500;
const MAX_OPERATION_KEY_LENGTH = 128;
const MAX_SLOT_COUNT = 500;
const MAX_REFERENCES_PER_SLOT = 20;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SUPPORTED_STORAGE_BACKENDS = new Set(['local', 'oss']);

export interface AiImageSuiteReferenceSnapshotIdentity {
  id: string;
  captureHash: string;
  profileHash: string;
  schemaVersion: string;
}

export interface AiImageSuiteReferenceCaptureSnapshot extends AiImageSuiteReferenceSnapshotIdentity {
  ownerUserId: string;
  subjectId: string;
  payloadBytes: number;
  payload: unknown;
}

export interface AiImageSuiteReferenceSlotAuthority {
  ordinal: number;
  slotKey: string;
  referencesSnapshot: unknown;
}

export interface AiImageSuiteReferenceAuthority {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  revision: number;
  status: string;
  provider: string;
  model: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  contextType: string;
  contextId: string;
  slots: AiImageSuiteReferenceSlotAuthority[];
  snapshot: AiImageSuiteReferenceCaptureSnapshot;
  latestSnapshot: AiImageSuiteReferenceSnapshotIdentity | null;
}

export interface AiImageSuiteReferenceAsset {
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
  sourceSha256: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AiImageSuiteReferenceAssetCreateInput {
  ownerUserId: string;
  kind: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
  sourceUrl: string;
  url: string;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  sourceSha256: string;
  metadata: Record<string, unknown>;
}

export interface AiImageSuitePreparedReference {
  ordinal: number;
  candidateId: string;
  sourceUrl: string;
  expectedContentHash: string | null;
  sourceSha256: string;
  assetSha256: string;
  asset: AiImageSuiteReferenceAsset;
  reused: boolean;
}

export interface AiImageSuiteReferenceBinding {
  ordinal: number;
  candidateId: string;
  sourceMediaKey: string;
  sourceUrl: string;
  expectedContentHash: string | null;
  sourceSha256: string;
  assetId: string;
  assetSha256: string;
  assetUrl: string;
  storageBackend: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface AiImageSuiteReferenceCommitInput {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  referenceSetHash: string;
  bindings: AiImageSuiteReferenceBinding[];
}

export type AiImageSuiteReferenceCommitResult =
  | { kind: 'committed' | 'existing' | 'already-internalized'; referenceSetHash: string }
  | { kind: 'not-found' | 'stale' | 'revision-conflict' | 'conflict'; referenceSetHash?: string };

export type AiImageSuiteReferenceCommitReplayResult =
  | { kind: 'existing'; referenceSetHash: string; bindings: AiImageSuiteReferenceBinding[] }
  | { kind: 'already-internalized'; referenceSetHash?: string }
  | { kind: 'conflict' }
  | null;

export interface AiImageSuiteReferenceRepository {
  findCommitReplay(input: {
    suiteId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    operationKey: string;
  }): Promise<AiImageSuiteReferenceCommitReplayResult>;
  loadAuthority(input: {
    suiteId: string;
    ownerUserId: string;
  }): Promise<AiImageSuiteReferenceAuthority | null>;
  findReusableAssets(input: {
    ownerUserId: string;
    sourceCaptureSnapshotId: string;
    sourceMediaKeys: string[];
  }): Promise<AiImageSuiteReferenceAsset[]>;
  createAsset(input: AiImageSuiteReferenceAssetCreateInput): Promise<AiImageSuiteReferenceAsset>;
  commitBindings(input: AiImageSuiteReferenceCommitInput): Promise<AiImageSuiteReferenceCommitResult>;
}

export interface AiImageSuiteReferenceStorageUploadResult {
  url: string;
  backend: string;
  filename?: string;
  key?: string;
  objectKey?: string;
}

export interface AiImageSuiteReferenceStorage {
  backend: 'local' | 'oss' | 'ozon-cdn';
  uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options: {
      category: 'raw';
      ownerId: string;
      idempotencyKey: string;
    },
  ): Promise<AiImageSuiteReferenceStorageUploadResult>;
}

export interface AiImageSuiteReferenceDependencies {
  repository: AiImageSuiteReferenceRepository;
  preparationLease: AiImageSuitePreparationLease;
  getStorage(): Promise<AiImageSuiteReferenceStorage>;
  download?: (
    url: string,
    options?: DownloadPublicImageOptions,
  ) => Promise<DownloadedPublicImage>;
}

export interface AiImageSuiteReferenceLimits {
  maxReferences?: number;
  maxBytesPerImage?: number;
  maxTotalBytes?: number;
  maxPixels?: number;
}

export interface InternalizeAiImageSuiteReferencesInput {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
}

export interface InternalizeAiImageSuiteReferencesResult {
  suiteId: string;
  referenceCount: number;
  referenceSetHash: string;
  bindings: AiImageSuiteReferenceBinding[];
  replayed: boolean;
}

export type AiImageSuiteReferenceErrorCode =
  | 'AI_MEDIA_SUITE_REFERENCE_INVALID_INPUT'
  | 'AI_MEDIA_SUITE_REFERENCE_NOT_FOUND'
  | 'AI_MEDIA_SUITE_REFERENCE_INVALID_STATE'
  | 'AI_MEDIA_SUITE_REFERENCE_STALE'
  | 'AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID'
  | 'AI_MEDIA_SUITE_REFERENCE_CONTENT_HASH_REQUIRED'
  | 'AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED'
  | 'AI_MEDIA_SUITE_REFERENCE_SOURCE_INVALID'
  | 'AI_MEDIA_SUITE_REFERENCE_SOURCE_FETCH_FAILED'
  | 'AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED'
  | 'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY'
  | 'AI_MEDIA_SUITE_REFERENCE_PREPARATION_BUSY'
  | 'AI_MEDIA_SUITE_REFERENCE_PREPARATION_UNAVAILABLE'
  | 'AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT'
  | 'AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED'
  | 'AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT';

export class AiImageSuiteReferenceError extends Error {
  constructor(
    public readonly code: AiImageSuiteReferenceErrorCode,
    public readonly statusCode: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiImageSuiteReferenceError';
  }
}

interface FrozenReference {
  ordinal: number;
  candidateId: string;
  source: {
    url: string;
    width: number | null;
    height: number | null;
    mimeType: string | null;
    role: string;
    skuKeys: string[];
    contentHash: string | null;
  };
}

interface ResolvedLimits {
  maxReferences: number;
  maxBytesPerImage: number;
  maxTotalBytes: number;
  maxPixels: number;
}

function fail(
  code: AiImageSuiteReferenceErrorCode,
  statusCode: number,
  message: string,
  cause?: unknown,
): never {
  throw new AiImageSuiteReferenceError(code, statusCode, message, { cause });
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function exactString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.normalize('NFKC').trim()
    || value.length > maxLength
    || hasControlCharacters(value)) {
    fail('AI_MEDIA_SUITE_REFERENCE_INVALID_INPUT', 400, `${label} is invalid`);
  }
  return value;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactHash(value: unknown, label: string): string {
  const normalized = exactString(value, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, `${label} is invalid`);
  }
  return normalized;
}

function optionalHash(value: unknown, label: string): string | null {
  if (value == null) return null;
  return exactHash(value, label);
}

function positiveIntegerOrNull(value: unknown, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, `${label} is invalid`);
  }
  return Number(value);
}

function normalizeMime(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).split(';', 1)[0]!.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized || null;
}

function decodedMime(format: string | undefined): string | null {
  switch (String(format || '').toLowerCase()) {
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'avif': return 'image/avif';
    case 'tiff': return 'image/tiff';
    default: return null;
  }
}

function exactUrl(value: unknown, label: string): string {
  const text = exactString(value, label, 8_000);
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)
      || !url.hostname
      || url.username
      || url.password) throw new Error('invalid URL');
  } catch (error) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, `${label} is invalid`, error);
  }
  return text;
}

function normalizedSkuKeys(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, `${label} is invalid`);
  }
  const keys = value.map((entry, index) => exactString(entry, `${label}[${index}]`, MAX_IDENTIFIER_LENGTH));
  if (new Set(keys).size !== keys.length) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, `${label} contains duplicates`);
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function parseFrozenReference(raw: unknown, ordinal: number): FrozenReference {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Frozen suite reference is invalid');
  }
  const record = raw as Record<string, unknown>;
  const source = record.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Frozen suite reference source is invalid');
  }
  const sourceRecord = source as Record<string, unknown>;
  return {
    ordinal,
    candidateId: exactString(record.candidateId, 'candidateId', MAX_IDENTIFIER_LENGTH),
    source: {
      url: exactUrl(sourceRecord.url, 'source.url'),
      width: positiveIntegerOrNull(sourceRecord.width, 'source.width'),
      height: positiveIntegerOrNull(sourceRecord.height, 'source.height'),
      mimeType: sourceRecord.mimeType == null
        ? null
        : exactString(normalizeMime(sourceRecord.mimeType), 'source.mimeType', 200),
      role: exactString(sourceRecord.role, 'source.role', 100),
      skuKeys: normalizedSkuKeys(sourceRecord.skuKeys, 'source.skuKeys'),
      contentHash: optionalHash(sourceRecord.contentHash, 'source.contentHash'),
    },
  };
}

function referenceIdentity(reference: FrozenReference) {
  return {
    candidateId: reference.candidateId,
    source: reference.source,
  };
}

export function resolveAiImageSuiteFrozenReferences(
  authority: Pick<AiImageSuiteReferenceAuthority, 'slots'>,
  maxReferences = AI_IMAGE_SUITE_REFERENCE_MAX_COUNT,
): FrozenReference[] {
  if (!Array.isArray(authority.slots)
    || authority.slots.length < 1
    || authority.slots.length > MAX_SLOT_COUNT) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite slots are invalid');
  }
  const orderedSlots = [...authority.slots].sort((left, right) => left.ordinal - right.ordinal);
  const slotOrdinals = new Set<number>();
  const referencesByCandidate = new Map<string, FrozenReference>();
  let ordinal = 0;
  for (const slot of orderedSlots) {
    if (!Number.isSafeInteger(slot.ordinal)
      || slot.ordinal < 0
      || slotOrdinals.has(slot.ordinal)) {
      fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite slot ordinal is invalid');
    }
    slotOrdinals.add(slot.ordinal);
    exactString(slot.slotKey, 'slotKey', 1024);
    if (!Array.isArray(slot.referencesSnapshot)
      || slot.referencesSnapshot.length < 1
      || slot.referencesSnapshot.length > MAX_REFERENCES_PER_SLOT) {
      fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite slot references are invalid');
    }
    for (const rawReference of slot.referencesSnapshot) {
      const reference = parseFrozenReference(rawReference, ordinal);
      const existing = referencesByCandidate.get(reference.candidateId);
      if (existing) {
        if (hashAiMediaPlanningJson(referenceIdentity(existing))
          !== hashAiMediaPlanningJson(referenceIdentity(reference))) {
          fail(
            'AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID',
            409,
            'A frozen candidate has conflicting reference metadata',
          );
        }
        continue;
      }
      if (referencesByCandidate.size >= maxReferences) {
        fail(
          'AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED',
          413,
          `Suite references exceed the ${maxReferences} image limit`,
        );
      }
      referencesByCandidate.set(reference.candidateId, reference);
      ordinal += 1;
    }
  }
  return [...referencesByCandidate.values()];
}

function sameSnapshot(
  actual: AiImageSuiteReferenceSnapshotIdentity | null,
  expected: Pick<AiImageSuiteReferenceAuthority,
  'sourceCaptureSnapshotId' | 'sourceCaptureHash' | 'sourceProfileHash' | 'sourceSchemaVersion'>,
): boolean {
  return Boolean(actual
    && actual.id === expected.sourceCaptureSnapshotId
    && actual.captureHash === expected.sourceCaptureHash
    && actual.profileHash === expected.sourceProfileHash
    && actual.schemaVersion === expected.sourceSchemaVersion);
}

async function verifiedCapture(authority: AiImageSuiteReferenceAuthority): Promise<SourceProductCaptureV2> {
  const snapshot = authority.snapshot;
  if (authority.ownerUserId !== snapshot.ownerUserId
    || authority.sourceSubjectId !== snapshot.subjectId
    || !sameSnapshot(snapshot, authority)
    || !sameSnapshot(authority.latestSnapshot, authority)
    || snapshot.schemaVersion !== 'source-product-capture-v2') {
    fail('AI_MEDIA_SUITE_REFERENCE_STALE', 409, 'Suite source capture authority is stale');
  }
  let verification: Awaited<ReturnType<typeof verifySourceProductCaptureV2Submission>>;
  try {
    verification = await verifySourceProductCaptureV2Submission({
      capture: snapshot.payload,
      captureHash: snapshot.captureHash,
      payloadBytes: snapshot.payloadBytes,
    });
  } catch (error) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite source capture verification failed', error);
  }
  if (!verification.valid) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite source capture submission is invalid');
  }
  const capture = snapshot.payload as SourceProductCaptureV2;
  let profile: ReturnType<typeof buildSourceProductProfileFromCapture>;
  try {
    profile = buildSourceProductProfileFromCapture(capture, {
      itemId: snapshot.captureHash,
      captureHash: snapshot.captureHash,
    });
  } catch (error) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite source profile could not be rebuilt', error);
  }
  if (profile.hash !== snapshot.profileHash || profile.hash !== authority.sourceProfileHash) {
    fail('AI_MEDIA_SUITE_REFERENCE_AUTHORITY_INVALID', 409, 'Suite source profile hash is invalid');
  }
  return capture;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveCaptureMedia(
  capture: SourceProductCaptureV2,
  reference: FrozenReference,
): SourceCaptureMedia {
  const matches = capture.media.filter((entry) => entry.key === reference.candidateId);
  if (matches.length !== 1) {
    fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED', 409, 'Frozen source media is not unique in its capture');
  }
  const media = matches[0]!;
  const mediaSkuKeys = [...media.skuKeys].sort((left, right) => left.localeCompare(right));
  // Missing capture metadata may be filled only by the bytes frozen before
  // planning. Reuse/download validation below still proves these exact values.
  const metadataMatches = (captured: unknown, frozen: unknown) => captured === frozen
    || (captured == null && frozen != null && reference.source.contentHash != null);
  if (media.kind !== 'image'
    || media.disposition !== 'accepted'
    || !media.url
    || media.url !== reference.source.url
    || !metadataMatches(media.width, reference.source.width)
    || !metadataMatches(media.height, reference.source.height)
    || !metadataMatches(normalizeMime(media.mimeType), reference.source.mimeType)
    || media.role !== reference.source.role
    || !sameStringSet(mediaSkuKeys, reference.source.skuKeys)) {
    fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED', 409, 'Frozen source media no longer matches capture authority');
  }
  return media;
}

function sourceSha256ForAsset(asset: AiImageSuiteReferenceAsset): string | null {
  const direct = String(asset.sourceSha256 || '').toLowerCase();
  if (SHA256_PATTERN.test(direct)) return direct;
  const metadataHash = String(asset.metadata?.sourceSha256 || '').toLowerCase();
  return SHA256_PATTERN.test(metadataHash) ? metadataHash : null;
}

function sourceSizeBytesForAsset(asset: AiImageSuiteReferenceAsset): number | null {
  const value = asset.metadata?.sourceSizeBytes;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function validStoredUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function normalizeAiImageSuiteOssCdnDomain(value: string | null | undefined): string | null {
  const domain = String(value || '').trim().replace(/\/+$/u, '');
  if (!domain) return null;
  return domain.startsWith('http') ? domain : `https://${domain}`;
}

export function resolveAiImageSuiteReferenceStorageReadiness(input: {
  provider: string;
  backend: 'local' | 'oss' | 'ozon-cdn';
  ossConfigured: boolean;
  publicBaseUrl: string | null;
}) {
  const publicBaseUrl = String(input.publicBaseUrl || '').trim().replace(/\/+$/u, '');
  const publicHttps = isPublicHttpsStorageUrl(publicBaseUrl);
  if (!SUPPORTED_STORAGE_BACKENDS.has(input.backend)) {
    return {
      ready: false,
      backend: input.backend,
      publicHttps,
      reason: 'AI image suite references require local or owned OSS storage',
    };
  }
  if (input.backend === 'oss' && !input.ossConfigured) {
    return {
      ready: false,
      backend: input.backend,
      publicHttps,
      reason: 'AI image suite OSS storage is not fully configured',
    };
  }
  if (input.provider === 'fake' && !validStoredUrl(publicBaseUrl)) {
    return {
      ready: false,
      backend: input.backend,
      publicHttps,
      reason: 'Fake AI image suite storage requires an absolute HTTP(S) URL',
    };
  }
  if (input.provider !== 'fake' && (input.backend !== 'oss' || !publicHttps)) {
    return {
      ready: false,
      backend: input.backend,
      publicHttps,
      reason: 'Paid AI image suite references require owned OSS with a public HTTPS URL',
    };
  }
  return {
    ready: true,
    backend: input.backend,
    publicHttps,
    reason: input.backend === 'oss'
      ? 'AI image suite OSS storage is ready'
      : 'Local AI image suite storage is ready for fake execution',
  };
}

function assertStoragePolicy(
  provider: string,
  backend: string,
  url?: string,
): void {
  if (!SUPPORTED_STORAGE_BACKENDS.has(backend)) {
    fail('AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY', 503, 'Suite references require local or OSS storage');
  }
  if (provider !== 'fake' && backend !== 'oss') {
    fail('AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY', 503, 'Paid suite references require OSS storage');
  }
  if (url && (provider !== 'fake' ? !isPublicHttpsStorageUrl(url) : !validStoredUrl(url))) {
    fail(
      'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY',
      503,
      provider === 'fake'
        ? 'Suite reference storage returned an invalid URL'
        : 'Paid suite reference storage requires a public HTTPS URL',
    );
  }
}

function selectReusableAsset(
  assets: AiImageSuiteReferenceAsset[],
  authority: AiImageSuiteReferenceAuthority,
): AiImageSuiteReferenceAsset | undefined {
  const compatible = assets.filter((asset) => (
    authority.provider === 'fake'
      ? SUPPORTED_STORAGE_BACKENDS.has(asset.storageBackend)
      : asset.storageBackend === 'oss'
  ));
  return compatible.find((asset) => (
    asset.metadata?.lineageVersion === AI_IMAGE_SUITE_REFERENCE_SET_VERSION
  )) || compatible.sort((left, right) => {
    const rank = (backend: string) => backend === 'local' ? 0 : 1;
    return rank(left.storageBackend) - rank(right.storageBackend)
      || left.id.localeCompare(right.id);
  })[0];
}

interface ReusableAssetIdentity {
  assetSha256: string;
  sourceSha256: string | null;
  sourceSizeBytes: number | null;
  sourceMimeType: string | null;
  complete: boolean;
}

function assertReusableAssetIdentity(
  asset: AiImageSuiteReferenceAsset,
  authority: AiImageSuiteReferenceAuthority,
  reference: FrozenReference,
): ReusableAssetIdentity {
  const sourceSha256 = sourceSha256ForAsset(asset);
  const sourceSizeBytes = sourceSizeBytesForAsset(asset);
  const assetSha256 = String(asset.sha256 || '').toLowerCase();
  const sourceMimeType = normalizeMime(asset.metadata?.sourceMimeType);
  const assetMimeType = normalizeMime(asset.mimeType);
  const expectedSourceMimeType = sourceMimeType || reference.source.mimeType || assetMimeType;
  const canonicalMimeType = expectedSourceMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const planningSource = asset.metadata?.lineageVersion === AI_MEDIA_PLANNING_SOURCE_VERSION;
  if (planningSource && (asset.metadata?.sourceSubjectId !== authority.sourceSubjectId
    || asset.metadata?.sourceCaptureHash !== authority.sourceCaptureHash
    || asset.metadata?.sourceProfileHash !== authority.sourceProfileHash
    || asset.metadata?.sourceSchemaVersion !== authority.sourceSchemaVersion
    || asset.metadata?.sourceUrl !== reference.source.url
    || asset.metadata?.canonicalSha256 !== assetSha256
    || asset.metadata?.pixelOrientationNormalized !== true)) {
    fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Planning source provenance does not match the frozen suite');
  }
  const complete = (asset.metadata?.lineageVersion === AI_IMAGE_SUITE_REFERENCE_SET_VERSION || planningSource)
    && Boolean(sourceSha256 && sourceSizeBytes && sourceMimeType);
  if (asset.ownerUserId !== authority.ownerUserId
    || asset.kind !== 'SOURCE_ORIGINAL'
    || asset.sourceCaptureSnapshotId !== authority.sourceCaptureSnapshotId
    || asset.sourceMediaKey !== reference.candidateId
    || asset.sourceUrl !== reference.source.url
    || !asset.storageKey
    || (sourceMimeType != null
      && !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']
        .includes(sourceMimeType))
    || assetMimeType !== canonicalMimeType
    || (sourceMimeType != null
      && reference.source.mimeType != null
      && reference.source.mimeType !== sourceMimeType)
    || !Number.isSafeInteger(asset.sizeBytes)
    || asset.sizeBytes < 1
    || !Number.isSafeInteger(asset.width)
    || Number(asset.width) < 1
    || !Number.isSafeInteger(asset.height)
    || Number(asset.height) < 1
    || (complete && reference.source.width != null && asset.width !== reference.source.width)
    || (complete && reference.source.height != null && asset.height !== reference.source.height)
    || !SHA256_PATTERN.test(assetSha256)
    || (reference.source.contentHash != null
      && sourceSha256 != null
      && reference.source.contentHash !== sourceSha256)) {
    fail(
      'AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT',
      409,
      'Existing source asset does not match frozen suite authority',
    );
  }
  assertStoragePolicy(authority.provider, asset.storageBackend, asset.url);
  return {
    sourceSha256,
    sourceSizeBytes,
    sourceMimeType,
    assetSha256,
    complete,
  };
}

function bindingFor(
  reference: AiImageSuitePreparedReference,
  asset: AiImageSuiteReferenceAsset,
  hashes: { sourceSha256: string; assetSha256: string },
): AiImageSuiteReferenceBinding {
  return {
    ordinal: reference.ordinal,
    candidateId: reference.candidateId,
    sourceMediaKey: reference.candidateId,
    sourceUrl: reference.sourceUrl,
    expectedContentHash: reference.expectedContentHash,
    sourceSha256: hashes.sourceSha256,
    assetId: asset.id,
    assetSha256: hashes.assetSha256,
    assetUrl: asset.url,
    storageBackend: asset.storageBackend,
    storageKey: asset.storageKey!,
    mimeType: asset.mimeType,
    width: asset.width!,
    height: asset.height!,
  };
}

function safeFilename(candidateId: string, mimeType: 'image/jpeg' | 'image/png'): string {
  const digest = createHash('sha256').update(candidateId).digest('hex').slice(0, 24);
  return `suite-source-${digest}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
}

function storageKey(result: AiImageSuiteReferenceStorageUploadResult): string {
  const value = result.key || result.objectKey || result.filename;
  if (typeof value !== 'string' || !value.trim() || value.length > 1_000) {
    fail('AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY', 503, 'Suite reference storage returned no object key');
  }
  return value.trim();
}

function limits(input: AiImageSuiteReferenceLimits): ResolvedLimits {
  const bounded = (
    value: number | undefined,
    fallback: number,
    maximum: number,
    label: string,
  ) => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new TypeError(`${label} is invalid`);
    }
    return resolved;
  };
  return {
    maxReferences: bounded(
      input.maxReferences,
      AI_IMAGE_SUITE_REFERENCE_MAX_COUNT,
      AI_IMAGE_SUITE_REFERENCE_MAX_COUNT,
      'maxReferences',
    ),
    maxBytesPerImage: bounded(
      input.maxBytesPerImage,
      AI_IMAGE_SUITE_REFERENCE_MAX_BYTES_PER_IMAGE,
      AI_IMAGE_SUITE_REFERENCE_MAX_BYTES_PER_IMAGE,
      'maxBytesPerImage',
    ),
    maxTotalBytes: bounded(
      input.maxTotalBytes,
      AI_IMAGE_SUITE_REFERENCE_MAX_TOTAL_BYTES,
      AI_IMAGE_SUITE_REFERENCE_MAX_TOTAL_BYTES,
      'maxTotalBytes',
    ),
    maxPixels: bounded(
      input.maxPixels,
      AI_IMAGE_SUITE_REFERENCE_MAX_PIXELS,
      AI_IMAGE_SUITE_REFERENCE_MAX_PIXELS,
      'maxPixels',
    ),
  };
}

function validateInput(input: InternalizeAiImageSuiteReferencesInput): void {
  exactString(input.suiteId, 'suiteId', 200);
  exactString(input.ownerUserId, 'ownerUserId', 200);
  exactString(input.actorUserId, 'actorUserId', 200);
  exactString(input.operationKey, 'operationKey', MAX_OPERATION_KEY_LENGTH);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    fail('AI_MEDIA_SUITE_REFERENCE_INVALID_INPUT', 400, 'expectedRevision is invalid');
  }
}

function mapCommitFailure(result: AiImageSuiteReferenceCommitResult): never {
  if (result.kind === 'not-found') {
    fail('AI_MEDIA_SUITE_REFERENCE_NOT_FOUND', 404, 'AI media suite was not found');
  }
  if (result.kind === 'stale') {
    fail('AI_MEDIA_SUITE_REFERENCE_STALE', 409, 'AI media suite source authority is stale');
  }
  if (result.kind === 'revision-conflict') {
    fail('AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT', 409, 'AI media suite revision changed during reference preparation');
  }
  if (result.kind === 'already-internalized') {
    fail('AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED', 409, 'AI media suite references are already internalized');
  }
  fail('AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT', 409, 'AI media suite reference binding conflicts with persisted state');
}

function mapPreparationLeaseFailure(error: unknown): never {
  if (!(error instanceof AiImageSuitePreparationLeaseError)) throw error;
  if (error.code === 'AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY') {
    fail(
      'AI_MEDIA_SUITE_REFERENCE_PREPARATION_BUSY',
      409,
      'AI image suite reference preparation is already in progress',
      error,
    );
  }
  fail(
    'AI_MEDIA_SUITE_REFERENCE_PREPARATION_UNAVAILABLE',
    503,
    'AI image suite reference preparation coordination is unavailable',
    error,
  );
}

export function createAiImageSuiteReferenceService(
  dependencies: AiImageSuiteReferenceDependencies,
  rawLimits: AiImageSuiteReferenceLimits = {},
) {
  const resolvedLimits = limits(rawLimits);
  const download = dependencies.download || downloadPublicImage;

  return {
    async internalize(
      input: InternalizeAiImageSuiteReferencesInput,
    ): Promise<InternalizeAiImageSuiteReferencesResult> {
      validateInput(input);
      try {
        return await dependencies.preparationLease.runExclusive({
          ownerUserId: input.ownerUserId,
          suiteId: input.suiteId,
        }, async (lease) => {
      const replay = await dependencies.repository.findCommitReplay(input);
      if (replay?.kind === 'conflict') {
        fail('AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT', 409, 'AI media suite reference operation key conflicts');
      }
      if (replay?.kind === 'already-internalized') {
        fail('AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED', 409, 'AI media suite references are already internalized');
      }
      if (replay?.kind === 'existing') {
        return {
          suiteId: input.suiteId,
          referenceCount: replay.bindings.length,
          referenceSetHash: replay.referenceSetHash,
          bindings: replay.bindings,
          replayed: true,
        };
      }
      const authority = await dependencies.repository.loadAuthority({
        suiteId: input.suiteId,
        ownerUserId: input.ownerUserId,
      });
      if (!authority || authority.ownerUserId !== input.ownerUserId || authority.suiteId !== input.suiteId) {
        fail('AI_MEDIA_SUITE_REFERENCE_NOT_FOUND', 404, 'AI media suite was not found');
      }
      if (authority.status !== 'PLANNED') {
        fail('AI_MEDIA_SUITE_REFERENCE_INVALID_STATE', 409, 'AI media suite references cannot be prepared in this state');
      }
      if (authority.revision !== input.expectedRevision) {
        fail('AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT', 409, 'AI media suite revision changed before reference preparation');
      }
      if (authority.revision !== 1) {
        fail('AI_MEDIA_SUITE_REFERENCE_INVALID_STATE', 409, 'AI media suite references must be prepared immediately after claim');
      }
      exactString(authority.provider, 'provider', 100);
      exactString(authority.model, 'model', 200);
      exactHash(authority.sourceCaptureHash, 'sourceCaptureHash');
      exactHash(authority.sourceProfileHash, 'sourceProfileHash');
      exactString(authority.sourceSchemaVersion, 'sourceSchemaVersion', 100);
      const references = resolveAiImageSuiteFrozenReferences(authority, resolvedLimits.maxReferences);
      if (authority.provider !== 'fake'
        && references.some((reference) => reference.source.contentHash == null)) {
        fail(
          'AI_MEDIA_SUITE_REFERENCE_CONTENT_HASH_REQUIRED',
          409,
          'Paid suite references require frozen source content hashes',
        );
      }
      const capture = await verifiedCapture(authority);
      for (const reference of references) resolveCaptureMedia(capture, reference);

      const assets = await dependencies.repository.findReusableAssets({
        ownerUserId: input.ownerUserId,
        sourceCaptureSnapshotId: authority.sourceCaptureSnapshotId,
        sourceMediaKeys: references.map((reference) => reference.candidateId),
      });
      const assetsByMediaKey = new Map<string, AiImageSuiteReferenceAsset[]>();
      for (const asset of assets) {
        const key = String(asset.sourceMediaKey || '');
        if (!references.some((reference) => reference.candidateId === key)) {
          fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Source asset lookup returned conflicting rows');
        }
        const rows = assetsByMediaKey.get(key) || [];
        if (rows.some((row) => row.storageBackend === asset.storageBackend)) {
          fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Source asset lookup returned duplicate storage variants');
        }
        rows.push(asset);
        assetsByMediaKey.set(key, rows);
      }

      const prepared: AiImageSuitePreparedReference[] = [];
      let totalSourceBytes = 0;
      let totalCanonicalBytes = 0;
      let storage: AiImageSuiteReferenceStorage | null = null;
      for (const reference of references) {
        const reusable = selectReusableAsset(
          assetsByMediaKey.get(reference.candidateId) || [],
          authority,
        );
        const reusableIdentity = reusable
          ? assertReusableAssetIdentity(reusable, authority, reference)
          : null;
        if (reusable) {
          if (reusableIdentity!.complete
            && (reusableIdentity!.sourceSizeBytes! > resolvedLimits.maxBytesPerImage
              || reusable.sizeBytes > resolvedLimits.maxBytesPerImage)) {
            fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Existing source asset byte provenance is invalid');
          }
          if (reusableIdentity!.complete) {
            totalSourceBytes += reusableIdentity!.sourceSizeBytes!;
            totalCanonicalBytes += reusable.sizeBytes;
          }
          if (totalSourceBytes > resolvedLimits.maxTotalBytes
            || totalCanonicalBytes > resolvedLimits.maxTotalBytes) {
            fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'Suite source images exceed the total byte limit');
          }
          if (reusableIdentity!.complete) {
            prepared.push({
              ordinal: reference.ordinal,
              candidateId: reference.candidateId,
              sourceUrl: reference.source.url,
              expectedContentHash: reference.source.contentHash,
              sourceSha256: reusableIdentity!.sourceSha256!,
              assetSha256: reusableIdentity!.assetSha256,
              asset: reusable,
              reused: true,
            });
            continue;
          }
        }
        await lease.ensureOwned();
        let downloaded: DownloadedPublicImage;
        try {
          downloaded = await download(reference.source.url, {
            maxBytes: resolvedLimits.maxBytesPerImage,
          });
        } catch (error) {
          fail(
            'AI_MEDIA_SUITE_REFERENCE_SOURCE_FETCH_FAILED',
            502,
            'A frozen suite source image could not be downloaded safely',
            error,
          );
        }
        if (!Buffer.isBuffer(downloaded.buffer)
          || downloaded.buffer.length < 1
          || downloaded.buffer.length > resolvedLimits.maxBytesPerImage) {
          fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'A suite source image exceeds its byte limit');
        }
        await lease.ensureOwned();
        totalSourceBytes += downloaded.buffer.length;
        if (totalSourceBytes > resolvedLimits.maxTotalBytes) {
          fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'Suite source images exceed the total byte limit');
        }

        let decoded: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
        try {
          decoded = await sharp(downloaded.buffer, {
            animated: false,
            limitInputPixels: resolvedLimits.maxPixels,
          }).metadata();
        } catch (error) {
          fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_INVALID', 422, 'A suite source image could not be decoded safely', error);
        }
        const sourceMimeType = decodedMime(decoded.format);
        const responseMimeType = normalizeMime(downloaded.contentType);
        const width = decoded.autoOrient?.width || decoded.width || 0;
        const height = decoded.autoOrient?.height || decoded.height || 0;
        if (!sourceMimeType
          || sourceMimeType !== responseMimeType
          || (reference.source.mimeType != null && reference.source.mimeType !== sourceMimeType)
          || width < 1
          || height < 1
          || width * height > resolvedLimits.maxPixels
          || (reference.source.width != null && reference.source.width !== width)
          || (reference.source.height != null && reference.source.height !== height)) {
          fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED', 409, 'Downloaded source image does not match frozen metadata');
        }
        const sourceSha256 = sha256(downloaded.buffer);
        if (reference.source.contentHash != null && reference.source.contentHash !== sourceSha256) {
          fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_CHANGED', 409, 'Downloaded source image does not match its frozen content hash');
        }

        let sanitized: Awaited<ReturnType<typeof sanitizeOzonPublishImageBuffer>>;
        let legacyVariant: {
          assetSha256: string;
          sizeBytes: number;
          width: number;
          height: number;
          mimeType: 'image/jpeg' | 'image/png';
        };
        try {
          sanitized = await sanitizeOzonPublishImageBuffer(
            downloaded.buffer,
            safeFilename(reference.candidateId, sourceMimeType === 'image/png' ? 'image/png' : 'image/jpeg'),
            sourceMimeType,
          );
          const legacyMetadata = await sharp(sanitized.buffer, {
            animated: false,
            limitInputPixels: resolvedLimits.maxPixels,
          }).metadata();
          legacyVariant = {
            assetSha256: sha256(sanitized.buffer),
            sizeBytes: sanitized.buffer.length,
            width: legacyMetadata.width || 0,
            height: legacyMetadata.height || 0,
            mimeType: sanitized.mimeType,
          };
          if (!sanitized.converted) {
            const pipeline = sharp(downloaded.buffer, {
              animated: false,
              limitInputPixels: resolvedLimits.maxPixels,
            }).autoOrient();
            const buffer = sanitized.mimeType === 'image/png'
              ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
              : await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
            sanitized = { ...sanitized, buffer };
          }
        } catch (error) {
          fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_INVALID', 422, 'A suite source image could not be normalized safely', error);
        }
        if (sanitized.buffer.length < 1 || sanitized.buffer.length > resolvedLimits.maxBytesPerImage) {
          fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'A normalized suite source image exceeds its byte limit');
        }
        let canonicalMetadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
        try {
          canonicalMetadata = await sharp(sanitized.buffer, {
            animated: false,
            limitInputPixels: resolvedLimits.maxPixels,
          }).metadata();
        } catch (error) {
          fail('AI_MEDIA_SUITE_REFERENCE_SOURCE_INVALID', 422, 'A normalized suite source image is invalid', error);
        }
        const canonicalWidth = canonicalMetadata.width || 0;
        const canonicalHeight = canonicalMetadata.height || 0;
        if (canonicalWidth < 1
          || canonicalHeight < 1
          || canonicalWidth * canonicalHeight > resolvedLimits.maxPixels) {
          fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'A normalized suite source image exceeds its pixel limit');
        }
        const assetSha256 = sha256(sanitized.buffer);
        if (reusable) {
          const storedVariant = {
            assetSha256: reusableIdentity!.assetSha256,
            sizeBytes: reusable.sizeBytes,
            width: reusable.width,
            height: reusable.height,
            mimeType: normalizeMime(reusable.mimeType),
          };
          const matchesCurrent = storedVariant.assetSha256 === assetSha256
            && storedVariant.sizeBytes === sanitized.buffer.length
            && storedVariant.width === canonicalWidth
            && storedVariant.height === canonicalHeight
            && storedVariant.mimeType === sanitized.mimeType;
          const matchesLegacy = storedVariant.assetSha256 === legacyVariant.assetSha256
            && storedVariant.sizeBytes === legacyVariant.sizeBytes
            && storedVariant.width === legacyVariant.width
            && storedVariant.height === legacyVariant.height
            && storedVariant.mimeType === legacyVariant.mimeType;
          if ((!matchesCurrent && !matchesLegacy)
            || (reusableIdentity!.sourceSha256 != null
              && reusableIdentity!.sourceSha256 !== sourceSha256)
            || (reusableIdentity!.sourceSizeBytes != null
              && reusableIdentity!.sourceSizeBytes !== downloaded.buffer.length)
            || (reusableIdentity!.sourceMimeType != null
              && reusableIdentity!.sourceMimeType !== sourceMimeType)) {
            fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Existing source asset failed byte revalidation');
          }
          totalCanonicalBytes += reusable.sizeBytes;
          if (reusable.sizeBytes > resolvedLimits.maxBytesPerImage
            || totalCanonicalBytes > resolvedLimits.maxTotalBytes) {
            fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'Normalized suite source images exceed the total byte limit');
          }
          prepared.push({
            ordinal: reference.ordinal,
            candidateId: reference.candidateId,
            sourceUrl: reference.source.url,
            expectedContentHash: reference.source.contentHash,
            sourceSha256,
            assetSha256: reusableIdentity!.assetSha256,
            asset: reusable,
            reused: true,
          });
          continue;
        }

        totalCanonicalBytes += sanitized.buffer.length;
        if (totalCanonicalBytes > resolvedLimits.maxTotalBytes) {
          fail('AI_MEDIA_SUITE_REFERENCE_LIMIT_EXCEEDED', 413, 'Normalized suite source images exceed the total byte limit');
        }

        if (!storage) {
          try {
            storage = await dependencies.getStorage();
          } catch (error) {
            fail(
              'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY',
              503,
              'Suite reference storage is not available',
              error,
            );
          }
          assertStoragePolicy(authority.provider, storage.backend);
        }
        const uploadIdempotencyKey = createHash('sha256').update([
          AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
          authority.sourceCaptureSnapshotId,
          reference.candidateId,
          sourceSha256,
          assetSha256,
        ].join('\u0000')).digest('hex');
        let uploaded: AiImageSuiteReferenceStorageUploadResult;
        await lease.ensureOwned();
        try {
          uploaded = await storage.uploadBuffer(
            sanitized.buffer,
            sanitized.filename,
            sanitized.mimeType,
            {
              category: 'raw',
              ownerId: input.ownerUserId,
              idempotencyKey: uploadIdempotencyKey,
            },
          );
        } catch (error) {
          fail('AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY', 503, 'Suite reference storage upload failed', error);
        }
        await lease.ensureOwned();
        assertStoragePolicy(authority.provider, uploaded.backend, uploaded.url);
        if (uploaded.backend !== storage.backend) {
          fail('AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY', 503, 'Suite reference storage changed backend during upload');
        }
        const created = await dependencies.repository.createAsset({
          ownerUserId: input.ownerUserId,
          kind: 'SOURCE_ORIGINAL',
          sourceCaptureSnapshotId: authority.sourceCaptureSnapshotId,
          sourceMediaKey: reference.candidateId,
          sourceUrl: reference.source.url,
          url: uploaded.url,
          storageBackend: uploaded.backend as 'local' | 'oss',
          storageKey: storageKey(uploaded),
          mimeType: sanitized.mimeType,
          sizeBytes: sanitized.buffer.length,
          width: canonicalWidth,
          height: canonicalHeight,
          sha256: assetSha256,
          sourceSha256,
          metadata: {
            lineageVersion: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
            sourceCaptureHash: authority.sourceCaptureHash,
            sourceProfileHash: authority.sourceProfileHash,
            sourceUrl: reference.source.url,
            finalSourceUrl: downloaded.finalUrl,
            sourceSha256,
            sourceMimeType,
            sourceFormat: sanitized.sourceFormat,
            redirectCount: downloaded.redirectCount,
            sourceSizeBytes: downloaded.buffer.length,
            canonicalSha256: assetSha256,
          },
        });
        const winnerHashes = assertReusableAssetIdentity(created, authority, reference);
        if (winnerHashes.sourceSha256 !== sourceSha256 || winnerHashes.assetSha256 !== assetSha256) {
          fail('AI_MEDIA_SUITE_REFERENCE_ASSET_CONFLICT', 409, 'Concurrent source asset content does not match prepared bytes');
        }
        prepared.push({
          ordinal: reference.ordinal,
          candidateId: reference.candidateId,
          sourceUrl: reference.source.url,
          expectedContentHash: reference.source.contentHash,
          sourceSha256,
          assetSha256,
          asset: created,
          reused: false,
        });
      }

      const bindings = prepared
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((entry) => bindingFor(entry, entry.asset, {
          sourceSha256: entry.sourceSha256,
          assetSha256: entry.assetSha256,
        }));
      const referenceSetHash = hashAiMediaPlanningJson({
        version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
        suiteId: authority.suiteId,
        ownerUserId: authority.ownerUserId,
        sourceCaptureSnapshotId: authority.sourceCaptureSnapshotId,
        bindings,
      });
      await lease.ensureOwned();
      const committed = await dependencies.repository.commitBindings({
        suiteId: input.suiteId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedRevision: input.expectedRevision,
        operationKey: input.operationKey,
        sourceSubjectId: authority.sourceSubjectId,
        sourceCaptureSnapshotId: authority.sourceCaptureSnapshotId,
        sourceCaptureHash: authority.sourceCaptureHash,
        sourceProfileHash: authority.sourceProfileHash,
        sourceSchemaVersion: authority.sourceSchemaVersion,
        referenceSetHash,
        bindings,
      });
      if (committed.kind !== 'committed'
        && committed.kind !== 'existing') {
        return mapCommitFailure(committed);
      }
      if (committed.referenceSetHash !== referenceSetHash) {
        fail('AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT', 409, 'Persisted suite reference set hash changed');
      }
      return {
        suiteId: authority.suiteId,
        referenceCount: bindings.length,
        referenceSetHash,
        bindings,
        replayed: committed.kind !== 'committed',
      };
        });
      } catch (error) {
        return mapPreparationLeaseFailure(error);
      }
    },
  };
}

export type AiImageSuiteReferenceService = ReturnType<typeof createAiImageSuiteReferenceService>;
