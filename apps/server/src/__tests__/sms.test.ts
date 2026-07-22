import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
  randomInt: vi.fn(() => 654321),
}));
const smsMocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ ok: true, bizId: 'test-biz-id' })),
}));

vi.mock('node:crypto', () => ({ randomInt: cryptoMocks.randomInt }));
vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: smsMocks.send })),
}));

import { sendSmsCode, verifySmsCode, verifyTurnstile } from '../lib/captcha.js';

vi.mock('../lib/redis.js', () => ({
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
  beforeEach(() => {
    vi.clearAllMocks();
    smsMocks.send.mockResolvedValue({ ok: true, bizId: 'test-biz-id' });
    vi.stubEnv('RUNTIME_MODE', 'cloud');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should generate 6-digit code and store in redis', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.set).mockResolvedValue('OK');

    const result = await sendSmsCode('13800138000');

    expect(result.ok).toBe(true);
    expect(smsMocks.send).toHaveBeenCalledWith('13800138000', '654321', 'register');
    expect(redis.set).toHaveBeenCalledWith(
      'sms:code:13800138000',
      expect.stringMatching(/^\d{6}$/),
      'EX',
      300
    );
  });

  it('uses cryptographically secure randomness for SMS codes', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.set).mockResolvedValue('OK');

    await sendSmsCode('13800138000', 'password-reset');

    expect(cryptoMocks.randomInt).toHaveBeenCalledWith(100000, 1000000);
    expect(smsMocks.send).toHaveBeenCalledWith('13800138000', '654321', 'password-reset');
    expect(redis.set).toHaveBeenCalledWith(
      'sms:code:password-reset:13800138000',
      '654321',
      'EX',
      300,
    );
  });

  it('claims the purpose-specific send window atomically', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.set).mockResolvedValue('OK');

    await sendSmsCode('13800138000', 'password-reset');

    expect(redis.set).toHaveBeenCalledWith(
      'sms:rate:password-reset:13800138000',
      '1',
      'EX',
      60,
      'NX',
    );
  });

  it('consumes a valid password reset code atomically', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.eval).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '123456', 'password-reset');

    expect(valid).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      'sms:code:password-reset:13800138000',
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

  it('should bypass Turnstile in local runtime even when NODE_ENV=production', async () => {
    vi.stubEnv('RUNTIME_MODE', 'local');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');

    await expect(verifyTurnstile('', '127.0.0.1')).resolves.toBe(true);
  });
});
