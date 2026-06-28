import { readFile } from 'fs/promises';
import { join } from 'path';
import { getOzonCdnStorageBackend, getStorageBackend, type ImageStorageBackend } from './image-storage.js';
import {
  isLikelyNonImageMediaUrl,
  isOzonDirectImageMime,
  sanitizeOzonPublishImageBuffer,
} from './ozon-image-sanitizer.js';

const MAX_OZON_IMAGE_SANITIZE_BYTES = 20 * 1024 * 1024;

function previewUrl(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

type ImageFetch = (
  url: string,
  init?: {
    method?: string;
    redirect?: 'follow' | 'error' | 'manual';
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
}>;

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;

  const ipv4 = host.match(/^172\.(\d+)\./);
  if (ipv4) {
    const second = Number(ipv4[1]);
    if (second >= 16 && second <= 31) return true;
  }

  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

function isOzonImageHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.ozone.ru') || host.endsWith('.ozon.ru') || host.endsWith('.ozonstatic.cn');
}

export function normalizeOzonPublishImageUrl(raw: string): string {
  let text = String(raw || '').trim();
  if (!text) {
    throw new Error('图片 URL 为空，请删除空图片或重新采集');
  }
  if (text.startsWith('//')) {
    text = `https:${text}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`图片 URL 格式非法: ${previewUrl(text)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`图片 URL 必须是 http/https: ${previewUrl(text)}`);
  }
  if (url.username || url.password) {
    throw new Error(`图片 URL 不能包含用户名或密码: ${previewUrl(text)}`);
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error(
      `图片 URL 不是公网地址，OZON 无法拉取: ${previewUrl(text)}。请配置 OSS/OZON CDN，或设置环境变量 LOCAL_BASE_URL 为公网 HTTPS 域名`,
    );
  }

  if (isOzonImageHostname(url.hostname)) {
    url.pathname = url.pathname.replace(/\/(?:wc|w|h|c)\d+(?:x\d+)?(?=\/)/i, '');
  }

  return url.href;
}

export async function diagnoseOzonImageUrl(
  url: string,
  fetchImpl: ImageFetch = fetch as ImageFetch,
): Promise<{
  ok: boolean;
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  finalUrl?: string;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const toDiag = (res: Awaited<ReturnType<ImageFetch>>) => ({
      ok: res.ok && String(res.headers.get('content-type') || '').toLowerCase().startsWith('image/'),
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      finalUrl: res.url || url,
    });

    const head = toDiag(await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal }));
    if (head.ok) return head;

    const get = toDiag(await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { range: 'bytes=0-0' },
    }));
    return get.ok ? get : head;
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === 'AbortError' ? 'timeout' : (e?.message ? String(e.message) : 'unknown error'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForOzonImageReady(
  url: string,
  options: {
    attempts?: number;
    delayMs?: number;
    fetchImpl?: ImageFetch;
  } = {},
): Promise<Awaited<ReturnType<typeof diagnoseOzonImageUrl>>> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 400);
  let lastDiag: Awaited<ReturnType<typeof diagnoseOzonImageUrl>> | null = null;
  const fetchImpl = options.fetchImpl || (fetch as ImageFetch);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastDiag = await diagnoseOzonImageUrl(url, fetchImpl);
    if (lastDiag.ok) return lastDiag;
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const rateLimitedHint = lastDiag?.status === 429
    ? '（图片代理或上游限流，请稍后重试；如频繁出现，优先检查 /api/cdn 图片代理限流或 R2/CDN 访问策略）'
    : '';
  throw new Error(
    `图片已上传但公网暂不可读${rateLimitedHint}，OZON 可能下载失败: ${previewUrl(url)} ` +
    `(status=${lastDiag?.status ?? 'ERR'}, type=${lastDiag?.contentType || '-'}${lastDiag?.error ? `, error=${lastDiag.error}` : ''})`,
  );
}

function queueOzonImageDiagnostic(url: string, source: string) {
  if (process.env.NODE_ENV === 'test') return;
  void diagnoseOzonImageUrl(url).then((diag) => {
    const msg = `[ozon-image] ${source} status=${diag.status ?? 'ERR'} contentType=${diag.contentType || '-'} contentLength=${diag.contentLength || '-'} finalUrl=${previewUrl(diag.finalUrl || url)}${diag.error ? ` error=${diag.error}` : ''}`;
    if (diag.ok) console.log(msg);
    else console.warn(msg);
  });
}

function localPathFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isPrivateHostname(url.hostname)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * 将本地水印路径上传到存储后端，返回公网可达 URL。
 * 关键：本地路径 resolve 失败必须 throw，绝不能让 localhost URL 透传给 OZON。
 */
export async function resolveImageUrls(
  images: string[],
  shopId: string,
  ownerId?: string,
  options: { preferOzonCdn?: boolean } = {},
): Promise<string[]> {
  const resolved: string[] = [];
  let backend: ImageStorageBackend | null = null;
  let backendError: string | null = null;
  let ozonCdnBackend: ImageStorageBackend | null = null;
  let ozonCdnError: string | null = null;

  // 过滤空字符串，防止透传给 OZON 导致 invalid URL
  const validImages = images.filter((raw) => {
    const text = String(raw || '').trim();
    return text.length > 0 && !isLikelyNonImageMediaUrl(text);
  });

  for (const raw of validImages) {
    let img = String(raw || '').trim();
    const localPath = localPathFromUrl(img);
    if (localPath) img = localPath;

    const isLocal = img.startsWith('/watermarked/') || img.startsWith('/uploads/');
    if (isLocal) {
      if (options.preferOzonCdn && !ozonCdnBackend && !ozonCdnError) {
        try {
          ozonCdnBackend = await getOzonCdnStorageBackend(shopId);
        } catch (e: any) {
          ozonCdnError = e?.message || 'OZON CDN 未配置';
        }
      }
      if (!ozonCdnBackend && !backend && !backendError) {
        try {
          backend = await getStorageBackend(shopId);
        } catch (e: any) {
          backendError = e?.message || '存储后端未配置';
        }
      }
      const uploadBackend = ozonCdnBackend || backend;
      if (!uploadBackend) {
        throw new Error(
          `本地水印图无法上传到 OZON：${backendError || ozonCdnError}。请在 /admin/integrations 切换图片存储后端为 ozon-cdn 或 oss，并通过浏览器扩展同步该店铺的 seller cookie 与 company_id`,
        );
      }
      const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
      let buf: Buffer;
      try {
        buf = await readFile(localPath);
      } catch {
        throw new Error(`水印图文件不存在: ${img}（请重新点击"打水印"刷新）`);
      }
      const filename = img.split('/').pop() || 'img.jpg';
      const sanitized = await sanitizeOzonPublishImageBuffer(buf, filename);
      const category = img.startsWith('/watermarked/') ? 'watermarked' : 'raw';
      const result = await uploadBackend.uploadBuffer(
        sanitized.buffer,
        sanitized.filename,
        sanitized.mimeType,
        { category, ownerId },
      );
      const normalized = normalizeOzonPublishImageUrl(result.url);
      await waitForOzonImageReady(normalized);
      resolved.push(normalized);
      queueOzonImageDiagnostic(normalized, ozonCdnBackend ? 'ozon-cdn' : category);
    } else {
      const normalized = normalizeOzonPublishImageUrl(img);
      const compatible = await resolvePublicOzonCompatibleImageUrl(
        normalized,
        shopId,
        ownerId,
        options,
        () => ozonCdnBackend,
        (value) => { ozonCdnBackend = value; },
        () => ozonCdnError,
        (value) => { ozonCdnError = value; },
        () => backend,
        (value) => { backend = value; },
        () => backendError,
        (value) => { backendError = value; },
      );
      resolved.push(compatible);
      queueOzonImageDiagnostic(compatible, compatible === normalized ? 'source' : 'sanitized-source');
    }
  }
  return resolved;
}

async function resolvePublicOzonCompatibleImageUrl(
  normalized: string,
  shopId: string,
  ownerId: string | undefined,
  options: { preferOzonCdn?: boolean },
  getOzonCdnBackend: () => ImageStorageBackend | null,
  setOzonCdnBackend: (value: ImageStorageBackend | null) => void,
  getOzonCdnError: () => string | null,
  setOzonCdnError: (value: string | null) => void,
  getBackend: () => ImageStorageBackend | null,
  setBackend: (value: ImageStorageBackend | null) => void,
  getBackendError: () => string | null,
  setBackendError: (value: string | null) => void,
): Promise<string> {
  if (!shouldInspectPublicImageForOzonCompatibility(normalized)) return normalized;

  const diag = await diagnoseOzonImageUrl(normalized);
  const contentType = diag.contentType || '';
  if (diag.ok && isOzonDirectImageMime(contentType)) return normalized;
  if (!diag.ok || !String(contentType).toLowerCase().startsWith('image/')) return normalized;

  const uploadBackend = await ensureUploadBackend(
    shopId,
    options,
    getOzonCdnBackend,
    setOzonCdnBackend,
    getOzonCdnError,
    setOzonCdnError,
    getBackend,
    setBackend,
    getBackendError,
    setBackendError,
  );
  if (!uploadBackend) {
    throw new Error(
      `图片格式为 ${contentType}，OZON 可能拒绝；但当前无法转成 JPEG/PNG：${getBackendError() || getOzonCdnError() || '存储后端未配置'}`,
    );
  }

  const res = await fetch(normalized, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`图片格式转换前下载失败: ${res.status} ${previewUrl(normalized)}`);

  const buf = await readLimitedImageBuffer(res, MAX_OZON_IMAGE_SANITIZE_BYTES);
  const sanitized = await sanitizeOzonPublishImageBuffer(buf, filenameFromUrl(normalized), res.headers.get('content-type') || contentType);
  const result = await uploadBackend.uploadBuffer(sanitized.buffer, sanitized.filename, sanitized.mimeType, {
    category: 'raw',
    ownerId,
  });
  const convertedUrl = normalizeOzonPublishImageUrl(result.url);
  await waitForOzonImageReady(convertedUrl);
  return convertedUrl;
}

function shouldInspectPublicImageForOzonCompatibility(raw: string): boolean {
  try {
    const url = new URL(raw);
    const path = url.pathname.toLowerCase();
    return /\/api\/cdn\//i.test(path) || /\.(?:webp|gif|avif|tiff?)(?:$|[?#])/i.test(`${path}${url.search}`);
  } catch {
    return /\.(?:webp|gif|avif|tiff?)(?:$|[?#])/i.test(String(raw || '').toLowerCase());
  }
}

async function ensureUploadBackend(
  shopId: string,
  options: { preferOzonCdn?: boolean },
  getOzonCdnBackend: () => ImageStorageBackend | null,
  setOzonCdnBackend: (value: ImageStorageBackend | null) => void,
  getOzonCdnError: () => string | null,
  setOzonCdnError: (value: string | null) => void,
  getBackend: () => ImageStorageBackend | null,
  setBackend: (value: ImageStorageBackend | null) => void,
  getBackendError: () => string | null,
  setBackendError: (value: string | null) => void,
): Promise<ImageStorageBackend | null> {
  if (options.preferOzonCdn && !getOzonCdnBackend() && !getOzonCdnError()) {
    try {
      setOzonCdnBackend(await getOzonCdnStorageBackend(shopId));
    } catch (e: any) {
      setOzonCdnError(e?.message || 'OZON CDN 未配置');
    }
  }
  if (!getOzonCdnBackend() && !getBackend() && !getBackendError()) {
    try {
      setBackend(await getStorageBackend(shopId));
    } catch (e: any) {
      setBackendError(e?.message || '存储后端未配置');
    }
  }
  return getOzonCdnBackend() || getBackend();
}

async function readLimitedImageBuffer(res: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`remote image exceeds ${maxBytes} bytes`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`remote image exceeds ${maxBytes} bytes`);
  return buf;
}

function filenameFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^\w.\-]/g, '_').slice(0, 120);
    return name || 'source.jpg';
  } catch {
    return 'source.jpg';
  }
}
