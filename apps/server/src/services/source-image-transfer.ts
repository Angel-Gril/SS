import sharp from 'sharp';
import { getStorageBackend } from './image-storage.js';
import { isLikelyNonImageMediaUrl, sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';
import { downloadPublicImage } from './source-public-image-download.js';

const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_IMAGES = 20;
const TRANSFER_CONCURRENCY = 4;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type SourceImageTransferDiagnostic = {
  enabled: boolean;
  backend?: string;
  attempted: number;
  transferred: number;
  skipped: number;
  errors: Array<{ url: string; error: string }>;
};

type TransferSourceProductImagesInput = {
  images: unknown;
  sourcePlatform?: unknown;
  userId: string;
};

type TransferSourceProductImagesResult = {
  images: string[];
  diagnostic: SourceImageTransferDiagnostic | null;
};

export function isDomesticSourcePlatform(value: unknown): boolean {
  const platform = String(value || '').trim().toLowerCase();
  return ['1688', 'pdd', 'pinduoduo', 'taobao', 'tmall', 'xianyu', 'goofish'].includes(platform);
}

export async function transferSourceProductImages(input: TransferSourceProductImagesInput): Promise<TransferSourceProductImagesResult> {
  const originalImages = normalizeSourceImageList(input.images).slice(0, MAX_TRANSFER_IMAGES);
  if (!originalImages.length || !isDomesticSourcePlatform(input.sourcePlatform)) {
    return { images: originalImages, diagnostic: null };
  }

  let backend: Awaited<ReturnType<typeof getStorageBackend>>;
  try {
    backend = await getStorageBackend();
  } catch (error: any) {
    return {
      images: originalImages,
      diagnostic: {
        enabled: false,
        attempted: 0,
        transferred: 0,
        skipped: originalImages.length,
        errors: [{ url: '', error: `存储后端不可用: ${shortError(error)}` }],
      },
    };
  }

  const output = [...originalImages];
  const diagnostic: SourceImageTransferDiagnostic = {
    enabled: true,
    attempted: 0,
    transferred: 0,
    skipped: 0,
    errors: [],
  };

  for (let offset = 0; offset < originalImages.length; offset += TRANSFER_CONCURRENCY) {
    const rows = await Promise.all(originalImages.slice(offset, offset + TRANSFER_CONCURRENCY).map(async (url, batchIndex) => {
      const index = offset + batchIndex;
      if (isAlreadyStoredImage(url)) {
        return { index, url, skipped: true as const };
      }
      diagnostic.attempted += 1;
      try {
        const transferred = await transferSingleSourceImage(backend, url, input.userId);
        return { index, url: transferred.url, backend: transferred.backend };
      } catch (error: any) {
        return { index, url, error: shortError(error) };
      }
    }));

    for (const row of rows) {
      output[row.index] = row.url;
      if ('backend' in row && row.backend) {
        diagnostic.backend = diagnostic.backend || row.backend;
        diagnostic.transferred += 1;
      } else if ('skipped' in row) {
        diagnostic.skipped += 1;
      } else if ('error' in row && row.error) {
        diagnostic.errors.push({ url: originalImages[row.index] || row.url, error: row.error });
      }
    }
  }

  return { images: output, diagnostic };
}

function normalizeSourceImageList(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const append = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(append);
      return;
    }
    const url = normalizeSourceImageUrl(entry);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  append(value);
  return out;
}

function normalizeSourceImageUrl(value: unknown): string {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) text = `https:${text}`;
  if (!/^https?:\/\//i.test(text)) return '';
  const lower = text.toLowerCase();
  if (isLikelyNonImageMediaUrl(lower)) return '';
  if (/\.(svg)(?:[?#]|$)/i.test(lower)) return '';
  if (/(logo|icon|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\/)/i.test(lower)) return '';
  if (/[-_]tps[-_]\d{1,4}[-x]\d{1,4}|55-tps|\b2-tps\b|gg_dtc|[-_/]rate(?:[._/-]|$)/i.test(lower)) return '';
  if (/imgextra\/i\d\/600000\d+\/.*(?:-tps-|gg_dtc|160-160|44-45|24-24|16-16|15-14)/i.test(lower)) return '';

  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname
      .replace(/\.(jpe?g|png|webp)_\.webp$/i, '.$1')
      .replace(/\.(jpe?g|png|webp)_(?:sum|b)\.(?:jpe?g|png|webp)$/i, '.$1')
      .replace(/\.(jpe?g|png|webp)_(?:\d{2,4}x\d{2,4}|q\d+)\.(?:jpe?g|png|webp)$/i, '.$1');
    return url.href;
  } catch {
    return text;
  }
}

function isAlreadyStoredImage(value: string): boolean {
  try {
    const url = new URL(value);
    return /\/api\/cdn\//i.test(url.pathname) || /\/uploads\//i.test(url.pathname);
  } catch {
    return false;
  }
}

async function transferSingleSourceImage(
  backend: Awaited<ReturnType<typeof getStorageBackend>>,
  rawUrl: string,
  userId: string,
) {
  const downloaded = await downloadPublicImage(rawUrl, {
    maxBytes: MAX_SOURCE_IMAGE_BYTES,
    maxRedirects: 0,
  });
  const remoteUrl = new URL(downloaded.finalUrl);
  const buf = downloaded.buffer;
  const contentType = normalizeMime(downloaded.contentType);
  const detected = await sharp(buf).metadata().catch(() => null);
  if (!detected?.format) throw new Error('远程 URL 不是有效图片');

  const detectedMime = mimeFromSharpFormat(detected.format);
  const mime = ALLOWED_IMAGE_MIME.has(contentType) ? contentType : detectedMime;
  if (!mime || !ALLOWED_IMAGE_MIME.has(mime)) throw new Error(`不支持的图片类型: ${contentType || detected.format}`);

  const filename = safeSourceImageFilename(remoteUrl, mime);
  const sanitized = await sanitizeOzonPublishImageBuffer(buf, filename, mime);
  return backend.uploadBuffer(sanitized.buffer, sanitized.filename, sanitized.mimeType, { category: 'raw', ownerId: userId });
}

function normalizeMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

function mimeFromSharpFormat(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return '';
  }
}

function safeSourceImageFilename(url: URL, mime: string): string {
  const rawName = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^\w.\-]/g, '_').slice(0, 120);
  if (rawName && /\.[a-z0-9]{2,5}$/i.test(rawName)) return rawName;
  return `source_${Date.now()}.${extensionFromMime(mime)}`;
}

function extensionFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

function shortError(error: unknown): string {
  return String((error as any)?.message || error || 'unknown').slice(0, 240);
}
