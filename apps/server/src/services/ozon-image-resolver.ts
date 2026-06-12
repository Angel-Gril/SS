import { readFile } from 'fs/promises';
import { join } from 'path';
import { getStorageBackend, type ImageStorageBackend } from './image-storage.js';

function previewUrl(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

type ImageFetch = (
  url: string,
  init?: { method?: string; redirect?: 'follow' | 'error' | 'manual'; signal?: AbortSignal },
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
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    return {
      ok: res.ok && String(res.headers.get('content-type') || '').toLowerCase().startsWith('image/'),
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      finalUrl: res.url || url,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === 'AbortError' ? 'timeout' : (e?.message ? String(e.message) : 'unknown error'),
    };
  } finally {
    clearTimeout(timer);
  }
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
): Promise<string[]> {
  const resolved: string[] = [];
  let backend: ImageStorageBackend | null = null;
  let backendError: string | null = null;

  // 过滤空字符串，防止透传给 OZON 导致 invalid URL
  const validImages = images.filter((raw) => String(raw || '').trim().length > 0);

  for (const raw of validImages) {
    let img = String(raw || '').trim();
    const localPath = localPathFromUrl(img);
    if (localPath) img = localPath;

    const isLocal = img.startsWith('/watermarked/') || img.startsWith('/uploads/');
    if (isLocal) {
      if (!backend && !backendError) {
        try {
          backend = await getStorageBackend(shopId);
        } catch (e: any) {
          backendError = e?.message || '存储后端未配置';
        }
      }
      if (!backend) {
        throw new Error(
          `本地水印图无法上传到 OZON：${backendError}。请在 /admin/integrations 切换图片存储后端为 ozon-cdn 或 oss，并通过浏览器扩展同步该店铺的 seller cookie 与 company_id`,
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
      const category = img.startsWith('/watermarked/') ? 'watermarked' : 'raw';
      const result = await backend.uploadBuffer(buf, filename, undefined, { category, ownerId });
      const normalized = normalizeOzonPublishImageUrl(result.url);
      resolved.push(normalized);
      queueOzonImageDiagnostic(normalized, category);
    } else {
      const normalized = normalizeOzonPublishImageUrl(img);
      resolved.push(normalized);
      queueOzonImageDiagnostic(normalized, 'source');
    }
  }
  return resolved;
}
