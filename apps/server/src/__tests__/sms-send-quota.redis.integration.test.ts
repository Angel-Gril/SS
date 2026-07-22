import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const redisDescribe = process.env.RUN_REDIS_INTEGRATION_TESTS === '1' ? describe : describe.skip;

redisDescribe('SMS send quota Redis integration', () => {
  let redis: any;
  let commitSmsSendQuota: typeof import('../lib/sms/send-quota.js').commitSmsSendQuota;
  let reserveSmsSendQuota: typeof import('../lib/sms/send-quota.js').reserveSmsSendQuota;
  let rollbackSmsSendQuota: typeof import('../lib/sms/send-quota.js').rollbackSmsSendQuota;
  let SMS_QUOTA_HASH_TAG: typeof import('../lib/sms/send-quota.js').SMS_QUOTA_HASH_TAG;
  const cleanupKeys = new Set<string>();

  beforeAll(async () => {
    ({ redis } = await import('../lib/redis.js'));
    ({ commitSmsSendQuota, reserveSmsSendQuota, rollbackSmsSendQuota, SMS_QUOTA_HASH_TAG } = await import('../lib/sms/send-quota.js'));
    await redis.ping();
  });

  afterAll(async () => {
    if (cleanupKeys.size > 0) await redis.del(...cleanupKeys);
    await redis.quit();
  });

  it('restores the prior OTP without refunding a dispatched attempt', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const codeKey = `${SMS_QUOTA_HASH_TAG}:integration:code:${suffix}`;
    cleanupKeys.add(codeKey);
    await redis.set(codeKey, '111111', 'PX', 120_000);

    const reserved = await reserveSmsSendQuota({
      phone: `integration-phone-${suffix}`,
      ip: `integration-ip-${suffix}`,
      purpose: 'register',
      rateLimitSeconds: 60,
      dailyPerPhoneLimit: 10,
      dailyPerIpLimit: 100,
      dailyGlobalLimit: 1000,
      codeKey,
      code: '222222',
      codeTtlSeconds: 300,
      now: new Date('2099-07-22T04:00:00.000Z'),
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    reserved.reservation.keys.forEach((key) => cleanupKeys.add(key));

    expect(await redis.get(codeKey)).toBe('222222');
    await expect(rollbackSmsSendQuota(
      reserved.reservation,
      { refundQuota: false },
    )).resolves.toBe(true);

    expect(await redis.get(codeKey)).toBe('111111');
    expect(await redis.pttl(codeKey)).toBeGreaterThan(0);
    expect(await redis.get(reserved.reservation.keys[0])).toBe(reserved.reservation.token);
    for (const counterKey of reserved.reservation.keys.slice(1, 4)) {
      expect(await redis.get(counterKey)).toBe('1');
    }
    expect(await redis.exists(reserved.reservation.markerKey)).toBe(0);
  });

  it('accepts exactly the global cap under concurrency and rolls back idempotently', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const date = '2099-07-23';
    const globalKey = `${SMS_QUOTA_HASH_TAG}:day:${date}:global`;
    cleanupKeys.add(globalKey);
    await redis.del(globalKey);

    const attempts = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const codeKey = `${SMS_QUOTA_HASH_TAG}:integration:concurrent:${suffix}:${index}`;
      cleanupKeys.add(codeKey);
      return reserveSmsSendQuota({
        phone: `integration-phone-${suffix}-${index}`,
        ip: `integration-ip-${suffix}-${index}`,
        purpose: 'sms-login',
        rateLimitSeconds: 60,
        dailyPerPhoneLimit: 10,
        dailyPerIpLimit: 100,
        dailyGlobalLimit: 3,
        codeKey,
        code: String(300000 + index),
        codeTtlSeconds: 300,
        now: new Date(`${date}T04:00:00.000Z`),
      });
    }));
    const accepted = attempts.filter((result) => result.ok);
    expect(accepted).toHaveLength(3);
    expect(attempts.filter((result) => !result.ok && result.reason === 'global')).toHaveLength(7);
    expect(await redis.get(globalKey)).toBe('3');
    expect(await redis.ttl(globalKey)).toBeGreaterThan(3600);

    for (const result of accepted) {
      if (!result.ok) continue;
      result.reservation.keys.forEach((key) => cleanupKeys.add(key));
      await expect(rollbackSmsSendQuota(result.reservation)).resolves.toBe(true);
    }
    const first = accepted[0];
    if (first?.ok) await expect(rollbackSmsSendQuota(first.reservation)).resolves.toBe(false);
    expect(await redis.get(globalKey)).toBeNull();
  });

  it('blocks a second same-phone reservation while the first provider call is unsettled', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const codeKey = `${SMS_QUOTA_HASH_TAG}:integration:overlap:${suffix}`;
    cleanupKeys.add(codeKey);
    await redis.set(codeKey, '111111', 'PX', 120_000);

    const first = await reserveSmsSendQuota({
      phone: `integration-phone-${suffix}`,
      ip: `integration-ip-${suffix}`,
      purpose: 'register',
      rateLimitSeconds: 60,
      dailyPerPhoneLimit: 10,
      dailyPerIpLimit: 100,
      dailyGlobalLimit: 1000,
      codeKey,
      code: '222222',
      codeTtlSeconds: 300,
      now: new Date('2099-07-24T04:00:00.000Z'),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.reservation.keys.forEach((key) => cleanupKeys.add(key));

    // Simulate the ordinary cooldown expiring while the provider call is still pending.
    await redis.del(first.reservation.keys[0]);
    const overlapping = await reserveSmsSendQuota({
      phone: `integration-phone-${suffix}`,
      ip: `integration-ip-${suffix}`,
      purpose: 'register',
      rateLimitSeconds: 60,
      dailyPerPhoneLimit: 10,
      dailyPerIpLimit: 100,
      dailyGlobalLimit: 1000,
      codeKey,
      code: '333333',
      codeTtlSeconds: 300,
      now: new Date('2099-07-24T04:01:01.000Z'),
    });

    expect(overlapping).toEqual({ ok: false, reason: 'cooldown' });
    await expect(rollbackSmsSendQuota(first.reservation, { refundQuota: false })).resolves.toBe(true);
    expect(await redis.get(codeKey)).toBe('111111');
  });

  it('releases the in-flight lock when a provider attempt commits', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const codeKey = `${SMS_QUOTA_HASH_TAG}:integration:commit:${suffix}`;
    cleanupKeys.add(codeKey);
    const request = {
      phone: `integration-phone-${suffix}`,
      ip: `integration-ip-${suffix}`,
      purpose: 'register' as const,
      rateLimitSeconds: 60,
      dailyPerPhoneLimit: 10,
      dailyPerIpLimit: 100,
      dailyGlobalLimit: 1000,
      codeKey,
      code: '444444',
      codeTtlSeconds: 300,
      now: new Date('2099-07-25T04:00:00.000Z'),
    };
    const first = await reserveSmsSendQuota(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.reservation.keys.forEach((key) => cleanupKeys.add(key));

    await commitSmsSendQuota(first.reservation);
    await redis.del(first.reservation.keys[0]);
    const second = await reserveSmsSendQuota({ ...request, code: '555555' });

    expect(second.ok).toBe(true);
    if (second.ok) {
      second.reservation.keys.forEach((key) => cleanupKeys.add(key));
      await rollbackSmsSendQuota(second.reservation);
    }
  });
});
