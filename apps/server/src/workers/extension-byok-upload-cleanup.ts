import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { getOwnedImageStorageBackendByType } from '../services/image-storage.js';
import {
  createPrismaExtensionByokUploadStagingStore,
  reconcileExpiredExtensionByokUploads,
} from '../services/extension-byok-upload-staging.js';

const TICK_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

export async function runExtensionByokUploadCleanupTick() {
  return reconcileExpiredExtensionByokUploads({
    store: createPrismaExtensionByokUploadStagingStore(prisma as never),
    getStorage: getOwnedImageStorageBackendByType,
  });
}

export function startExtensionByokUploadCleanupWorker() {
  if (timer) return;
  const tick = async () => {
    try {
      await runExtensionByokUploadCleanupTick();
    } catch (error) {
      console.error('[ExtensionByokUploadCleanup] tick failed:', error);
    } finally {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
    }
  };
  timer = setTimeout(tick, TICK_INTERVAL_MS);
  registerTimer(stopExtensionByokUploadCleanupWorker);
  console.log('[ExtensionByokUploadCleanup] started');
}

export function stopExtensionByokUploadCleanupWorker() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}
