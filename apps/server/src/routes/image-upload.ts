import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../lib/auth.js';
import { getStorageBackend } from '../services/image-storage.js';
import { applyWatermark } from '../services/watermark.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { uploadLimiter } from '../lib/upload-limiter.js';
import { getConfig } from '../config/system-config-schema.js';
import {
  parseBatchResizeInput,
  parseUploadFromUrlInput,
  parseWatermarkBatchInput,
  parseWatermarkPreviewInput,
} from '../services/image-processing-input.js';
import {
  IMAGE_PROCESSING_MAX_BYTES,
  IMAGE_PROCESSING_MAX_PIXELS,
  loadBoundedImageSource,
} from '../services/image-source-loader.js';

const MAX_BYTES = IMAGE_PROCESSING_MAX_BYTES;

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
    let body;
    try {
      body = parseUploadFromUrlInput(request.body);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error.issues?.[0]?.message || '参数错误' });
    }
    try {
      const { userId } = (request as any).user;
      const rateCheck = await checkUploadRateLimit(userId);
      if (!rateCheck.allowed) {
        return reply.status(429).send({ code: 0, msg: rateCheck.reason });
      }

      const source = await loadBoundedImageSource(body.url);
      const buf = source.buffer;

      const quotaCheck = await checkUploadQuota(userId, buf.length);
      if (!quotaCheck.allowed) {
        return reply.status(429).send({ code: 0, msg: quotaCheck.reason });
      }

      const contentType = normalizeMime(source.contentType);
      if (contentType && !ALLOWED_MIME.has(contentType)) {
        return reply.status(400).send({ code: 0, msg: `不支持的图片类型: ${contentType}` });
      }
      const finalUrl = new URL(source.finalUrl);
      const filename = decodeURIComponent(finalUrl.pathname.split('/').pop() || '') || `img_${Date.now()}.jpg`;
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buf, filename, contentType || undefined, { category: 'raw', ownerId: userId });
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  app.post('/upload-watermarked', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    let body;
    try {
      body = parseWatermarkBatchInput(request.body);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error.issues?.[0]?.message || '参数错误' });
    }

    const { userId } = (request as any).user;
    const rateCheck = await checkUploadRateLimit(userId);
    if (!rateCheck.allowed) return reply.status(429).send({ code: 0, msg: rateCheck.reason });
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
          const quotaCheck = await checkUploadQuota(userId, buf.length);
          if (!quotaCheck.allowed) throw new Error(quotaCheck.reason);
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
    let body;
    try {
      body = parseWatermarkPreviewInput(request.body);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error.issues?.[0]?.message || '参数错误' });
    }
    try {
      const { userId } = (request as any).user;
      const rateCheck = await checkUploadRateLimit(userId);
      if (!rateCheck.allowed) return reply.status(429).send({ code: 0, msg: rateCheck.reason });
      const previewId = `preview_${Date.now()}`;
      const relativePath = await applyWatermark(body.url, previewId, 0, body.config);
      return reply.send({ code: 1, msg: 'ok', data: { previewUrl: relativePath } });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `预览失败: ${e.message}` });
    }
  });

  // ─── 批量改分辨率 ───
  app.post('/batch-resize', async (request, reply) => {
    let body;
    try {
      body = parseBatchResizeInput(request.body);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error.issues?.[0]?.message || '参数错误' });
    }
    const { userId } = (request as any).user;
    const rateCheck = await checkUploadRateLimit(userId);
    if (!rateCheck.allowed) return reply.status(429).send({ code: 0, msg: rateCheck.reason });

    const RESIZE_DIR = join(process.cwd(), 'public', 'resized');
    await mkdir(RESIZE_DIR, { recursive: true });

    const results: Array<{ source: string; resized?: string; uploaded?: string; error?: string; size?: { w: number; h: number } }> = [];
    const backend = body.uploadToCdn ? await getStorageBackend().catch(() => null) : null;

    for (const url of body.urls) {
      try {
        const source = await loadBoundedImageSource(url);
        const buf = source.buffer;

        const pipeline = sharp(buf, { limitInputPixels: IMAGE_PROCESSING_MAX_PIXELS }).resize({
          width: body.width,
          height: body.height,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const outputBuf = await pipeline.jpeg({ quality: body.quality }).toBuffer();
        const meta = await sharp(outputBuf, { limitInputPixels: IMAGE_PROCESSING_MAX_PIXELS }).metadata();

        const hash = createHash('md5').update(buf).digest('hex').slice(0, 8);
        const filename = `resize_${Date.now()}_${hash}.jpg`;
        await writeFile(join(RESIZE_DIR, filename), outputBuf);
        const relativePath = `/resized/${filename}`;

        const entry: any = { source: url, resized: relativePath, size: { w: meta.width, h: meta.height } };

        if (backend) {
          try {
            const quotaCheck = await checkUploadQuota(userId, outputBuf.length);
            if (!quotaCheck.allowed) throw new Error(quotaCheck.reason);
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
