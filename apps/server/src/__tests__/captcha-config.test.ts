import { beforeEach, describe, expect, it, vi } from 'vitest';

const configStore = new Map<string, string>();
const sendMock = vi.fn(async () => ({ ok: true }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (!configStore.has(where.key)) return null;
        return { key: where.key, value: configStore.get(where.key) };
      }),
    },
  },
}));

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

vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: sendMock })),
}));

describe('captcha runtime config', () => {
  beforeEach(async () => {
    configStore.clear();
    sendMock.mockClear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('NODE_ENV', 'production');
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(0);
  });

  it('uses configured SMS code TTL and send interval', async () => {
    configStore.set('auth_sms_code_ttl_seconds', '600');
    configStore.set('auth_sms_rate_limit_seconds', '120');
    const { redis } = await import('../lib/redis.js');

    const { sendSmsCode } = await import('../lib/captcha.js');
    const result = await sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' });

    expect(result.ok).toBe(true);
    const reserveCall = vi.mocked(redis.eval).mock.calls[0]!;
    expect(reserveCall[0]).toContain('sms-send-quota:reserve');
    expect(reserveCall).toContain('120');
    expect(reserveCall).toContain('600');
  });

  it('retains the cost fuse when a provider throws with unknown delivery state', async () => {
    configStore.set('auth_sms_rate_limit_seconds', '120');
    const { redis } = await import('../lib/redis.js');
    sendMock.mockRejectedValueOnce(new Error('provider unavailable'));

    const { sendSmsCode } = await import('../lib/captcha.js');
    await expect(sendSmsCode('13800138000', 'register', { ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      msg: '验证码发送失败，请稍后重试',
      errorCode: 'sms_provider_failed',
    });
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(vi.mocked(redis.eval).mock.calls[1]?.[0]).toContain('sms-send-quota:commit');
    expect(redis.del).not.toHaveBeenCalled();
  });

});
