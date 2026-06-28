import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';
import { getStorageBackend } from './image-storage.js';
import { isLikelyNonImageMediaUrl, sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';

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
  const remoteUrl = await validateRemoteImageUrl(rawUrl);
  const res = await fetch(remoteUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer: sourceRefererFor(remoteUrl),
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

  const buf = await readLimitedResponseBuffer(res, MAX_SOURCE_IMAGE_BYTES);
  const contentType = normalizeMime(res.headers.get('content-type') || '');
  const detected = await sharp(buf).metadata().catch(() => null);
  if (!detected?.format) throw new Error('远程 URL 不是有效图片');

  const detectedMime = mimeFromSharpFormat(detected.format);
  const mime = ALLOWED_IMAGE_MIME.has(contentType) ? contentType : detectedMime;
  if (!mime || !ALLOWED_IMAGE_MIME.has(mime)) throw new Error(`不支持的图片类型: ${contentType || detected.format}`);

  const filename = safeSourceImageFilename(remoteUrl, mime);
  const sanitized = await sanitizeOzonPublishImageBuffer(buf, filename, mime);
  return backend.uploadBuffer(sanitized.buffer, sanitized.filename, sanitized.mimeType, { category: 'raw', ownerId: userId });
}

async function readLimitedResponseBuffer(res: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`remote file exceeds ${maxBytes} bytes`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`remote file exceeds ${maxBytes} bytes`);
    return buf;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`remote file exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

async function validateRemoteImageUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL 格式错误');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('仅支持 http/https 图片 URL');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('图片 URL 不允许包含认证信息');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不允许抓取本机地址');
  }
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('不允许抓取内网地址');
  }

  const records = await lookup(hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error('不允许抓取内网地址');
  }

  return parsed;
}

function isPrivateIp(address: string): boolean {
  if (address === '::1') return true;
  if (address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;

  const mapped = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(mapped) !== 4) return false;

  const parts = mapped.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;

  return false;
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

function sourceRefererFor(url: URL): string {
  if (/(?:^|\.)alicdn\.com$/i.test(url.hostname) || /(?:^|\.)1688\.com$/i.test(url.hostname)) {
    return 'https://detail.1688.com/';
  }
  if (/(?:^|\.)pinduoduo\.com$/i.test(url.hostname) || /(?:^|\.)yangkeduo\.com$/i.test(url.hostname)) {
    return 'https://mobile.yangkeduo.com/';
  }
  return `${url.protocol}//${url.hostname}/`;
}

function shortError(error: unknown): string {
  return String((error as any)?.message || error || 'unknown').slice(0, 240);
}
