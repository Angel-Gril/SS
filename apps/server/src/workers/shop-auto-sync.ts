import { randomUUID } from 'node:crypto';
import { redis, redisDisabled } from '../lib/redis.js';
import { registerTimer } from '../lib/worker-registry.js';
import { dispatchShopAutoSync } from '../services/shop-auto-sync.js';

const leaseKey = 'ss-erp:shop-auto-sync:dispatch';
const releaseLease = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
export function startShopAutoSyncWorker() {
  if (redisDisabled) return null;
  let stopped = false, afterShopId: string | undefined, timer: ReturnType<typeof setTimeout>;
  let running: Promise<void> | null = null;
  const schedule = (delay: number) => { timer = setTimeout(() => { running = tick(); }, delay); timer.unref(); };
  const tick = async () => {
    const token = randomUUID(); let acquired = false;
    try {
      acquired = await redis.set(leaseKey, token, 'PX', 55000, 'NX') === 'OK';
      if (!acquired || stopped) return;
      const result = await dispatchShopAutoSync({ afterShopId }); afterShopId = result.lastShopId ?? undefined;
      if (result.queued || result.failed) console.log('[shop-auto-sync]', { queued: result.queued, failed: result.failed });
    } catch { console.warn('[shop-auto-sync] scheduling unavailable; retained jobs will be checked next minute'); }
    finally {
      if (acquired) await redis.eval(releaseLease, 1, leaseKey, token).catch(() => undefined);
      if (!stopped) schedule(60000);
    }
  };
  const stop = async () => { stopped = true; clearTimeout(timer); await running; };
  registerTimer(stop); schedule(10000);
  return { stop };
}
