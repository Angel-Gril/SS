import { prisma } from '../lib/prisma.js';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const READ_RETENTION_DAYS = 90;
const UNREAD_RETENTION_DAYS = 365;

let timer: NodeJS.Timeout | null = null;

async function cleanupOnce() {
  const now = Date.now();
  const readCutoff = new Date(now - READ_RETENTION_DAYS * 24 * 3600 * 1000);
  const unreadCutoff = new Date(now - UNREAD_RETENTION_DAYS * 24 * 3600 * 1000);

  const [readDeleted, unreadDeleted] = await Promise.all([
    prisma.notification.deleteMany({
      where: { read: true, createdAt: { lt: readCutoff } },
    }),
    prisma.notification.deleteMany({
      where: { read: false, createdAt: { lt: unreadCutoff } },
    }),
  ]);

  if (readDeleted.count > 0 || unreadDeleted.count > 0) {
    console.log(`[NotificationCleanup] deleted ${readDeleted.count} read + ${unreadDeleted.count} unread notifications`);
  }
}

export function startNotificationCleanupWorker() {
  if (timer) return;
  const tick = async () => {
    try {
      await cleanupOnce();
    } catch (err) {
      console.error('[NotificationCleanup] tick failed:', err);
    } finally {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
    }
  };
  // 启动后等 5 分钟再跑首次，避免冷启动占用资源
  timer = setTimeout(tick, 5 * 60 * 1000);
  console.log(`[NotificationCleanup] started, retention: read=${READ_RETENTION_DAYS}d, unread=${UNREAD_RETENTION_DAYS}d`);
}

export function stopNotificationCleanupWorker() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
