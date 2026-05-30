import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

interface RetentionConfig {
  syncSuccessDays: number;
  syncFailedDays: number;
  notificationReadDays: number;
  notificationUnreadDays: number;
  tempImagesDays: number;
  dryRun: boolean;
}

async function loadConfig(): Promise<RetentionConfig> {
  const rows = await prisma.systemConfig.findMany({
    where: { group: 'retention' },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    syncSuccessDays: Number(map.get('retention_sync_success_days')) || 30,
    syncFailedDays: Number(map.get('retention_sync_failed_days')) || 180,
    notificationReadDays: Number(map.get('retention_notification_read_days')) || 90,
    notificationUnreadDays: Number(map.get('retention_notification_unread_days')) || 365,
    tempImagesDays: Number(map.get('retention_temp_images_days')) || 30,
    dryRun: map.get('retention_cleanup_dry_run') !== 'false',
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

async function cleanupOnce() {
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

  // 6. Temp images (local filesystem)
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
}

export function startDataRetentionWorker() {
  if (timer) return;
  const tick = async () => {
    try {
      await cleanupOnce();
    } catch (err) {
      console.error('[DataRetention] tick failed:', err);
    } finally {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
    }
  };
  timer = setTimeout(tick, 10 * 60 * 1000);
  registerTimer(stopDataRetentionWorker);
  console.log('[DataRetention] started (runs daily, reads config from SystemConfig)');
}

export function stopDataRetentionWorker() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
