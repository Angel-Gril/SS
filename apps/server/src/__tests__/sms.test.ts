import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSmsCode, verifySmsCode } from '../lib/captcha.js';

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

describe('SMS verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate 6-digit code and store in redis', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.set).mockResolvedValue('OK');

    const result = await sendSmsCode('13800138000');

    expect(result.ok).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'sms:code:13800138000',
      expect.stringMatching(/^\d{6}$/),
      'EX',
      300
    );
  });

  it('should verify correct code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.get).mockResolvedValue('123456');
    vi.mocked(redis.del).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '123456');

    expect(valid).toBe(true);
    expect(redis.del).toHaveBeenCalledWith('sms:code:13800138000');
  });

  it('should reject incorrect code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.get).mockResolvedValue('123456');
    vi.mocked(redis.incr).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);

    const valid = await verifySmsCode('13800138000', '999999');

    expect(valid).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalledWith('sms:fail:13800138000');
  });

  it('should reject expired code', async () => {
    const { redis } = await import('../lib/redis.js');
    vi.mocked(redis.get).mockResolvedValue(null);

    const valid = await verifySmsCode('13800138000', '123456');

    expect(valid).toBe(false);
  });
});
