import { registerTimer } from '../lib/worker-registry.js';
import { expirePendingRechargeOrders } from '../services/recharge.js';

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const count = await expirePendingRechargeOrders();
    if (count > 0) {
      console.log(`[recharge-timeout] marked ${count} recharge orders as timeout`);
    }
  } catch (error: any) {
    console.error(`[recharge-timeout] tick failed: ${error?.message || error}`);
  } finally {
    running = false;
  }
}

export function startRechargeTimeoutWorker() {
  const intervalMs = Number(process.env.RECHARGE_TIMEOUT_WORKER_INTERVAL_MS || 5 * 60 * 1000);
  const startupDelayMs = Number(process.env.RECHARGE_TIMEOUT_WORKER_STARTUP_DELAY_MS || 60 * 1000);
  const startupTimer = setTimeout(() => {
    void tick();
  }, startupDelayMs);
  startupTimer.unref();

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  interval.unref();

  registerTimer(() => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  });
  console.log(`[recharge-timeout] worker started, interval=${intervalMs}ms`);
}
