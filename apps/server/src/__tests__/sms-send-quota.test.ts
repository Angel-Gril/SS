import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redisDisabled: false,
  redis: {
    eval: mocks.eval,
    get: mocks.get,
    set: mocks.set,
    del: mocks.del,
  },
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeMode: () => 'cloud',
}));

import {
  commitSmsSendQuota,
  getSmsGlobalQuotaSnapshot,
  getSmsQuotaDenialMessage,
  reserveSmsSendQuota,
  rollbackSmsSendQuota,
  SMS_QUOTA_HASH_TAG,
} from '../lib/sms/send-quota.js';

const options = {
  phone: '13800138000',
  ip: '203.0.113.10',
  purpose: 'register' as const,
  rateLimitSeconds: 60,
  dailyPerPhoneLimit: 10,
  dailyPerIpLimit: 100,
  dailyGlobalLimit: 1000,
  codeKey: `${SMS_QUOTA_HASH_TAG}:code:13800138000`,
  code: '654321',
  codeTtlSeconds: 300,
  now: new Date('2026-07-22T04:00:00.000Z'),
};

describe('SMS send quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eval.mockResolvedValue(0);
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue('OK');
    mocks.del.mockResolvedValue(1);
  });

  it('reserves cooldown and all daily buckets in one atomic Redis script', async () => {
    const result = await reserveSmsSendQuota(options);

    expect(result.ok).toBe(true);
    expect(mocks.eval).toHaveBeenCalledTimes(1);
    const [script, keyCount, ...args] = mocks.eval.mock.calls[0]!;
    expect(keyCount).toBe(7);
    expect(script).toContain('sms-send-quota:reserve');
    const keys = args.slice(0, keyCount);
    expect(keys).toEqual(expect.arrayContaining([
      expect.stringMatching(/^\{sms-quota\}:rate:register:/),
      expect.stringMatching(/^\{sms-quota\}:day:2026-07-22:phone:/),
      expect.stringMatching(/^\{sms-quota\}:day:2026-07-22:ip:/),
      `${SMS_QUOTA_HASH_TAG}:day:2026-07-22:global`,
      expect.stringMatching(/^\{sms-quota\}:reservation:/),
      options.codeKey,
      expect.stringMatching(/^\{sms-quota\}:in-flight:register:/),
    ]));
    expect(keys.every((key: string) => key.startsWith(`${SMS_QUOTA_HASH_TAG}:`))).toBe(true);
    expect(args).toContain('10');
    expect(args).toContain('100');
    expect(args).toContain('1000');
    expect(args).not.toContain(options.phone);
    expect(args).not.toContain(options.ip);
    expect(script).toContain("redis.call('PTTL', KEYS[6])");
    expect(script).toContain("'previousCode', previousCode");
  });

  it.each([
    [1, 'cooldown'],
    [2, 'phone'],
    [3, 'ip'],
    [4, 'global'],
    [-1, 'unavailable'],
  ] as const)('maps Redis reservation result %s to %s', async (redisResult, reason) => {
    mocks.eval.mockResolvedValue(redisResult);

    const result = await reserveSmsSendQuota(options);

    expect(result).toMatchObject({ ok: false, reason });
    expect(getSmsQuotaDenialMessage(reason)).toEqual(expect.any(String));
  });

  it('rolls the calendar bucket at Asia/Shanghai midnight', async () => {
    await reserveSmsSendQuota({ ...options, now: new Date('2026-07-21T15:59:59.000Z') });
    const beforeMidnightKeys = mocks.eval.mock.calls[0]!.slice(2, 9);
    mocks.eval.mockClear();

    await reserveSmsSendQuota({ ...options, now: new Date('2026-07-21T16:00:00.000Z') });
    const afterMidnightKeys = mocks.eval.mock.calls[0]!.slice(2, 9);

    expect(beforeMidnightKeys).toContain(`${SMS_QUOTA_HASH_TAG}:day:2026-07-21:global`);
    expect(afterMidnightKeys).toContain(`${SMS_QUOTA_HASH_TAG}:day:2026-07-22:global`);
  });

  it('rolls back only the matching reservation and code value', async () => {
    const reservation = await reserveSmsSendQuota(options);
    if (!reservation.ok) throw new Error('reservation should succeed');
    mocks.eval.mockResolvedValue(1);

    await rollbackSmsSendQuota(reservation.reservation);

    expect(mocks.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('sms-send-quota:rollback'),
      7,
      ...reservation.reservation.keys,
      reservation.reservation.token,
      options.code,
      '1',
    );
  });

  it('restores an unexpired prior code without refunding a dispatched attempt', async () => {
    const reservation = await reserveSmsSendQuota(options);
    if (!reservation.ok) throw new Error('reservation should succeed');
    mocks.eval.mockResolvedValue(1);

    await rollbackSmsSendQuota(reservation.reservation, { refundQuota: false });

    const [script, , ...args] = mocks.eval.mock.calls.at(-1)!;
    expect(script).toContain("redis.call('HGET', KEYS[5], 'previousCode')");
    expect(script).toContain("redis.call('SET', KEYS[6], previousCode, 'PX', remainingTtlMs)");
    expect(args.at(-1)).toBe('0');
  });

  it('commits a successful reservation by atomically clearing its marker and in-flight lock', async () => {
    const reservation = await reserveSmsSendQuota(options);
    if (!reservation.ok) throw new Error('reservation should succeed');
    mocks.eval.mockResolvedValue(1);

    await commitSmsSendQuota(reservation.reservation);

    expect(mocks.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('sms-send-quota:commit'),
      7,
      ...reservation.reservation.keys,
      reservation.reservation.token,
    );
  });

  it('reports global usage and the next Shanghai reset to administrators', async () => {
    mocks.get.mockResolvedValue('321');

    await expect(getSmsGlobalQuotaSnapshot(
      1000,
      new Date('2026-07-22T04:00:00.000Z'),
    )).resolves.toEqual({
      available: true,
      date: '2026-07-22',
      used: 321,
      limit: 1000,
      remaining: 679,
      resetAt: '2026-07-22T16:00:00.000Z',
    });
  });
});
