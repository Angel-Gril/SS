import { describe, expect, it, vi } from 'vitest';
import { createExtensionDeviceClaimAttemptLimiter } from '../services/extension-device-session-prisma.js';

describe('extension device claim attempt limiter', () => {
  it('uses one atomic Redis operation for device and keyed code digests', async () => {
    const redis = { eval: vi.fn(async (..._args: unknown[]) => 1) };
    const limiter = createExtensionDeviceClaimAttemptLimiter(redis);
    const codeDigest = 'a'.repeat(64);

    await expect(limiter({
      codeDigest,
      deviceId: 'plaintext-device-id',
      now: new Date('2026-07-12T08:00:00.000Z'),
    })).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const call = redis.eval.mock.calls[0] || [];
    expect(call[1]).toBe(2);
    expect(call[2]).toMatch(/^extension-device:claim:device:[a-f0-9]{64}$/);
    expect(call[3]).toBe(`extension-device:claim:code:${codeDigest}`);
    expect(JSON.stringify(call)).not.toContain('plaintext-device-id');
  });

  it('fails closed when either atomic attempt budget is exhausted', async () => {
    const redis = { eval: vi.fn(async (..._args: unknown[]) => 0) };
    const limiter = createExtensionDeviceClaimAttemptLimiter(redis);

    await expect(limiter({
      codeDigest: 'b'.repeat(64),
      deviceId: 'device-2',
      now: new Date(),
    })).resolves.toBe(false);
  });
});
