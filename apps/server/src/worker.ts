import 'dotenv/config';
import './bootstrap-config.js';
import { startProductSyncWorker } from './workers/product-sync.js';
import { startOrderSyncWorker } from './workers/order-sync.js';
import { startWarehouseCommandPollWorker } from './workers/warehouse-command-poll.js';
import { startSoloBillingWorker } from './workers/solo-billing.js';
import { startScheduledDispatchWorker } from './workers/scheduled-dispatch.js';
import { startExchangeRateSyncWorker } from './workers/exchange-rate-sync.js';
import { startFinanceSyncWorker } from './workers/finance-sync.js';
import { startDataRetentionWorker } from './workers/data-retention-cleanup.js';
import { startOssCleanupWorker } from './workers/oss-cleanup.js';
import { startDatabaseBackupWorker } from './workers/database-backup.js';
import { startRechargeTimeoutWorker } from './workers/recharge-timeout.js';
import { shutdownAllWorkers } from './lib/worker-registry.js';

console.log('[worker] starting all workers as standalone process...');

startWarehouseCommandPollWorker();
startDataRetentionWorker();
startOssCleanupWorker();
startDatabaseBackupWorker();
startRechargeTimeoutWorker();
startProductSyncWorker();
startOrderSyncWorker();
startSoloBillingWorker();
startScheduledDispatchWorker();
startExchangeRateSyncWorker();
startFinanceSyncWorker();

console.log('[worker] all workers running');

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  try {
    await shutdownAllWorkers(30000);
    process.exit(0);
  } catch (err) {
    console.error('[worker] shutdown error:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
