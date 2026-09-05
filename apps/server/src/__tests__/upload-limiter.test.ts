import { describe, expect, it, vi } from 'vitest';
import { UploadLimiter, UploadLimiterUnavailableError } from '../lib/upload-limiter.js';

describe('upload limiter', () => {
  it('uses hashed Redis keys and atomic scripts for cloud rate and quota checks', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      get: vi.fn(),
    };
    const limiter = new UploadLimiter({ redisClient: redis, localOnly: false });

    await expect(limiter.checkRateLimit('tenant-user-1', 5)).resolves.toBe(true);
    await expect(limiter.checkDailyQuota('tenant-user-1', 60, 100)).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(String(redis.eval.mock.calls[1]![2])).toContain(new Date().toISOString().slice(0, 10));
    for (const call of redis.eval.mock.calls) {
      expect(call[2]).toMatch(/^ss-erp:upload:(?:rate|quota):/u);
      expect(String(call[2])).not.toContain('tenant-user-1');
      expect(call[0]).toContain("redis.call('GET', KEYS[1])");
    }
  });

  it('fails closed when Redis cannot enforce a cloud limit', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      get: vi.fn(),
    };
    const limiter = new UploadLimiter({ redisClient: redis, localOnly: false });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(limiter.checkRateLimit('tenant-user-1', 5))
      .rejects.toBeInstanceOf(UploadLimiterUnavailableError);
    expect(errorLog).toHaveBeenCalledWith(
      '[upload-limiter] Redis rate limit unavailable:',
      'redis unavailable',
    );
    errorLog.mockRestore();
  });

  it('keeps the bounded in-memory implementation only for explicit local mode', async () => {
    const limiter = new UploadLimiter({
      redisClient: { eval: vi.fn(), get: vi.fn() },
      localOnly: true,
    });

    await expect(limiter.checkRateLimit('local-user', 2)).resolves.toBe(true);
    await expect(limiter.checkRateLimit('local-user', 2)).resolves.toBe(true);
    await expect(limiter.checkRateLimit('local-user', 2)).resolves.toBe(false);
    await expect(limiter.getRateUsage('local-user')).resolves.toBe(2);

    await expect(limiter.checkDailyQuota('local-user', 60, 100)).resolves.toBe(true);
    await expect(limiter.checkDailyQuota('local-user', 41, 100)).resolves.toBe(false);
    await expect(limiter.getDailyUsage('local-user')).resolves.toBe(60);
  });
});
