import type { SourceCaptureMedia } from 'shared';
import { isPublicHttpsStorageUrl } from './ai-image-translation-storage.js';

export const SOURCE_CAPTURE_MEDIA_DISPLAY_LIMIT = 120;
export const SOURCE_CAPTURE_MEDIA_DISPLAY_BYTES = 96 * 1024;

export interface SourceCaptureMediaDisplayClient {
  mediaAsset: { findMany(args: any): Promise<any[]> };
}
export interface SourceCaptureMediaDisplayUrl {
  key: string;
  sourceUrl: string;
  displayUrl: string;
}
function displayablePublicHttpsUrl(value: string): boolean {
  if (!isPublicHttpsStorageUrl(value)) return false;
  const url = new URL(value);
  return !url.hash && !url.hostname.includes(':') && url.hostname !== 'metadata'
    && url.hostname !== 'metadata.google.internal';
}
function usableAsset(asset: any, ownerUserId: string, snapshotId: string, media: SourceCaptureMedia): boolean {
  return asset.ownerUserId === ownerUserId && asset.sourceCaptureSnapshotId === snapshotId
    && asset.sourceMediaKey === media.key && asset.sourceUrl === media.url
    && asset.kind === 'SOURCE_ORIGINAL' && asset.aiImageJobId === null
    && asset.storageBackend === 'oss' && typeof asset.storageKey === 'string' && asset.storageKey.length > 0
    && typeof asset.url === 'string' && asset.url.length <= 4096 && displayablePublicHttpsUrl(asset.url)
    && ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)
    && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= 20 * 1024 * 1024
    && Number.isSafeInteger(asset.width) && asset.width > 0 && asset.width <= 16384
    && Number.isSafeInteger(asset.height) && asset.height > 0 && asset.height <= 16384
    && asset.width * asset.height <= 40_000_000 && /^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''));
}

/** A read projection only: captured URLs and media keys remain immutable authority. */
export function createSourceCaptureMediaDisplayService(options: { client: SourceCaptureMediaDisplayClient }) {
  return {
    async loadDisplayUrls(input: { ownerUserId: string; snapshotId: string; media: SourceCaptureMedia[] }): Promise<SourceCaptureMediaDisplayUrl[]> {
      const keyCounts = new Map<string, number>();
      for (const media of input.media) keyCounts.set(media.key, (keyCounts.get(media.key) || 0) + 1);
      const media = input.media.filter(item => item.kind === 'image' && item.disposition === 'accepted'
        && typeof item.url === 'string' && item.url.length > 0 && item.url.length <= 4096
        && displayablePublicHttpsUrl(item.url)
        && keyCounts.get(item.key) === 1).slice(0, SOURCE_CAPTURE_MEDIA_DISPLAY_LIMIT);
      if (!media.length) return [];
      const rows = await options.client.mediaAsset.findMany({
        where: { ownerUserId: input.ownerUserId, sourceCaptureSnapshotId: input.snapshotId,
          sourceMediaKey: { in: media.map(item => item.key) }, kind: 'SOURCE_ORIGINAL', aiImageJobId: null,
          storageBackend: 'oss' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: SOURCE_CAPTURE_MEDIA_DISPLAY_LIMIT,
        select: { ownerUserId: true, sourceCaptureSnapshotId: true, sourceMediaKey: true, sourceUrl: true,
          kind: true, aiImageJobId: true, storageBackend: true, storageKey: true, url: true,
          mimeType: true, sizeBytes: true, width: true, height: true, sha256: true },
      });
      const result: SourceCaptureMediaDisplayUrl[] = [];
      let bytes = 2;
      for (const item of media) {
        const asset = rows.find(row => usableAsset(row, input.ownerUserId, input.snapshotId, item));
        if (!asset) continue;
        const display = { key: item.key, sourceUrl: item.url!, displayUrl: asset.url as string };
        const itemBytes = Buffer.byteLength(JSON.stringify(display), 'utf8') + 1;
        if (bytes + itemBytes > SOURCE_CAPTURE_MEDIA_DISPLAY_BYTES) break;
        bytes += itemBytes;
        result.push(display);
      }
      return result;
    },
  };
}
