import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config/system-config-schema.js';

/**
 * CDN 代理路由
 *
 * 用途：
 * 1. 避免直接暴露 R2/OSS 域名，防止盗链
 * 2. 统一图片访问入口：app.ss-erp.com/cdn/*
 * 3. 支持 Referer 检查（可选）
 *
 * 路径映射：
 * /cdn/users/123/raw/2026/05/abc.jpg → R2: users/123/raw/2026/05/abc.jpg
 * /cdn/watermarked/item_456_1.jpg → R2: watermarked/item_456_1.jpg
 */

const DEFAULT_ALLOWED_REFERERS = [
  'ss-erp.com',
  'www.ss-erp.com',
  'app.ss-erp.com',
  'admin.ss-erp.com',
  'localhost',
  '127.0.0.1',
];

const ALLOWED_PREFIXES = [
  'users/',
  'announcements/',
  'system/attachments/',
  'uploads/',
  'watermarked/',
  'resized/',
];

let refererCheckCache: { value: boolean; expiresAt: number } | null = null;

async function isRefererCheckEnabled(): Promise<boolean> {
  const now = Date.now();
  if (refererCheckCache && now < refererCheckCache.expiresAt) {
    return refererCheckCache.value;
  }

  const value = await getConfig('upload_referer_check_enabled');
  refererCheckCache = { value, expiresAt: now + 5000 };
  return value;
}

function normalizeObjectKey(rawPath: string): string | null {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const key = decoded.replace(/^\/+/, '');
  if (
    !key ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return null;
  }

  return key;
}

function isAllowedReferer(referer: string): boolean {
  if (!referer) return true;

  try {
    const url = new URL(referer);
    const hostname = url.hostname.toLowerCase();
    return getAllowedRefererHosts().has(hostname);
  } catch {
    return false;
  }
}

function getAllowedRefererHosts(): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_REFERERS);
  for (const value of [
    process.env.NEXT_PUBLIC_USER_HOSTNAME,
    process.env.NEXT_PUBLIC_ADMIN_HOSTNAME,
    ...(process.env.CORS_ORIGIN || '').split(','),
  ]) {
    const host = normalizeHost(value || '');
    if (host) hosts.add(host);
  }
  return hosts;
}

function normalizeHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function cdnProxyRoutes(app: FastifyInstance) {
  app.get('/cdn/*', async (request, reply) => {
    const path = (request.params as any)['*'] as string;
    const objectKey = normalizeObjectKey(path || '');
    if (!objectKey) {
      return reply.status(400).send({ code: 0, msg: 'Invalid path' });
    }

    // Referer 检查（可选）
    const refererCheckEnabled = await isRefererCheckEnabled();
    if (refererCheckEnabled) {
      const referer = request.headers.referer || '';
      if (!isAllowedReferer(Array.isArray(referer) ? referer[0] || '' : referer)) {
        return reply.status(403).send({ code: 0, msg: 'Forbidden: Invalid referer' });
      }
    }

    try {
      const endpoint = process.env.R2_INTERNAL_URL || process.env.OSS_ENDPOINT;
      const bucket = process.env.OSS_BUCKET;
      const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.OSS_ACCESS_KEY_SECRET;

      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return reply.status(500).send({ code: 0, msg: 'OSS/R2 credentials not configured' });
      }

      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const normalizedEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      const client = new S3Client({
        endpoint: normalizedEndpoint,
        region: process.env.OSS_REGION || 'auto',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: normalizedEndpoint.includes('localhost') || normalizedEndpoint.includes('minio'),
      });

      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));

      // 转发响应头
      const contentType = result.ContentType || 'application/octet-stream';
      const contentLength = result.ContentLength;
      const etag = result.ETag;
      const lastModified = result.LastModified;

      reply.header('Content-Type', contentType);
      if (contentLength != null) reply.header('Content-Length', String(contentLength));
      if (etag) reply.header('ETag', etag);
      if (lastModified) reply.header('Last-Modified', lastModified.toUTCString());

      // 缓存策略：公开资源，1 年有效期
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');

      const body = result.Body;
      if (!body) {
        return reply.status(404).send({ code: 0, msg: 'File not found' });
      }

      return reply.send(Buffer.from(await body.transformToByteArray()));
    } catch (e: any) {
      const statusCode = e?.$metadata?.httpStatusCode;
      if (statusCode === 404 || e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey') {
        return reply.status(404).send({ code: 0, msg: 'File not found' });
      }
      return reply.status(502).send({ code: 0, msg: `Proxy error: ${e.message}` });
    }
  });
}
