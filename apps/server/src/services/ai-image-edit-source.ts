export const AI_MEDIA_EDIT_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const AI_MEDIA_EDIT_SOURCE_MAX_PIXELS = 12_000_000;
export const AI_MEDIA_EDIT_SOURCE_MAX_EDGE = 16_384;
export const AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO = 20;
export const AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION = 'ai-media-edit-source/v1';

function metadataRecord(asset: { metadata?: unknown } | null | undefined): Record<string, unknown> {
  return asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, unknown>
    : {};
}

export function isAiMediaEditReadySourceAsset(asset: any): boolean {
  const metadata = metadataRecord(asset);
  return Boolean(
    asset
    && asset.kind === 'SOURCE_ORIGINAL'
    && ['local', 'oss'].includes(String(asset.storageBackend || ''))
    && String(asset.storageKey || '').trim()
    && String(asset.url || '').trim()
    && ['image/jpeg', 'image/png'].includes(String(asset.mimeType || ''))
    && /^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''))
    && Number.isSafeInteger(asset.sizeBytes)
    && asset.sizeBytes > 0
    && asset.sizeBytes <= AI_MEDIA_EDIT_SOURCE_MAX_BYTES
    && Number.isSafeInteger(asset.width)
    && Number.isSafeInteger(asset.height)
    && asset.width > 0
    && asset.height > 0
    && asset.width <= AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    && asset.height <= AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    && asset.width * asset.height <= AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
    && Math.max(asset.width, asset.height) / Math.min(asset.width, asset.height)
      <= AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO
    && metadata.pixelOrientationNormalized === true,
  );
}
