import { createHash } from 'node:crypto';
import { redis, redisDisabled } from './redis.js';

const RATE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local maximum = tonumber(ARGV[1])
if current >= maximum then return 0 end
current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1
`.trim();

const QUOTA_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local bytes = tonumber(ARGV[1])
local maximum = tonumber(ARGV[2])
if current + bytes > maximum then return 0 end
redis.call('INCRBY', KEYS[1], bytes)
if current == 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return 1
`.trim();

interface RedisLike {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface QuotaRecord {
  bytes: number;
  resetAt: number;
}

export class UploadLimiterUnavailableError extends Error {
  readonly code = 'UPLOAD_LIMITER_UNAVAILABLE';

  constructor() {
    super('Upload rate limiting is unavailable');
    this.name = 'UploadLimiterUnavailableError';
  }
}

function identifierHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function utcDayReset(now = new Date()): { key: string; resetAt: number; ttlSeconds: number } {
  const key = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return {
    key,
    resetAt: tomorrow.getTime(),
    ttlSeconds: Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000) + 3600),
  };
}

export class UploadLimiter {
  private readonly rateLimits = new Map<string, RateLimitRecord>();
  private readonly quotas = new Map<string, QuotaRecord>();
  private readonly redisClient: RedisLike;
  private readonly localOnly: boolean;

  constructor(options: { redisClient?: RedisLike; localOnly?: boolean } = {}) {
    this.redisClient = options.redisClient || redis;
    this.localOnly = options.localOnly ?? redisDisabled;
  }

  async checkRateLimit(userId: string, maxPerMinute: number): Promise<boolean> {
    if (this.localOnly) return this.checkMemoryRateLimit(userId, maxPerMinute);
    try {
      return Number(await this.redisClient.eval(
        RATE_SCRIPT, 1, `ss-erp:upload:rate:${identifierHash(userId)}`,
        String(maxPerMinute), '60',
      )) === 1;
    } catch (error) {
      console.error('[upload-limiter] Redis rate limit unavailable:', error instanceof Error ? error.message : error);
      throw new UploadLimiterUnavailableError();
    }
  }

  async getRateUsage(userId: string): Promise<number> {
    if (this.localOnly) {
      const record = this.rateLimits.get(`rate:${userId}`);
      return !record || Date.now() > record.resetAt ? 0 : record.count;
    }
    try {
      return Number(await this.redisClient.get(`ss-erp:upload:rate:${identifierHash(userId)}`) || 0);
    } catch (error) {
      console.error('[upload-limiter] Redis rate usage unavailable:', error instanceof Error ? error.message : error);
      throw new UploadLimiterUnavailableError();
    }
  }

  async checkDailyQuota(userId: string, bytes: number, maxBytesPerDay: number): Promise<boolean> {
    if (this.localOnly) return this.checkMemoryDailyQuota(userId, bytes, maxBytesPerDay);
    const reset = utcDayReset();
    try {
      return Number(await this.redisClient.eval(
        QUOTA_SCRIPT, 1, `ss-erp:upload:quota:${reset.key}:${identifierHash(userId)}`,
        String(bytes), String(maxBytesPerDay), String(reset.ttlSeconds),
      )) === 1;
    } catch (error) {
      console.error('[upload-limiter] Redis daily quota unavailable:', error instanceof Error ? error.message : error);
      throw new UploadLimiterUnavailableError();
    }
  }

  async getDailyUsage(userId: string): Promise<number> {
    if (this.localOnly) {
      const record = this.quotas.get(`quota:${userId}`);
      return !record || Date.now() > record.resetAt ? 0 : record.bytes;
    }
    const reset = utcDayReset();
    try {
      return Number(await this.redisClient.get(`ss-erp:upload:quota:${reset.key}:${identifierHash(userId)}`) || 0);
    } catch (error) {
      console.error('[upload-limiter] Redis daily usage unavailable:', error instanceof Error ? error.message : error);
      throw new UploadLimiterUnavailableError();
    }
  }

  cleanup(): void {
    if (!this.localOnly) return;
    const now = Date.now();
    for (const [key, record] of this.rateLimits.entries()) if (now > record.resetAt) this.rateLimits.delete(key);
    for (const [key, record] of this.quotas.entries()) if (now > record.resetAt) this.quotas.delete(key);
  }

  private checkMemoryRateLimit(userId: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const key = `rate:${userId}`;
    const record = this.rateLimits.get(key);
    if (!record || now > record.resetAt) {
      this.rateLimits.set(key, { count: 1, resetAt: now + 60 * 1000 });
      return true;
    }
    if (record.count >= maxPerMinute) return false;
    record.count += 1;
    return true;
  }

  private checkMemoryDailyQuota(userId: string, bytes: number, maxBytesPerDay: number): boolean {
    const now = Date.now();
    const key = `quota:${userId}`;
    const record = this.quotas.get(key);
    const resetAt = utcDayReset().resetAt;
    if (!record || now > record.resetAt) {
      if (bytes > maxBytesPerDay) return false;
      this.quotas.set(key, { bytes, resetAt });
      return true;
    }
    if (record.bytes + bytes > maxBytesPerDay) return false;
    record.bytes += bytes;
    return true;
  }
}

export const uploadLimiter = new UploadLimiter();

const cleanupTimer = setInterval(() => uploadLimiter.cleanup(), 60 * 60 * 1000);
cleanupTimer.unref?.();
