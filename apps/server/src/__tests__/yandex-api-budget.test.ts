import { describe, expect, it, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ eval: vi.fn(), set: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: false, redis: m }));
import { acquireYandexApiPermit, recordYandexApiCooldown } from '../services/yandex-api-budget.js';
describe('Yandex shared request budget', () => {
  beforeEach(() => { vi.clearAllMocks(); m.eval.mockResolvedValue(1); m.set.mockResolvedValue('OK'); });
  it('shares credential-scoped limits across API/Worker without exposing the key', async () => {
    await acquireYandexApiPermit('synthetic-private-key', '/v2/businesses/77/warehouses');
    expect(m.eval).toHaveBeenCalledOnce(); const args = m.eval.mock.calls[0]!;
    expect(JSON.stringify(args)).not.toContain('synthetic-private-key');
    expect(args).toContain(90); expect(args).toContain(60);
  });
  it('blocks requests when quota is exhausted or Redis is unavailable', async () => {
    m.eval.mockResolvedValue(0); await expect(acquireYandexApiPermit('fixture', '/v1/businesses/77/orders')).rejects.toThrow('频率');
    m.eval.mockRejectedValue(Error('Redis unavailable')); await expect(acquireYandexApiPermit('fixture', '/v1/businesses/77/orders')).rejects.toThrow();
  });
  it('shares business concurrency even when the business uses different keys', async () => {
    await acquireYandexApiPermit('key-one', '/v2/campaigns/123/offers', '77');
    await acquireYandexApiPermit('key-two', '/v2/campaigns/456/offers', '77');
    expect(m.eval.mock.calls[0]!.slice(2, 6)).toEqual(m.eval.mock.calls[1]!.slice(2, 6));
  });
  it('keeps low-volume operation, shipment and identifier methods under official hourly limits', async () => {
    for (const [path, limit] of [['/v1/businesses/77/operations', 900], ['/v2/campaigns/123/first-mile/shipments/8/confirm', 180], ['/v2/delivery/services', 4500], ['/v2/campaigns/123/orders/7/identifiers/status', 900]] as const) {
      await acquireYandexApiPermit('fixture', path); expect(m.eval.mock.calls.at(-1)).toContain(limit);
    }
  });
  it('bounds a provider Retry-After cooldown without automatically sending another request', async () => {
    await recordYandexApiCooldown('fixture', '7200'); expect(m.set.mock.calls[0]!.slice(-2)).toEqual(['EX', 3600]);
  });
});
