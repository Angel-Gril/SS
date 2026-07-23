import { registerTimer } from '../lib/worker-registry.js';
import { getBackupRuntimeConfig, shouldRunBackupNow } from '../services/backup.service.js';
import {
  BackupRunInProgressError,
  BackupRunLeaseLostError,
  runDatabaseBackupSingleFlight,
} from '../services/backup-run.service.js';

let running = false;
let lastRunAt: Date | null = null;

async function tick() {
  if (running) return;
  try {
    const config = await getBackupRuntimeConfig();
    const now = new Date();
    if (!config.enabled) return;
    if (!shouldRunBackupNow(config.schedule, now, lastRunAt)) return;

    running = true;
    console.log(`[database-backup] 开始定时备份，schedule=${config.schedule}`);
    const result = await runDatabaseBackupSingleFlight({ trigger: 'scheduled' });
    lastRunAt = now;
    if (result.ok) {
      console.log(`[database-backup] 备份完成: ${result.localFile}${result.remoteUploaded ? `, remote=${result.remoteKey}` : ''}`);
    } else {
      console.error(`[database-backup] ${result.msg}`);
    }
  } catch (error: any) {
    if (error instanceof BackupRunInProgressError) {
      console.log('[database-backup] 已有手动或定时备份在执行，本轮跳过');
      return;
    }
    if (error instanceof BackupRunLeaseLostError) {
      console.error(`[database-backup] 备份租约失效，本轮已中止: ${error.message}`);
      return;
    }
    console.error(`[database-backup] tick failed: ${error?.message || error}`);
  } finally {
    running = false;
  }
}

export function startDatabaseBackupWorker() {
  const intervalMs = Number(process.env.BACKUP_WORKER_INTERVAL_MS || 60000);
  const startupDelayMs = Number(process.env.BACKUP_WORKER_STARTUP_DELAY_MS || 30000);
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
  console.log(`[database-backup] worker started, interval=${intervalMs}ms`);
}
