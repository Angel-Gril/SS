import { readFile } from 'fs/promises';
import { basename } from 'path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { prisma } from '../lib/prisma.js';

// 复用一个 ProxyAgent（如果设置了 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY）
const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy ||
  process.env.ALL_PROXY || process.env.all_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
// 走代理时必须用 undici.fetch，全局 fetch 用 Node 内置 undici，dispatcher 接口不兼容
const httpFetch: typeof globalThis.fetch = proxyDispatcher
  ? ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher }) as any)
  : globalThis.fetch;

const OZON_CDN_IMAGE_UPLOAD_ATTEMPTS = 3;

export interface ImageUploadResult {
  url: string;
  filename: string;
  backend: 'ozon-cdn' | 'oss' | 'local';
}

export interface PresignedUploadResult {
  uploadUrl: string;
  finalUrl: string;
  key: string;
  objectKey: string;
  expiresIn: number;
  maxBytes: number;
  headers: Record<string, string>;
}

export interface PresignedUploadInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
  ownerId?: string;
}

export type ImageUploadCategory = 'raw' | 'watermarked' | 'thumbnail' | 'tmp' | 'video' | 'announcement' | 'system' | 'ai-generated';

export interface ImageUploadOptions {
  category?: ImageUploadCategory;
  ownerId?: string;
}

export interface ImageStorageBackend {
  upload(filePath: string, mimeType?: string): Promise<ImageUploadResult>;
  uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult>;
  getPresignedPutUrl?(input: PresignedUploadInput): Promise<PresignedUploadResult>;
}

// ─── OZON CDN 上传（利用 seller 登录态） ───

interface OzonCdnConfig {
  cookie: string;
  companyId: string;
  relayUrl?: string;
}

export class OzonCdnBackend implements ImageStorageBackend {
  private config: OzonCdnConfig;
  private etcCookie: string | null = null;
  private etcExpiry = 0;

  constructor(config: OzonCdnConfig) {
    this.config = config;
  }

  private getUploadBaseUrl(): string {
    if (this.config.relayUrl) {
      return this.config.relayUrl.replace(/\/+$/, '');
    }
    return 'https://upload.seller.ozon.ru';
  }

  async upload(filePath: string): Promise<ImageUploadResult> {
    const buffer = await readFile(filePath);
    const filename = basename(filePath);
    return this.uploadBuffer(buffer, filename);
  }

  // OZON CDN 要求先访问一次拿 __Secure-ETC cookie，再带它真正上传
  private async ensureEtcCookie(cleanCookie: string): Promise<string> {
    const now = Date.now();
    if (this.etcCookie && now < this.etcExpiry) return this.etcCookie;

    const probe = await httpFetch(`${this.getUploadBaseUrl()}/api/images/synchronous/validate_raw`, {
      method: 'POST',
      headers: {
        'cookie': cleanCookie,
        'x-o3-app-name': 'seller-ui',
        'x-o3-company-id': this.config.companyId,
        'user-agent': 'Mozilla/5.0',
      },
      body: 'probe',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    const headers: any = probe.headers;
    const setCookies: string[] = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (probe.headers.get('set-cookie') ? [probe.headers.get('set-cookie')!] : []);
    const etc = setCookies.map((c) => c.split(';')[0]!.trim()).find((c) => c.startsWith('__Secure-ETC='));
    if (!etc) {
      const body = await probe.text().catch(() => '');
      throw new Error(`OZON CDN 握手失败 (HTTP ${probe.status}): 未返回 __Secure-ETC cookie。响应: ${body.slice(0, 150)}`);
    }
    this.etcCookie = etc;
    this.etcExpiry = now + 30 * 60 * 1000; // 30 分钟内复用
    return etc;
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    if (options?.category === 'video') {
      return this.uploadVideoBuffer(buffer, filename, mimeType);
    }

    const boundary = `----WebKitFormBoundary${randomBoundary()}`;
    const mime = mimeType || guessMime(filename);

    const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      buffer,
      Buffer.from(footer, 'utf-8'),
    ]);

    // 清理 cookie：去除换行/回车（fetch 会拒绝带控制字符的 header）
    const cleanCookie = this.config.cookie.replace(/[\r\n]/g, '').trim();
    if (!cleanCookie) {
      throw new Error('OZON CDN cookie 为空，请通过浏览器扩展同步该店铺登录态');
    }

    let etc: string;
    try {
      etc = await this.ensureEtcCookie(cleanCookie);
    } catch (e: any) {
      throw new Error(`OZON CDN 握手阶段失败: ${e.message}`);
    }
    const fullCookie = `${cleanCookie}; ${etc}`;

    let res: Response | null = null;
    for (let attempt = 1; attempt <= OZON_CDN_IMAGE_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        res = await httpFetch(`${this.getUploadBaseUrl()}/api/images/synchronous/validate_raw?__rr=1`, {
          method: 'POST',
          headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'cookie': fullCookie,
            'x-o3-app-name': 'seller-ui',
            'x-o3-company-id': this.config.companyId,
            'origin': 'https://seller.ozon.ru',
            'referer': 'https://seller.ozon.ru/',
            'user-agent': 'Mozilla/5.0',
          },
          body,
          signal: AbortSignal.timeout(30000),
        });
        break;
      } catch (e: any) {
        const cause = getFetchFailureCause(e);
        if (attempt < OZON_CDN_IMAGE_UPLOAD_ATTEMPTS && isTransientOzonCdnUploadFailure(cause, e)) {
          console.warn(`[image-storage] Ozon CDN image upload interrupted (${cause || e?.message || 'unknown'}), retry ${attempt + 1}/${OZON_CDN_IMAGE_UPLOAD_ATTEMPTS}`);
          await waitForOzonCdnUploadRetry(attempt);
          continue;
        }
        const hint = formatOzonCdnUploadConnectionHint(cause, e, this.config.relayUrl);
        const retrySuffix = attempt > 1 ? `（已重试 ${attempt} 次）` : '';
        throw new Error(`OZON CDN 上传连接失败${retrySuffix} — ${hint}`);
      }
    }

    if (!res) {
      throw new Error('OZON CDN 上传连接失败 — 底层错误: empty response');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        // 401/403 通常是 ETC 失效，清缓存让下次重新握手
        this.etcCookie = null;
        throw new Error(`OZON CDN 鉴权失败 (HTTP ${res.status}) — cookie 已过期或 company_id 不匹配，请重新通过扩展同步登录态`);
      }
      throw new Error(`OZON CDN upload failed: HTTP ${res.status} - ${text.slice(0, 200)}`);
    }

    const data = await res.json() as { url?: string; name?: string; validation_error?: { code: string; message: string } };
    if (data?.validation_error) {
      throw new Error(`OZON CDN 校验失败: ${data.validation_error.code} - ${data.validation_error.message}`);
    }
    if (!data?.url) {
      throw new Error(`OZON CDN 返回数据异常: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { url: data.url, filename: data.name || filename, backend: 'ozon-cdn' };
  }

  private async uploadVideoBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
  ): Promise<ImageUploadResult> {
    const boundary = `----WebKitFormBoundary${randomBoundary()}`;
    const mime = mimeType || guessMime(filename);
    const safeFilename = filename.replace(/[\r\n"]/g, '_') || 'video.mp4';
    const textPart = (name: string, value: string) => Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf-8',
    );
    const fileHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="body"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      'utf-8',
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([
      textPart('file_name', safeFilename),
      textPart('tmp', 'true'),
      fileHeader,
      buffer,
      footer,
    ]);

    const cleanCookie = this.config.cookie.replace(/[\r\n]/g, '').trim();
    if (!cleanCookie) {
      throw new Error('OZON CDN cookie 为空，请通过浏览器扩展同步该店铺登录态');
    }

    let res: Response;
    try {
      const headers = {
        'accept': 'application/json, text/plain, */*',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'cookie': cleanCookie,
        'x-o3-app-name': 'seller-ui',
        'x-o3-company-id': this.config.companyId,
        'x-o3-language': 'zh-Hans',
        'x-o3-page-type': 'products-other',
        'origin': 'https://seller.ozon.ru',
        'referer': 'https://seller.ozon.ru/',
        'user-agent': 'Mozilla/5.0',
      };
      res = await httpFetch('https://api.seller.ozon.ru/api/media-storage/upload-file', {
        method: 'POST',
        redirect: 'manual',
        headers,
        body,
        signal: AbortSignal.timeout(120000),
      });
      if ((res.status === 307 || res.status === 308) && res.headers.get('location')) {
        const etcCookie = extractOzonEtcCookie(res.headers);
        if (etcCookie) {
          res = await httpFetch(res.headers.get('location')!, {
            method: 'POST',
            redirect: 'manual',
            headers: {
              ...headers,
              cookie: mergeCookieHeaderReplacing(headers.cookie, etcCookie),
            },
            body,
            signal: AbortSignal.timeout(120000),
          });
        }
      }
    } catch (e: any) {
      const cause = e?.cause?.code || e?.cause?.message || e?.code || '';
      const hint = cause === 'ENOTFOUND' || cause === 'EAI_AGAIN'
        ? 'DNS 解析失败：api.seller.ozon.ru 在当前网络不可达'
        : cause === 'ECONNREFUSED' || cause === 'ECONNRESET'
        ? '连接被拒绝/中断，可能是网络代理或防火墙拦截'
        : cause === 'UND_ERR_HEADERS_TIMEOUT' || /timeout/i.test(String(cause))
        ? '请求超时'
        : `底层错误: ${cause || e?.message || 'unknown'}`;
      throw new Error(`OZON 视频上传连接失败 — ${hint}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error(`OZON 视频上传鉴权失败 (HTTP ${res.status}) — cookie 已过期或 company_id 不匹配，请重新通过扩展同步登录态`);
      }
      throw new Error(`OZON 视频上传失败: HTTP ${res.status} - ${text.slice(0, 200)}`);
    }

    const data = await res.json() as { url?: string; name?: string; error?: unknown };
    if (!data?.url) {
      throw new Error(`OZON 视频上传返回数据异常: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { url: data.url, filename: data.name || safeFilename, backend: 'ozon-cdn' };
  }
}

function extractOzonEtcCookie(headers: Headers): string {
  const anyHeaders = headers as any;
  const setCookies: string[] = typeof anyHeaders.getSetCookie === 'function'
    ? anyHeaders.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')!] : []);
  return setCookies
    .map((cookie) => cookie.split(';')[0]!.trim())
    .find((cookie) => cookie.startsWith('__Secure-ETC='))
    || '';
}

function mergeCookieHeaderReplacing(cookieHeader: string, replacementCookie: string): string {
  const replacementName = replacementCookie.split('=')[0]?.trim();
  const parts = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && (!replacementName || !part.startsWith(`${replacementName}=`)));
  if (replacementCookie.trim()) parts.push(replacementCookie.trim());
  return parts.join('; ');
}

// ─── OSS 对象存储（S3 兼容：阿里云/腾讯云/CF R2/AWS/MinIO） ───

interface OssConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  cdnDomain?: string;
  publicBaseUrl?: string;
  pathPrefix?: string;
}

class OssBackend implements ImageStorageBackend {
  private config: OssConfig;

  constructor(config: OssConfig) {
    this.config = config;
  }

  async upload(filePath: string): Promise<ImageUploadResult> {
    const buffer = await readFile(filePath);
    const filename = basename(filePath);
    return this.uploadBuffer(buffer, filename);
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const endpoint = this.config.endpoint.startsWith('http')
      ? this.config.endpoint
      : `https://${this.config.endpoint}`;

    const client = new S3Client({
      endpoint,
      region: this.config.region || 'auto',
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.accessKeySecret,
      },
      forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
    });

    const ext = filename.split('.').pop() || 'jpg';
    const category = options?.category || 'raw';
    const userId = options?.ownerId || null;
    const objectKey = generateObjectKey(userId, category, ext);
    const mime = mimeType || guessMime(filename);

    await client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mime,
    }));

    const url = this.getPublicObjectUrl(objectKey);

    return { url, filename: objectKey.split('/').pop() || filename, backend: 'oss' };
  }

  async getPresignedPutUrl(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const endpoint = this.config.endpoint.startsWith('http')
      ? this.config.endpoint
      : `https://${this.config.endpoint}`;

    const client = new S3Client({
      endpoint,
      region: this.config.region || 'auto',
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.accessKeySecret,
      },
      forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
    });

    const ext = extensionFromMime(input.mimeType);
    const userId = input.ownerId || 'shared';
    const objectKey = generateObjectKey(userId, 'raw', ext);
    const expiresIn = 300;

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn },
    );

    const finalUrl = this.getPublicObjectUrl(objectKey);

    return {
      uploadUrl,
      finalUrl,
      key: objectKey,
      objectKey,
      expiresIn,
      maxBytes: input.maxBytes,
      headers: { 'Content-Type': input.mimeType },
    };
  }

  private getPublicObjectUrl(objectKey: string): string {
    if (this.config.cdnDomain) {
      const domain = this.config.cdnDomain.replace(/\/+$/, '');
      return `${domain.startsWith('http') ? domain : `https://${domain}`}/${objectKey}`;
    }

    const publicBaseUrl = (this.config.publicBaseUrl || 'http://localhost:3001').replace(/\/+$/, '');
    return `${publicBaseUrl}/api/cdn/${objectKey}`;
  }
}

// ─── 本地静态服务（开发测试用） ───

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

const LOCAL_UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

class LocalBackend implements ImageStorageBackend {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async upload(filePath: string): Promise<ImageUploadResult> {
    const buffer = await readFile(filePath);
    const filename = basename(filePath);
    return this.uploadBuffer(buffer, filename);
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
    const hash = createHash('md5').update(buffer).digest('hex').slice(0, 8);
    const ext = filename.split('.').pop() || 'jpg';
    const storedName = `${Date.now()}_${hash}.${ext}`;
    await writeFile(join(LOCAL_UPLOAD_DIR, storedName), buffer);
    const url = `${this.baseUrl}/uploads/${storedName}`;
    return { url, filename: storedName, backend: 'local' };
  }
}

// ─── Fallback 包装：OSS 失败自动降级到 OZON CDN ───

export class FallbackStorageBackend implements ImageStorageBackend {
  constructor(
    private primary: ImageStorageBackend,
    private fallback: ImageStorageBackend,
    private primaryName: string,
    private fallbackName: string,
  ) {}

  async upload(filePath: string, mimeType?: string): Promise<ImageUploadResult> {
    try {
      return await this.primary.upload(filePath, mimeType);
    } catch (e: any) {
      console.warn(`[image-storage] ${this.primaryName} upload failed, falling back to ${this.fallbackName}: ${e.message}`);
      return await this.fallback.upload(filePath, mimeType);
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ImageUploadOptions,
  ): Promise<ImageUploadResult> {
    try {
      return await this.primary.uploadBuffer(buffer, filename, mimeType, options);
    } catch (e: any) {
      console.warn(`[image-storage] ${this.primaryName} uploadBuffer failed, falling back to ${this.fallbackName}: ${e.message}`);
      return await this.fallback.uploadBuffer(buffer, filename, mimeType, options);
    }
  }

  async getPresignedPutUrl(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    if (this.primary.getPresignedPutUrl) {
      try {
        return await this.primary.getPresignedPutUrl(input);
      } catch (e: any) {
        console.warn(`[image-storage] ${this.primaryName} presign failed: ${e.message}`);
      }
    }
    if (this.fallback.getPresignedPutUrl) {
      return await this.fallback.getPresignedPutUrl(input);
    }
    throw new Error(`${this.primaryName} 预签名失败且 ${this.fallbackName} 不支持预签名，请使用 upload-base64 接口`);
  }
}

// ─── 工厂：根据环境变量获取当前存储后端 ───

import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';

export type StorageBackendType = 'ozon-cdn' | 'oss' | 'local';

interface ShopOzonAuth {
  cookie: string;
  companyId: string;
}

async function getShopOzonAuth(shopId: string): Promise<ShopOzonAuth | null> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return null;
  const config = (shop.config as any) || {};
  if (!config.ozonCdnCookie || !config.ozonCompanyId) return null;
  return { cookie: config.ozonCdnCookie, companyId: String(config.ozonCompanyId) };
}

async function buildOzonCdnBackend(shopId: string): Promise<OzonCdnBackend> {
  const auth = await getShopOzonAuth(shopId);
  if (!auth) {
    throw new Error('目标店铺未同步 OZON CDN cookie/company_id，请通过浏览器扩展同步登录态');
  }
  const rc = await getRuntimeConfigForStorage();
  return new OzonCdnBackend({ ...auth, relayUrl: rc.ozonCdnRelayUrl });
}

export async function getOzonCdnStorageBackend(shopId: string): Promise<ImageStorageBackend> {
  return buildOzonCdnBackend(shopId);
}

async function buildOssBackend(): Promise<OssBackend> {
  const rc = await getRuntimeConfigForStorage();
  if (!rc.oss) {
    throw new Error('OSS 未配置，请在超管设置中填写上传 R2/OSS 配置，或设置环境变量 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET');
  }
  return new OssBackend({ ...rc.oss, publicBaseUrl: rc.localBaseUrl });
}

export async function getStorageBackend(shopId?: string): Promise<ImageStorageBackend> {
  const rc = await getRuntimeConfigForStorage();
  const backendType = rc.imageStorage;

  switch (backendType) {
    case 'ozon-cdn': {
      if (!shopId) {
        throw new Error('OZON CDN 后端需要指定目标店铺（shopId）');
      }
      return await buildOzonCdnBackend(shopId);
    }
    case 'oss': {
      const ossBackend = await buildOssBackend();
      if (shopId && rc.ossFallbackToCdn) {
        try {
          const cdnFallback = await buildOzonCdnBackend(shopId);
          return new FallbackStorageBackend(ossBackend, cdnFallback, 'OSS', 'OZON-CDN');
        } catch {
          // 店铺无 CDN 凭证，纯 OSS 无降级
        }
      }
      return ossBackend;
    }
    case 'local':
    default: {
      return new LocalBackend(rc.localBaseUrl);
    }
  }
}

// ─── Helpers ───

function randomBoundary(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function getFetchFailureCause(error: any): string {
  return String(error?.cause?.code || error?.cause?.message || error?.code || '');
}

function isTransientOzonCdnUploadFailure(cause: string, error: any): boolean {
  const text = `${cause} ${error?.message || ''}`;
  return [
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ].some((token) => text.includes(token));
}

function formatOzonCdnUploadConnectionHint(cause: string, error: any, relayUrl?: string): string {
  const target = relayUrl ? `中转地址 ${relayUrl}` : 'upload.seller.ozon.ru';
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
    return `DNS 解析失败：${target} 在当前网络不可达${relayUrl ? '。请检查 CF Worker 中转地址是否正确' : (PROXY_URL ? '' : '。请在超管设置中配置 CF Worker 中转地址，或使用 OSS 后端')}`;
  }
  if (cause === 'ECONNREFUSED' || cause === 'ECONNRESET') {
    return '连接被拒绝/中断，可能是网络代理或防火墙拦截';
  }
  if (cause === 'CERT_HAS_EXPIRED' || /certificate/i.test(String(cause))) {
    return 'TLS 证书校验失败';
  }
  if (cause === 'UND_ERR_HEADERS_TIMEOUT' || /timeout/i.test(String(cause))) {
    return '请求超时';
  }
  return `底层错误: ${cause || error?.message || 'unknown'}`;
}

async function waitForOzonCdnUploadRetry(attempt: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const delayMs = Math.min(2000, 500 * (2 ** Math.max(0, attempt - 1)));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

/**
 * 生成 OSS 对象路径
 *
 * 路径规范：
 * - 用户图片：users/{userId}/{category}/yyyy/mm/hash.ext
 * - 公告附件：announcements/yyyy/mm/hash.ext
 * - 系统附件：system/attachments/yyyy/mm/hash.ext
 *
 * @param userId 用户 ID（公告/系统附件传 null）
 * @param category 分类：raw（原始采集图）、watermarked（水印图）、tmp（临时图）、announcement（公告附件）、system（系统附件）
 * @param ext 文件扩展名
 */
function generateObjectKey(
  userId: string | null,
  category: ImageUploadCategory,
  ext: string,
): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const safeExt = sanitizeObjectSegment(ext.toLowerCase().replace(/^\.+/, '')) || 'jpg';
  const hash = createHash('sha256').update(`${userId || 'system'}-${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16);

  // 公告附件：announcements/yyyy/mm/hash.ext
  if (category === 'announcement') {
    return `announcements/${yyyy}/${mm}/${hash}.${safeExt}`;
  }

  // 系统附件：system/attachments/yyyy/mm/hash.ext
  if (category === 'system') {
    return `system/attachments/${yyyy}/${mm}/${hash}.${safeExt}`;
  }

  // 用户图片：users/{userId}/{category}/yyyy/mm/hash.ext
  const safeUserId = sanitizeObjectSegment(userId || 'shared') || 'shared';
  return `users/${safeUserId}/${category}/${yyyy}/${mm}/${hash}.${safeExt}`;
}

function sanitizeObjectSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 80);
}
