import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getStorageBackend, type ImageStorageBackend } from './image-storage.js';
import { isDomesticSourcePlatform } from './source-image-transfer.js';

const MAX_SOURCE_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_TRANSFER_VIDEOS = 4;
const TRANSFER_CONCURRENCY = 2;
const DIRECT_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

type VideoFetch = (
  url: string,
  init?: {
    method?: string;
    redirect?: 'follow' | 'error' | 'manual';
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
) => Promise<ResponseLike>;

type ResponseLike = {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer?: () => Promise<ArrayBuffer | SharedArrayBuffer>;
};

export type SourceVideoDiagnosticStatus =
  | 'direct_video'
  | 'ozon_cdn_ready'
  | 'playlist_unsupported'
  | 'blocked'
  | 'not_video'
  | 'invalid_url'
  | 'too_large'
  | 'error';

export type SourceVideoUrlDiagnostic = {
  url: string;
  status: SourceVideoDiagnosticStatus;
  canTransfer: boolean;
  ozonAutoPublish: boolean;
  statusCode?: number;
  contentType?: string | null;
  contentLength?: string | null;
  finalUrl?: string;
  message: string;
};

export type SourceVideoTransferDiagnostic = {
  enabled: boolean;
  backend?: string;
  attempted: number;
  transferred: number;
  skipped: number;
  errors: Array<{ url: string; error: string }>;
  entries: Array<{
    originalUrl: string;
    url?: string;
    status: 'uploaded' | 'skipped' | 'ozon_cdn_ready' | 'failed';
    reason: string;
    contentType?: string | null;
    contentLength?: string | null;
    message?: string;
  }>;
};

export type SourceVideo = {
  url: string;
  coverUrl?: string;
  title?: string;
  originalUrl?: string;
  transferStatus?: 'uploaded' | 'skipped' | 'ozon_cdn_ready' | 'failed';
  transferReason?: string;
};

export type TransferSourceProductVideosInput = {
  sourceVideos: unknown;
  sourcePlatform?: unknown;
  userId: string;
  storageBackend?: ImageStorageBackend;
  fetchImpl?: VideoFetch;
};

export async function diagnoseSourceVideoUrl(
  rawUrl: unknown,
  options: { fetchImpl?: VideoFetch } = {},
): Promise<SourceVideoUrlDiagnostic> {
  const url = normalizeVideoUrl(rawUrl);
  if (!url) {
    return {
      url: String(rawUrl || '').trim(),
      status: 'invalid_url',
      canTransfer: false,
      ozonAutoPublish: false,
      message: '视频 URL 格式无效',
    };
  }

  if (isOzonCdnVideoUrl(url)) {
    return {
      url,
      status: 'ozon_cdn_ready',
      canTransfer: false,
      ozonAutoPublish: true,
      message: '已是 Ozon 官方视频 CDN，可生成 Ozon 视频媒体属性',
    };
  }

  if (isPlaylistUrl(url)) {
    return {
      url,
      status: 'playlist_unsupported',
      canTransfer: false,
      ozonAutoPublish: false,
      message: 'HLS/m3u8 分片流暂不支持服务端直接转存',
    };
  }

  const fetchImpl = options.fetchImpl || (fetch as VideoFetch);
  try {
    const diag = await fetchVideoHeadOrRange(url, fetchImpl);
    const contentLengthNumber = Number(diag.contentLength || 0);
    if (Number.isFinite(contentLengthNumber) && contentLengthNumber > MAX_SOURCE_VIDEO_BYTES) {
      return {
        ...diag,
        url,
        status: 'too_large',
        canTransfer: false,
        ozonAutoPublish: false,
        message: `视频超过 ${Math.round(MAX_SOURCE_VIDEO_BYTES / 1024 / 1024)}MB，暂不自动转存`,
      };
    }
    if (!diag.ok) {
      return {
        ...diag,
        url,
        status: 'blocked',
        canTransfer: false,
        ozonAutoPublish: false,
        message: '源站视频不可被服务端直接访问，可能需要浏览器登录态或防盗链 referer',
      };
    }
    if (isDirectVideoMime(diag.contentType) || isDirectVideoFileUrl(diag.finalUrl || url)) {
      return {
        ...diag,
        url,
        status: 'direct_video',
        canTransfer: true,
        ozonAutoPublish: false,
        message: '可服务端下载并转存到 OSS/R2',
      };
    }
    return {
      ...diag,
      url,
      status: 'not_video',
      canTransfer: false,
      ozonAutoPublish: false,
      message: 'URL 返回内容不是可识别的视频文件',
    };
  } catch (error: any) {
    return {
      url,
      status: 'error',
      canTransfer: false,
      ozonAutoPublish: false,
      message: shortError(error),
    };
  }
}

export async function transferSourceProductVideos(
  input: TransferSourceProductVideosInput,
): Promise<{ videos: SourceVideo[]; diagnostic: SourceVideoTransferDiagnostic | null }> {
  const originalVideos = normalizeSourceVideoList(input.sourceVideos).slice(0, MAX_TRANSFER_VIDEOS);
  if (!originalVideos.length || !isDomesticSourcePlatform(input.sourcePlatform)) {
    return { videos: originalVideos, diagnostic: null };
  }

  let backend = input.storageBackend || null;
  const output = [...originalVideos];
  const diagnostic: SourceVideoTransferDiagnostic = {
    enabled: true,
    attempted: 0,
    transferred: 0,
    skipped: 0,
    errors: [],
    entries: [],
  };

  for (let offset = 0; offset < originalVideos.length; offset += TRANSFER_CONCURRENCY) {
    const rows = await Promise.all(originalVideos.slice(offset, offset + TRANSFER_CONCURRENCY).map(async (video, batchIndex) => {
      const index = offset + batchIndex;
      const diag = await diagnoseSourceVideoUrl(video.url, { fetchImpl: input.fetchImpl });
      if (diag.status === 'ozon_cdn_ready') {
        return { index, video: { ...video, transferStatus: 'ozon_cdn_ready' as const, transferReason: diag.status }, diag, skipped: true as const };
      }
      if (!diag.canTransfer) {
        return { index, video: { ...video, transferStatus: 'skipped' as const, transferReason: diag.status }, diag, skipped: true as const };
      }

      diagnostic.attempted += 1;
      try {
        if (!backend) backend = await getStorageBackend();
        const transferred = await transferSingleSourceVideo(backend, video, input.userId, input.fetchImpl);
        return { index, video: transferred.video, diag, backend: transferred.backend };
      } catch (error: any) {
        return { index, video: { ...video, transferStatus: 'failed' as const, transferReason: 'transfer_failed' }, diag, error: shortError(error) };
      }
    }));

    for (const row of rows) {
      output[row.index] = row.video;
      if ('backend' in row && row.backend) {
        diagnostic.backend = diagnostic.backend || row.backend;
        diagnostic.transferred += 1;
        diagnostic.entries.push({
          originalUrl: originalVideos[row.index]!.url,
          url: row.video.url,
          status: 'uploaded',
          reason: 'direct_video',
          contentType: row.diag.contentType,
          contentLength: row.diag.contentLength,
        });
      } else if ('error' in row && row.error) {
        diagnostic.errors.push({ url: originalVideos[row.index]!.url, error: row.error });
        diagnostic.entries.push({
          originalUrl: originalVideos[row.index]!.url,
          status: 'failed',
          reason: row.video.transferReason || 'transfer_failed',
          contentType: row.diag.contentType,
          contentLength: row.diag.contentLength,
          message: row.error,
        });
      } else {
        diagnostic.skipped += 1;
        diagnostic.entries.push({
          originalUrl: originalVideos[row.index]!.url,
          url: row.video.url,
          status: row.video.transferStatus === 'ozon_cdn_ready' ? 'ozon_cdn_ready' : 'skipped',
          reason: row.video.transferReason || row.diag.status,
          contentType: row.diag.contentType,
          contentLength: row.diag.contentLength,
          message: row.diag.message,
        });
      }
    }
  }

  return { videos: output, diagnostic };
}

async function transferSingleSourceVideo(
  backend: ImageStorageBackend,
  video: SourceVideo,
  userId: string,
  fetchImpl: VideoFetch = fetch as VideoFetch,
): Promise<{ video: SourceVideo; backend: string }> {
  const remoteUrl = await validateRemoteVideoUrl(video.url, { skipDnsCheck: fetchImpl !== fetch });
  const res = await fetchImpl(remoteUrl.href, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer: sourceRefererFor(remoteUrl),
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const contentType = normalizeMime(res.headers.get('content-type') || '');
  if (!isDirectVideoMime(contentType) && !isDirectVideoFileUrl(remoteUrl.href)) {
    throw new Error(`不支持的视频类型: ${contentType || 'unknown'}`);
  }
  const buffer = await readLimitedResponseBuffer(res, MAX_SOURCE_VIDEO_BYTES);
  const mime = isDirectVideoMime(contentType) ? contentType : mimeFromVideoUrl(remoteUrl.href);
  const filename = safeSourceVideoFilename(remoteUrl, mime);
  const uploaded = await backend.uploadBuffer(buffer, filename, mime, { category: 'video', ownerId: userId });
  return {
    backend: uploaded.backend,
    video: {
      ...video,
      url: uploaded.url,
      originalUrl: video.url,
      transferStatus: 'uploaded',
      transferReason: 'direct_video',
    },
  };
}

async function fetchVideoHeadOrRange(url: string, fetchImpl: VideoFetch): Promise<{
  ok: boolean;
  statusCode?: number;
  contentType?: string | null;
  contentLength?: string | null;
  finalUrl?: string;
}> {
  const toDiag = (res: ResponseLike) => ({
    ok: res.ok,
    statusCode: res.status,
    contentType: res.headers.get('content-type'),
    contentLength: res.headers.get('content-length'),
    finalUrl: res.url || url,
  });

  const head = toDiag(await fetchImpl(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'Mozilla/5.0' },
  }));
  if (head.ok && (isDirectVideoMime(head.contentType) || isDirectVideoFileUrl(head.finalUrl || url))) return head;

  const ranged = toDiag(await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    headers: { 'user-agent': 'Mozilla/5.0', range: 'bytes=0-0' },
  }));
  return ranged.ok ? ranged : head;
}

function normalizeSourceVideoList(value: unknown): SourceVideo[] {
  if (!Array.isArray(value)) return [];
  const out: SourceVideo[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = normalizeVideoUrl(row.url || row.videoUrl || row.src || row.link);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const coverUrl = normalizeVideoUrl(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail);
    const title = String(row.title || row.name || row.caption || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    out.push({
      url,
      ...(coverUrl ? { coverUrl } : {}),
      ...(title ? { title } : {}),
    });
  }
  return out;
}

function normalizeVideoUrl(value: unknown): string {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) text = `https:${text}`;
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function isOzonCdnVideoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /^(?:cdnvideo\.v\.ozone\.ru|v-\d+\.ozone\.ru)$/i.test(url.hostname)
      && /^\/vod\/video-\d+\/[A-Z0-9]+\/[^/]+\.mp4$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isPlaylistUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /\.m3u8$/i.test(url.pathname);
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(String(raw || ''));
  }
}

function isDirectVideoFileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /\.(?:mp4|webm|mov|m4v)$/i.test(url.pathname);
  } catch {
    return /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(raw || ''));
  }
}

function isDirectVideoMime(value: unknown): boolean {
  return DIRECT_VIDEO_MIME.has(normalizeMime(String(value || '')));
}

function normalizeMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

function mimeFromVideoUrl(raw: string): string {
  const pathname = (() => {
    try {
      return new URL(raw).pathname.toLowerCase();
    } catch {
      return raw.toLowerCase();
    }
  })();
  if (pathname.endsWith('.webm')) return 'video/webm';
  if (pathname.endsWith('.mov') || pathname.endsWith('.m4v')) return 'video/quicktime';
  return 'video/mp4';
}

function safeSourceVideoFilename(url: URL, mime: string): string {
  const rawName = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^\w.\-]/g, '_').slice(0, 120);
  if (rawName && /\.(?:mp4|webm|mov|m4v)$/i.test(rawName)) return rawName;
  return `source_video_${Date.now()}.${extensionFromMime(mime)}`;
}

function extensionFromMime(mime: string): string {
  switch (mime) {
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'video/mp4':
    default:
      return 'mp4';
  }
}

async function readLimitedResponseBuffer(res: ResponseLike, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`remote video exceeds ${maxBytes} bytes`);
  }
  if (!res.arrayBuffer) throw new Error('response body unavailable');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`remote video exceeds ${maxBytes} bytes`);
  return buf;
}

async function validateRemoteVideoUrl(rawUrl: string, options: { skipDnsCheck?: boolean } = {}): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL 格式错误');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('仅支持 http/https 视频 URL');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('视频 URL 不允许包含认证信息');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不允许抓取本机地址');
  }
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('不允许抓取内网地址');
  }
  if (options.skipDnsCheck) return parsed;

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
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

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

function sourceRefererFor(url: URL): string {
  if (/(?:^|\.)alicdn\.com$/i.test(url.hostname) || /(?:^|\.)1688\.com$/i.test(url.hostname)) {
    return 'https://detail.1688.com/';
  }
  if (/(?:^|\.)pinduoduo\.com$/i.test(url.hostname) || /(?:^|\.)yangkeduo\.com$/i.test(url.hostname)) {
    return 'https://mobile.yangkeduo.com/';
  }
  if (/(?:^|\.)taobao\.com$/i.test(url.hostname) || /(?:^|\.)tmall\.com$/i.test(url.hostname)) {
    return 'https://item.taobao.com/';
  }
  return `${url.protocol}//${url.hostname}/`;
}

function shortError(error: unknown): string {
  return String((error as any)?.message || error || 'unknown').slice(0, 240);
}
