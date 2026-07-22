import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SmsResult } from '../lib/sms/types.js';

const cryptoMocks = vi.hoisted(() => ({
  randomInt: vi.fn(() => 654321),
}));
const smsMocks = vi.hoisted(() => ({
  send: vi.fn(async (): Promise<SmsResult> => (
    { ok: true, bizId: 'test-biz-id' }
  )),
}));

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomInt: cryptoMocks.randomInt,
}));
vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: smsMocks.send })),
}));

import { sendSmsCode, verifySmsCode } from '../lib/captcha.js';

vi.mock('../lib/redis.js', () => ({
  redisDisabled: false,
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
  },
}));

describe('SMS verification', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    smsMocks.send.mockResolvedValue({ ok: true, bizId: 'test-biz-id' });
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores the code atomically before invoking the paid provider', async () => {
    const { redis } = await import('../lib/redis.js');

    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result.ok).toBe(true);
    expect(smsMocks.send).toHaveBeenCalledWith('13800138000', '654321', 'register');
    const reserveCall = vi.mocked(redis.eval).mock.calls[0]!;
    expect(reserveCall[0]).toContain('sms-send-quota:reserve');
    expect(reserveCall).toContain('{sms-quota}:code:13800138000');
    expect(reserveCall).toContain('654321');
    expect(vi.mocked(redis.eval).mock.invocationCallOrder[0]).toBeLessThan(
      smsMocks.send.mock.invocationCallOrder[0]!,
    );
  });

  it('uses cryptographically secure randomness for SMS codes', async () => {
    await sendSmsCode('13800138000', 'password-reset', { ip: '203.0.113.10' });

    expect(cryptoMocks.randomInt).toHaveBeenCalledWith(100000, 1000000);
    expect(smsMocks.send).toHaveBeenCalledWith('13800138000', '654321', 'password-reset');
  });

  it('claims the purpose-specific send window atomically', async () => {
    const { redis } = await import('../lib/redis.js');

    await sendSmsCode('13800138000', 'password-reset', { ip: '203.0.113.10' });

    expect(vi.mocked(redis.eval).mock.calls[0]?.[2]).toMatch(
      /^\{sms-quota\}:rate:password-reset:[a-f0-9]{64}$/,
    );
  });

  it.each([2, 3, 4])('does not call the provider when daily quota result is %s', async (reason) => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValueOnce(reason);

    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result.ok).toBe(false);
    expect(smsMocks.send).not.toHaveBeenCalled();
  });

  it('fails closed before provider invocation when Redis is unavailable', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result).toEqual({
      ok: false,
      msg: '验证码服务暂时不可用，请稍后重试',
      errorCode: 'sms_quota_unavailable',
    });
    expect(smsMocks.send).not.toHaveBeenCalled();
  });

  it('rolls back the exact reservation when the provider rejects the send', async () => {
    const { redis } = await import('../lib/redis.js');
    smsMocks.send.mockResolvedValueOnce({ ok: false, err: 'rejected', failureKind: 'rejected' });

    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result.ok).toBe(false);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(vi.mocked(redis.eval).mock.calls[1]?.[0]).toContain('sms-send-quota:rollback');
    expect(vi.mocked(redis.eval).mock.calls[1]?.at(-1)).toBe('0');
  });

  it('retains quota and the new code when delivery status is unknown', async () => {
    const { redis } = await import('../lib/redis.js');
    smsMocks.send.mockResolvedValueOnce({ ok: false, err: 'timeout', failureKind: 'unknown' });

    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result.ok).toBe(false);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(vi.mocked(redis.eval).mock.calls[1]?.[0]).toContain('sms-send-quota:commit');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('commits a successful reservation without decrementing counters', async () => {
    const { redis } = await import('../lib/redis.js');

    await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(vi.mocked(redis.eval).mock.calls[1]?.[0]).toContain('sms-send-quota:commit');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('consumes a valid password reset code atomically', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '123456', 'password-reset');

    expect(valid).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      '{sms-quota}:code:password-reset:13800138000',
      '123456',
    );
  });

  it('should verify correct code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(1);
    vi.mocked(redis.del).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '123456');

    expect(valid).toBe(true);
    expect(redis.del).toHaveBeenCalledWith('sms:fail:13800138000');
  });

  it('should reject incorrect code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(0);
    vi.mocked(redis.incr).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '999999');

    expect(valid).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalledWith('sms:fail:13800138000');
  });

  it('should reject expired code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(-1);

    const valid = await verifySmsCode('13800138000', '123456');

    expect(valid).toBe(false);
  });

  it('should bypass SMS verification in local runtime', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.stubEnv('RUNTIME_MODE', 'local');

    const valid = await verifySmsCode('13800138000', '');

    expect(valid).toBe(true);
    expect(redis.eval).not.toHaveBeenCalled();
  });

});
