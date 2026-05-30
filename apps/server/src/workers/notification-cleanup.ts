import { startDataRetentionWorker, stopDataRetentionWorker } from './data-retention-cleanup.js';

export function startNotificationCleanupWorker() {
  startDataRetentionWorker();
}

export function stopNotificationCleanupWorker() {
  stopDataRetentionWorker();
}
