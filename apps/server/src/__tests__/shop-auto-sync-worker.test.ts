import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ set: vi.fn(), eval: vi.fn(), dispatch: vi.fn(), stop: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: false, redis: { set: m.set, eval: m.eval } }));
vi.mock('../lib/worker-registry.js', () => ({ registerTimer: m.stop }));
vi.mock('../services/shop-auto-sync.js', () => ({ dispatchShopAutoSync: m.dispatch }));
import { startShopAutoSyncWorker } from '../workers/shop-auto-sync.js';
describe('automatic shop sync lifetime', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); m.set.mockResolvedValue('OK'); m.eval.mockResolvedValue(1); m.dispatch.mockResolvedValue({ queued: 0, failed: 0, lastShopId: null }); });
  afterEach(() => { m.stop.mock.calls.at(-1)?.[0](); vi.useRealTimers(); });
  it('runs on the server, refreshes settings every minute and stops its timer cleanly', async () => {
    startShopAutoSyncWorker(); await vi.advanceTimersByTimeAsync(10000); expect(m.dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000); expect(m.dispatch).toHaveBeenCalledTimes(2);
    m.stop.mock.calls.at(-1)![0](); await vi.advanceTimersByTimeAsync(120000); expect(m.dispatch).toHaveBeenCalledTimes(2);
  });
  it('uses a distributed lease and never schedules if Redis cannot prove ownership', async () => {
    m.set.mockResolvedValue(null); startShopAutoSyncWorker(); await vi.advanceTimersByTimeAsync(10000); expect(m.dispatch).not.toHaveBeenCalled();
    m.set.mockRejectedValue(Error('redis')); await vi.advanceTimersByTimeAsync(60000); expect(m.dispatch).not.toHaveBeenCalled();
  });
});
