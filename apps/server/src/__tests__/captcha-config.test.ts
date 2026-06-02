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
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: sendMock })),
}));

describe('captcha runtime config', () => {
  beforeEach(() => {
    configStore.clear();
    sendMock.mockClear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('uses configured SMS code TTL and send interval', async () => {
    configStore.set('auth_sms_code_ttl_seconds', '600');
    configStore.set('auth_sms_rate_limit_seconds', '120');
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.get).mockResolvedValue(null);

    const { sendSmsCode } = await import('../lib/captcha.js');
    const result = await sendSmsCode('13800138000');

    expect(result.ok).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('sms:code:13800138000', expect.stringMatching(/^\d{6}$/), 'EX', 600);
    expect(redis.set).toHaveBeenCalledWith('sms:rate:13800138000', '1', 'EX', 120);
  });

  it('uses configured Turnstile secret instead of env secret', async () => {
    configStore.set('feature_turnstile_login', 'true');
    configStore.set('auth_turnstile_secret_key', 'db-secret');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'env-secret');
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { verifyTurnstile } = await import('../lib/captcha.js');
    await expect(verifyTurnstile('token-value', '127.0.0.1')).resolves.toBe(true);

    const body = String((fetchMock.mock.calls[0] as any)?.[1]?.body);
    expect(body).toContain('secret=db-secret');
    expect(body).not.toContain('env-secret');
  });
});
