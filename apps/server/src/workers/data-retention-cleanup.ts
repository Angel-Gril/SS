import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { getConfig } from '../config/system-config-schema.js';
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DATA_RETENTION_INITIAL_DELAY_MS = 10 * 60 * 1000;
export const DATA_RETENTION_PARITY_RETRY_MS = 60 * 1000;
export const DATA_RETENTION_PARITY_BATCH_SIZE = 1_000;
export const DATA_RETENTION_PARITY_MAX_BATCHES = 10;
let timer: NodeJS.Timeout | null = null;
let workerGeneration = 0;

interface RetentionConfig {
  syncSuccessDays: number;
  syncFailedDays: number;
  notificationReadDays: number;
  notificationUnreadDays: number;
  tempImagesDays: number;
  dryRun: boolean;
}

async function loadConfig(): Promise<RetentionConfig> {
  const [syncSuccessDays, syncFailedDays, notificationReadDays, notificationUnreadDays, tempImagesDays, dryRun] = await Promise.all([
    getConfig('retention_sync_success_days'),
    getConfig('retention_sync_failed_days'),
    getConfig('retention_notification_read_days'),
    getConfig('retention_notification_unread_days'),
    getConfig('retention_temp_images_days'),
    getConfig('retention_cleanup_dry_run'),
  ]);
  return {
    syncSuccessDays,
    syncFailedDays,
    notificationReadDays,
    notificationUnreadDays,
    tempImagesDays,
    dryRun,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

export interface DataRetentionCleanupResult {
  parityObservationBacklog: boolean;
}

export async function cleanupOnce(): Promise<DataRetentionCleanupResult> {
  const cfg = await loadConfig();
  const prefix = cfg.dryRun ? '[retention][dry-run]' : '[retention]';

  // 1. Expired sessions
  const expiredSessions = await prisma.session.count({
    where: { expiresAt: { lt: new Date() } },
  });
  if (expiredSessions > 0) {
    if (!cfg.dryRun) {
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    }
    console.log(`${prefix} sessions expired=${expiredSessions}`);
  }

  // 2. Read notifications
  const readCutoff = daysAgo(cfg.notificationReadDays);
  const readCount = await prisma.notification.count({
    where: { read: true, createdAt: { lt: readCutoff } },
  });
  if (readCount > 0) {
    if (!cfg.dryRun) {
      await prisma.notification.deleteMany({ where: { read: true, createdAt: { lt: readCutoff } } });
    }
    console.log(`${prefix} notification_read=${readCount}`);
  }

  // 3. Unread notifications
  const unreadCutoff = daysAgo(cfg.notificationUnreadDays);
  const unreadCount = await prisma.notification.count({
    where: { read: false, createdAt: { lt: unreadCutoff } },
  });
  if (unreadCount > 0) {
    if (!cfg.dryRun) {
      await prisma.notification.deleteMany({ where: { read: false, createdAt: { lt: unreadCutoff } } });
    }
    console.log(`${prefix} notification_unread=${unreadCount}`);
  }

  // 4. Successful sync jobs
  const syncSuccessCutoff = daysAgo(cfg.syncSuccessDays);
  const syncSuccessCount = await prisma.syncJob.count({
    where: { status: 'SUCCESS', createdAt: { lt: syncSuccessCutoff } },
  });
  if (syncSuccessCount > 0) {
    if (!cfg.dryRun) {
      await prisma.syncJob.deleteMany({ where: { status: 'SUCCESS', createdAt: { lt: syncSuccessCutoff } } });
    }
    console.log(`${prefix} sync_success=${syncSuccessCount}`);
  }

  // 5. Failed sync jobs
  const syncFailedCutoff = daysAgo(cfg.syncFailedDays);
  const syncFailedCount = await prisma.syncJob.count({
    where: { status: 'FAILED', createdAt: { lt: syncFailedCutoff } },
  });
  if (syncFailedCount > 0) {
    if (!cfg.dryRun) {
      await prisma.syncJob.deleteMany({ where: { status: 'FAILED', createdAt: { lt: syncFailedCutoff } } });
    }
    console.log(`${prefix} sync_failed=${syncFailedCount}`);
  }

  // 6. Sanitized Ozon publisher parity observations. Approval subjects and
  // immutable decisions intentionally live in separate tables.
  const parityObservation = (prisma as any).ozonPublisherParityObservation;
  let parityObservationBacklog = false;
  if (parityObservation) {
    const expiredBefore = new Date();
    if (cfg.dryRun) {
      const expiredParityCount = await parityObservation.count({
        where: { expiresAt: { lt: expiredBefore } },
      });
      if (expiredParityCount > 0) {
        console.log(`${prefix} ozon_publisher_parity=${expiredParityCount}`);
      }
    } else {
      let deletedCount = 0;
      for (let batch = 0; batch < DATA_RETENTION_PARITY_MAX_BATCHES; batch += 1) {
        const rows = await parityObservation.findMany({
          where: { expiresAt: { lt: expiredBefore } },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
          take: DATA_RETENTION_PARITY_BATCH_SIZE + 1,
        });
        const ids = rows
          .slice(0, DATA_RETENTION_PARITY_BATCH_SIZE)
          .map(({ id }: { id: string }) => id);
        parityObservationBacklog = rows.length > DATA_RETENTION_PARITY_BATCH_SIZE;
        if (ids.length > 0) {
          const deleted = await parityObservation.deleteMany({
            where: { id: { in: ids } },
          });
          deletedCount += Number(deleted?.count) || 0;
        }
        if (!parityObservationBacklog) break;
      }
      if (deletedCount > 0 || parityObservationBacklog) {
        console.log(
          `${prefix} ozon_publisher_parity=${deletedCount}`
          + (parityObservationBacklog ? ' backlog=true' : ''),
        );
      }
    }
  }

  // 7. Temp images (local filesystem)
  const tempDirs = ['public/watermarked', 'public/resized', 'public/uploads/tmp'];
  const tempCutoff = daysAgo(cfg.tempImagesDays);
  let tempFilesCount = 0;
  for (const dir of tempDirs) {
    const fullDir = join(process.cwd(), dir);
    if (!existsSync(fullDir)) continue;
    try {
      const files = readdirSync(fullDir);
      for (const file of files) {
        const filePath = join(fullDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.isFile() && stat.mtime < tempCutoff) {
            tempFilesCount++;
            if (!cfg.dryRun) unlinkSync(filePath);
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }
  if (tempFilesCount > 0) {
    console.log(`${prefix} temp_images=${tempFilesCount}`);
  }

  return { parityObservationBacklog };
}

export function startDataRetentionWorker() {
  if (timer) return;
  const generation = ++workerGeneration;
  const tick = async () => {
    let nextDelayMs = TICK_INTERVAL_MS;
    try {
      const result = await cleanupOnce();
      if (result.parityObservationBacklog) {
        nextDelayMs = DATA_RETENTION_PARITY_RETRY_MS;
      }
    } catch (err) {
      console.error('[DataRetention] tick failed:', err);
      nextDelayMs = DATA_RETENTION_PARITY_RETRY_MS;
    } finally {
      if (workerGeneration === generation) timer = setTimeout(tick, nextDelayMs);
    }
  };
  timer = setTimeout(tick, DATA_RETENTION_INITIAL_DELAY_MS);
  registerTimer(stopDataRetentionWorker);
  console.log('[DataRetention] started (runs daily, reads config from SystemConfig)');
}

export function stopDataRetentionWorker() {
  workerGeneration += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
