import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { OzonListingDraft, OzonListingDraftMediaAssignment, SourceCaptureMedia } from 'shared';
import type { ImageStorageBackend, OwnedImageStorageBackend } from './image-storage.js';
import {
  downloadPublicImage,
  type DownloadedPublicImage,
} from './source-public-image-download.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';

const MAX_MEDIA_SELECTIONS = 50;
const MAX_IDENTIFIER_LENGTH = 500;
const DURABLE_BACKENDS = new Set(['oss', 'ozon-cdn']);
export const SOURCE_MEDIA_LINEAGE_VERSION = 'source-media-lineage/v1';

export interface SourceListingMediaSelection {
  sourceMediaKey: string;
  slotKey: string;
  scope: 'PRODUCT' | 'SKU';
  skuKey?: string;
}

export interface SourceListingImportedMediaAsset {
  id: string;
  ownerUserId: string;
  kind?: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
  sourceUrl: string;
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SourceListingMediaAssetCreateInput extends Omit<SourceListingImportedMediaAsset, 'id'> {
  kind: 'SOURCE_ORIGINAL';
  width: number | null;
  height: number | null;
  sha256: string;
  metadata: Record<string, unknown>;
}

export interface SourceListingCaptureMediaAuthority {
  snapshotId: string;
  captureHash: string;
  media: SourceCaptureMedia[];
}

export interface SourceListingMediaImportDependencies {
  loadCaptureAuthority(input: {
    ownerUserId: string;
    snapshotId: string;
  }): Promise<SourceListingCaptureMediaAuthority | null>;
  findReusableAsset(input: {
    ownerUserId: string;
    sourceCaptureSnapshotId: string;
    sourceMediaKey: string;
  }): Promise<SourceListingImportedMediaAsset | null>;
  loadOwnedAssets(input: {
    ownerUserId: string;
    assetIds: string[];
  }): Promise<SourceListingImportedMediaAsset[]>;
  createAsset(input: SourceListingMediaAssetCreateInput): Promise<SourceListingImportedMediaAsset>;
  getStorageBackend(shopId: string): Promise<Pick<ImageStorageBackend, 'uploadBuffer'>>;
  getCaptureStorageBackend?: () => Promise<Pick<OwnedImageStorageBackend, 'backendType' | 'uploadBuffer'>>;
  download?: (url: string) => Promise<DownloadedPublicImage>;
}

export class SourceListingMediaImportError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceListingMediaImportError';
  }
}

function fail(code: string, statusCode: number, message: string): never {
  throw new SourceListingMediaImportError(code, statusCode, message);
}

function hasAsciiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function exactIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.normalize('NFKC').trim()
    || Array.from(value).length > MAX_IDENTIFIER_LENGTH
    || hasAsciiControl(value)) {
    fail('SOURCE_LISTING_MEDIA_INVALID', 400, `${label} must be an exact bounded identifier`);
  }
  return value;
}

function exactSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFKC').trim()) {
    fail('SOURCE_LISTING_MEDIA_INVALID', 422, 'Capture media URL is invalid');
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error();
    }
  } catch {
    fail('SOURCE_LISTING_MEDIA_INVALID', 422, 'Capture media URL is invalid');
  }
  return value;
}

function durableHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFKC').trim()) {
    fail('SOURCE_LISTING_MEDIA_STORAGE_UNAVAILABLE', 503, 'Storage did not return a durable image URL');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error();
  } catch {
    fail('SOURCE_LISTING_MEDIA_STORAGE_UNAVAILABLE', 503, 'Storage did not return a durable HTTPS image URL');
  }
  return value;
}

function normalizedSelections(
  draft: OzonListingDraft,
  selections: SourceListingMediaSelection[],
): SourceListingMediaSelection[] {
  if (!Array.isArray(selections) || !selections.length || selections.length > MAX_MEDIA_SELECTIONS) {
    fail('SOURCE_LISTING_MEDIA_INVALID', 400, `Media selections must contain 1-${MAX_MEDIA_SELECTIONS} items`);
  }
  const selectedSkus = new Set(draft.selectedSkuKeys);
  const mediaKeys = new Set<string>();
  const slots = new Set<string>();
  return selections.map((selection) => {
    const sourceMediaKey = exactIdentifier(selection?.sourceMediaKey, 'sourceMediaKey');
    const slotKey = exactIdentifier(selection?.slotKey, 'slotKey');
    if (mediaKeys.has(sourceMediaKey) || slots.has(slotKey)) {
      fail('SOURCE_LISTING_MEDIA_INVALID', 400, 'Media keys and slots must be unique');
    }
    mediaKeys.add(sourceMediaKey);
    slots.add(slotKey);
    if (selection.scope === 'PRODUCT') {
      if (selection.skuKey !== undefined) {
        fail('SOURCE_LISTING_MEDIA_INVALID', 400, 'Product media cannot include a SKU key');
      }
      return { sourceMediaKey, slotKey, scope: 'PRODUCT' };
    }
    if (selection.scope !== 'SKU') {
      fail('SOURCE_LISTING_MEDIA_INVALID', 400, 'Media scope must be PRODUCT or SKU');
    }
    const skuKey = exactIdentifier(selection.skuKey, 'skuKey');
    if (!selectedSkus.has(skuKey)) {
      fail('SOURCE_LISTING_MEDIA_INVALID', 409, 'Media targets an unselected canonical SKU');
    }
    return { sourceMediaKey, slotKey, scope: 'SKU', skuKey };
  });
}

function exactCaptureMedia(
  authority: SourceListingCaptureMediaAuthority,
  selection: SourceListingMediaSelection,
): SourceCaptureMedia {
  const matches = authority.media.filter((entry) => entry?.key === selection.sourceMediaKey);
  if (matches.length !== 1) {
    fail('SOURCE_LISTING_MEDIA_NOT_FOUND', 404, 'Selected source media was not found in the exact capture snapshot');
  }
  const media = matches[0]!;
  if (media.kind !== 'image' || media.disposition !== 'accepted' || !media.url) {
    fail('SOURCE_LISTING_MEDIA_INVALID', 422, 'Selected capture media is not an accepted image');
  }
  if (selection.scope === 'SKU') {
    if (media.role !== 'sku' || !media.skuKeys.includes(selection.skuKey!)) {
      fail('SOURCE_LISTING_MEDIA_SCOPE_MISMATCH', 422, 'Selected source image does not belong to the requested SKU');
    }
  } else if (media.role === 'sku' || media.skuKeys.length > 0) {
    fail('SOURCE_LISTING_MEDIA_SCOPE_MISMATCH', 422, 'SKU-specific source image cannot be assigned to the whole product');
  }
  return media;
}

function detectedMime(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'avif': return 'image/avif';
    case 'tiff': return 'image/tiff';
    default: return '';
  }
}

function reusableAsset(
  asset: SourceListingImportedMediaAsset | null,
  input: { ownerUserId: string; draft: Pick<OzonListingDraft, 'sourceCaptureSnapshotId'>; media: SourceCaptureMedia },
): SourceListingImportedMediaAsset | null {
  if (!asset) return null;
  if (asset.ownerUserId !== input.ownerUserId
    || asset.sourceCaptureSnapshotId !== input.draft.sourceCaptureSnapshotId
    || asset.sourceMediaKey !== input.media.key
    || asset.sourceUrl !== input.media.url
    || !DURABLE_BACKENDS.has(asset.storageBackend)
    || !asset.storageKey
    || !asset.mimeType.toLowerCase().startsWith('image/')) {
    fail('SOURCE_LISTING_MEDIA_ASSET_CONFLICT', 409, 'Existing source media asset does not match immutable capture authority');
  }
  durableHttpsUrl(asset.url);
  return asset;
}

function assignment(
  selection: SourceListingMediaSelection,
  assetId: string,
): OzonListingDraftMediaAssignment {
  return selection.scope === 'PRODUCT'
    ? { assetId, slotKey: selection.slotKey, source: 'SOURCE', scope: 'PRODUCT' }
    : {
      assetId,
      slotKey: selection.slotKey,
      source: 'SOURCE',
      scope: 'SKU',
      skuKey: selection.skuKey!,
    };
}

function filenameFor(media: SourceCaptureMedia): string {
  try {
    const url = new URL(media.url!);
    const name = decodeURIComponent(url.pathname.split('/').pop() || '')
      .replace(/[^\w.\-]/g, '_')
      .slice(0, 100);
    return name || `source-${createHash('sha256').update(media.key).digest('hex').slice(0, 16)}.jpg`;
  } catch {
    return `source-${createHash('sha256').update(media.key).digest('hex').slice(0, 16)}.jpg`;
  }
}

export function createSourceListingMediaImportService(
  dependencies: SourceListingMediaImportDependencies,
) {
  const download = dependencies.download || downloadPublicImage;
  const downloadCapture = dependencies.download || ((url: string) => downloadPublicImage(url, {
    maxBytes: 8 * 1024 * 1024, maxRedirects: 0, timeoutMs: 15_000, omitReferer: true,
  }));
  async function importImage(input: {
    ownerUserId: string; snapshotId: string; captureHash: string; media: SourceCaptureMedia;
    backend: Pick<ImageStorageBackend, 'uploadBuffer'>; captureTransfer?: boolean;
    consumeBytes?: (bytes: number) => void;
  }): Promise<SourceListingImportedMediaAsset> {
    const draftAuthority = { sourceCaptureSnapshotId: input.snapshotId };
    const existing = reusableAsset(await dependencies.findReusableAsset({
      ownerUserId: input.ownerUserId, sourceCaptureSnapshotId: input.snapshotId, sourceMediaKey: input.media.key,
    }), { ownerUserId: input.ownerUserId, draft: draftAuthority, media: input.media });
    // Capture-time transfer must never reuse a legacy Ozon CDN asset. It must
    // converge on the ERP-owned OSS/R2 namespace so the display projection is
    // durable and independent of a shop's Ozon session.
    if (existing && (!input.captureTransfer || existing.storageBackend === 'oss')) {
      if (input.captureTransfer && existing.kind !== 'SOURCE_ORIGINAL') {
        fail('SOURCE_LISTING_MEDIA_ASSET_CONFLICT', 409, 'Existing asset is not an original source image');
      }
      return existing;
    }
    const sourceUrl = exactSourceUrl(input.media.url);
    const downloaded = await (input.captureTransfer ? downloadCapture : download)(sourceUrl);
    if (input.captureTransfer && downloaded.buffer.length > 8 * 1024 * 1024) {
      fail('SOURCE_IMAGE_SIZE_EXCEEDED', 422, 'Source image exceeds the transfer limit');
    }
    input.consumeBytes?.(downloaded.buffer.length);
    const decoded = await sharp(downloaded.buffer, { animated: false,
      ...(input.captureTransfer ? { limitInputPixels: 12_000_000 } : {}),
    }).metadata().catch(() => null);
    const decodedMime = decoded?.format ? detectedMime(decoded.format) : '';
    if (!decodedMime || decodedMime !== downloaded.contentType) {
      fail('SOURCE_LISTING_MEDIA_MIME_MISMATCH', 422, 'Source image MIME does not match decoded image content');
    }
    if (input.captureTransfer && (!decoded?.width || !decoded.height || decoded.width > 16384
      || decoded.height > 16384 || decoded.width * decoded.height > 12_000_000 || (decoded.pages || 1) !== 1)) {
      fail('SOURCE_IMAGE_PIXELS_EXCEEDED', 422, 'Source image exceeds the pixel or frame limit');
    }
    const sanitized = await sanitizeOzonPublishImageBuffer(downloaded.buffer, filenameFor(input.media), downloaded.contentType);
    // Capture previews are untrusted remote bytes: strip metadata and decode/re-encode before storage.
    const buffer = input.captureTransfer
      ? await (sanitized.mimeType === 'image/png'
        ? sharp(sanitized.buffer, { limitInputPixels: 12_000_000 }).rotate().png()
        : sharp(sanitized.buffer, { limitInputPixels: 12_000_000 }).rotate().jpeg({ quality: 92 })).toBuffer()
      : sanitized.buffer;
    const metadata = await sharp(buffer, { animated: false }).metadata();
    if (input.captureTransfer && buffer.length > 8 * 1024 * 1024) {
      fail('SOURCE_IMAGE_SIZE_EXCEEDED', 422, 'Normalized source image exceeds the transfer limit');
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const uploaded = await input.backend.uploadBuffer(buffer, sanitized.filename, sanitized.mimeType, {
      category: 'raw', ownerId: input.ownerUserId,
      ...(input.captureTransfer ? { idempotencyKey: `source-capture:${input.snapshotId}:${input.media.key}:${sha256}`,
        signal: AbortSignal.timeout(30_000) } : {}),
    });
    if (!DURABLE_BACKENDS.has(uploaded.backend) || (input.captureTransfer && uploaded.backend !== 'oss')) {
      fail('SOURCE_LISTING_MEDIA_STORAGE_UNAVAILABLE', 503, 'Source media requires durable owned storage');
    }
    const created = await dependencies.createAsset({
      ownerUserId: input.ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: input.snapshotId,
      sourceMediaKey: input.media.key, sourceUrl, url: durableHttpsUrl(uploaded.url), storageBackend: uploaded.backend,
      storageKey: exactIdentifier(uploaded.key || uploaded.filename, 'storageKey'), mimeType: sanitized.mimeType,
      sizeBytes: buffer.length, width: metadata.width || null, height: metadata.height || null,
      sha256, metadata: {
        lineageVersion: SOURCE_MEDIA_LINEAGE_VERSION, sourceCaptureHash: input.captureHash, sourceUrl,
        finalSourceUrl: downloaded.finalUrl, sourceSha256: createHash('sha256').update(downloaded.buffer).digest('hex'),
        sourceSizeBytes: downloaded.buffer.length, sourceMimeType: downloaded.contentType,
        sourceFormat: sanitized.sourceFormat, redirectCount: downloaded.redirectCount,
      },
    });
    return reusableAsset(created, { ownerUserId: input.ownerUserId, draft: draftAuthority, media: input.media })!;
  }
  return {
    async internalizeCapture(input: { ownerUserId: string; snapshotId: string; captureHash: string; offset?: number }) {
      exactIdentifier(input.ownerUserId, 'ownerUserId');
      exactIdentifier(input.snapshotId, 'snapshotId');
      const authority = await dependencies.loadCaptureAuthority(input);
      if (!authority || authority.snapshotId !== input.snapshotId || authority.captureHash !== input.captureHash) {
        fail('SOURCE_LISTING_MEDIA_AUTHORITY_STALE', 409, 'Owned capture authority no longer matches');
      }
      const allMedia = authority.media.filter(item => item.kind === 'image' && item.disposition === 'accepted' && item.url);
      if (new Set(allMedia.map(item => item.key)).size !== allMedia.length) {
        fail('SOURCE_IMAGE_COUNT_EXCEEDED', 422, 'Capture source image keys are not unique');
      }
      const offset = Number.isSafeInteger(input.offset) && input.offset! >= 0 ? input.offset! : 0;
      if (offset > allMedia.length) fail('SOURCE_IMAGE_OFFSET_INVALID', 400, 'Capture source image offset is invalid');
      const total = allMedia.length;
      const media = allMedia.slice(offset, offset + 100);
      if (!media.length) return { assets: [], errors: [] };
      const backend = await dependencies.getCaptureStorageBackend?.();
      if (!backend || backend.backendType !== 'oss') {
        fail('SOURCE_LISTING_MEDIA_STORAGE_UNAVAILABLE', 503, 'Capture images require ERP-owned OSS/R2');
      }
      const assets: SourceListingImportedMediaAsset[] = [];
      const errors: Array<{ sourceMediaKey: string; code: string }> = [];
      let bytes = 0;
      for (let offset = 0; offset < media.length; offset += 4) {
        const results = await Promise.all(media.slice(offset, offset + 4).map(async (item) => {
          try {
            if (bytes >= 128 * 1024 * 1024) throw new SourceListingMediaImportError('SOURCE_IMAGE_SIZE_EXCEEDED', 422, 'Transfer byte budget exhausted');
            return { asset: await importImage({ ...input, media: item, backend, captureTransfer: true, consumeBytes: count => {
              bytes += count;
              if (bytes > 128 * 1024 * 1024) fail('SOURCE_IMAGE_SIZE_EXCEEDED', 422, 'Transfer byte budget exhausted');
            } }) };
          } catch (error) {
            return { error: { sourceMediaKey: item.key,
              code: error instanceof SourceListingMediaImportError ? error.code : 'SOURCE_IMAGE_TRANSFER_FAILED' } };
          }
        }));
        for (const result of results) {
          if (result.asset) assets.push(result.asset);
          if (result.error) errors.push(result.error);
        }
      }
      return { assets, errors, nextOffset: offset + media.length, total };
    },
    async validateSourceAssignments(input: {
      ownerUserId: string;
      draft: OzonListingDraft;
      assignments: OzonListingDraftMediaAssignment[];
    }): Promise<void> {
      if (!input.ownerUserId || input.draft.ownerUserId !== input.ownerUserId) {
        fail('SOURCE_LISTING_MEDIA_NOT_FOUND', 404, 'Listing draft was not found');
      }
      if (!Array.isArray(input.assignments)
        || !input.assignments.length
        || input.assignments.length > MAX_MEDIA_SELECTIONS) {
        fail('SOURCE_LISTING_MEDIA_INVALID', 400, `Media assignments must contain 1-${MAX_MEDIA_SELECTIONS} items`);
      }
      const selectedSkus = new Set(input.draft.selectedSkuKeys);
      const assetIds = new Set<string>();
      const slotKeys = new Set<string>();
      const assignmentsByAssetId = new Map<string, OzonListingDraftMediaAssignment>();
      for (const item of input.assignments) {
        const assetId = exactIdentifier(item?.assetId, 'assetId');
        const slotKey = exactIdentifier(item?.slotKey, 'slotKey');
        if (item.source !== 'SOURCE' || assetIds.has(assetId) || slotKeys.has(slotKey)) {
          fail('SOURCE_LISTING_MEDIA_INVALID', 400, 'Source media assignments require unique source assets and slots');
        }
        assetIds.add(assetId);
        slotKeys.add(slotKey);
        assignmentsByAssetId.set(assetId, item);
        if (item.scope === 'PRODUCT') {
          if ((item as { skuKey?: unknown }).skuKey !== undefined) {
            fail('SOURCE_LISTING_MEDIA_INVALID', 400, 'Product media cannot include a SKU key');
          }
        } else if (item.scope !== 'SKU'
          || !selectedSkus.has(exactIdentifier((item as { skuKey?: unknown }).skuKey, 'skuKey'))) {
          fail('SOURCE_LISTING_MEDIA_INVALID', 409, 'Media assignment targets an unselected canonical SKU');
        }
      }
      const [authority, assets] = await Promise.all([
        dependencies.loadCaptureAuthority({
          ownerUserId: input.ownerUserId,
          snapshotId: input.draft.sourceCaptureSnapshotId,
        }),
        dependencies.loadOwnedAssets({
          ownerUserId: input.ownerUserId,
          assetIds: [...assetIds],
        }),
      ]);
      if (!authority
        || authority.snapshotId !== input.draft.sourceCaptureSnapshotId
        || authority.captureHash !== input.draft.sourceCaptureHash
        || !Array.isArray(authority.media)) {
        fail('SOURCE_LISTING_MEDIA_AUTHORITY_STALE', 409, 'Capture media authority does not match the exact listing draft');
      }
      if (!Array.isArray(assets) || assets.length !== assetIds.size) {
        fail('SOURCE_LISTING_MEDIA_NOT_FOUND', 404, 'One or more source media assets were not found');
      }
      const observed = new Set<string>();
      for (const asset of assets) {
        if (!assetIds.has(asset.id)
          || observed.has(asset.id)
          || asset.ownerUserId !== input.ownerUserId
          || asset.kind !== 'SOURCE_ORIGINAL'
          || asset.sourceCaptureSnapshotId !== input.draft.sourceCaptureSnapshotId
          || !asset.sourceMediaKey
          || !asset.sourceUrl
          || !DURABLE_BACKENDS.has(asset.storageBackend)
          || !asset.storageKey
          || !asset.mimeType.toLowerCase().startsWith('image/')) {
          fail('SOURCE_LISTING_MEDIA_AUTHORITY_STALE', 409, 'Source media asset does not match the current snapshot authority');
        }
        const draftAssignment = assignmentsByAssetId.get(asset.id)!;
        const selection: SourceListingMediaSelection = draftAssignment.scope === 'PRODUCT'
          ? {
            sourceMediaKey: exactIdentifier(asset.sourceMediaKey, 'sourceMediaKey'),
            slotKey: draftAssignment.slotKey,
            scope: 'PRODUCT',
          }
          : {
            sourceMediaKey: exactIdentifier(asset.sourceMediaKey, 'sourceMediaKey'),
            slotKey: draftAssignment.slotKey,
            scope: 'SKU',
            skuKey: draftAssignment.skuKey,
          };
        const captureMedia = exactCaptureMedia(authority, selection);
        reusableAsset(asset, {
          ownerUserId: input.ownerUserId,
          draft: input.draft,
          media: captureMedia,
        });
        observed.add(asset.id);
      }
      if (observed.size !== assetIds.size) {
        fail('SOURCE_LISTING_MEDIA_NOT_FOUND', 404, 'One or more source media assets were not found');
      }
    },

    async internalize(input: {
      ownerUserId: string;
      draft: OzonListingDraft;
      selections: SourceListingMediaSelection[];
    }): Promise<{
      assets: SourceListingImportedMediaAsset[];
      assignments: OzonListingDraftMediaAssignment[];
    }> {
      if (!input.ownerUserId || input.draft.ownerUserId !== input.ownerUserId) {
        fail('SOURCE_LISTING_MEDIA_NOT_FOUND', 404, 'Listing draft was not found');
      }
      const selections = normalizedSelections(input.draft, input.selections);
      const authority = await dependencies.loadCaptureAuthority({
        ownerUserId: input.ownerUserId,
        snapshotId: input.draft.sourceCaptureSnapshotId,
      });
      if (!authority
        || authority.snapshotId !== input.draft.sourceCaptureSnapshotId
        || authority.captureHash !== input.draft.sourceCaptureHash
        || !Array.isArray(authority.media)) {
        fail('SOURCE_LISTING_MEDIA_AUTHORITY_STALE', 409, 'Capture media authority does not match the exact listing draft');
      }

      const backend = await dependencies.getStorageBackend(input.draft.shopId);
      const assets: SourceListingImportedMediaAsset[] = [];
      const assignments: OzonListingDraftMediaAssignment[] = [];
      for (const selection of selections) {
        const media = exactCaptureMedia(authority, selection);
        const canonical = await importImage({ ownerUserId: input.ownerUserId,
          snapshotId: input.draft.sourceCaptureSnapshotId, captureHash: input.draft.sourceCaptureHash, media, backend });
        assets.push(canonical);
        assignments.push(assignment(selection, canonical.id));
      }
      return { assets, assignments };
    },
  };
}
