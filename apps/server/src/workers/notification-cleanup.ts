import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const READ_RETENTION_DAYS = 90;
const UNREAD_RETENTION_DAYS = 365;

let timer: NodeJS.Timeout | null = null;

async function cleanupOnce() {
  const now = new Date();
  const readCutoff = new Date(now.getTime() - READ_RETENTION_DAYS * 24 * 3600 * 1000);
  const unreadCutoff = new Date(now.getTime() - UNREAD_RETENTION_DAYS * 24 * 3600 * 1000);

  const [readDeleted, unreadDeleted, sessionsDeleted] = await Promise.all([
    prisma.notification.deleteMany({
      where: { read: true, createdAt: { lt: readCutoff } },
    }),
    prisma.notification.deleteMany({
      where: { read: false, createdAt: { lt: unreadCutoff } },
    }),
    prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
  ]);

  if (readDeleted.count > 0 || unreadDeleted.count > 0) {
    console.log(`[Cleanup] deleted ${readDeleted.count} read + ${unreadDeleted.count} unread notifications`);
  }
  if (sessionsDeleted.count > 0) {
    console.log(`[Cleanup] deleted ${sessionsDeleted.count} expired sessions`);
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
  timer = setTimeout(tick, 5 * 60 * 1000);
  registerTimer(stopNotificationCleanupWorker);
  console.log(`[NotificationCleanup] started, retention: read=${READ_RETENTION_DAYS}d, unread=${UNREAD_RETENTION_DAYS}d`);
}

export function stopNotificationCleanupWorker() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
