import { getConfig } from '../config/system-config-schema.js';
import { UploadLimiterUnavailableError, uploadLimiter } from '../lib/upload-limiter.js';
import { getStorageBackend, type ImageUploadResult } from './image-storage.js';
import { IMAGE_PROCESSING_MAX_BYTES } from './image-source-loader.js';

// 图片上传的唯一 owner：类型白名单、大小上限、限流/配额与落盘。
// 账号路由（routes/image-upload.ts）和设备路由（routes/extension-device.ts）共用，
// 避免两条入口各自维护一份校验。

export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type UploadLimitCheck = { allowed: true } | { allowed: false; reason: string; statusCode: 429 | 503 };

export type StoreImageResult =
  | { ok: true; data: ImageUploadResult }
  | { ok: false; statusCode: number; msg: string };

export function normalizeMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

export async function checkUploadRateLimit(userId: string): Promise<UploadLimitCheck> {
  const rateLimitEnabled = await getConfig('upload_rate_limit_enabled');
  if (rateLimitEnabled) {
    const maxPerMinute = await getConfig('upload_rate_limit_per_minute');
    if (!await uploadLimiter.checkRateLimit(userId, maxPerMinute)) {
      return { allowed: false, reason: `上传过于频繁，每分钟最多 ${maxPerMinute} 次`, statusCode: 429 };
    }
  }

  return { allowed: true };
}

export async function checkUploadQuota(userId: string, bytes: number): Promise<UploadLimitCheck> {
  const quotaEnabled = await getConfig('upload_daily_quota_enabled');
  if (quotaEnabled) {
    const maxMB = await getConfig('upload_daily_quota_mb');
    const maxBytes = maxMB * 1024 * 1024;
    if (!await uploadLimiter.checkDailyQuota(userId, bytes, maxBytes)) {
      const usedMB = Math.round(await uploadLimiter.getDailyUsage(userId) / 1024 / 1024);
      return { allowed: false, reason: `今日上传配额已用完（${usedMB}MB / ${maxMB}MB）`, statusCode: 429 };
    }
  }

  return { allowed: true };
}

export async function checkUploadLimits(userId: string, bytes: number): Promise<UploadLimitCheck> {
  try {
    const rateCheck = await checkUploadRateLimit(userId);
    if (!rateCheck.allowed) return rateCheck;
    return checkUploadQuota(userId, bytes);
  } catch (error) {
    if (!(error instanceof UploadLimiterUnavailableError)) throw error;
    return { allowed: false, reason: '上传限流服务暂不可用，请稍后重试', statusCode: 503 };
  }
}

export async function storeDataUrlImage(input: {
  ownerUserId: string;
  dataUrl: unknown;
  filename?: string;
  shopId?: string;
}): Promise<StoreImageResult> {
  if (typeof input.dataUrl !== 'string' || !input.dataUrl) {
    return { ok: false, statusCode: 400, msg: '缺少 dataUrl' };
  }
  const match = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(input.dataUrl);
  if (!match) {
    return { ok: false, statusCode: 400, msg: 'dataUrl 格式错误，需为 data:image/...;base64,...' };
  }
  const mime = normalizeMime(match[1]!);
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { ok: false, statusCode: 400, msg: `不支持的图片类型: ${mime}` };
  }
  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.length > IMAGE_PROCESSING_MAX_BYTES) {
    return { ok: false, statusCode: 413, msg: `图片超出 ${IMAGE_PROCESSING_MAX_BYTES / 1024 / 1024}MB 限制` };
  }

  const limitCheck = await checkUploadLimits(input.ownerUserId, buffer.length);
  if (!limitCheck.allowed) {
    return { ok: false, statusCode: limitCheck.statusCode, msg: limitCheck.reason };
  }

  const ext = mime.split('/')[1]!.replace('jpeg', 'jpg');
  const filename = input.filename || `upload_${Date.now()}.${ext}`;
  try {
    const backend = await getStorageBackend(input.shopId);
    const data = await backend.uploadBuffer(buffer, filename, mime, { category: 'raw', ownerId: input.ownerUserId });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, statusCode: 500, msg: `上传失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}
