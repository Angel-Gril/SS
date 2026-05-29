import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { getStorageBackend } from '../services/image-storage.js';
import { applyWatermark, type WatermarkConfig } from '../services/watermark.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';

const MAX_BYTES = 20 * 1024 * 1024;

const LARGE_BODY_LIMIT = 30 * 1024 * 1024;

export async function imageUploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 浏览器直传：前端把文件 base64 编码后放 body.dataUrl，自动转存到当前后端
  app.post('/upload-base64', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { dataUrl: string; filename?: string; shopId?: string };
    if (!body?.dataUrl) return reply.status(400).send({ code: 0, msg: '缺少 dataUrl' });
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(body.dataUrl);
    if (!m) return reply.status(400).send({ code: 0, msg: 'dataUrl 格式错误，需为 data:image/...;base64,...' });
    const mime = m[1]!;
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length > MAX_BYTES) {
      return reply.status(413).send({ code: 0, msg: `图片超出 ${MAX_BYTES / 1024 / 1024}MB 限制` });
    }
    const ext = mime.split('/')[1]!.replace('jpeg', 'jpg');
    const filename = body.filename || `upload_${Date.now()}.${ext}`;
    try {
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buf, filename, mime);
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  app.post('/upload-from-url', { bodyLimit: LARGE_BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { url: string; shopId?: string };
    if (!body?.url) return reply.status(400).send({ code: 0, msg: '缺少 url' });
    try {
      const res = await fetch(body.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        return reply.status(413).send({ code: 0, msg: '图片超出 20MB 限制' });
      }
      const filename = body.url.split('/').pop()?.split('?')[0] || `img_${Date.now()}.jpg`;
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buf, filename);
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
          const uploaded = await backend.uploadBuffer(buf, filename);
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
            const uploaded = await backend.uploadBuffer(outputBuf, filename);
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
