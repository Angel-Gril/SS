import sharp from 'sharp';

const OZON_DIRECT_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);

export type OzonSanitizedImage = {
  buffer: Buffer;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png';
  converted: boolean;
  sourceFormat: string;
};

export function isLikelyNonImageMediaUrl(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;

  try {
    const url = new URL(text.startsWith('//') ? `https:${text}` : text);
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    const hostname = url.hostname.toLowerCase();
    if (/\.(?:mp4|m4v|mov|webm|m3u8|avi|mkv|flv)(?:$|[?#])/i.test(`${pathname}${url.search}`)) {
      return true;
    }
    return /(?:^|\.)cloud\.video\.taobao\.com$/i.test(hostname) && /\/play\//i.test(pathname);
  } catch {
    const lower = text.toLowerCase();
    return /\.(?:mp4|m4v|mov|webm|m3u8|avi|mkv|flv)(?:$|[?#])/i.test(lower);
  }
}

export async function sanitizeOzonPublishImageBuffer(
  buffer: Buffer,
  filename: string,
  contentType?: string | null,
): Promise<OzonSanitizedImage> {
  const metadata = await sharp(buffer, { animated: false }).metadata().catch(() => null);
  if (!metadata?.format) {
    throw new Error('远程 URL 不是有效图片');
  }

  const detectedMime = mimeFromSharpFormat(metadata.format);
  const normalizedContentType = normalizeMime(contentType || '');
  const sourceMime = detectedMime || normalizedContentType;

  if (sourceMime === 'image/jpeg') {
    return {
      buffer,
      filename: forceExtension(filename, 'jpg'),
      mimeType: 'image/jpeg',
      converted: false,
      sourceFormat: metadata.format,
    };
  }

  if (sourceMime === 'image/png') {
    return {
      buffer,
      filename: forceExtension(filename, 'png'),
      mimeType: 'image/png',
      converted: false,
      sourceFormat: metadata.format,
    };
  }

  const converted = await sharp(buffer, { animated: false })
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return {
    buffer: converted,
    filename: forceExtension(filename, 'jpg'),
    mimeType: 'image/jpeg',
    converted: true,
    sourceFormat: metadata.format,
  };
}

export function isOzonDirectImageMime(value: unknown): boolean {
  return OZON_DIRECT_IMAGE_MIME.has(normalizeMime(String(value || '')));
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
    case 'avif':
      return 'image/avif';
    case 'tiff':
      return 'image/tiff';
    default:
      return '';
  }
}

function forceExtension(filename: string, extension: 'jpg' | 'png'): string {
  const clean = String(filename || '').trim().replace(/[^\w.\-]/g, '_').slice(0, 120) || `image.${extension}`;
  if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean.replace(/\.[a-z0-9]{2,5}$/i, `.${extension}`);
  return `${clean}.${extension}`;
}
