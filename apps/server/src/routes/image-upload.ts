import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../lib/auth.js';
import { getStorageBackend } from '../services/image-storage.js';
import { applyWatermark, type WatermarkConfig } from '../services/watermark.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import sharp from 'sharp';
import { uploadLimiter } from '../lib/upload-limiter.js';
import { getConfig } from '../config/system-config-schema.js';

const MAX_BYTES = 20 * 1024 * 1024;

const LARGE_BODY_LIMIT = 30 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
]);

const ATTACHMENT_EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'text/plain': 'txt',
};

type UploadLimitCheck = { allowed: true } | { allowed: false; reason: string };

async function checkUploadRateLimit(userId: string): Promise<UploadLimitCheck> {
  const rateLimitEnabled = await getConfig('upload_rate_limit_enabled');
  if (rateLimitEnabled) {
    const maxPerMinute = await getConfig('upload_rate_limit_per_minute');
    if (!uploadLimiter.checkRateLimit(userId, maxPerMinute)) {
      return { allowed: false, reason: `上传过于频繁，每分钟最多 ${maxPerMinute} 次` };
    }
  }

  return { allowed: true };
}

async function checkUploadQuota(userId: string, bytes: number): Promise<UploadLimitCheck> {
  const quotaEnabled = await getConfig('upload_daily_quota_enabled');
  if (quotaEnabled) {
    const maxMB = await getConfig('upload_daily_quota_mb');
    const maxBytes = maxMB * 1024 * 1024;
    if (!uploadLimiter.checkDailyQuota(userId, bytes, maxBytes)) {
      const usedMB = Math.round(uploadLimiter.getDailyUsage(userId) / 1024 / 1024);
      return { allowed: false, reason: `今日上传配额已用完（${usedMB}MB / ${maxMB}MB）` };
    }
  }

  return { allowed: true };
}

async function checkUploadLimits(userId: string, bytes: number): Promise<UploadLimitCheck> {
  const rateCheck = await checkUploadRateLimit(userId);
  if (!rateCheck.allowed) return rateCheck;
  return checkUploadQuota(userId, bytes);
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

export async function imageUploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // OSS 直传：前端拿预签名 URL 后直接 PUT 到 OSS，不经后端中转
  app.post('/presign', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { filename?: string; contentType?: string; sizeBytes?: number };
    const filename = body?.filename || `upload_${Date.now()}.jpg`;
    const contentType = normalizeMime(body?.contentType || 'image/jpeg');
    const sizeBytes = Number(body?.sizeBytes || 0);

    if (!ALLOWED_MIME.has(contentType)) {
      return reply.status(400).send({ code: 0, msg: `不支持的文件类型: ${contentType}` });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return reply.status(400).send({ code: 0, msg: '缺少有效的文件大小' });
    }
    if (sizeBytes > MAX_BYTES) {
      return reply.status(413).send({ code: 0, msg: `图片超出 ${MAX_BYTES / 1024 / 1024}MB 限制` });
    }

    const limitCheck = await checkUploadLimits(userId, sizeBytes);
    if (!limitCheck.allowed) {
      return reply.status(429).send({ code: 0, msg: limitCheck.reason });
    }

    try {
      const backend = await getStorageBackend();
      if (!backend.getPresignedPutUrl) {
        return reply.status(400).send({ code: 0, msg: '当前存储后端不支持直传，请使用 upload-base64 接口' });
      }
      const result = await backend.getPresignedPutUrl({
        filename,
        mimeType: contentType,
        sizeBytes,
        maxBytes: MAX_BYTES,
        ownerId: userId,
      });
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      if (String(e?.message || '').includes('OZON CDN 后端需要指定目标店铺')) {
        return reply.status(400).send({ code: 0, msg: '当前存储后端不支持直传，请使用 upload-base64 接口' });
      }
      return reply.status(500).send({ code: 0, msg: `获取上传凭证失败: ${e.message}` });
    }
  });

  // 浏览器直传：前端把文件 base64 编码后放 body.dataUrl，自动转存到当前后端
  app.post('/upload-base64', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { dataUrl: string; filename?: string; shopId?: string };
    if (!body?.dataUrl) return reply.status(400).send({ code: 0, msg: '缺少 dataUrl' });
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(body.dataUrl);
    if (!m) return reply.status(400).send({ code: 0, msg: 'dataUrl 格式错误，需为 data:image/...;base64,...' });
    const mime = normalizeMime(m[1]!);
    if (!ALLOWED_MIME.has(mime)) {
      return reply.status(400).send({ code: 0, msg: `不支持的图片类型: ${mime}` });
    }
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length > MAX_BYTES) {
      return reply.status(413).send({ code: 0, msg: `图片超出 ${MAX_BYTES / 1024 / 1024}MB 限制` });
    }

    const { userId } = (request as any).user;

    // 检查上传限制
    const limitCheck = await checkUploadLimits(userId, buf.length);
    if (!limitCheck.allowed) {
      return reply.status(429).send({ code: 0, msg: limitCheck.reason });
    }

    const ext = mime.split('/')[1]!.replace('jpeg', 'jpg');
    const filename = body.filename || `upload_${Date.now()}.${ext}`;
    try {
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buf, filename, mime, { category: 'raw', ownerId: userId });
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  // 通用附件上传：支持图片、PDF、Office、ZIP、纯文本（用于公告附件等）
  app.post('/upload-attachment', { bodyLimit: LARGE_BODY_LIMIT, preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const body = request.body as { dataUrl: string; filename?: string };
    if (!body?.dataUrl) return reply.status(400).send({ code: 0, msg: '缺少 dataUrl' });
    const m = /^data:([a-z0-9/+.\-]+);base64,(.+)$/i.exec(body.dataUrl);
    if (!m) return reply.status(400).send({ code: 0, msg: 'dataUrl 格式错误' });
    const mime = m[1]!.toLowerCase();
    if (!ALLOWED_ATTACHMENT_MIME.has(mime)) {
      return reply.status(400).send({ code: 0, msg: `不支持的文件类型: ${mime}` });
    }
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length > MAX_BYTES) {
      return reply.status(413).send({ code: 0, msg: `文件超出 ${MAX_BYTES / 1024 / 1024}MB 限制` });
    }

    const { userId } = (request as any).user;

    // 检查上传限制（管理员也受限）
    const limitCheck = await checkUploadLimits(userId, buf.length);
    if (!limitCheck.allowed) {
      return reply.status(429).send({ code: 0, msg: limitCheck.reason });
    }

    const ext = ATTACHMENT_EXT_MAP[mime] || 'bin';
    const safeName = (body.filename || `attachment_${Date.now()}.${ext}`).replace(/[^\w.\-]/g, '_').slice(0, 120);
    try {
      const backend = await getStorageBackend();
      const result = await backend.uploadBuffer(buf, safeName, mime, { category: 'announcement' });
      return reply.send({ code: 1, msg: 'ok', data: { url: result.url, filename: safeName, size: buf.length, mime } });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  app.post('/upload-from-url', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { url: string; shopId?: string };
    if (!body?.url) return reply.status(400).send({ code: 0, msg: '缺少 url' });
    try {
      const { userId } = (request as any).user;
      const rateCheck = await checkUploadRateLimit(userId);
      if (!rateCheck.allowed) {
        return reply.status(429).send({ code: 0, msg: rateCheck.reason });
      }

      const remoteUrl = await validateRemoteImageUrl(body.url);
      const res = await fetch(remoteUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = await readLimitedResponseBuffer(res, MAX_BYTES);

      const quotaCheck = await checkUploadQuota(userId, buf.length);
      if (!quotaCheck.allowed) {
        return reply.status(429).send({ code: 0, msg: quotaCheck.reason });
      }

      const contentType = normalizeMime(res.headers.get('content-type') || '');
      if (contentType && !ALLOWED_MIME.has(contentType)) {
        return reply.status(400).send({ code: 0, msg: `不支持的图片类型: ${contentType}` });
      }
      const detected = await sharp(buf).metadata().catch(() => null);
      if (!detected || !detected.format) {
        return reply.status(400).send({ code: 0, msg: '远程 URL 不是有效图片' });
      }
      if (buf.length > MAX_BYTES) {
        return reply.status(413).send({ code: 0, msg: '图片超出 20MB 限制' });
      }

      const filename = decodeURIComponent(remoteUrl.pathname.split('/').pop() || '') || `img_${Date.now()}.jpg`;
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buf, filename, contentType || undefined, { category: 'raw', ownerId: userId });
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  app.post('/upload-watermarked', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    const body = request.body as {
      sourceUrls: string[];
      itemId: string;
      config: WatermarkConfig;
      uploadToCdn?: boolean;
      shopId?: string;
    };
    if (!Array.isArray(body?.sourceUrls) || body.sourceUrls.length === 0) {
      return reply.status(400).send({ code: 0, msg: '缺少 sourceUrls' });
    }
    if (!body.itemId || !body.config) {
      return reply.status(400).send({ code: 0, msg: '缺少 itemId 或 config' });
    }

    const { userId } = (request as any).user;
    const results: Array<{ source: string; watermarked: string; uploaded?: string; error?: string }> = [];
    const backend = body.uploadToCdn ? await getStorageBackend(body.shopId).catch((e) => {
      throw new Error(`存储后端未配置: ${e.message}`);
    }) : null;

    for (let i = 0; i < body.sourceUrls.length; i++) {
      const src = body.sourceUrls[i]!;
      try {
        const relativePath = await applyWatermark(src, body.itemId, i, body.config);
        const entry: any = { source: src, watermarked: relativePath };

        if (backend) {
          const localPath = join(process.cwd(), 'public', relativePath.replace(/^\//, ''));
          const buf = await readFile(localPath);
          const filename = relativePath.split('/').pop() || `wm_${i}.jpg`;
          const uploaded = await backend.uploadBuffer(buf, filename, undefined, { category: 'watermarked', ownerId: userId });
          entry.uploaded = uploaded.url;
          entry.backend = uploaded.backend;
        }

        results.push(entry);
      } catch (e: any) {
        results.push({ source: src, watermarked: src, error: e.message?.slice(0, 200) });
      }
    }

    return reply.send({ code: 1, msg: 'ok', data: { results } });
  });

  app.post('/preview-watermark', async (request, reply) => {
    const body = request.body as { url: string; config: WatermarkConfig };
    if (!body?.url || !body?.config) {
      return reply.status(400).send({ code: 0, msg: '缺少 url 或 config' });
    }
    try {
      const previewId = `preview_${Date.now()}`;
      const relativePath = await applyWatermark(body.url, previewId, 0, body.config);
      return reply.send({ code: 1, msg: 'ok', data: { previewUrl: relativePath } });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `预览失败: ${e.message}` });
    }
  });

  // ─── 批量改分辨率 ───
  app.post('/batch-resize', async (request, reply) => {
    const body = request.body as {
      urls: string[];
      width?: number;
      height?: number;
      quality?: number;
      uploadToCdn?: boolean;
    };
    const { userId } = (request as any).user;

    if (!Array.isArray(body?.urls) || body.urls.length === 0) {
      return reply.status(400).send({ code: 0, msg: '缺少 urls 数组' });
    }
    if (!body.width && !body.height) {
      return reply.status(400).send({ code: 0, msg: '至少指定 width 或 height' });
    }

    const RESIZE_DIR = join(process.cwd(), 'public', 'resized');
    await mkdir(RESIZE_DIR, { recursive: true });

    const results: Array<{ source: string; resized?: string; uploaded?: string; error?: string; size?: { w: number; h: number } }> = [];
    const backend = body.uploadToCdn ? await getStorageBackend().catch(() => null) : null;

    for (const url of body.urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const pipeline = sharp(buf).resize({
          width: body.width,
          height: body.height,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const outputBuf = await pipeline.jpeg({ quality: body.quality || 90 }).toBuffer();
        const meta = await sharp(outputBuf).metadata();

        const hash = createHash('md5').update(buf).digest('hex').slice(0, 8);
        const filename = `resize_${Date.now()}_${hash}.jpg`;
        await writeFile(join(RESIZE_DIR, filename), outputBuf);
        const relativePath = `/resized/${filename}`;

        const entry: any = { source: url, resized: relativePath, size: { w: meta.width, h: meta.height } };

        if (backend) {
          try {
            const uploaded = await backend.uploadBuffer(outputBuf, filename, 'image/jpeg', { category: 'tmp', ownerId: userId });
            entry.uploaded = uploaded.url;
          } catch (e: any) {
            entry.error = `上传失败: ${e.message?.slice(0, 100)}`;
          }
        }

        results.push(entry);
      } catch (e: any) {
        results.push({ source: url, error: e.message?.slice(0, 200) });
      }
    }

    return reply.send({ code: 1, msg: 'ok', data: { results } });
  });
}

function normalizeMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}
