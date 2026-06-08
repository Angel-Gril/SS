import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('REDIS_DISABLED memory fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('REDIS_DISABLED', '1');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('stores string keys with expiration and pattern scanning', async () => {
    const { redis, redisDisabled } = await import('../lib/redis.js');

    expect(redisDisabled).toBe(true);
    await redis.set('sms:code:13800138000', '123456', 'EX', 300);

    expect(await redis.get('sms:code:13800138000')).toBe('123456');
    expect(await redis.exists('sms:code:13800138000')).toBe(1);
    expect(await redis.scan('0', 'MATCH', 'sms:code:*', 'COUNT', 100)).toEqual([
      '0',
      ['sms:code:13800138000'],
    ]);

    vi.advanceTimersByTime(300_001);

    expect(await redis.get('sms:code:13800138000')).toBeNull();
    expect(await redis.exists('sms:code:13800138000')).toBe(0);
    expect(await redis.scan('0', 'MATCH', 'sms:code:*', 'COUNT', 100)).toEqual(['0', []]);
  });

  it('supports counters, expiration, and multi-key delete', async () => {
    const { redis } = await import('../lib/redis.js');

    expect(await redis.incr('login:fail:127.0.0.1')).toBe(1);
    expect(await redis.incr('login:fail:127.0.0.1')).toBe(2);
    expect(await redis.expire('login:fail:127.0.0.1', 60)).toBe(1);

    vi.advanceTimersByTime(60_001);

    expect(await redis.get('login:fail:127.0.0.1')).toBeNull();

    await redis.set('session:user-1:aaaa', '1', 'EX', 604800);
    await redis.set('session:user-1:bbbb', '1', 'EX', 604800);
    await redis.set('session:user-2:cccc', '1', 'EX', 604800);

    expect(await redis.keys('session:user-1:*')).toEqual(['session:user-1:aaaa', 'session:user-1:bbbb']);
    expect(await redis.del('session:user-1:aaaa', 'session:user-1:bbbb')).toBe(2);
    expect(await redis.keys('session:user-1:*')).toEqual([]);
    expect(await redis.keys('session:user-2:*')).toEqual(['session:user-2:cccc']);
  });
});
